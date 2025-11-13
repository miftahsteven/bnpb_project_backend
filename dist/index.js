"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const static_1 = __importDefault(require("@fastify/static"));
const auth_1 = __importDefault(require("@/plugins/auth"));
const ref_1 = __importDefault(require("@/routes/ref"));
const rambu_1 = __importDefault(require("@/routes/rambu"));
const import_1 = __importDefault(require("@/routes/import"));
const photo_1 = __importDefault(require("@/routes/photo"));
const locations_1 = __importDefault(require("@/routes/locations"));
const locations_geom_1 = __importDefault(require("@/routes/locations-geom"));
const rambu_crud_1 = __importDefault(require("@/routes/rambu-crud")); // ✅ pastikan path betul
const province_geom_1 = __importDefault(require("@/routes/province-geom"));
const auth_2 = __importDefault(require("@/routes/auth"));
const users_1 = __importDefault(require("@/routes/users"));
const app = (0, fastify_1.default)({
    logger: { transport: { target: "pino-pretty" } },
}).withTypeProvider();
async function main() {
    await app.register(cors_1.default, { origin: "*" });
    // ✅ multipart yang benar
    await app.register(multipart_1.default, {
        limits: { fileSize: 50 * 1024 * 1024 },
    });
    app.register(auth_1.default);
    await app.register(static_1.default, {
        root: path_1.default.join(process.cwd(), "uploads"),
        prefix: "/uploads/",
    });
    //daftarkan route static untuk folder images untuk akses langsung
    await app.register(static_1.default, {
        root: path_1.default.join(process.cwd(), "public"),
        prefix: "/public/",
        decorateReply: false,
    });
    app.get("/health", () => ({ ok: true }));
    // ✅ Semua route harus sebelum listen()
    await app.register(ref_1.default, { prefix: "/api" });
    await app.register(rambu_1.default, { prefix: "/api" });
    await app.register(import_1.default, { prefix: "/api" });
    await app.register(photo_1.default, { prefix: "/api" });
    await app.register(locations_1.default, { prefix: "/api" });
    await app.register(locations_geom_1.default, { prefix: "/api" });
    await app.register(rambu_crud_1.default, { prefix: "/api" }); // ✅ PENTING!
    await app.register(province_geom_1.default, { prefix: "/api" });
    await app.register(auth_2.default, { prefix: "/api" });
    await app.register(users_1.default, { prefix: "/api" });
    const port = process.env.PORT ? Number(process.env.PORT) : 8044;
    await app.listen({ port });
    app.log.info(`API ready at http://localhost:${port}`);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
