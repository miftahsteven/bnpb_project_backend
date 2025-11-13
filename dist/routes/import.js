"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const xlsx_1 = __importDefault(require("xlsx"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const prisma_1 = require("@/lib/prisma");
const storage_1 = require("@/lib/storage");
const crypto_1 = require("crypto");
// helper baca excel buffer -> array record
function readExcel(buf) {
    const wb = xlsx_1.default.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx_1.default.utils.sheet_to_json(sheet, { defval: '' });
    return rows;
}
// mapping contoh dari "Jenis Rambu" ke Category / DisasterType
async function resolveCategoryAndDisaster(jenis, defaults) {
    if (defaults.categoryId && defaults.disasterTypeId) {
        return { categoryId: defaults.categoryId, disasterTypeId: defaults.disasterTypeId };
    }
    // contoh sangat sederhana: coba cari Category.name == jenis (case-insensitive)
    const cat = await prisma_1.prisma.category.findFirst({
        where: { name: { equals: jenis, mode: 'insensitive' } }
    });
    // fallback: pakai default kalau ada
    return {
        categoryId: cat?.id ?? defaults.categoryId ?? (() => { throw new Error('categoryId tidak ditemukan & default tidak diisi'); })(),
        disasterTypeId: defaults.disasterTypeId ?? (() => { throw new Error('disasterTypeId default tidak diisi'); })()
    };
}
const importRoutes = async (app) => {
    // POST /api/import/rambu-excel
    // Form fields:
    //  - file: excel (.xlsx)
    //  - imagesZip: (optional) .zip berisi file gambar, dipetakan lewat kolom PhotoGPS/Photo0/Photo50/Photo100
    //  - defaults (opsional): categoryId, disasterTypeId, prov_id, city_id, district_id, subdistrict_id
    app.post('/import/rambu-excel', { preHandler: app.multipart }, async (req, reply) => {
        const q = req.query;
        const defaults = {
            categoryId: q.categoryId ? Number(q.categoryId) : undefined,
            disasterTypeId: q.disasterTypeId ? Number(q.disasterTypeId) : undefined,
            prov_id: q.prov_id ? Number(q.prov_id) : undefined,
            city_id: q.city_id ? Number(q.city_id) : undefined,
            district_id: q.district_id ? Number(q.district_id) : undefined,
            subdistrict_id: q.subdistrict_id ? Number(q.subdistrict_id) : undefined,
        };
        let excelBuf = null;
        let zipBuf = null;
        const mp = await req.parts();
        for await (const part of mp) {
            if (part.file && part.fieldname === 'file') {
                const chunks = [];
                for await (const c of part.file)
                    chunks.push(c);
                excelBuf = Buffer.concat(chunks);
            }
            else if (part.file && part.fieldname === 'imagesZip') {
                const chunks = [];
                for await (const c of part.file)
                    chunks.push(c);
                zipBuf = Buffer.concat(chunks);
            }
        }
        if (!excelBuf)
            return reply.code(400).send({ error: 'Excel file (field "file") wajib.' });
        // siapkan lookup gambar dari zip (jika ada)
        const zipLookup = new Map();
        if (zipBuf) {
            const zip = new adm_zip_1.default(zipBuf);
            zip.getEntries().forEach(e => {
                if (!e.isDirectory && e.entryName) {
                    zipLookup.set(e.entryName.split('/').pop(), e.getData());
                }
            });
        }
        const rows = readExcel(excelBuf);
        const createdIds = [];
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
                const jenis = String(row['Jenis Rambu'] ?? row['jenis_rambu'] ?? '').trim();
                const jmlUnit = row['jumlah unit'] ?? row['Jumlah Unit'] ?? row['jmlUnit'] ?? null;
                const alamat = row['Alamat Pemasangan'] ?? row['alamat'] ?? null;
                const lat = Number(row['Latitude'] ?? row['lat']);
                const lng = Number(row['Longitude'] ?? row['lng']);
                if (!lat || !lng)
                    throw new Error('Latitude/Longitude tidak valid');
                const { categoryId, disasterTypeId } = await resolveCategoryAndDisaster(jenis, defaults);
                const rambu = await prisma_1.prisma.rambu.create({
                    data: {
                        name: jenis || `Rambu-${Date.now()}`,
                        description: alamat || undefined,
                        lat, lng,
                        categoryId, disasterTypeId,
                        prov_id: defaults.prov_id,
                        city_id: defaults.city_id,
                        district_id: defaults.district_id,
                        subdistrict_id: defaults.subdistrict_id,
                        jmlUnit: jmlUnit ? Number(jmlUnit) : null
                    }
                });
                // jika Excel menyediakan kolom nama file gambar & ZIP diberikan
                const photoCols = [
                    { key: 'PhotoGPS', type: 1 },
                    { key: 'Photo0', type: 2 },
                    { key: 'Photo50', type: 3 },
                    { key: 'Photo100', type: 4 },
                ];
                for (const pc of photoCols) {
                    const fname = row[pc.key];
                    if (fname && zipLookup.size) {
                        const base = String(fname).trim();
                        const buf = zipLookup.get(base);
                        if (buf) {
                            const ext = (base.split('.').pop() || 'jpg').toLowerCase();
                            const url = (0, storage_1.saveBufferLocal)(`${rambu.id}-${pc.key}-${(0, crypto_1.randomUUID)()}.${ext}`, buf);
                            await prisma_1.prisma.photo.create({
                                data: { rambuId: rambu.id, url, checksum: (0, storage_1.sha256)(buf), type: pc.type }
                            });
                        }
                    }
                }
                createdIds.push(rambu.id);
            }
            catch (e) {
                errors.push({ row: i + 2, message: e.message || String(e) });
            }
        }
        reply.send({ created: createdIds.length, ids: createdIds, errors });
    });
};
exports.default = importRoutes;
