// src/routes/locations-geom.ts
import { FastifyPluginAsync } from 'fastify'

const locationsGeomRoutes: FastifyPluginAsync = async (app) => {
    const prisma = (await import('@/lib/prisma')).prisma

    app.get('/locations/province-geojson', async (req, reply) => {
        const { prov_id } = (req.query as any) ?? {}
        if (!prov_id) return reply.code(400).send({ error: 'prov_id is required' })

        // Ambil hanya kolom geom
        const row = await prisma.provinces.findUnique({
            where: { prov_id: Number(prov_id) },
            select: { geom: true } as any
        }) as { geom: unknown } | null

        if (!row?.geom) return reply.code(404).send({ error: 'geometry not found' })

        // Handle bila geom tersimpan sebagai JSON atau string
        let gjson: any
        if (typeof row.geom === 'string') {
            // try {
            //     gjson = JSON.parse(row.geom as string)
            // } catch (e) {
            //     return reply.code(500).send({ error: 'invalid geometry json string' })
            // }
            try {
                const g = JSON.parse(row.geom!) // geometry murni
                return {
                    type: 'Feature',
                    geometry: g,
                    properties: { prov_id: Number(prov_id) }
                }
            } catch {
                return reply.code(500).send({ error: 'invalid geometry json string' })
            }
        } else {
            // Prisma.JsonValue | object
            gjson = row.geom
        }

        // Validasi minimal GeoJSON
        if (typeof gjson !== 'object' || !gjson) {
            return reply.code(500).send({ error: 'invalid geometry json' })
        }

        return gjson
    })
}

export default locationsGeomRoutes
