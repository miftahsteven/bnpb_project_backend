"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const turf = __importStar(require("@turf/turf"));
const FALLBACK_BBOX = {
    // prov_id: [minLng, minLat, maxLng, maxLat]
    11: [106.6, -6.4, 107.1, -5.9], // DKI (perkiraan)
    14: [110.0, -8.3, 110.9, -7.6], // DIY (perkiraan)
    18: [115.0, -9.2, 117.0, -7.9], // NTB contoh (isi sesuai kebutuhan)
    // tambahkan lain bertahap...
};
// Kembalikan payload ringan untuk selectbox
function mapProvince(p) {
    return { id: p.prov_id, name: p.prov_name };
}
function mapCity(c) {
    return { id: c.city_id, name: c.city_name };
}
function mapDistrict(d) {
    return { id: d.dis_id, name: d.dis_name };
}
function mapSubdistrict(s) {
    return { id: s.subdis_id, name: s.subdis_name };
}
const locationsRoutes = async (app) => {
    const prisma = (await Promise.resolve().then(() => __importStar(require('@/lib/prisma')))).prisma;
    // Provinces
    app.get('/locations/provinces', async (req) => {
        const { q, limit } = req.query ?? {};
        const take = Math.min(Number(limit) || 100, 500);
        const rows = await prisma.provinces.findMany({
            where: q ? { prov_name: { contains: String(q), mode: 'insensitive' } } : undefined,
            select: { prov_id: true, prov_name: true },
            orderBy: { prov_name: 'asc' },
            take
        });
        return rows.map(mapProvince);
    });
    // Cities by province
    app.get('/locations/cities', async (req, reply) => {
        const { prov_id, q, limit } = req.query ?? {};
        if (!prov_id)
            return reply.code(400).send({ error: 'prov_id is required' });
        const take = Math.min(Number(limit) || 200, 1000);
        const rows = await prisma.cities.findMany({
            where: {
                prov_id: Number(prov_id),
                ...(q ? { city_name: { contains: String(q), mode: 'insensitive' } } : {})
            },
            select: { city_id: true, city_name: true },
            orderBy: { city_name: 'asc' },
            take
        });
        return rows.map(mapCity);
    });
    // Districts by city
    app.get('/locations/districts', async (req, reply) => {
        const { city_id, q, limit } = req.query ?? {};
        if (!city_id)
            return reply.code(400).send({ error: 'city_id is required' });
        const take = Math.min(Number(limit) || 300, 1500);
        const rows = await prisma.districts.findMany({
            where: {
                city_id: Number(city_id),
                ...(q ? { dis_name: { contains: String(q), mode: 'insensitive' } } : {})
            },
            select: { dis_id: true, dis_name: true },
            orderBy: { dis_name: 'asc' },
            take
        });
        return rows.map(mapDistrict);
    });
    // Subdistricts by district
    app.get('/locations/subdistricts', async (req, reply) => {
        const { district_id, q, limit } = req.query ?? {};
        if (!district_id)
            return reply.code(400).send({ error: 'district_id is required' });
        const take = Math.min(Number(limit) || 500, 3000);
        const rows = await prisma.subdistricts.findMany({
            where: {
                dis_id: Number(district_id),
                ...(q ? { subdis_name: { contains: String(q), mode: 'insensitive' } } : {})
            },
            select: { subdis_id: true, subdis_name: true },
            orderBy: { subdis_name: 'asc' },
            take
        });
        return rows.map(mapSubdistrict);
    });
    app.get('/province-bbox', async (req, reply) => {
        const prov_id = Number(req.query.prov_id);
        if (!prov_id)
            return reply.code(400).send({ error: 'prov_id required' });
        // 1) coba dari DB.geom (jika disimpan sebagai GeoJSON string)
        const row = await prisma.provinces.findUnique({
            where: { prov_id },
            select: { geom: true }
        }).catch(() => null);
        if (row?.geom) {
            try {
                const gj = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
                const norm = (gj.type === 'Feature' || gj.type === 'FeatureCollection') ? gj
                    : { type: 'Feature', geometry: gj, properties: {} };
                const bbox = turf.bbox(norm);
                return reply.send({ bbox });
            }
            catch {
                // fallthrough ke fallback
            }
        }
        // 2) fallback aproksimasi
        const fb = FALLBACK_BBOX[prov_id];
        if (fb)
            return reply.send({ bbox: fb });
        // 3) tidak tersedia
        return reply.code(404).send({ error: 'bbox not available' });
    });
};
exports.default = locationsRoutes;
