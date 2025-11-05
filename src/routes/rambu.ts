import { FastifyPluginAsync } from 'fastify'
import { prisma } from '@/lib/prisma'
import { rambuCreateSchema } from '@/schemas/rambu'
import { randomUUID } from 'crypto'
import { saveBufferLocal } from '@/lib/storage'
import { getRealtimeDb } from '@/lib/firebase'

const rambuRoutes: FastifyPluginAsync = async (app) => {
    app.get('/rambu', async (req) => {
        const { categoryId, disasterTypeId } = (req.query as any) || {}
        return prisma.rambu.findMany({
            where: { categoryId, disasterTypeId },
            include: { photos: true }
        })
    })

    // multipart untuk 4 foto (opsional ≤ 4)
    app.post('/rambu', { preHandler: app.multipart }, async (req, reply) => {
        const parts: any[] = []
        const fields: Record<string, any> = {}

        const mp = await req.parts()
        for await (const part of mp) {
            if (part.file) {
                // file
                const buffers: Buffer[] = []
                for await (const chunk of part.file) buffers.push(chunk)
                const buf = Buffer.concat(buffers)
                parts.push({ filename: part.filename, mimetype: part.mimetype, buf })
            } else {
                // field biasa
                fields[part.fieldname] = part.value
            }
        }

        const data = rambuCreateSchema.parse(fields)
        // Simpan rambu
        const rambu = await prisma.rambu.create({ data })

        // Ambil maksimal 4 foto
        const photos = parts.slice(0, 4)
        for (const p of photos) {
            const ext = (p.filename?.split('.').pop() || 'jpg').toLowerCase()
            const stored = saveBufferLocal(`${rambu.id}-${randomUUID()}.${ext}`, p.buf)
            await prisma.photo.create({
                data: { rambuId: rambu.id, url: stored }
            })
        }

        // Mirror ke Firebase Realtime DB (opsional)
        const db = getRealtimeDb()
        if (db) {
            await db.ref(`/rambu/${rambu.id}`).set({
                id: rambu.id,
                name: rambu.name,
                lat: rambu.lat,
                lng: rambu.lng,
                categoryId: rambu.categoryId,
                disasterTypeId: rambu.disasterTypeId,
                createdAt: Date.now()
            })
        }

        const withPhotos = await prisma.rambu.findUnique({
            where: { id: rambu.id }, include: { photos: true }
        })
        reply.code(201).send(withPhotos)
    })
}

export default rambuRoutes
