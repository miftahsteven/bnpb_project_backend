"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("@/lib/prisma");
const crypto_1 = require("crypto");
const storage_1 = require("@/lib/storage");
const photoRoutes = async (app) => {
    app.get('/photo/by-rambu/:rambuId', async (req) => {
        const { rambuId } = req.params;
        return prisma_1.prisma.photo.findMany({ where: { rambuId: Number(rambuId) } });
    });
    // tambah foto per rambu (multipart), field: file, type (1..4 optional)
    app.post('/photo/:rambuId', { preHandler: app.multipart }, async (req, reply) => {
        const { rambuId } = req.params;
        let fileBuf = null;
        let fileName;
        let type;
        const mp = await req.parts();
        for await (const part of mp) {
            if (part.file) {
                const chunks = [];
                for await (const c of part.file)
                    chunks.push(c);
                fileBuf = Buffer.concat(chunks);
                fileName = part.filename;
            }
            else if (part.fieldname === 'type') {
                type = Number(part.value);
            }
        }
        if (!fileBuf)
            return reply.code(400).send({ error: 'file is required' });
        const ext = (fileName?.split('.').pop() || 'jpg').toLowerCase();
        const url = (0, storage_1.saveBufferLocal)(`${rambuId}-${(0, crypto_1.randomUUID)()}.${ext}`, fileBuf);
        const created = await prisma_1.prisma.photo.create({
            data: {
                rambuId: Number(rambuId),
                url,
                checksum: (0, storage_1.sha256)(fileBuf),
                type
            }
        });
        reply.code(201).send(created);
    });
    app.delete('/photo/:id', async (req, reply) => {
        const { id } = req.params;
        await prisma_1.prisma.photo.delete({ where: { id: Number(id) } });
        reply.code(204).send();
    });
};
exports.default = photoRoutes;
