import { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma";
import { rambuCreateSchema, rambuUpdateSchema, photoTypeMap } from "../schemas/rambu";
import { randomUUID } from "crypto";
import { saveBufferLocal, sha256 } from "../lib/storage";
import exifr from "exifr";
import { is } from "zod/v4/locales";
//import jwt from "jsonwebtoken";


declare module "fastify" {
    interface FastifyRequest {
        authUser?: { id: number; role?: any };
    }
}

// Simple auth guard (pakai secret yang sama dengan signToken)
// tidak menggunakan env JWVT_SECRET, token dikirim melalui header dan mengandung user id, tokenpun disimpan dalam table users.
// jika sesuai maka data bisa diakses
async function authGuard(req: any, reply: any) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7).trim();
    if (!token) return reply.code(401).send({ error: "Unauthorized" });

    // Cari user berdasarkan token yang tersimpan
    const user = await prisma.users.findFirst({ where: { token } });
    if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
    }
    req.authUser = { id: user.id, role: user.role };
}


// =========================
// ✅ Google Drive Utilities
// =========================
function extractDriveFileId(url: string): string | null {
    const match = url.match(/\/d\/([^/]+)/);
    return match ? match[1] : null;
}

async function extractMeta(buffer: Buffer) {
    try {
        const exif = await exifr.parse(buffer, {
            gps: true,
            tiff: true,
            ifd0: {},
            exif: true,
            interop: true,
        });

        if (!exif) return null;

        const meta: any = {};

        if (exif.latitude && exif.longitude) {
            meta.gps = {
                lat: exif.latitude || 0.00,
                lng: exif.longitude || 0.00,
            };
        }
        if (exif.DateTimeOriginal) meta.datetime = exif.DateTimeOriginal;
        if (exif.Orientation) meta.orientation = exif.Orientation;
        if (exif.ImageWidth) meta.width = exif.ImageWidth;
        if (exif.ImageHeight) meta.height = exif.ImageHeight;

        return meta;
    } catch (e) {
        console.error("EXIF parse failed:", e);
        return null;
    }
}

async function downloadDriveFile(driveUrl: string) {
    const fileId = extractDriveFileId(driveUrl);
    if (!fileId) throw new Error("Invalid Google Drive URL");

    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const res = await fetch(directUrl);

    if (!res.ok) throw new Error("Failed to download from Google Drive");

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let ext = "jpg";
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("png")) ext = "png";
    if (ct.includes("jpeg")) ext = "jpg";

    return { buffer, ext };
}

// ============================================
// ✅ MAIN ROUTES
// ============================================
const rambuRoutes: FastifyPluginAsync = async (app) => {

    // ✅ GET LIST (TIDAK DIUBAH AGAR MAP TETAP JALAN)
    app.get("/rambu", async (req) => {
        const q = req.query as any;

        return prisma.rambu.findMany({
            where: {
                categoryId: q.categoryId ? Number(q.categoryId) : undefined,
                disasterTypeId: q.disasterTypeId ? Number(q.disasterTypeId) : undefined,
                prov_id: q.prov_id ? Number(q.prov_id) : undefined,
                city_id: q.city_id ? Number(q.city_id) : undefined,
                district_id: q.district_id ? Number(q.district_id) : undefined,
                subdistrict_id: q.subdistrict_id ? Number(q.subdistrict_id) : undefined,
            },
            include: { photos: true },
            orderBy: { createdAt: "desc" },
        });
    });

    // ======================================================
    // ✅ CREATE RAMBU — upload file + Google Drive URL
    // ======================================================
    app.post("/rambu", { preHandler: authGuard }, async (req, reply) => {
        const parts = req.parts();

        const fields: Record<string, any> = {};
        const files: Record<string, { filename?: string; buf: Buffer }> = {};

        for await (const part of parts) {
            if (part.type === "file") {
                const chunks: Buffer[] = [];
                for await (const c of part.file) chunks.push(c);
                files[part.fieldname] = { filename: part.filename, buf: Buffer.concat(chunks) };
            } else {
                fields[part.fieldname] = part.value;
            }
        }

        // Validasi foto gps wajib
        const gpsFile = files["photo_gps"];
        if (!gpsFile || !gpsFile.buf?.length) {
            return reply.code(400).send({ error: "Foto GPS (photo_gps) wajib diunggah" });
        }

        // Kumpulkan foto tambahan
        const additionalKeys = ["photo_additional_1", "photo_additional_2", "photo_additional_3"];
        const additionalFiles = additionalKeys
            .map(k => ({ key: k, file: files[k] }))
            .filter(x => x.file && x.file.buf?.length);

        // Batas maksimum (1 gps + 3 tambahan)
        const totalPhotos = 1 + additionalFiles.length;
        if (totalPhotos > 4) {
            return reply.code(400).send({ error: "Total foto melebihi batas (maksimal 4 termasuk GPS)" });
        }

        // Parse & buat rambu
        let parsed;
        try {
            parsed = rambuCreateSchema.parse(fields);
        } catch (e: any) {
            return reply.code(400).send({ error: "Validasi gagal", issues: e?.errors ?? [] });
        }

        const created = await prisma.rambu.create({ data: parsed });

        // Buat rambuProps (opsional) dengan user_id
        const propsData: any = {
            rambuId: created.id,
            year: fields.year ? String(fields.year) : undefined,
            cost_id: fields.cost_id ? Number(fields.cost_id) : undefined,
            model: fields.model_id ? Number(fields.model_id) : undefined,
            isSimulation: fields.isSimulation ? Number(fields.isSimulation) : undefined,
            user_id: req.authUser?.id ?? undefined,
        };
        if (Object.values(propsData).some(v => v !== undefined)) {
            await prisma.rambuProps.create({ data: propsData });
        }

        // Helper simpan foto
        async function savePhoto(kind: string, file: { filename?: string; buf: Buffer }) {
            if (!file?.buf?.length) return;
            const ext = (file.filename?.split(".").pop() || "jpg").toLowerCase();
            const filename = `${created.id}-${kind}-${randomUUID()}.${ext}`;
            const url = saveBufferLocal(filename, file.buf);
            let meta: any = null;
            try {
                const exif = await exifr.parse(file.buf, { gps: true, exif: true });
                if (exif) {
                    meta = await extractMeta(file.buf);
                    if (exif.latitude && exif.longitude) {
                        meta.gps = { lat: exif.latitude, lng: exif.longitude };
                    }
                    if (exif.DateTimeOriginal) meta.datetime = exif.DateTimeOriginal;
                }
            } catch { /* ignore meta errors */ }
            await prisma.photo.create({
                data: {
                    rambuId: created.id,
                    url,
                    checksum: sha256(file.buf),
                    // Mapping type: gunakan photoTypeMap.gps untuk gps, dan fallback type 99 untuk tambahan
                    type: kind === "gps" ? photoTypeMap.gps : 99,
                    meta: meta ? JSON.stringify(meta) : null,
                },
            });
        }

        // Simpan foto GPS
        await savePhoto("gps", gpsFile);

        // Simpan foto tambahan
        for (const { key, file } of additionalFiles) {
            await savePhoto(key, file);
        }

        // Ambil kembali data lengkap
        const full = await prisma.rambu.findUnique({
            where: { id: created.id },
            include: { photos: true, RambuProps: true },
        });

        reply.code(201).send(full);
    });

    // ======================================================
    // ✅ UPDATE RAMBU — replace optional photo
    // ======================================================
    app.put("/rambu/:id", async (req, reply) => {
        const { id } = req.params as any;
        const parts = req.parts();

        const fields: Record<string, any> = {};
        const files: Record<string, { filename?: string; buf: Buffer }> = {};

        for await (const part of parts) {
            if (part.type === "file") {
                const chunks: Buffer[] = [];
                for await (const c of part.file) chunks.push(c);

                files[part.fieldname] = {
                    filename: part.filename,
                    buf: Buffer.concat(chunks),
                };
            } else {
                fields[part.fieldname] = part.value;
            }
        }

        const updates = rambuUpdateSchema.parse(fields);

        // ✅ Update main data
        await prisma.rambu.update({
            where: { id: Number(id) },
            data: updates,
        });

        // ======================================================
        // ✅ Replace Photo Helper (FILE)
        // ======================================================
        async function replacePhotoFile(kind: keyof typeof photoTypeMap, file?: { filename?: string; buf: Buffer }) {
            if (!file || !file.buf || file.buf.length === 0) return;

            await prisma.photo.deleteMany({
                where: { rambuId: Number(id), type: photoTypeMap[kind] },
            });

            const ext = (file.filename?.split(".").pop() || "jpg").toLowerCase();
            const filename = `${id}-${kind}-${randomUUID()}.${ext}`;
            const url = saveBufferLocal(filename, file.buf);
            const meta = await extractMeta(file.buf);

            await prisma.photo.create({
                data: {
                    rambuId: Number(id),
                    url,
                    checksum: sha256(file.buf),
                    type: photoTypeMap[kind],
                    meta: meta ? JSON.stringify(meta) : null,
                },
            });
        }

        // ======================================================
        // ✅ Replace via URL (Google Drive)
        // ======================================================
        async function replacePhotoUrl(kind: keyof typeof photoTypeMap, urlField?: string) {
            if (!urlField) return;

            try {
                await prisma.photo.deleteMany({
                    where: { rambuId: Number(id), type: photoTypeMap[kind] },
                });

                const { buffer, ext } = await downloadDriveFile(urlField);

                const filename = `${id}-${kind}-${randomUUID()}.${ext}`;
                const url = saveBufferLocal(filename, buffer);

                const meta = await extractMeta(buffer);

                await prisma.photo.create({
                    data: {
                        rambuId: Number(id),
                        url,
                        checksum: sha256(buffer),
                        type: photoTypeMap[kind],
                        meta: meta ? JSON.stringify(meta) : null
                    },
                });
            } catch (e) {
                app.log.error(`Failed to update ${kind} from URL: ${e}`);
            }
        }

        // ✅ Replace only if uploaded
        await replacePhotoFile("gps", files["photo_gps"]);
        await replacePhotoFile("zero", files["photo_0"]);
        await replacePhotoFile("fifty", files["photo_50"]);
        await replacePhotoFile("hundred", files["photo_100"]);

        // ✅ Replace only if URL provided
        await replacePhotoUrl("gps", fields["photo_gps_url"]);
        await replacePhotoUrl("zero", fields["photo_0_url"]);
        await replacePhotoUrl("fifty", fields["photo_50_url"]);
        await replacePhotoUrl("hundred", fields["photo_100_url"]);

        const full = await prisma.rambu.findUnique({
            where: { id: Number(id) },
            include: { photos: true },
        });

        reply.send(full);
    });

    app.post("/rambuprops/:id", async (req, reply) => {
        const { id } = req.params as any;
        const body = req.body as any;
        const created = await prisma.rambuProps.create({
            data: {
                rambuId: Number(id),
                ...body,
            },
        });
        reply.code(201).send(created);
    });

    app.put("/rambuprops/:id", async (req, reply) => {
        const { id } = req.params as any;
        const body = req.body as any;
        const updated = await prisma.rambuProps.update({
            where: { id: Number(id) },
            data: body,
        });
        reply.send(updated);
    });
};

export default rambuRoutes;
