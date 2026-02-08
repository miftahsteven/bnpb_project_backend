"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
const photoRoutes = async (app) => {
    app.get('/photo/by-rambu/:rambuId', async (req) => {
        const { rambuId } = req.params;
        return prisma_1.prisma.photo.findMany({ where: { rambuId: Number(rambuId) } });
    });
    app.post('/photo/:rambuId', async (req, reply) => {
        const parts = req.parts();
        let fileBuffer = null;
        let fileName;
        let type;
        for await (const part of parts) {
            if (part.type === 'file') {
                const chunks = [];
                for await (const chunk of part.file) {
                    chunks.push(chunk);
                }
                fileBuffer = Buffer.concat(chunks);
                fileName = part.filename;
            }
            else if (part.type === 'field' && part.fieldname === 'type') {
                type = Number(part.value);
            }
        }
        // validasi
        if (!fileBuffer || !fileName) {
            return reply.code(400).send({ message: 'File tidak ditemukan' });
        }
        // lanjut simpan fileBuffer ke disk / storage dengan nama fileName dan type
    });
    app.delete('/photo/:id', async (req, reply) => {
        const { id } = req.params;
        await prisma_1.prisma.photo.delete({ where: { id: Number(id) } });
        reply.code(204).send();
    });
};
exports.default = photoRoutes;
