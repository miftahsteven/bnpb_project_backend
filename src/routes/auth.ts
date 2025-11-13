import { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma";
import bcrypt from "bcryptjs";
import md5 from "md5";
import { signToken } from "../lib/jwt";
import { ROLE } from "../constants/roles";

const authRoutes: FastifyPluginAsync = async (app) => {
    app.post("/login", async (req, reply) => {
        const { username, password } = req.body as any;
        if (!username || !password) return reply.status(400).send({ message: "username & password required" });

        const user = await prisma.users.findFirst({ where: { username } });
        if (!user || !user.password) return reply.status(401).send({ message: "Invalid credentials" });

        console.log("username dan password ditemukan, verifikasi password...", username, password);


        // Deteksi format hash
        const isBcrypt =
            typeof user.password === "string" &&
            (user.password.startsWith("$2a$") || user.password.startsWith("$2b$") || user.password.startsWith("$2y$"));

        let match = false;

        if (isBcrypt) {
            match = await bcrypt.compare(password, user.password);
        } else {
            // Verifikasi MD5 lama
            const md5Hex = md5(password);
            match = md5Hex === user.password;
            // Migrasi ke bcrypt jika cocok
            if (match) {
                try {
                    const newHash = await bcrypt.hash(password, 10);
                    await prisma.users.update({ where: { id: user.id }, data: { password: newHash } });
                } catch (e) {
                    req.log.warn({ err: e }, "password migration to bcrypt failed (login continues)");
                }
            }
        }

        if (!match) return reply.status(401).send({ message: "Invalid credentials" });

        const token = signToken({ id: user.id, role: user.role, satker_id: user.satker_id });
        await prisma.users.update({ where: { id: user.id }, data: { token } });

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

export default authRoutes;
