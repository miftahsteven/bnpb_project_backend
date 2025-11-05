import { FastifyPluginAsync } from 'fastify'
import { prisma } from '@/lib/prisma'
import { categorySchema, disasterTypeSchema } from '@/schemas/ref'

const refRoutes: FastifyPluginAsync = async (app) => {
    // Category
    app.get('/ref/categories', async () => prisma.category.findMany())
    app.post('/ref/categories', async (req, reply) => {
        const body = categorySchema.parse(req.body)
        const data = await prisma.category.create({ data: body })
        reply.code(201).send(data)
    })
    app.put('/ref/categories/:id', async (req, reply) => {
        const { id } = req.params as any
        const body = categorySchema.partial().parse(req.body)
        const data = await prisma.category.update({ where: { id }, data: body })
        reply.send(data)
    })
    app.delete('/ref/categories/:id', async (req, reply) => {
        const { id } = req.params as any
        await prisma.category.delete({ where: { id } })
        reply.code(204).send()
    })

    // DisasterType
    app.get('/ref/disaster-types', async () => prisma.disasterType.findMany())
    app.post('/ref/disaster-types', async (req, reply) => {
        const body = disasterTypeSchema.parse(req.body)
        const data = await prisma.disasterType.create({ data: body })
        reply.code(201).send(data)
    })
    app.put('/ref/disaster-types/:id', async (req, reply) => {
        const { id } = req.params as any
        const body = disasterTypeSchema.partial().parse(req.body)
        const data = await prisma.disasterType.update({ where: { id }, data: body })
        reply.send(data)
    })
    app.delete('/ref/disaster-types/:id', async (req, reply) => {
        const { id } = req.params as any
        await prisma.disasterType.delete({ where: { id } })
        reply.code(204).send()
    })
}

export default refRoutes
