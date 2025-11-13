// scripts/import-province-geom.ts
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";

async function run() {
    const filePath = path.join(__dirname, "../data/prov 37 simplified.geojson");

    console.log("📍 Membaca file:", filePath);

    if (!fs.existsSync(filePath)) {
        console.error("❌ File tidak ditemukan");
        process.exit(1);
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const geo = JSON.parse(raw);

    if (!geo.features || !Array.isArray(geo.features)) {
        console.error("❌ Format GeoJSON tidak valid (tidak ada features)");
        process.exit(1);
    }

    console.log(`✅ Total fitur provinsi: ${geo.features.length}`);

    for (const f of geo.features) {
        const props = f.properties || {};
        const geom = f.geometry;

        if (!geom) {
            console.log(`⚠️ Lewati fitur tanpa geometry`);
            continue;
        }

        // --- AMBIL NAMA PROVINSI DARI FILE ---
        const provName = (props.provinsi || props.name || "")
            .toString()
            .trim()
            .toUpperCase();

        if (!provName) {
            console.log("⚠️ Nama provinsi kosong, lewati.");
            continue;
        }

        // --- MATCH DI DATABASE TANPA mode ---
        const dbProv = await prisma.provinces.findFirst({
            where: {
                prov_name: {
                    contains: provName,  // ✅ Fix: tanpa mode
                }
            }
        });

        if (!dbProv) {
            console.log(`❌ Tidak ditemukan di DB: ${provName}`);
            continue;
        }

        await prisma.provinces.update({
            where: { prov_id: dbProv.prov_id },
            data: {
                geom: JSON.stringify(geom)
            }
        });

        console.log(`✅ Update geom: ${provName}`);
    }

    console.log("🎉 IMPORT SELESAI");
    process.exit(0);
}

run().catch(err => {
    console.error("❌ ERROR", err);
    process.exit(1);
});
