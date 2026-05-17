"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE = void 0;
const prisma_1 = require("../lib/prisma");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const bcrypt = __importStar(require("bcryptjs"));
const guards_1 = require("../lib/guards");
const hashid_1 = require("../utils/hashid");
const { authenticator } = require("otplib");
const QRCode = __importStar(require("qrcode"));
// ===== ROLES (integer) =====
exports.ROLE = {
    SUPERADMIN: 1,
    ADMIN: 2,
    MANAGER: 3,
};
// ===== Helpers =====
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL_SEC = 24 * 60 * 60; // 24 jam
function signToken(payload) {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL_SEC });
}
/**
 * Password check:
 * - Jika hash bcrypt (prefix $2), gunakan bcrypt.compare
 * - Jika bukan hash, fallback plain compare (untuk data lama)
 */
async function verifyPassword(input, stored) {
    if (!stored)
        return false;
    // ✅ bcrypt
    if (stored.startsWith("$2")) {
        try {
            return await bcrypt.compare(input, stored);
        }
        catch {
            return false;
        }
    }
    // ✅ MD5 32-character hex
    if (/^[a-f0-9]{32}$/i.test(stored)) {
        const md5 = crypto_1.default.createHash("md5").update(input).digest("hex");
        return md5 === stored;
    }
    // ✅ fallback plaintext
    return input === stored;
}
// Bearer auth preHandler
const authBearer = async (req, reply) => {
    // 1. Validasi User-Agent (Pencegahan untuk curl, postman, dsb di terminal)
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    if (!userAgent ||
        userAgent.includes('curl') ||
        userAgent.includes('postman') ||
        userAgent.includes('wget') ||
        userAgent.includes('insomnia') ||
        userAgent.includes('httpie')) {
        return reply.code(403).send({
            error: 'Forbidden: Access from terminal or non-browser clients is not allowed.'
        });
    }
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Missing/invalid Authorization header" });
    }
    const token = auth.slice("Bearer ".length).trim();
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        // Cek juga di DB agar token bisa direvoke (logout)
        const user = await prisma_1.prisma.users.findUnique({
            where: { id: decoded.id },
            select: { id: true, role: true, satker_id: true, status: true, token: true },
        });
        if (!user || user.status !== 1 || user.token !== token) {
            return reply.code(401).send({ error: "Token invalid or revoked" });
        }
        // 3. Validasi domain origin (whitelist) — wajib untuk otentikasi via token Bearer
        const requestDomain = (0, guards_1.extractOriginDomain)(req);
        if (!requestDomain) {
            return reply.code(403).send({
                error: 'Forbidden: Request origin cannot be determined. Domain validation failed.',
            });
        }
        const isAllowed = guards_1.DASHBOARD_ALLOWED_DOMAINS.some((allowed) => requestDomain === allowed || requestDomain.endsWith(`.${allowed}`));
        if (!isAllowed) {
            return reply.code(403).send({
                error: `Forbidden: Domain "${requestDomain}" is not allowed to access resources.`,
            });
        }
        req.user = { id: user.id, role: user.role ?? decoded.role, satker_id: user.satker_id ?? null };
    }
    catch (e) {
        return reply.code(401).send({ error: "Invalid/expired token" });
    }
};
const usersRoutes = async (app) => {
    // ===========================
    // LOGIN (no auth)
    // ===========================
    app.post("/users/login", async (req, reply) => {
        const body = (req.body || {});
        const { username, password, otp_code } = body;
        if (!username || !password) {
            return reply.code(400).send({ error: "username & password required" });
        }
        const user = await prisma_1.prisma.users.findFirst({
            where: { username },
            select: {
                id: true,
                username: true,
                password: true,
                name: true,
                role: true,
                satker_id: true,
                status: true,
                failedLogin: true,
                lastFailedAt: true,
                twoFactorSecret: true,
                satuanKerja: {
                    select: {
                        id: true,
                        name: true,
                        prov_id: true,
                        citiy_id: true
                    }
                }
            },
        });
        if (!user || user.status !== 1) {
            return reply.code(401).send({ error: "Username atau Password Salah" });
        }
        // --- RATE LIMITING CHECK ---
        const MAX_ATTEMPTS = 3;
        const LOCKOUT_MINUTES = 3;
        if (user.failedLogin && user.failedLogin >= MAX_ATTEMPTS) {
            if (user.lastFailedAt) {
                const now = new Date();
                const diffMs = now.getTime() - user.lastFailedAt.getTime();
                const diffMins = diffMs / (1000 * 60);
                if (diffMins < LOCKOUT_MINUTES) {
                    return reply.code(429).send({ error: `Sudah 3x login salah, menunggu ${LOCKOUT_MINUTES} menit.` });
                }
                else {
                    // Reset kesempatannya karena sudah lebih dari 3 menit
                    await prisma_1.prisma.users.update({
                        where: { id: user.id },
                        data: { failedLogin: 0, lastFailedAt: null }
                    });
                }
            }
        }
        const ok = await verifyPassword(password, user.password || undefined);
        if (!ok) {
            // INCREMENT FAILED LOGIN
            const currentFails = (user.failedLogin || 0) + 1;
            await prisma_1.prisma.users.update({
                where: { id: user.id },
                data: { failedLogin: currentFails, lastFailedAt: new Date() }
            });
            if (currentFails >= MAX_ATTEMPTS) {
                return reply.code(429).send({ error: `Sudah 3x login salah, menunggu ${LOCKOUT_MINUTES} menit.` });
            }
            return reply.code(401).send({ error: "Username atau Password Salah" });
        }
        // --- GOOGLE AUTHENTICATOR (MFA) CHECK ---
        if (!user.twoFactorSecret) {
            const secret = authenticator.generateSecret();
            const otpauth = authenticator.keyuri(user.username || user.id.toString(), "Sistem MRB BNPB", secret);
            const imageUrl = await QRCode.toDataURL(otpauth);
            return reply.send({
                requires_setup: true,
                secret: secret,
                qrcode: imageUrl,
                message: "MFA belum terkonfigurasi. Silahkan pelajari QRCode berikut.",
            });
        }
        else {
            if (!otp_code) {
                return reply.code(403).send({ error: "Anda sudah melakukan register. Silahkan Masukan Code OTP Anda" });
            }
            const isValid = authenticator.verify({ token: otp_code, secret: user.twoFactorSecret });
            if (!isValid) {
                // INCREMENT FAILED LOGIN PADA OTP SALAH
                const currentFails = (user.failedLogin || 0) + 1;
                await prisma_1.prisma.users.update({
                    where: { id: user.id },
                    data: { failedLogin: currentFails, lastFailedAt: new Date() }
                });
                return reply.code(401).send({ error: "Kode Autentikator Tidak Valid" });
            }
        }
        // Generate JWT 24 jam & simpan di DB
        const token = signToken({ id: user.id, role: user.role ?? exports.ROLE.ADMIN, satker_id: user.satker_id ?? null });
        // Sukses Login: Reset counter failure
        await prisma_1.prisma.users.update({
            where: { id: user.id },
            data: { token, failedLogin: 0, lastFailedAt: null },
        });
        return reply.send({
            id: (0, hashid_1.encodeId)(user.id),
            name: user.name,
            username: user.username,
            role: user.role ?? null,
            satker_id: user.satker_id ?? null,
            satker_name: user.satuanKerja ? user.satuanKerja.name : null,
            token,
            expiresIn: TOKEN_TTL_SEC,
        });
    });
    // ===========================
    // SETUP MFA MANUAL (auth required)
    // ===========================
    app.post("/users/setup-mfa", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user)
            return reply.code(401).send({ error: "Unauthorized" });
        const secret = authenticator.generateSecret();
        const otpauth = authenticator.keyuri(req.user.id.toString(), "Sistem MRB BNPB", secret);
        const imageUrl = await QRCode.toDataURL(otpauth);
        // Simpan secret ke DB user
        await prisma_1.prisma.users.update({
            where: { id: req.user.id },
            data: { twoFactorSecret: secret }
        });
        return reply.send({ secret, qrcode: imageUrl });
    });
    // ===========================
    // VERIFY FIRST-TIME MFA SETUP
    // ===========================
    app.post("/users/verify-mfa-setup", async (req, reply) => {
        const body = (req.body || {});
        const { username, password, secret, otp_code } = body;
        if (!username || !password || !secret || !otp_code) {
            return reply.code(400).send({ error: "Data tidak lengkap untuk setup MFA." });
        }
        const user = await prisma_1.prisma.users.findFirst({
            where: { username },
            select: {
                id: true, password: true, name: true, role: true, satker_id: true, status: true, twoFactorSecret: true,
                satuanKerja: { select: { id: true, name: true, prov_id: true, citiy_id: true } }
            }
        });
        if (!user || user.status !== 1)
            return reply.code(401).send({ error: "Username/Password tidak valid." });
        // Re-verify password to secure the endpoint completely
        const ok = await verifyPassword(password, user.password || undefined);
        if (!ok)
            return reply.code(401).send({ error: "Username/Password tidak valid." });
        if (user.twoFactorSecret) {
            return reply.code(400).send({ error: "MFA sudah terkonfigurasi pada akun ini." });
        }
        const isValid = authenticator.verify({ token: otp_code, secret });
        if (!isValid) {
            return reply.code(401).send({ error: "Kode OTP Salah." });
        }
        // Simpan secret, generate token, sukses.
        const token = signToken({ id: user.id, role: user.role ?? exports.ROLE.ADMIN, satker_id: user.satker_id ?? null });
        await prisma_1.prisma.users.update({
            where: { id: user.id },
            data: { twoFactorSecret: secret, failedLogin: 0, lastFailedAt: null, token }
        });
        return reply.send({
            id: (0, hashid_1.encodeId)(user.id),
            name: user.name,
            username,
            role: user.role ?? null,
            satker_id: user.satker_id ?? null,
            satker_name: user.satuanKerja ? user.satuanKerja.name : null,
            token,
            expiresIn: TOKEN_TTL_SEC,
        });
    });
    // GET ME (auth)
    app.get("/users/me", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user)
            return reply.code(401).send({ error: "Unauthorized" });
        const user = await prisma_1.prisma.users.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                username: true,
                name: true,
                role: true,
                satker_id: true,
                status: true,
                satuanKerja: { select: { id: true, name: true, prov_id: true, citiy_id: true } },
            },
        });
        if (!user || user.status !== 1)
            return reply.code(401).send({ error: "Unauthorized" });
        return reply.send({ ...user, id: (0, hashid_1.encodeId)(user.id) });
    });
    // ===========================
    // GET ROLE
    // ===========================
    app.get("/users/getRole", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user)
            return reply.code(401).send({ error: "Unauthorized" });
        const user = await prisma_1.prisma.users.findUnique({
            where: { id: req.user.id },
            select: {
                role: true,
                status: true,
            },
        });
        if (!user || user.status !== 1)
            return reply.code(401).send({ error: "Unauthorized" });
        return reply.send({ role: user.role });
    });
    // LOGOUT (auth)
    app.post("/users/logout", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user)
            return reply.code(401).send({ error: "Unauthorized" });
        await prisma_1.prisma.users.update({
            where: { id: req.user.id },
            data: { token: null },
        });
        return reply.send({ ok: true });
    });
    // ===========================
    // LIST (SUPERADMIN & MANAGER)
    // ===========================
    app.get("/users", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user)
            return reply.code(401).send({ error: "Unauthorized" });
        if (![exports.ROLE.SUPERADMIN, exports.ROLE.MANAGER].includes(req.user.role)) {
            return reply.code(403).send({ error: "Forbidden" });
        }
        const users = await prisma_1.prisma.users.findMany({
            orderBy: { id: "desc" },
            select: {
                id: true,
                username: true,
                name: true,
                role: true,
                status: true,
                satker_id: true,
                satuanKerja: {
                    select: { id: true, name: true, prov_id: true, citiy_id: true },
                },
            },
        });
        return reply.send(users.map(u => ({ ...u, id: (0, hashid_1.encodeId)(u.id) })));
    });
    // ===========================
    // DETAIL (SUPERADMIN & MANAGER)
    // ===========================
    app.get("/users/:id", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user)
            return reply.code(401).send({ error: "Unauthorized" });
        if (req.user.role !== exports.ROLE.SUPERADMIN && req.user.role !== exports.ROLE.MANAGER) {
            return reply.code(403).send({ error: "Forbidden" });
        }
        const id = (0, hashid_1.decodeId)(req.params.id);
        if (id === null)
            return reply.code(400).send({ error: "Invalid id" });
        const user = await prisma_1.prisma.users.findUnique({
            where: { id },
            select: {
                id: true,
                username: true,
                name: true,
                role: true,
                status: true,
                satker_id: true,
                satuanKerja: { select: { id: true, name: true, prov_id: true, citiy_id: true } },
            },
        });
        if (!user)
            return reply.code(404).send({ error: "Not found" });
        return reply.send({ ...user, id: (0, hashid_1.encodeId)(user.id) });
    });
    // ===========================
    // CREATE (SUPERADMIN only)
    // ===========================
    app.post("/users", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user)
            return reply.code(401).send({ error: "Unauthorized" });
        if (req.user.role !== exports.ROLE.SUPERADMIN) {
            return reply.code(403).send({ error: "Forbidden" });
        }
        const body = (req.body || {});
        if (!body.username || !body.password) {
            return reply.code(400).send({ error: "username & password required" });
        }
        // Hash password (opsional): kalau mau plaintext, hapus hashing
        const hash = await bcrypt.hash(body.password, 10);
        const created = await prisma_1.prisma.users.create({
            data: {
                username: body.username,
                password: hash,
                name: body.name ?? null,
                role: body.role ?? exports.ROLE.ADMIN, // default admin
                satker_id: body.satker_id ?? null,
                status: body.status ?? 1,
            },
        });
        return reply.code(201).send({ id: (0, hashid_1.encodeId)(created.id) });
    });
    // ===========================
    // UPDATE (SUPERADMIN only)
    // ===========================
    app.put("/users/:id", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user)
            return reply.code(401).send({ error: "Unauthorized" });
        if (req.user.role !== exports.ROLE.SUPERADMIN) {
            return reply.code(403).send({ error: "Forbidden" });
        }
        const id = (0, hashid_1.decodeId)(req.params.id);
        if (id === null)
            return reply.code(400).send({ error: "Invalid id" });
        const body = (req.body || {});
        const data = {};
        if (body.username != null)
            data.username = body.username;
        if (body.name != null)
            data.name = body.name;
        if (body.role != null)
            data.role = body.role;
        if (body.satker_id !== undefined)
            data.satker_id = body.satker_id;
        if (body.status != null)
            data.status = body.status;
        if (body.password) {
            data.password = await bcrypt.hash(body.password, 10);
        }
        await prisma_1.prisma.users.update({
            where: { id },
            data,
        });
        return reply.send({ ok: true });
    });
    // ===========================
    // DELETE (SUPERADMIN only)
    // ===========================
    app.delete("/users/:id", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user)
            return reply.code(401).send({ error: "Unauthorized" });
        if (req.user.role !== exports.ROLE.SUPERADMIN) {
            return reply.code(403).send({ error: "Forbidden" });
        }
        const id = (0, hashid_1.decodeId)(req.params.id);
        if (id === null)
            return reply.code(400).send({ error: "Invalid id" });
        await prisma_1.prisma.users.delete({ where: { id } });
        return reply.send({ ok: true });
    });
    app.get("/users/satuan-kerja", { preHandler: authBearer }, async (req, reply) => {
        const satkerList = await prisma_1.prisma.satuanKerja.findMany({
            orderBy: { name: "asc" },
            select: {
                id: true,
                name: true,
            },
        });
        return reply.send(satkerList);
    });
};
exports.default = usersRoutes;
