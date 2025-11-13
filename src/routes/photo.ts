import { FastifyPluginAsync } from 'fastify'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
import { saveBufferLocal, sha256 } from '@/lib/storage'

const photoRoutes: FastifyPluginAsync = async (app) => {
    app.get('/photo/by-rambu/:rambuId', async (req) => {
        const { rambuId } = req.params as any
        return prisma.photo.findMany({ where: { rambuId: Number(rambuId) } })
    })

    // tambah foto per rambu (multipart), field: file, type (1..4 optional)
    app.post('/photo/:rambuId', { preHandler: app.multipart }, async (req, reply) => {
        const { rambuId } = req.params as any
        let fileBuf: Buffer | null = null
        let fileName: string | undefined
        let type: number | undefined

        const mp = await req.parts()
        for await (const part of mp) {
            if (part.file) {
                const chunks: Buffer[] = []
                for await (const c of part.file) chunks.push(c)
                fileBuf = Buffer.concat(chunks)
                fileName = part.filename
            } else if (part.fieldname === 'type') {
                type = Number(part.value)
            }
        }

        if (!fileBuf) return reply.code(400).send({ error: 'file is required' })
        const ext = (fileName?.split('.').pop() || 'jpg').toLowerCase()
        const url = saveBufferLocal(`${rambuId}-${randomUUID()}.${ext}`, fileBuf)

        const created = await prisma.photo.create({
            data: {
                rambuId: Number(rambuId),
                url,
                checksum: sha256(fileBuf),
                type
            }
        })
        reply.code(201).send(created)
    })

    app.delete('/photo/:id', async (req, reply) => {
        const { id } = req.params as any
        await prisma.photo.delete({ where: { id: Number(id) } })
        reply.code(204).send()
    })
}

export default photoRoutes
