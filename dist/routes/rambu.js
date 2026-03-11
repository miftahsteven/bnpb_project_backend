"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
const rambu_1 = require("../schemas/rambu");
const crypto_1 = require("crypto");
const storage_1 = require("../lib/storage");
const guards_1 = require("../lib/guards");
const hashid_1 = require("../utils/hashid");
const exifr_1 = __importDefault(require("exifr"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Simple auth guard (pakai secret yang sama dengan signToken)
// tidak menggunakan env JWVT_SECRET, token dikirim melalui header dan mengandung user id, tokenpun disimpan dalam table users.
// jika sesuai maka data bisa diakses
async function authGuard(req, reply) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7).trim();
    if (!token)
        return reply.code(401).send({ error: "Unauthorized" });
    const JWT_SECRET = process.env.JWT_SECRET || "5w6xiQ8WWu25bbKPpVbUimXkXbXwb1X5M58I9ISPneA=";
    let decoded;
    try {
        decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch (err) {
        return reply.code(401).send({ error: "Unauthorized: Invalid or expired token" });
    }
    // Pastikan token benar-benar valid dan sesuai di db untuk sesi saat ini
    const user = await prisma_1.prisma.users.findFirst({ where: { id: decoded.id, token } });
    if (!user || user.status !== 1) {
        return reply.code(401).send({ error: "Unauthorized" });
    }
    req.authUser = { id: user.id, role: user.role };
}
// authOrApiKeyGuard dan extractOriginDomain diimport dari ../lib/guards
// =========================
// ✅ Google Drive Utilities
// =========================
function extractDriveFileId(url) {
    const match = url.match(/\/d\/([^/]+)/);
    return match ? match[1] : null;
}
async function extractMeta(buffer) {
    try {
        const exif = await exifr_1.default.parse(buffer, {
            gps: true,
            tiff: true,
            ifd0: {},
            exif: true,
            interop: true,
        });
        if (!exif)
            return null;
        const meta = {};
        if (exif.latitude && exif.longitude) {
            meta.gps = {
                lat: exif.latitude || 0.00,
                lng: exif.longitude || 0.00,
            };
        }
        if (exif.DateTimeOriginal)
            meta.datetime = exif.DateTimeOriginal;
        if (exif.Orientation)
            meta.orientation = exif.Orientation;
        if (exif.ImageWidth)
            meta.width = exif.ImageWidth;
        if (exif.ImageHeight)
            meta.height = exif.ImageHeight;
        return meta;
    }
    catch (e) {
        console.error("EXIF parse failed:", e);
        return null;
    }
}
async function downloadDriveFile(driveUrl) {
    const fileId = extractDriveFileId(driveUrl);
    if (!fileId)
        throw new Error("Invalid Google Drive URL");
    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const res = await fetch(directUrl);
    if (!res.ok)
        throw new Error("Failed to download from Google Drive");
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let ext = "jpg";
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("png"))
        ext = "png";
    if (ct.includes("jpeg"))
        ext = "jpg";
    return { buffer, ext };
}
// ============================================
// ✅ MAIN ROUTES
// ============================================
const rambuRoutes = async (app) => {
    //Helper
    async function savePhotoFromBuffer(rambuId, kind, buf, origFilename) {
        if (!buf?.length)
            return;
        const ext = (origFilename?.split('.').pop() || 'jpg').toLowerCase();
        const filename = `${rambuId}-${kind}-${(0, crypto_1.randomUUID)()}.${ext}`;
        const url = (0, storage_1.saveBufferLocal)(filename, buf);
        let meta = null;
        try {
            meta = await extractMeta(buf);
        }
        catch (e) {
            console.error("savePhotoFromBuffer meta error:", e);
        }
        const type = kind === 'gps' ? rambu_1.photoTypeMap.gps
            : kind in rambu_1.photoTypeMap ? rambu_1.photoTypeMap[kind]
                : 99; // additional default type
        await prisma_1.prisma.photo.create({
            data: {
                rambuId,
                url,
                checksum: (0, storage_1.sha256)(buf),
                type,
                meta: meta ? JSON.stringify(meta) : null,
            },
        });
    }
    // Helper: hapus dan ganti foto gps dari URL
    async function replaceGpsFromUrl(rambuId, urlField) {
        const { buffer } = await downloadDriveFile(urlField);
        await prisma_1.prisma.photo.deleteMany({ where: { rambuId, type: rambu_1.photoTypeMap.gps } });
        await savePhotoFromBuffer(rambuId, 'gps', buffer, 'gps.jpg');
    }
    // Helper: parse daftar id foto yang dihapus
    function parseRemoveIds(v) {
        if (!v)
            return [];
        try {
            if (typeof v === 'string') {
                // bisa JSON array atau csv
                if (v.trim().startsWith('['))
                    return JSON.parse(v).map((x) => Number(x)).filter(Number.isFinite);
                return v.split(',').map(s => Number(s.trim())).filter(Number.isFinite);
            }
            if (Array.isArray(v))
                return v.map(x => Number(x)).filter(Number.isFinite);
        }
        catch { /* ignore */ }
        return [];
    }
    // ✅ GET LIST (TIDAK DIUBAH AGAR MAP TETAP JALAN - Sekarang dilindungi oleh hybrid authOrApiKeyGuard)
    app.get("/rambu", { preHandler: guards_1.authOrApiKeyGuard }, async (req) => {
        const q = req.query;
        // Jika request dari API Key (open map publik) dan tidak ada filter status eksplisit,
        // paksa hanya tampilkan data yang sudah "published"
        const isApiKeyAccess = !!req.headers['x-api-key'];
        const statusFilter = q.status
            ? String(q.status)
            : isApiKeyAccess ? 'published' : undefined;
        const results = await prisma_1.prisma.rambu.findMany({
            where: {
                categoryId: q.categoryId ? Number(q.categoryId) : undefined,
                disasterTypeId: q.disasterTypeId ? Number(q.disasterTypeId) : undefined,
                prov_id: q.prov_id ? Number(q.prov_id) : undefined,
                city_id: q.city_id ? Number(q.city_id) : undefined,
                district_id: q.district_id ? Number(q.district_id) : undefined,
                subdistrict_id: q.subdistrict_id ? Number(q.subdistrict_id) : undefined,
                ...(q.isSimulation !== undefined
                    ? { RambuProps: { some: { isSimulation: Number(q.isSimulation) === 1 ? 1 : 0 } } }
                    : {}),
                ...(statusFilter ? { status: statusFilter } : {}),
                ...(q.modelId ? { RambuProps: { some: { model: Number(q.modelId) } } } : {}),
                ...(q.costsourceId
                    ? { RambuProps: { some: { costsource: { is: { id: Number(q.costsourceId) } } } } }
                    : {}),
            },
            include: { photos: true, RambuProps: true },
            orderBy: { createdAt: "desc" },
        });
        return results.map(r => ({ ...r, id: (0, hashid_1.encodeId)(r.id) }));
    });
    //GET All Rambu untuk dashboard (semua status, hanya user yang sudah login)
    app.get("/rambu-all-dashboard", { preHandler: guards_1.authDashboardGuard }, async (req) => {
        const q = req.query;
        const results = await prisma_1.prisma.rambu.findMany({
            where: {
                categoryId: q.categoryId ? Number(q.categoryId) : undefined,
                disasterTypeId: q.disasterTypeId ? Number(q.disasterTypeId) : undefined,
                prov_id: q.prov_id ? Number(q.prov_id) : undefined,
                city_id: q.city_id ? Number(q.city_id) : undefined,
                district_id: q.district_id ? Number(q.district_id) : undefined,
                subdistrict_id: q.subdistrict_id ? Number(q.subdistrict_id) : undefined,
                ...(q.isSimulation !== undefined
                    ? { RambuProps: { some: { isSimulation: Number(q.isSimulation) === 1 ? 1 : 0 } } }
                    : {}),
                // Status: gunakan query param jika ada, jika tidak tampilkan semua (beda dengan route publik)
                ...(q.status ? { status: String(q.status) } : {}),
                ...(q.modelId ? { RambuProps: { some: { model: Number(q.modelId) } } } : {}),
                ...(q.costsourceId
                    ? { RambuProps: { some: { costsource: { is: { id: Number(q.costsourceId) } } } } }
                    : {}),
            },
            include: { photos: true, RambuProps: true },
            orderBy: { createdAt: "desc" },
        });
        return results.map(r => ({ ...r, id: (0, hashid_1.encodeId)(r.id) }));
    });
    app.get("/rambu/:id", { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        try {
            const { id } = req.params;
            const rambuId = (0, hashid_1.decodeId)(id);
            if (rambuId === null)
                return reply.code(400).send({ error: 'Invalid id' });
            const data = await prisma_1.prisma.rambu.findUnique({
                where: { id: rambuId },
                include: {
                    photos: true,
                    RambuProps: true,
                },
            });
            if (!data)
                return reply.code(404).send({ error: 'Not found' });
            return reply.send({ ...data, id: (0, hashid_1.encodeId)(data.id) });
        }
        catch (e) {
            req.log?.error(e);
            return reply.code(500).send({ error: 'Internal error' });
        }
    });
    app.get("/rambu-detail/:id", { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        try {
            const { id } = req.params;
            const rambuId = (0, hashid_1.decodeId)(id);
            if (rambuId === null)
                return reply.code(400).send({ error: 'Invalid id' });
            const data = await prisma_1.prisma.rambu.findUnique({
                where: { id: rambuId },
                include: {
                    photos: true,
                    RambuProps: {
                        select: {
                            isSimulation: true,
                            model: true,
                            year: true,
                            costsource: true,
                        }
                    }
                },
            });
            if (!data)
                return reply.code(404).send({ error: 'Not found' });
            const dataFormatted = {
                id: (0, hashid_1.encodeId)(data.id),
                name: data.name,
                description: data.description,
                lat: data.lat,
                lng: data.lng,
                categoryName: data.categoryId ? (await prisma_1.prisma.category.findUnique({ where: { id: data.categoryId } }))?.name : null,
                disasterTypeName: data.disasterTypeId ? (await prisma_1.prisma.disasterType.findUnique({ where: { id: data.disasterTypeId } }))?.name : null,
                provinceName: data.prov_id ? (await prisma_1.prisma.provinces.findUnique({ where: { prov_id: data.prov_id } }))?.prov_name : null,
                cityName: data.city_id ? (await prisma_1.prisma.cities.findUnique({ where: { city_id: data.city_id } }))?.city_name : null,
                districtName: data.district_id ? (await prisma_1.prisma.districts.findUnique({ where: { dis_id: data.district_id } }))?.dis_name : null,
                subdistrictName: data.subdistrict_id ? (await prisma_1.prisma.subdistricts.findUnique({ where: { subdis_id: data.subdistrict_id } }))?.subdis_name : null,
                status: data.status,
                isSimulation: data.RambuProps?.[0]?.isSimulation ?? 0,
                photos: data.photos.map(p => ({ id: p.id, url: p.url, type: p.type })),
                model: data.RambuProps?.[0]?.model ? (await prisma_1.prisma.model.findUnique({ where: { id: data.RambuProps[0].model } }))?.name : null,
                costsource: data.RambuProps?.[0]?.costsource ? (await prisma_1.prisma.costsource.findUnique({ where: { id: data.RambuProps[0].costsource.id } }))?.name : null,
                year: data.RambuProps?.[0]?.year ?? null,
                createdAt: data.createdAt,
            };
            return reply.send({
                data: dataFormatted,
                status: 'success',
                code: 200,
            });
        }
        catch (e) {
            req.log?.error(e);
            return reply.code(500).send({ error: 'Internal error' });
        }
    });
    app.get("/rambu-map-detail/:id", async (req, reply) => {
        try {
            const { id } = req.params;
            const rambuId = (0, hashid_1.decodeId)(id);
            if (rambuId === null)
                return reply.code(400).send({ error: 'Invalid id' });
            const data = await prisma_1.prisma.rambu.findUnique({
                where: { id: rambuId },
                include: {
                    photos: true,
                    RambuProps: true,
                },
            });
            if (!data)
                return reply.code(404).send({ error: 'Not found' });
            const dataFormatted = {
                id: (0, hashid_1.encodeId)(data.id),
                name: data.name,
                description: data.description,
                lat: data.lat,
                lng: data.lng,
                categoryName: data.categoryId ? (await prisma_1.prisma.category.findUnique({ where: { id: data.categoryId } }))?.name : null,
                disasterTypeName: data.disasterTypeId ? (await prisma_1.prisma.disasterType.findUnique({ where: { id: data.disasterTypeId } }))?.name : null,
                provinceName: data.prov_id ? (await prisma_1.prisma.provinces.findUnique({ where: { prov_id: data.prov_id } }))?.prov_name : null,
                cityName: data.city_id ? (await prisma_1.prisma.cities.findUnique({ where: { city_id: data.city_id } }))?.city_name : null,
                districtName: data.district_id ? (await prisma_1.prisma.districts.findUnique({ where: { dis_id: data.district_id } }))?.dis_name : null,
                subdistrictName: data.subdistrict_id ? (await prisma_1.prisma.subdistricts.findUnique({ where: { subdis_id: data.subdistrict_id } }))?.subdis_name : null,
                status: data.status,
                isSimulation: data.RambuProps?.[0]?.isSimulation ?? 0,
                photos: data.photos.map(p => ({ id: p.id, url: p.url, type: p.type })),
                createdAt: data.createdAt,
            };
            return reply.send(dataFormatted);
        }
        catch (e) {
            req.log?.error(e);
            return reply.code(500).send({ error: 'Internal error' });
        }
    });
    // ======================================================
    // ✅ CREATE RAMBU — upload file + Google Drive URL
    // ======================================================
    app.post("/rambu", { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        const parts = req.parts();
        const fields = {};
        const files = {};
        for await (const part of parts) {
            if (part.type === "file") {
                const chunks = [];
                for await (const c of part.file)
                    chunks.push(c);
                files[part.fieldname] = { filename: part.filename, buf: Buffer.concat(chunks) };
            }
            else {
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
            parsed = rambu_1.rambuCreateSchema.parse(fields);
        }
        catch (e) {
            return reply.code(400).send({ error: "Validasi gagal", issues: e?.errors ?? [] });
        }
        const created = await prisma_1.prisma.rambu.create({ data: parsed });
        // Buat rambuProps (opsional) dengan user_id
        const propsData = {
            rambuId: created.id,
            year: fields.year ? String(fields.year) : undefined,
            cost_id: fields.cost_id ? Number(fields.cost_id) : undefined,
            model: fields.model_id ? Number(fields.model_id) : undefined,
            isSimulation: fields.isSimulation ? Number(fields.isSimulation) : undefined,
            user_id: req.authUser?.id ?? undefined,
        };
        if (Object.values(propsData).some(v => v !== undefined)) {
            await prisma_1.prisma.rambuProps.create({ data: propsData });
        }
        // Helper simpan foto
        async function savePhoto(kind, file) {
            if (!file?.buf?.length)
                return;
            const ext = (file.filename?.split(".").pop() || "jpg").toLowerCase();
            const filename = `${created.id}-${kind}-${(0, crypto_1.randomUUID)()}.${ext}`;
            const url = (0, storage_1.saveBufferLocal)(filename, file.buf);
            let meta = null;
            try {
                // Use consistent extractMeta helper
                meta = await extractMeta(file.buf);
            }
            catch (e) {
                console.error("Meta extraction error:", e);
            }
            await prisma_1.prisma.photo.create({
                data: {
                    rambuId: created.id,
                    url,
                    checksum: (0, storage_1.sha256)(file.buf),
                    // Mapping type: gunakan photoTypeMap.gps untuk gps, dan fallback type 99 untuk tambahan
                    type: kind === "gps" ? rambu_1.photoTypeMap.gps : 99,
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
        const full = await prisma_1.prisma.rambu.findUnique({
            where: { id: created.id },
            include: { photos: true, RambuProps: true },
        });
        reply.code(201).send({ ...full, id: (0, hashid_1.encodeId)(full.id) });
    });
    // ======================================================
    // ✅ UPDATE RAMBU — replace optional photo
    // ======================================================
    // ======================================================
    // UPDATE RAMBU — multipart (file + fields)
    // ======================================================
    // ======================================================
    // UPDATE RAMBU — PATCH — handles both JSON and Multipart
    // ======================================================
    app.patch("/rambu/:id", { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        const { id } = req.params;
        const rambuId = (0, hashid_1.decodeId)(id);
        if (rambuId === null)
            return reply.code(400).send({ error: 'Invalid id' });
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            // MULTIPART LOGIC
            const parts = req.parts();
            const fields = {};
            const files = {};
            for await (const part of parts) {
                if (part.type === "file") {
                    const chunks = [];
                    for await (const c of part.file)
                        chunks.push(c);
                    files[part.fieldname] = { filename: part.filename, buf: Buffer.concat(chunks) };
                }
                else {
                    fields[part.fieldname] = part.value;
                }
            }
            // 1) Update Rambu main data
            let updates = {};
            try {
                updates = rambu_1.rambuUpdateSchema.parse(fields);
            }
            catch (e) {
                app.log.debug({ e }, 'rambuUpdateSchema parse: skip updates');
            }
            if (Object.keys(updates).length) {
                await prisma_1.prisma.rambu.update({ where: { id: rambuId }, data: updates });
            }
            // 2) Upsert RambuProps
            const yearRaw = fields.year ?? fields.tahun;
            const costRaw = fields.cost_id ?? fields.costId;
            const modelRaw = fields.model_id ?? fields.modelId ?? fields.model;
            const simRaw = fields.isSimulation ?? fields.issimulation ?? fields.is_simulation ?? fields.IsSimulation;
            const propsPayload = {
                rambuId,
                year: yearRaw != null ? String(yearRaw) : undefined,
                cost_id: costRaw != null ? Number(costRaw) : undefined,
                model: modelRaw != null ? Number(modelRaw) : undefined,
                isSimulation: simRaw != null ? Number(simRaw) : undefined,
                user_id: req.authUser?.id ?? undefined,
            };
            Object.keys(propsPayload).forEach(k => propsPayload[k] === undefined && delete propsPayload[k]);
            if (Object.keys(propsPayload).length > 0) {
                const existingProps = await prisma_1.prisma.rambuProps.findFirst({ where: { rambuId } });
                if (existingProps) {
                    await prisma_1.prisma.rambuProps.update({ where: { id: existingProps.id }, data: propsPayload });
                }
                else {
                    await prisma_1.prisma.rambuProps.create({ data: propsPayload });
                }
            }
            // 3) Handle Photos
            const removeIds = parseRemoveIds(fields.removePhotoIds ?? fields.remove_photos ?? fields.deletePhotoIds);
            if (removeIds.length) {
                await prisma_1.prisma.photo.deleteMany({ where: { id: { in: removeIds }, rambuId } });
            }
            const gpsFile = files["photo_gps"];
            const gpsUrl = fields["photo_gps_url"];
            if (gpsFile?.buf?.length) {
                await prisma_1.prisma.photo.deleteMany({ where: { rambuId, type: rambu_1.photoTypeMap.gps } });
                await savePhotoFromBuffer(rambuId, 'gps', gpsFile.buf, gpsFile.filename);
            }
            else if (gpsUrl) {
                try {
                    await replaceGpsFromUrl(rambuId, gpsUrl);
                }
                catch (e) {
                    app.log.error({ err: e }, 'replace gps from url failed');
                }
            }
            const additionalFiles = [];
            Object.keys(files).forEach(k => {
                if (k === 'photo_gps')
                    return;
                if (k === 'photo_additional' || k.startsWith('photo_additional_')) {
                    additionalFiles.push(files[k]);
                }
            });
            const replaceAdditional = String(fields.replaceAdditional ?? '').toLowerCase() === 'true';
            if (replaceAdditional) {
                await prisma_1.prisma.photo.deleteMany({ where: { rambuId, NOT: { type: rambu_1.photoTypeMap.gps } } });
            }
            const currentCount = await prisma_1.prisma.photo.count({ where: { rambuId } });
            const allowed = Math.max(0, 4 - currentCount);
            const toInsert = additionalFiles.slice(0, allowed);
            for (const f of toInsert) {
                await savePhotoFromBuffer(rambuId, 'additional', f.buf, f.filename);
            }
            if (files["photo_0"])
                await savePhotoFromBuffer(rambuId, "zero", files["photo_0"].buf, files["photo_0"].filename);
            if (files["photo_50"])
                await savePhotoFromBuffer(rambuId, "fifty", files["photo_50"].buf, files["photo_50"].filename);
            if (files["photo_100"])
                await savePhotoFromBuffer(rambuId, "hundred", files["photo_100"].buf, files["photo_100"].filename);
            const full = await prisma_1.prisma.rambu.findUnique({
                where: { id: rambuId },
                include: { photos: true, RambuProps: true },
            });
            return reply.send({ ...full, id: (0, hashid_1.encodeId)(full.id) });
        }
        else {
            // JSON LOGIC
            const body = req.body;
            let updates = {};
            try {
                updates = rambu_1.rambuUpdateSchema.parse(body);
            }
            catch (e) {
                app.log.debug({ e }, 'rambuUpdateSchema parse: skip updates');
            }
            if (Object.keys(updates).length) {
                await prisma_1.prisma.rambu.update({ where: { id: rambuId }, data: updates });
            }
            const yearRaw = body.year ?? body.tahun;
            const costRaw = body.cost_id ?? body.costId;
            const modelRaw = body.model_id ?? body.modelId ?? body.model;
            const simRaw = body.isSimulation ?? body.issimulation ?? body.is_simulation ?? body.IsSimulation;
            const propsPayload = {
                rambuId,
                year: yearRaw != null ? String(yearRaw) : undefined,
                cost_id: costRaw != null ? Number(costRaw) : undefined,
                model: modelRaw != null ? Number(modelRaw) : undefined,
                isSimulation: simRaw != null ? Number(simRaw) : undefined,
                user_id: req.authUser?.id ?? undefined,
            };
            Object.keys(propsPayload).forEach(k => propsPayload[k] === undefined && delete propsPayload[k]);
            if (Object.keys(propsPayload).length) {
                const existingProps = await prisma_1.prisma.rambuProps.findFirst({ where: { rambuId } });
                if (existingProps) {
                    await prisma_1.prisma.rambuProps.update({ where: { id: existingProps.id }, data: propsPayload });
                }
                else {
                    await prisma_1.prisma.rambuProps.create({ data: propsPayload });
                }
            }
            const full = await prisma_1.prisma.rambu.findUnique({
                where: { id: rambuId },
                include: { photos: true, RambuProps: true },
            });
            return reply.send({ ...full, id: (0, hashid_1.encodeId)(full.id) });
        }
    });
    app.post("/rambuprops/:id", async (req, reply) => {
        const { id } = req.params;
        const body = req.body;
        const created = await prisma_1.prisma.rambuProps.create({
            data: {
                rambuId: Number(id),
                ...body,
            },
        });
        reply.code(201).send(created);
    });
    app.put("/rambuprops/:id", async (req, reply) => {
        const { id } = req.params;
        const body = req.body;
        const updated = await prisma_1.prisma.rambuProps.update({
            where: { id: Number(id) },
            data: body,
        });
        reply.send(updated);
    });
    app.delete("/rambu/:id", { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        const { id } = req.params;
        const rambuId = (0, hashid_1.decodeId)(id);
        if (rambuId === null)
            return reply.code(400).send({ error: 'Invalid id' });
        // Hapus foto terkait
        await prisma_1.prisma.photo.deleteMany({ where: { rambuId } });
        // Hapus props terkait
        await prisma_1.prisma.rambuProps.deleteMany({ where: { rambuId } });
        // Hapus rambu
        await prisma_1.prisma.rambu.delete({ where: { id: rambuId } });
        return reply.send({
            message: 'Rambu deleted',
            code: 200,
            ok: true
        });
    });
    //buatkan fungsi route hapus dan masukan ke trash. status diubah jadi "trash"
    app.put("/rambu-trash/:id", { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        const { id } = req.params;
        const rambuId = (0, hashid_1.decodeId)(id);
        if (rambuId === null)
            return reply.code(400).send({ error: 'Invalid id' });
        const updated = await prisma_1.prisma.rambu.update({
            where: { id: rambuId },
            data: { status: 'trash' },
        });
        return reply.send({ ...updated, id: (0, hashid_1.encodeId)(updated.id) });
    });
    app.put("/rambu-status/:id", { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        const { id } = req.params;
        const rambuId = (0, hashid_1.decodeId)(id);
        if (rambuId === null)
            return reply.code(400).send({ error: 'Invalid id' });
        const body = req.body;
        const status = body.status;
        if (typeof status !== 'string' || !status.trim().length) {
            return reply.code(400).send({ error: 'Invalid status' });
        }
        const updated = await prisma_1.prisma.rambu.update({
            where: { id: rambuId },
            data: { status: status.trim() },
        });
        return reply.send({ ...updated, id: (0, hashid_1.encodeId)(updated.id) });
    });
};
exports.default = rambuRoutes;
