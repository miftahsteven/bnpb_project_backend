import { FastifyPluginAsync, FastifyRequest  } from 'fastify';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL_SEC = 24 * 60 * 60; // 24 jam


const authBearer = async (req: FastifyRequest, reply: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Missing/invalid Authorization header" });
    }
    const token = auth.slice("Bearer ".length).trim();
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: number; role: number; satker_id?: number | null; exp: number };
        // Cek juga di DB agar token bisa direvoke (logout)
        const user = await prisma.users.findUnique({
            where: { id: decoded.id },
            select: { id: true, role: true as any, satker_id: true as any, status: true as any, token: true },
        } as any);

        if (!user || user.status !== 1 || user.token !== token) {
            return reply.code(401).send({ error: "Token invalid or revoked" });
        }

        req.user = { id: user.id, role: (user as any).role ?? decoded.role, satker_id: user.satker_id ?? null };
    } catch (e) {
        return reply.code(401).send({ error: "Invalid/expired token" });
    }
};


const reportRoutes: FastifyPluginAsync = async (fastify, opts) => {
  fastify.get('/dashboard-stats', {preHandler: authBearer}, async (request, reply) => {
    try {
      // 1. Laporan jumlah data rambu (Summary)
      const [draft, published, rusak, hilang, total] = await Promise.all([
        prisma.rambu.count({ where: { status: 'draft' } }),
        prisma.rambu.count({ where: { status: 'published' } }),
        prisma.rambu.count({ where: { status: 'rusak' } }),
        prisma.rambu.count({ where: { status: 'hilang' } }),
        prisma.rambu.count(),
      ]);

      const summary = { draft, published, rusak, hilang, total };    

      return {
        summary,        
      };
    } catch (error) {
      return reply.status(500).send({ message: 'Internal Server Error', error });
    }
  });
};

export default reportRoutes;
