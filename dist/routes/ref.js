"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
const ref_1 = require("../schemas/ref");
const refRoutes = async (app) => {
    // Category
    app.get('/ref/categories', async () => prisma_1.prisma.category.findMany());
    app.post('/ref/categories', {
        errorHandler: (error, request, reply) => {
            //reply.code(400).send({ error: 'Invalid data format' })
            //reply unique code 400 for inserted code, get error message from prisma that contain "Category_UNIQUE"
            if (error.code === 'P2002' && error.meta?.target?.includes('Category_UNIQUE')) {
                reply.code(400).send({
                    code: 'Category_UNIQUE',
                    error: 'Category already exists'
                });
            }
            else {
                reply.code(500).send({
                    code: 'INTERNAL_SERVER_ERROR',
                    error: 'Internal server error'
                });
            }
        }
    }, async (req, reply) => {
        const body = ref_1.categorySchema.parse(req.body);
        const data = await prisma_1.prisma.category.create({ data: body });
        //reply unique code 201 for inserted code        
        reply.code(201).send(data);
    });
    app.put('/ref/categories/:id', {
        errorHandler: (error, request, reply) => {
            if (error.code === 'P2002' && error.meta?.target?.includes('Category_UNIQUE')) {
                reply.code(400).send({
                    code: 'Category_UNIQUE',
                    error: 'Category already exists'
                });
            }
            else {
                reply.code(500).send({
                    code: 'INTERNAL_SERVER_ERROR',
                    error: 'Internal server error'
                });
            }
        }
    }, async (req, reply) => {
        const { id } = req.params;
        const body = ref_1.categorySchema.partial().parse(req.body);
        const data = await prisma_1.prisma.category.update({ where: { id: Number(id) }, data: body });
        reply.send(data);
    });
    app.delete('/ref/categories/:id', {
        errorHandler: (error, request, reply) => {
            reply.code(500).send({
                code: 'INTERNAL_SERVER_ERROR',
                error: 'Internal server error'
            });
        }
    }, async (req, reply) => {
        const { id } = req.params;
        await prisma_1.prisma.category.delete({ where: { id: Number(id) } });
        //reply.code(204).send()
        //disini setelah sukses seharusnya mengembalikan 204 dengan konten keterangan bahwa data telah berhasil dihapus
        reply.code(201).send({
            code: 'CATEGORY_DELETED',
            message: 'Hapus Kategori Berhasil'
        });
    });
    // DisasterType
    app.get('/ref/disaster-types', async () => prisma_1.prisma.disasterType.findMany());
    app.post('/ref/disaster-types', {
        errorHandler: (error, request, reply) => {
            if (error.code === 'P2002' && error.meta?.target?.includes('DisasterType_UNIQUE')) {
                reply.code(400).send({
                    code: 'DisasterType_UNIQUE',
                    error: 'Disaster Type already exists'
                });
            }
            else {
                reply.code(500).send({
                    code: 'INTERNAL_SERVER_ERROR',
                    error: 'Internal server error'
                });
            }
        }
    }, async (req, reply) => {
        const body = ref_1.disasterTypeSchema.parse(req.body);
        const data = await prisma_1.prisma.disasterType.create({ data: body });
        reply.code(201).send(data);
    });
    app.put('/ref/disaster-types/:id', {
        errorHandler: (error, request, reply) => {
            if (error.code === 'P2002' && error.meta?.target?.includes('DisasterType_UNIQUE')) {
                reply.code(400).send({
                    code: 'DisasterType_UNIQUE',
                    error: 'Disaster Type already exists'
                });
            }
            else {
                reply.code(500).send({
                    code: 'INTERNAL_SERVER_ERROR',
                    error: 'Internal server error'
                });
            }
        }
    }, async (req, reply) => {
        const { id } = req.params;
        const body = ref_1.disasterTypeSchema.partial().parse(req.body);
        const data = await prisma_1.prisma.disasterType.update({ where: { id: Number(id) }, data: body });
        reply.send(data);
    });
    app.delete('/ref/disaster-types/:id', {
        errorHandler: (error, request, reply) => {
            reply.code(500).send({
                code: 'INTERNAL_SERVER_ERROR',
                error: 'Internal server error'
            });
        }
    }, async (req, reply) => {
        const { id } = req.params;
        await prisma_1.prisma.disasterType.delete({ where: { id: Number(id) } });
        reply.code(201).send({
            code: 'DISASTERTYPE_DELETED',
            message: 'Hapus Jenis Bencana Berhasil'
        });
    });
};
exports.default = refRoutes;
