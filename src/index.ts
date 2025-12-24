import path from "path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import authPlugin from "./plugins/auth";

import refRoutes from "./routes/ref";
import rambuRoutes from "./routes/rambu";
import importRoutes from "./routes/import";
import photoRoutes from "./routes/photo";
import locationsRoutes from "./routes/locations";
import locationsGeomRoutes from "./routes/locations-geom";
import rambuCrudRoutes from "./routes/rambu-crud"; // ✅ pastikan path betul
import provinceGeomRoutes from "./routes/province-geom";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";



const app = Fastify({
    logger: { transport: { target: "pino-pretty" } },
}).withTypeProvider<ZodTypeProvider>();

async function main() {
    //await app.register(cors, { origin: "*" });
    await app.register(cors, {
        origin: "*",
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        //allowedHeaders: ['Authorization', 'Content-Type'],
        //maxAge: 86400,
    })

    // ✅ multipart yang benar
    await app.register(multipart, {
        limits: { fileSize: 50 * 1024 * 1024 },
    });

    app.register(authPlugin);

    await app.register(fastifyStatic, {
        root: path.resolve(process.cwd(), "uploads"),
        prefix: "/public/uploads/",
        // decorateReply default = true; biarkan untuk instance pertama
    });
    //daftarkan route static untuk folder images untuk akses langsung
    await app.register(fastifyStatic, {
        root: path.resolve(process.cwd(), "public"),
        prefix: "/public/",
        decorateReply: false,
    });

    app.get("/health", () => ({ ok: true }));

    // ✅ Semua route harus sebelum listen()
    await app.register(refRoutes, { prefix: "/api" });
    await app.register(rambuRoutes, { prefix: "/api" });
    await app.register(importRoutes, { prefix: "/api" });
    await app.register(photoRoutes, { prefix: "/api" });
    await app.register(locationsRoutes, { prefix: "/api" });
    await app.register(locationsGeomRoutes, { prefix: "/api" });
    await app.register(rambuCrudRoutes, { prefix: "/api" }); // ✅ PENTING!
    await app.register(provinceGeomRoutes, { prefix: "/api" });
    await app.register(authRoutes, { prefix: "/api" });
    await app.register(usersRoutes, { prefix: "/api" });

    const port = process.env.PORT ? Number(process.env.PORT) : 8044;
    await app.listen({ port });
    app.log.info(`API ready at http://localhost:${port}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
