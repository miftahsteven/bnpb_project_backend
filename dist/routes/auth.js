"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const md5_1 = __importDefault(require("md5"));
const jwt_1 = require("../lib/jwt");
const authRoutes = async (app) => {
    app.post("/login", async (req, reply) => {
        const { username, password } = req.body;
        if (!username || !password)
            return reply.status(400).send({ message: "username & password required" });
        const user = await prisma_1.prisma.users.findFirst({ where: { username } });
        if (!user || !user.password)
            return reply.status(401).send({ message: "Invalid credentials" });
        console.log("username dan password ditemukan, verifikasi password...", username, password);
        // Deteksi format hash
        const isBcrypt = typeof user.password === "string" &&
            (user.password.startsWith("$2a$") || user.password.startsWith("$2b$") || user.password.startsWith("$2y$"));
        let match = false;
        if (isBcrypt) {
            match = await bcryptjs_1.default.compare(password, user.password);
        }
        else {
            // Verifikasi MD5 lama
            const md5Hex = (0, md5_1.default)(password);
            match = md5Hex === user.password;
            // Migrasi ke bcrypt jika cocok
            if (match) {
                try {
                    const newHash = await bcryptjs_1.default.hash(password, 10);
                    await prisma_1.prisma.users.update({ where: { id: user.id }, data: { password: newHash } });
                }
                catch (e) {
                    req.log.warn({ err: e }, "password migration to bcrypt failed (login continues)");
                }
            }
        }
        if (!match)
            return reply.status(401).send({ message: "Invalid credentials" });
        const token = (0, jwt_1.signToken)({ id: user.id, role: user.role, satker_id: user.satker_id });
        await prisma_1.prisma.users.update({ where: { id: user.id }, data: { token } });
        reply.send({
            message: "Login success",
            token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                satker_id: user.satker_id,
            },
        });
    });
};
exports.default = authRoutes;
