"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const exceljs_1 = __importDefault(require("exceljs"));
const prisma_1 = require("../lib/prisma");
const geografis_1 = __importDefault(require("geografis"));
const crypto_1 = require("crypto");
const exifr_1 = __importDefault(require("exifr"));
const storage_1 = require("../lib/storage");
const guards_1 = require("../lib/guards");
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
// Fuzzy helpers for high-accuracy (>90%) database location lookup
async function findBestProvince(name) {
    if (!name)
        return null;
    const cleanName = name.toUpperCase().replace(/^(PROVINSI|PROV\.)\s+/i, '').trim();
    // 1. First try contains
    let prov = await prisma_1.prisma.provinces.findFirst({
        where: {
            prov_name: {
                contains: cleanName
            }
        }
    });
    // 2. Fallback startsWith (first 4 characters)
    if (!prov && cleanName.length >= 4) {
        prov = await prisma_1.prisma.provinces.findFirst({
            where: {
                prov_name: {
                    startsWith: cleanName.slice(0, 4)
                }
            }
        });
    }
    return prov;
}
async function findBestCity(provId, name) {
    if (!name)
        return null;
    const cleanName = name.toUpperCase()
        .replace(/^(KABUPATEN|KOTA|KAB\.|KAB)\s+/i, '')
        .trim();
    // 1. Try contains
    let city = await prisma_1.prisma.cities.findFirst({
        where: {
            prov_id: provId,
            city_name: {
                contains: cleanName
            }
        }
    });
    // 2. Fallback startsWith (first 4 characters)
    if (!city && cleanName.length >= 4) {
        city = await prisma_1.prisma.cities.findFirst({
            where: {
                prov_id: provId,
                city_name: {
                    startsWith: cleanName.slice(0, 4)
                }
            }
        });
    }
    return city;
}
async function findBestDistrict(cityId, name) {
    if (!name)
        return null;
    const cleanName = name.toUpperCase()
        .replace(/^(KECAMATAN|KEC\.|KEC)\s+/i, '')
        .trim();
    // 1. Try contains
    let dist = await prisma_1.prisma.districts.findFirst({
        where: {
            city_id: cityId,
            dis_name: {
                contains: cleanName
            }
        }
    });
    // 2. Fallback startsWith (first 4 characters)
    if (!dist && cleanName.length >= 4) {
        dist = await prisma_1.prisma.districts.findFirst({
            where: {
                city_id: cityId,
                dis_name: {
                    startsWith: cleanName.slice(0, 4)
                }
            }
        });
    }
    return dist;
}
async function findBestSubdistrict(districtId, name) {
    if (!name)
        return null;
    const cleanName = name.toUpperCase()
        .replace(/^(DESA|KELURAHAN|KEL\.|KEL)\s+/i, '')
        .trim();
    // 1. Try contains
    let subdist = await prisma_1.prisma.subdistricts.findFirst({
        where: {
            dis_id: districtId,
            subdis_name: {
                contains: cleanName
            }
        }
    });
    // 2. Fallback startsWith (first 4 characters)
    if (!subdist && cleanName.length >= 4) {
        subdist = await prisma_1.prisma.subdistricts.findFirst({
            where: {
                dis_id: districtId,
                subdis_name: {
                    startsWith: cleanName.slice(0, 4)
                }
            }
        });
    }
    // 3. Simple overlap heuristic for typo tolerance (e.g. Pagubungan vs Pagubugan)
    if (!subdist && cleanName.length >= 5) {
        const candidates = await prisma_1.prisma.subdistricts.findMany({
            where: { dis_id: districtId }
        });
        if (candidates.length > 0) {
            let bestMatch = candidates[0];
            let maxOverlap = 0;
            for (const cand of candidates) {
                const cName = (cand.subdis_name || '').toUpperCase();
                let overlap = 0;
                for (let idx = 0; idx < Math.min(cleanName.length, cName.length); idx++) {
                    if (cleanName[idx] === cName[idx])
                        overlap++;
                }
                if (overlap > maxOverlap) {
                    maxOverlap = overlap;
                    bestMatch = cand;
                }
            }
            if (maxOverlap >= 3) {
                subdist = bestMatch;
            }
        }
    }
    return subdist;
}
const excelRoutes = async (app) => {
    // 1. ✅ PARSE EXCEL ENDPOINT
    app.post('/parse-excel', { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        const fileData = await req.file();
        if (!fileData) {
            return reply.status(400).send({ message: 'No file uploaded' });
        }
        const workbook = new exceljs_1.default.Workbook();
        try {
            const buffer = await fileData.toBuffer();
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.getWorksheet(1);
            if (!worksheet) {
                throw new Error('Worksheet not found');
            }
            // Max 100 data rows (excluding header)
            const dataRowCount = worksheet.rowCount - 1;
            if (dataRowCount > 100) {
                return reply.status(400).send({ message: 'Jumlah data import maksimal 100 baris.' });
            }
            const parsedRows = [];
            const currentYear = new Date().getFullYear();
            for (let i = 2; i <= worksheet.rowCount; i++) {
                const row = worksheet.getRow(i);
                // Skip empty row
                const kecamatanVal = row.getCell(1).text?.trim();
                const desaVal = row.getCell(2).text?.trim();
                const latVal = row.getCell(3).text?.trim();
                const lngVal = row.getCell(4).text?.trim();
                const jenisRambuVal = row.getCell(5).text?.trim();
                if (!kecamatanVal && !desaVal && !latVal && !lngVal && !jenisRambuVal) {
                    continue;
                }
                const lat = parseFloat(latVal || '0');
                const lng = parseFloat(lngVal || '0');
                // Resolve Category (Jenis Rambu)
                let categoryId = '';
                if (jenisRambuVal) {
                    const category = await prisma_1.prisma.category.findFirst({
                        where: {
                            name: {
                                equals: jenisRambuVal
                            }
                        }
                    });
                    if (category) {
                        categoryId = category.id;
                    }
                }
                // Location IDs lookup (Fuzzy + coordinates)
                let prov_id = '';
                let city_id = '';
                let district_id = '';
                let subdistrict_id = '';
                // Step A: lookup by Geografis using Lat/Lng
                if (lat && lng) {
                    try {
                        const geo = await geografis_1.default.getNearest(lat, lng);
                        if (geo) {
                            const prov = geo.province ? await findBestProvince(geo.province) : null;
                            if (prov) {
                                prov_id = prov.prov_id;
                                const city = geo.city ? await findBestCity(prov.prov_id, geo.city) : null;
                                if (city) {
                                    city_id = city.city_id;
                                    const dist = geo.district ? await findBestDistrict(city.city_id, geo.district) : null;
                                    if (dist) {
                                        district_id = dist.dis_id;
                                        const subdist = geo.village ? await findBestSubdistrict(dist.dis_id, geo.village) : null;
                                        if (subdist) {
                                            subdistrict_id = subdist.subdis_id;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    catch (e) {
                        console.error(`Geografis lookup failed in parse for row ${i}:`, e);
                    }
                }
                // Step B: fallback using Excel's Nama Kecamatan and Nama Desa names
                if (!district_id && kecamatanVal) {
                    const dist = await prisma_1.prisma.districts.findFirst({
                        where: {
                            dis_name: {
                                contains: kecamatanVal.toUpperCase()
                            }
                        }
                    });
                    if (dist) {
                        district_id = dist.dis_id;
                        if (dist.city_id) {
                            city_id = dist.city_id;
                            const city = await prisma_1.prisma.cities.findUnique({ where: { city_id: dist.city_id } });
                            if (city && city.prov_id) {
                                prov_id = city.prov_id;
                            }
                        }
                    }
                    else {
                        // Try starting with first 4 letters of Kecamatan
                        const distFallback = await prisma_1.prisma.districts.findFirst({
                            where: {
                                dis_name: {
                                    startsWith: kecamatanVal.toUpperCase().slice(0, 4)
                                }
                            }
                        });
                        if (distFallback) {
                            district_id = distFallback.dis_id;
                            if (distFallback.city_id) {
                                city_id = distFallback.city_id;
                                const city = await prisma_1.prisma.cities.findUnique({ where: { city_id: distFallback.city_id } });
                                if (city && city.prov_id) {
                                    prov_id = city.prov_id;
                                }
                            }
                        }
                    }
                }
                if (district_id && !subdistrict_id && desaVal) {
                    const subdist = await findBestSubdistrict(Number(district_id), desaVal);
                    if (subdist) {
                        subdistrict_id = subdist.subdis_id;
                    }
                }
                parsedRows.push({
                    key: `row-${i}-${(0, crypto_1.randomUUID)().slice(0, 8)}`,
                    excelKecamatan: kecamatanVal || '',
                    excelDesa: desaVal || '',
                    excelJenisRambu: jenisRambuVal || '',
                    lat: lat || '',
                    lng: lng || '',
                    prov_id,
                    city_id,
                    district_id,
                    subdistrict_id,
                    categoryId,
                    disasterTypeId: '', // Mandatory, to be selected by admin
                    model_id: 1, // Default "Rambu Daun 1"
                    cost_id: 1, // Default "Pusat"
                    year: currentYear,
                    isSimulation: 0,
                    description: `Import Rambu Kecamatan ${kecamatanVal || ''}, Desa ${desaVal || ''}`,
                    photos: [] // Will hold arrays of uploaded photos
                });
            }
            return reply.send({
                success: true,
                message: `Parsed ${parsedRows.length} rows successfully.`,
                data: parsedRows
            });
        }
        catch (err) {
            console.error(err);
            return reply.status(500).send({ message: 'Gagal memproses file excel: ' + err.message });
        }
    });
    // 2. ✅ TEMP PHOTO UPLOAD ENDPOINT
    app.post('/import-excel-temp-photo', { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        const part = await req.file();
        if (!part) {
            return reply.status(400).send({ message: 'No image uploaded' });
        }
        try {
            const chunks = [];
            for await (const chunk of part.file) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            const ext = (part.filename?.split('.').pop() || 'jpg').toLowerCase();
            const filename = `temp-import-${(0, crypto_1.randomUUID)()}.${ext}`;
            const url = (0, storage_1.saveBufferLocal)(filename, buffer);
            let meta = null;
            try {
                meta = await extractMeta(buffer);
            }
            catch (e) {
                console.error('EXIF extraction failed on temp upload:', e);
            }
            return reply.send({
                url,
                checksum: (0, storage_1.sha256)(buffer),
                meta: meta || undefined
            });
        }
        catch (e) {
            console.error(e);
            return reply.status(500).send({ message: 'Gagal mengunggah foto: ' + e.message });
        }
    });
    // 3. ✅ BULK SAVE ENDPOINT
    app.post('/import-excel-bulk', { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        const { rows } = req.body;
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
            return reply.status(400).send({ message: 'Tidak ada data untuk disimpan.' });
        }
        // Validation pass
        for (let idx = 0; idx < rows.length; idx++) {
            const row = rows[idx];
            const rowNum = idx + 1;
            if (!row.lat || isNaN(parseFloat(row.lat))) {
                return reply.status(400).send({ message: `Baris ${rowNum}: Latitude harus berupa angka valid.` });
            }
            if (!row.lng || isNaN(parseFloat(row.lng))) {
                return reply.status(400).send({ message: `Baris ${rowNum}: Longitude harus berupa angka valid.` });
            }
            if (!row.categoryId) {
                return reply.status(400).send({ message: `Baris ${rowNum}: Jenis Rambu wajib dipilih.` });
            }
            if (!row.disasterTypeId) {
                return reply.status(400).send({ message: `Baris ${rowNum}: Jenis Bencana wajib dipilih.` });
            }
            if (!row.prov_id || !row.city_id || !row.district_id || !row.subdistrict_id) {
                return reply.status(400).send({ message: `Baris ${rowNum}: Wilayah lokasi (Provinsi, Kota, Kecamatan, Desa) harus lengkap.` });
            }
        }
        const savedRecords = [];
        try {
            // Transaction or sequential creations
            await prisma_1.prisma.$transaction(async (tx) => {
                for (const row of rows) {
                    // Find Category name for Rambu name fallback
                    const category = await tx.category.findUnique({
                        where: { id: Number(row.categoryId) }
                    });
                    // Create Rambu (marked as lowercase "draft")
                    const createdRambu = await tx.rambu.create({
                        data: {
                            name: category ? category.name : 'Rambu Import',
                            description: row.description || '',
                            status: 'draft', // Forced to draft
                            lat: parseFloat(row.lat),
                            lng: parseFloat(row.lng),
                            categoryId: Number(row.categoryId),
                            disasterTypeId: Number(row.disasterTypeId),
                            prov_id: Number(row.prov_id),
                            city_id: Number(row.city_id),
                            district_id: Number(row.district_id),
                            subdistrict_id: Number(row.subdistrict_id),
                            inputBy: 2,
                            RambuProps: {
                                create: {
                                    model: row.model_id ? Number(row.model_id) : null,
                                    cost_id: row.cost_id ? Number(row.cost_id) : null,
                                    year: String(row.year),
                                    isSimulation: Number(row.isSimulation) === 1 ? 1 : 0,
                                    isPlanning: 0
                                }
                            }
                        }
                    });
                    // Create Photos linked to Rambu ID
                    if (row.photos && Array.isArray(row.photos)) {
                        for (let pIdx = 0; pIdx < row.photos.length; pIdx++) {
                            const photo = row.photos[pIdx];
                            await tx.photo.create({
                                data: {
                                    rambuId: createdRambu.id,
                                    url: photo.url,
                                    checksum: photo.checksum || '',
                                    // Type 1 is GPS for first photo, type 99 is Additional for others
                                    type: pIdx === 0 ? 1 : 99,
                                    meta: photo.meta ? JSON.stringify(photo.meta) : null
                                }
                            });
                        }
                    }
                    savedRecords.push(createdRambu);
                }
            });
            return reply.send({
                success: true,
                message: `${savedRecords.length} Rambu berhasil diimport dan disimpan dengan status Draft.`,
                count: savedRecords.length
            });
        }
        catch (e) {
            console.error('Bulk save transaction failed:', e);
            return reply.status(500).send({ message: 'Gagal melakukan penyimpanan bulk: ' + e.message });
        }
    });
    // Keep original /import-excel endpoint active for backwards compatibility
    app.post('/import-excel', async (req, reply) => {
        const data = await req.file();
        if (!data) {
            return reply.status(400).send({ message: 'No file uploaded' });
        }
        const workbook = new exceljs_1.default.Workbook();
        try {
            const buffer = await data.toBuffer();
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.getWorksheet(1);
            if (!worksheet) {
                throw new Error('Worksheet not found');
            }
            const errors = [];
            const successData = [];
            for (let i = 2; i <= worksheet.rowCount; i++) {
                const row = worksheet.getRow(i);
                if (!row.getCell(1).value)
                    continue;
                const rawData = {
                    deskripsi: row.getCell(1).text,
                    status: row.getCell(2).text,
                    kategoriName: row.getCell(3).text,
                    jenisBencanaName: row.getCell(4).text,
                    latitude: row.getCell(5).text,
                    longitude: row.getCell(6).text,
                    modelName: row.getCell(7).text,
                    sumberDanaName: row.getCell(8).text,
                    tahun: row.getCell(9).text,
                    simulasi: row.getCell(10).text.toLowerCase().trim(),
                };
                const lat = parseFloat(rawData.latitude);
                const lng = parseFloat(rawData.longitude);
                const existingRambu = await prisma_1.prisma.rambu.findFirst({
                    where: {
                        lat: lat,
                        lng: lng,
                    },
                });
                if (existingRambu) {
                    errors.push(`Baris ${i}: Rambu dengan latitude ${lat} dan longitude ${lng} sudah ada.`);
                    continue;
                }
                const [category, disasterType, model, costSource] = await Promise.all([
                    prisma_1.prisma.category.findFirst({ where: { name: rawData.kategoriName } }),
                    prisma_1.prisma.disasterType.findFirst({ where: { name: rawData.jenisBencanaName } }),
                    prisma_1.prisma.model.findFirst({ where: { name: rawData.modelName } }),
                    prisma_1.prisma.costsource.findFirst({ where: { name: rawData.sumberDanaName } }),
                ]);
                const missingRefs = [];
                if (!category)
                    missingRefs.push(`Kategori: ${rawData.kategoriName}`);
                if (!disasterType)
                    missingRefs.push(`Jenis Bencana: ${rawData.jenisBencanaName}`);
                if (!model)
                    missingRefs.push(`Model: ${rawData.modelName}`);
                if (!costSource)
                    missingRefs.push(`Sumber Dana: ${rawData.sumberDanaName}`);
                if (missingRefs.length > 0) {
                    errors.push(`Baris ${i}: ${missingRefs.join(', ')} tidak ditemukan.`);
                    continue;
                }
                let locationIds = {};
                try {
                    const geo = await geografis_1.default.getNearest(lat, lng);
                    if (geo) {
                        const prov = geo.province ? await prisma_1.prisma.provinces.findFirst({ where: { prov_name: geo.province } }) : null;
                        const city = geo.city ? await prisma_1.prisma.cities.findFirst({ where: { city_name: geo.city } }) : null;
                        const dist = geo.district ? await prisma_1.prisma.districts.findFirst({ where: { dis_name: geo.district } }) : null;
                        const subdist = geo.village ? await prisma_1.prisma.subdistricts.findFirst({ where: { subdis_name: geo.village } }) : null;
                        locationIds = {
                            prov_id: prov?.prov_id,
                            city_id: city?.city_id,
                            district_id: dist?.dis_id,
                            subdistrict_id: subdist?.subdis_id
                        };
                    }
                }
                catch (e) {
                    console.error(`Geocoding failed for row ${i}`, e);
                }
                const isSimulasiBool = rawData.simulasi === 'ya' || rawData.simulasi === 'yes' || rawData.simulasi === 'true';
                const result = await prisma_1.prisma.rambu.create({
                    data: {
                        name: rawData.kategoriName,
                        description: rawData.deskripsi,
                        status: rawData.status,
                        lat: lat || 0,
                        lng: lng || 0,
                        categoryId: category.id,
                        disasterTypeId: disasterType.id,
                        prov_id: locationIds.prov_id,
                        city_id: locationIds.city_id,
                        district_id: locationIds.district_id,
                        subdistrict_id: locationIds.subdistrict_id,
                        inputBy: 2,
                        RambuProps: {
                            create: {
                                model: model.id,
                                cost_id: costSource.id,
                                year: rawData.tahun,
                                isSimulation: isSimulasiBool ? 1 : 0,
                                isPlanning: 0
                            }
                        }
                    }
                });
                successData.push(result);
            }
            return reply.send({
                message: 'Import process completed',
                importedCount: successData.length,
                errors: errors.length > 0 ? errors : undefined
            });
        }
        catch (error) {
            return reply.send(error);
        }
    });
};
exports.default = excelRoutes;
