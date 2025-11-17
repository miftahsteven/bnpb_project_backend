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
const prisma_1 = require("@/lib/prisma");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const bcrypt = __importStar(require("bcryptjs"));
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
        const { username, password } = body;
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
        const ok = await verifyPassword(password, user.password || undefined);
        //console.log("Password verification result:");
        if (!ok) {
            return reply.code(401).send({ error: "Invalid credentials" });
        }
        // Generate JWT 24 jam & simpan di DB
        const token = signToken({ id: user.id, role: user.role ?? exports.ROLE.ADMIN, satker_id: user.satker_id ?? null });
        await prisma_1.prisma.users.update({
            where: { id: user.id },
            data: { token },
        });
        return reply.send({
            id: user.id,
            name: user.name,
            username: user.username,
            role: user.role ?? null,
            satker_id: user.satker_id ?? null,
            satker_name: user.satuanKerja ? user.satuanKerja.name : null,
            token,
            expiresIn: TOKEN_TTL_SEC,
        });
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
        return reply.send(users);
    });
    // ===========================
    // DETAIL (SUPERADMIN & MANAGER)
    // ===========================
    app.get("/users/:id", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user)
            return reply.code(401).send({ error: "Unauthorized" });
        if (![exports.ROLE.SUPERADMIN, exports.ROLE.MANAGER].includes(req.user.role)) {
            return reply.code(403).send({ error: "Forbidden" });
        }
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
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
        return reply.send(user);
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
        return reply.code(201).send({ id: created.id });
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
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
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
        const id = Number(req.params.id);
        if (!Number.isFinite(id))
            return reply.code(400).send({ error: "Invalid id" });
        await prisma_1.prisma.users.delete({ where: { id } });
        return reply.send({ ok: true });
    });
};
exports.default = usersRoutes;
