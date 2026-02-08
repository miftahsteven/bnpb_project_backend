"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const exceljs_1 = __importDefault(require("exceljs"));
const prisma_1 = require("../lib/prisma");
const geografis_1 = __importDefault(require("geografis"));
const excelRoutes = async (app) => {
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
                // Assuming column 1 (Deskripsi) is mandatory to consider the row valid
                if (!row.getCell(1).value)
                    continue;
                // Extract raw data from columns A-J (1-10)
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
                // Parse lat/lng
                const lat = parseFloat(rawData.latitude);
                const lng = parseFloat(rawData.longitude);
                // Resolve Relations
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
                // Location Lookup using Geografis
                let locationIds = {};
                try {
                    // geografis.getNearest returns { province, city, district, village } (strings)
                    const geo = await geografis_1.default.getNearest(lat, lng);
                    if (geo) {
                        // Database Lookup for Location IDs
                        // Note: We use 'contains' to be safer with case/formatting, or exact match?
                        // Usually exact match is preferred if data source is standard. 
                        // We'll try findFirst with the name.
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
                    // We proceed without location IDs if geocoding fails, or should we error? 
                    // The requirement implies we "take from get data geografis". If it fails, maybe allow it but fields will be null.
                }
                // Create Rambu
                // Note: We map Deskripsi -> description. name -> ? (Maybe logic from import.ts: jenis or default)
                // I will use description for descriptiom. 
                // I'll leave 'name' null or maybe use rawData.kategoriName + " " + rawData.jenisBencanaName? 
                // Let's use rawData.deskripsi for description, and maybe category name for name if name is required. 
                // Schema says `name String?`, `description String?`. So name can be null.
                const isSimulasiBool = rawData.simulasi === 'ya' || rawData.simulasi === 'yes' || rawData.simulasi === 'true';
                // Check if RambuProps fields need to be numbers or strings? 
                // Schema: isSimulation Int?
                const result = await prisma_1.prisma.rambu.create({
                    data: {
                        // Rambu fields
                        name: rawData.kategoriName, // Fallback name
                        description: rawData.deskripsi,
                        status: rawData.status,
                        lat: lat || 0,
                        lng: lng || 0,
                        categoryId: category.id,
                        disasterTypeId: disasterType.id,
                        // Location fields
                        prov_id: locationIds.prov_id,
                        city_id: locationIds.city_id,
                        district_id: locationIds.district_id,
                        subdistrict_id: locationIds.subdistrict_id,
                        // Default fields
                        jmlUnit: 1,
                        // Relations
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
            return reply.code(500).send({ message: error.message });
        }
    });
};
exports.default = excelRoutes;
