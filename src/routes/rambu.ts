import { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma";
import { rambuCreateSchema, rambuUpdateSchema, photoTypeMap } from "../schemas/rambu";
import { randomUUID } from "crypto";
import { saveBufferLocal, sha256 } from "../lib/storage";
import exifr from "exifr";

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
    app.post("/rambu", async (req, reply) => {
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

        // ✅ Validate only basic fields
        const data = rambuCreateSchema.parse(fields);

        const created = await prisma.rambu.create({ data });

        // ======================================================
        // ✅ Helper save from FILE upload
        // ======================================================
        async function savePhotoFile(kind: keyof typeof photoTypeMap, file?: { filename?: string; buf: Buffer }) {
            if (!file || !file.buf || file.buf.length === 0) return;

            const ext = (file.filename?.split(".").pop() || "jpg").toLowerCase();
            const filename = `${created.id}-${kind}-${randomUUID()}.${ext}`;
            const url = saveBufferLocal(filename, file.buf);

            //ambil data meta dari file.buf jika bisa
            const meta = await extractMeta(file.buf);
            if (meta) {
                app.log.info(`Extracted EXIF for ${kind}: ${JSON.stringify(meta)}`);
            }

            await prisma.photo.create({
                data: {
                    rambuId: created.id,
                    url,
                    checksum: sha256(file.buf),
                    type: photoTypeMap[kind],
                    meta: meta ? JSON.stringify(meta) : null,
                },
            });
        }

        // ======================================================
        // ✅ Helper: Save photo from Google Drive URL
        // ======================================================
        async function savePhotoFromUrl(kind: keyof typeof photoTypeMap, urlField?: string) {
            if (!urlField) return;

            try {
                const { buffer, ext } = await downloadDriveFile(urlField);
                const filename = `${created.id}-${kind}-${randomUUID()}.${ext}`;
                const url = saveBufferLocal(filename, buffer);

                const meta = await extractMeta(buffer);

                await prisma.photo.create({
                    data: {
                        rambuId: created.id,
                        url,
                        checksum: sha256(buffer),
                        type: photoTypeMap[kind],
                        meta: meta ? JSON.stringify(meta) : null
                    },
                });
            } catch (e) {
                app.log.error(`Failed to save ${kind} from URL: ${e}`);
            }
        }

        // ======================================================
        // ✅ Process FILE uploads
        // ======================================================
        await savePhotoFile("gps", files["photo_gps"]);
        await savePhotoFile("zero", files["photo_0"]);
        await savePhotoFile("fifty", files["photo_50"]);
        await savePhotoFile("hundred", files["photo_100"]);

        // ======================================================
        // ✅ Process URL uploads (Google Drive)
        // (Nama field FE harus: photo_gps_url, photo_0_url, ...)
        // ======================================================
        await savePhotoFromUrl("gps", fields["photo_gps_url"]);
        await savePhotoFromUrl("zero", fields["photo_0_url"]);
        await savePhotoFromUrl("fifty", fields["photo_50_url"]);
        await savePhotoFromUrl("hundred", fields["photo_100_url"]);

        const full = await prisma.rambu.findUnique({
            where: { id: created.id },
            include: { photos: true },
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
};

export default rambuRoutes;
