import { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma'
import { categorySchema, disasterTypeSchema } from '../schemas/ref'
//import geografis library from https://github.com/drizki/geografis
import geografis from 'geografis'

const refRoutes: FastifyPluginAsync = async (app) => {
    // Category`
    app.get('/ref/categories', async () => prisma.category.findMany())
    app.post('/ref/categories', {
        errorHandler: (error: any, request: any, reply: any) => {
            //reply.code(400).send({ error: 'Invalid data format' })
            //reply unique code 400 for inserted code, get error message from prisma that contain "Category_UNIQUE"
            if (error.code === 'P2002' && error.meta?.target?.includes('Category_UNIQUE')) {
                reply.code(400).send({
                    code: 'Category_UNIQUE',
                    error: 'Category already exists'
                })
            } else {
                reply.code(500).send({
                    code: 'INTERNAL_SERVER_ERROR',
                    error: 'Internal server error'
                })
            }

        }
    }, async (req, reply) => {
        const body = categorySchema.parse(req.body)
        const data = await prisma.category.create({ data: body })
        //reply unique code 201 for inserted code        
        reply.code(201).send(data)
    })
    app.put('/ref/categories/:id', {
        errorHandler: (error: any, request: any, reply: any) => {
            if (error.code === 'P2002' && error.meta?.target?.includes('Category_UNIQUE')) {
                reply.code(400).send({
                    code: 'Category_UNIQUE',
                    error: 'Category already exists'
                })
            } else {
                reply.code(500).send({
                    code: 'INTERNAL_SERVER_ERROR',
                    error: 'Internal server error'
                })
            }
        }
    }, async (req, reply) => {
        const { id } = req.params as any
        const body = categorySchema.partial().parse(req.body)
        const data = await prisma.category.update({ where: { id: Number(id) }, data: body })
        reply.send(data)
    })
    app.delete('/ref/categories/:id', {
        errorHandler: (error: any, request: any, reply: any) => {
            reply.code(500).send({
                code: 'INTERNAL_SERVER_ERROR',
                error: 'Internal server error'
            })
        }
    }, async (req, reply) => {
        const { id } = req.params as any
        await prisma.category.delete({ where: { id: Number(id) } })
        //reply.code(204).send()
        //disini setelah sukses seharusnya mengembalikan 204 dengan konten keterangan bahwa data telah berhasil dihapus
        reply.code(201).send({
            code: 'CATEGORY_DELETED',
            message: 'Hapus Kategori Berhasil'
        })
    })

    // DisasterType
    app.get('/ref/disaster-types', async () => prisma.disasterType.findMany())
    app.post('/ref/disaster-types', {
        errorHandler: (error: any, request: any, reply: any) => {
            if (error.code === 'P2002' && error.meta?.target?.includes('DisasterType_UNIQUE')) {
                reply.code(400).send({
                    code: 'DisasterType_UNIQUE',
                    error: 'Disaster Type already exists'
                })
            } else {
                reply.code(500).send({
                    code: 'INTERNAL_SERVER_ERROR',
                    error: 'Internal server error'
                })
            }
        }
    }, async (req, reply) => {
        const body = disasterTypeSchema.parse(req.body)
        const data = await prisma.disasterType.create({ data: body })
        reply.code(201).send(data)
    })
    app.put('/ref/disaster-types/:id', {
        errorHandler: (error: any, request: any, reply: any) => {
            if (error.code === 'P2002' && error.meta?.target?.includes('DisasterType_UNIQUE')) {
                reply.code(400).send({
                    code: 'DisasterType_UNIQUE',
                    error: 'Disaster Type already exists'
                })
            } else {
                reply.code(500).send({
                    code: 'INTERNAL_SERVER_ERROR',
                    error: 'Internal server error'
                })
            }
        }
    }, async (req, reply) => {
        const { id } = req.params as any
        const body = disasterTypeSchema.partial().parse(req.body)
        const data = await prisma.disasterType.update({ where: { id: Number(id) }, data: body })
        reply.send(data)
    })
    app.delete('/ref/disaster-types/:id', {
        errorHandler: (error: any, request: any, reply: any) => {
            reply.code(500).send({
                code: 'INTERNAL_SERVER_ERROR',
                error: 'Internal server error'
            })
        }
    }, async (req, reply) => {
        const { id } = req.params as any
        await prisma.disasterType.delete({ where: { id: Number(id) } })
        reply.code(201).send({
            code: 'DISASTERTYPE_DELETED',
            message: 'Hapus Jenis Bencana Berhasil'
        })
    })

    app.get('/ref/model', async () => prisma.model.findMany())
    app.get('/ref/costsource', async () => prisma.costsource.findMany())

    app.post("/ref/geografis", async (req) => {

        const { lat, long } = req.body as any;
        const village = await geografis.getNearest(lat, long);

        return {
            data: village,
            message: 'Success',
            status: 200
        }
    });
}

export default refRoutes
