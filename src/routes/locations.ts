import { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma'
import * as turf from '@turf/turf'

const FALLBACK_BBOX: Record<number, [number, number, number, number]> = {
    // prov_id: [minLng, minLat, maxLng, maxLat]
    11: [106.6, -6.4, 107.1, -5.9],      // DKI (perkiraan)
    14: [110.0, -8.3, 110.9, -7.6],      // DIY (perkiraan)
    18: [115.0, -9.2, 117.0, -7.9],      // NTB contoh (isi sesuai kebutuhan)
    // tambahkan lain bertahap...
}

// Kembalikan payload ringan untuk selectbox
function mapProvince(p: any) {
    return { id: p.prov_id, name: p.prov_name }
}
function mapCity(c: any) {
    return { id: c.city_id, name: c.city_name }
}
function mapDistrict(d: any) {
    return { id: d.dis_id, name: d.dis_name }
}
function mapSubdistrict(s: any) {
    return { id: s.subdis_id, name: s.subdis_name }
}

const locationsRoutes: FastifyPluginAsync = async (app) => {
    const prisma = (await import('../lib/prisma')).prisma

    // Provinces
    app.get('/locations/provinces', async (req) => {
        const { q, limit } = (req.query as any) ?? {}
        const take = Math.min(Number(limit) || 100, 500)
        const rows = await prisma.provinces.findMany({
            where: q ? { prov_name: { contains: String(q) } } : undefined,
            select: { prov_id: true, prov_name: true },
            orderBy: { prov_name: 'asc' },
            take
        })
        return rows.map(mapProvince)
    })

    // Cities by province
    app.get('/locations/cities', async (req, reply) => {
        const { prov_id, q, limit } = (req.query as any) ?? {}
        if (!prov_id) return reply.code(400).send({ error: 'prov_id is required' })
        const take = Math.min(Number(limit) || 200, 1000)
        const rows = await prisma.cities.findMany({
            where: {
                prov_id: Number(prov_id),
                ...(q ? { city_name: { contains: String(q) } } : {})
            },
            select: { city_id: true, city_name: true },
            orderBy: { city_name: 'asc' },
            take
        })
        return rows.map(mapCity)
    })

    // Districts by city
    app.get('/locations/districts', async (req, reply) => {
        const { city_id, q, limit } = (req.query as any) ?? {}
        if (!city_id) return reply.code(400).send({ error: 'city_id is required' })
        const take = Math.min(Number(limit) || 300, 1500)
        const rows = await prisma.districts.findMany({
            where: {
                city_id: Number(city_id),
                ...(q ? { dis_name: { contains: String(q) } } : {})
            },
            select: { dis_id: true, dis_name: true },
            orderBy: { dis_name: 'asc' },
            take
        })
        return rows.map(mapDistrict)
    })

    // Subdistricts by district
    app.get('/locations/subdistricts', async (req, reply) => {
        const { district_id, q, limit } = (req.query as any) ?? {}
        if (!district_id) return reply.code(400).send({ error: 'district_id is required' })
        const take = Math.min(Number(limit) || 500, 3000)
        const rows = await prisma.subdistricts.findMany({
            where: {
                dis_id: Number(district_id),
                ...(q ? { subdis_name: { contains: String(q) } } : {})
            },
            select: { subdis_id: true, subdis_name: true },
            orderBy: { subdis_name: 'asc' },
            take
        })
        return rows.map(mapSubdistrict)
    })

    app.get('/province-bbox', async (req, reply) => {
        const prov_id = Number((req.query as any).prov_id)
        if (!prov_id) return reply.code(400).send({ error: 'prov_id required' })

        // 1) coba dari DB.geom (jika disimpan sebagai GeoJSON string)
        const row = await prisma.provinces.findUnique({
            where: { prov_id },
            select: { geom: true }
        }).catch(() => null)

        if (row?.geom) {
            try {
                const gj = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom
                const norm = (gj.type === 'Feature' || gj.type === 'FeatureCollection') ? gj
                    : { type: 'Feature', geometry: gj, properties: {} }
                const bbox = turf.bbox(norm) as [number, number, number, number]
                return reply.send({ bbox })
            } catch {
                // fallthrough ke fallback
            }
        }

        // 2) fallback aproksimasi
        const fb = FALLBACK_BBOX[prov_id]
        if (fb) return reply.send({ bbox: fb })

        // 3) tidak tersedia
        return reply.code(404).send({ error: 'bbox not available' })
    })
}

export default locationsRoutes
