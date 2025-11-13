import fp from "fastify-plugin";
import { verifyToken } from "../lib/jwt";

export default fp(async (app) => {
    app.decorate("authenticate", async (req: any, reply: any) => {
        try {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith("Bearer "))
                return reply.status(401).send({ message: "Missing Bearer token" });

            const token = authHeader.split(" ")[1];
            const decoded: any = verifyToken(token);
            req.user = decoded;

        } catch (err) {
            reply.status(401).send({ message: "Invalid or expired token" });
        }
    });
});
