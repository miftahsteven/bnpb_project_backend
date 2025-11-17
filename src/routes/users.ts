import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import crypto, { randomUUID } from "crypto";
import * as bcrypt from "bcryptjs";
import { log } from "console";

// ===== ROLES (integer) =====
export const ROLE = {
    SUPERADMIN: 1,
    ADMIN: 2,
    MANAGER: 3,
} as const;

// ===== Auth types augmentation =====
declare module "fastify" {
    interface FastifyRequest {
        user?: {
            id: number;
            role: number;
            satker_id?: number | null;
            satuanKerja?: {
                id: number;
                name: string;
            };
        }
    }
}

// ===== Helpers =====
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL_SEC = 24 * 60 * 60; // 24 jam

function signToken(payload: { id: number; role: number; satker_id?: number | null }) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL_SEC });
}

/**
 * Password check:
 * - Jika hash bcrypt (prefix $2), gunakan bcrypt.compare
 * - Jika bukan hash, fallback plain compare (untuk data lama)
 */
async function verifyPassword(input: string, stored?: string | null): Promise<boolean> {
    if (!stored) return false;

    // ✅ bcrypt
    if (stored.startsWith("$2")) {
        try {
            return await bcrypt.compare(input, stored);
        } catch {
            return false;
        }
    }

    // ✅ MD5 32-character hex
    if (/^[a-f0-9]{32}$/i.test(stored)) {
        const md5 = crypto.createHash("md5").update(input).digest("hex");
        return md5 === stored;
    }

    // ✅ fallback plaintext
    return input === stored;
}

// Bearer auth preHandler
const authBearer = async (req: FastifyRequest, reply: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Missing/invalid Authorization header" });
    }
    const token = auth.slice("Bearer ".length).trim();
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: number; role: number; satker_id?: number | null; exp: number };
        // Cek juga di DB agar token bisa direvoke (logout)
        const user = await prisma.users.findUnique({
            where: { id: decoded.id },
            select: { id: true, role: true as any, satker_id: true as any, status: true as any, token: true },
        } as any);

        if (!user || user.status !== 1 || user.token !== token) {
            return reply.code(401).send({ error: "Token invalid or revoked" });
        }

        req.user = { id: user.id, role: (user as any).role ?? decoded.role, satker_id: user.satker_id ?? null };
    } catch (e) {
        return reply.code(401).send({ error: "Invalid/expired token" });
    }
};

const usersRoutes: FastifyPluginAsync = async (app) => {
    // ===========================
    // LOGIN (no auth)
    // ===========================
    app.post("/users/login", async (req, reply) => {
        const body = (req.body || {}) as { username?: string; password?: string };
        const { username, password } = body;

        if (!username || !password) {
            return reply.code(400).send({ error: "username & password required" });
        }

        const user = await prisma.users.findFirst({
            where: { username },
            select: {
                id: true,
                username: true,
                password: true,
                name: true,
                role: true as any,
                satker_id: true as any,
                status: true as any,
                satuanKerja: {
                    select: {
                        id: true,
                        name: true,
                        prov_id: true,
                        citiy_id: true
                    }
                }
            },
        } as any);

        if (!user || user.status !== 1) {
            return reply.code(401).send({ error: "Username atau Password Salah" });
        }

        const ok = await verifyPassword(password, user.password || undefined);
        //console.log("Password verification result:");

        if (!ok) {
            return reply.code(401).send({ error: "Invalid credentials" });
        }

        // Generate JWT 24 jam & simpan di DB
        const token = signToken({ id: user.id, role: (user as any).role ?? ROLE.ADMIN, satker_id: user.satker_id ?? null });

        await prisma.users.update({
            where: { id: user.id },
            data: { token },
        });

        return reply.send({
            id: user.id,
            name: user.name,
            username: user.username,
            role: (user as any).role ?? null,
            satker_id: user.satker_id ?? null,
            satker_name: (user as any).satuanKerja ? (user as any).satuanKerja.name : null,
            token,
            expiresIn: TOKEN_TTL_SEC,
        });
    });

    // LOGOUT (auth)
    app.post("/users/logout", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user) return reply.code(401).send({ error: "Unauthorized" });
        await prisma.users.update({
            where: { id: req.user.id },
            data: { token: null },
        });
        return reply.send({ ok: true });
    });

    // ===========================
    // LIST (SUPERADMIN & MANAGER)
    // ===========================
    app.get("/users", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user) return reply.code(401).send({ error: "Unauthorized" });
        // if (![ROLE.SUPERADMIN, ROLE.MANAGER].includes(req.user.role)) {
        //     return reply.code(403).send({ error: "Forbidden" });
        // }

        const users = await prisma.users.findMany({
            orderBy: { id: "desc" },
            select: {
                id: true,
                username: true,
                name: true,
                role: true as any,
                status: true as any,
                satker_id: true as any,
                satuanKerja: {
                    select: { id: true, name: true, prov_id: true, citiy_id: true },
                },
            },
        } as any);

        return reply.send(users);
    });

    // ===========================
    // DETAIL (SUPERADMIN & MANAGER)
    // ===========================
    app.get<{
        Params: { id: string };
    }>("/users/:id", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user) return reply.code(401).send({ error: "Unauthorized" });
        if (req.user.role !== ROLE.SUPERADMIN && req.user.role !== ROLE.MANAGER) {
            return reply.code(403).send({ error: "Forbidden" });
        }

        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid id" });

        const user = await prisma.users.findUnique({
            where: { id },
            select: {
                id: true,
                username: true,
                name: true,
                role: true as any,
                status: true as any,
                satker_id: true as any,
                satuanKerja: { select: { id: true, name: true, prov_id: true, citiy_id: true } },
            },
        } as any);

        if (!user) return reply.code(404).send({ error: "Not found" });
        return reply.send(user);
    });

    // ===========================
    // CREATE (SUPERADMIN only)
    // ===========================
    app.post("/users", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user) return reply.code(401).send({ error: "Unauthorized" });
        if (req.user.role !== ROLE.SUPERADMIN) {
            return reply.code(403).send({ error: "Forbidden" });
        }

        const body = (req.body || {}) as {
            username?: string;
            password?: string;
            name?: string;
            role?: number;
            satker_id?: number | null;
            status?: number;
        };

        if (!body.username || !body.password) {
            return reply.code(400).send({ error: "username & password required" });
        }

        // Hash password (opsional): kalau mau plaintext, hapus hashing
        const hash = await bcrypt.hash(body.password, 10);

        const created = await prisma.users.create({
            data: {
                username: body.username,
                password: hash,
                name: body.name ?? null,
                role: body.role ?? ROLE.ADMIN, // default admin
                satker_id: body.satker_id ?? null,
                status: body.status ?? 1,
            } as any,
        });

        return reply.code(201).send({ id: created.id });
    });

    // ===========================
    // UPDATE (SUPERADMIN only)
    // ===========================
    app.put<{
        Params: { id: string };
    }>("/users/:id", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user) return reply.code(401).send({ error: "Unauthorized" });
        if (req.user.role !== ROLE.SUPERADMIN) {
            return reply.code(403).send({ error: "Forbidden" });
        }

        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid id" });

        const body = (req.body || {}) as {
            username?: string;
            password?: string;
            name?: string;
            role?: number;
            satker_id?: number | null;
            status?: number;
        };

        const data: any = {};
        if (body.username != null) data.username = body.username;
        if (body.name != null) data.name = body.name;
        if (body.role != null) data.role = body.role;
        if (body.satker_id !== undefined) data.satker_id = body.satker_id;
        if (body.status != null) data.status = body.status;
        if (body.password) {
            data.password = await bcrypt.hash(body.password, 10);
        }

        await prisma.users.update({
            where: { id },
            data,
        });

        return reply.send({ ok: true });
    });

    // ===========================
    // DELETE (SUPERADMIN only)
    // ===========================
    app.delete<{
        Params: { id: string };
    }>("/users/:id", { preHandler: authBearer }, async (req, reply) => {
        if (!req.user) return reply.code(401).send({ error: "Unauthorized" });
        if (req.user.role !== ROLE.SUPERADMIN) {
            return reply.code(403).send({ error: "Forbidden" });
        }

        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid id" });

        await prisma.users.delete({ where: { id } });
        return reply.send({ ok: true });
    });
};

export default usersRoutes;
