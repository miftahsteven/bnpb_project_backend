import { FastifyPluginAsync } from 'fastify'
import { prisma } from '@/lib/prisma'
import { parseRambuExcel } from '@/utils/excel'

const importRoutes: FastifyPluginAsync = async (app) => {
    app.post('/import/rambu-excel', { preHandler: app.multipart }, async (req, reply) => {
        const mp = await req.parts()
        let fileBuf: Buffer | null = null

        for await (const part of mp) {
            if (part.file && part.fieldname === 'file') {
                const chunks: Buffer[] = []
                for await (const chunk of part.file) chunks.push(chunk)
                fileBuf = Buffer.concat(chunks)
            }
        }
        if (!fileBuf) return reply.code(400).send({ error: 'File excel tidak ditemukan (field name: file)' })

        const batch = await prisma.importBatch.create({
            data: { source: 'excel', status: 'validating' }
        })

        const { ok, errors } = parseRambuExcel(fileBuf)

        // insert dalam transaksi
        const created = await prisma.$transaction(async (tx) => {
            const res = []
            for (const item of ok) {
                res.push(await tx.rambu.create({ data: item }))
            }
            return res
        }).catch(() => [] as any[])

        const status = errors.length > 0 ? (created.length ? 'needs_fix' : 'failed') : 'imported'
        await prisma.importBatch.update({
            where: { id: batch.id },
            data: { status, report: { created: created.length, errors } }
        })

        reply.send({
            batchId: batch.id,
            status,
            created: created.length,
            errors
        })
    })
}

export default importRoutes
