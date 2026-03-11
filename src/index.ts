import path from "path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import helmet from "@fastify/helmet";
import authPlugin from "./plugins/auth";

import refRoutes from "./routes/ref";
import rambuRoutes from "./routes/rambu";
import importRoutes from "./routes/import";
import photoRoutes from "./routes/photo";
import locationsRoutes from "./routes/locations";
import locationsGeomRoutes from "./routes/locations-geom";
import rambuCrudRoutes from "./routes/rambu-crud"; // ✅ pastikan path betul
import usersCrudRoutes from "./routes/users-crud";
import provinceGeomRoutes from "./routes/province-geom";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import reportRoutes from "./routes/report";
import excelRoutes from "./routes/excel";
import openRambuRoutes from "./routes/openrambu";

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://mrb.supplydata.id"
];


const app = Fastify({
    logger: { transport: { target: "pino-pretty" } },
}).withTypeProvider<ZodTypeProvider>();

async function main() {
    // Menambahkan perlindungan khusus untuk clickjacking sesuai rekomendasi Security Tester
    await app.register(helmet, {
      frameguard: {
        action: 'deny' // Menambahkan X-Frame-Options: DENY
      },
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "frame-ancestors": ["'none'"], // Menambahkan perlindungan dari frame-ancestors
        },
      },
    });

    //await app.register(cors, { origin: "*" });
    await app.register(cors, {
        origin: ALLOWED_ORIGINS,
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

    // Global Error Handler
    app.setErrorHandler(function (error, request, reply) {
      // Selalu log error lengkap ke terminal server (logger internal Fastify)
      this.log.error(error);

      // Pastikan error formating (Zod / schema validation) tetap dikembalikan semestinya jika diperlukan
      if (error.validation) {
         return reply.status(400).send({
             message: "Terjadi kesalahan validasi data.",
             details: error.validation
         });
      }

      // Jika error bukan dari internal system / library dan sudah memiliki status khusus
      if (error.statusCode && error.statusCode < 500) {
          return reply.status(error.statusCode).send({
              message: error.message
          });
      }

      // Pesan generic untuk error lainnya (Bocornya PRISMA, SQL, dll akan tertahan disini)
      // Sengaja tidak mengirimkan detail error ke sisi user (frontend)
      return reply.status(500).send({
         message: "Terjadi kesalahan pada sistem. Silakan coba beberapa saat lagi.",
         statusCode: 500
      });
    });

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
    await app.register(usersCrudRoutes, {prefix: "/api"});
    await app.register(reportRoutes, {prefix: "/api"});
    await app.register(excelRoutes, {prefix: "/api"});
    await app.register(openRambuRoutes, {prefix: "/api/public"});

    const port = process.env.PORT ? Number(process.env.PORT) : 8044;
    await app.listen({ port });
    //app.log.info(`API ready at http://localhost:${port}`);
    app.log.info(`API ready at ${process.env.BASEURL}:${process.env.PORT}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
