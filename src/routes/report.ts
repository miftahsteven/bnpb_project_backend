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

  fastify.get('/report-perprovince', {preHandler: authBearer}, async (request, reply) => {
    try {
      // Laporan jumlah data rambu per provinsi
      const provinces = await prisma.provinces.findMany({
        select: {
          prov_name: true,
          _count: {
            select: { Rambu: true }
          }
        },
        where: {
            Rambu: {
                some: {} // Only get provinces that have at least one Rambu, optional but cleaner for charts
            }
        }
      });

      const data = provinces.map(p => ({
        label: p.prov_name || 'Unknown',
        value: p._count.Rambu
      })).sort((a, b) => b.value - a.value); // Sort by count descending

      return {
        data
      };
    } catch (error) {
      return reply.status(500).send({ message: 'Internal Server Error', error });
    }
  });

  fastify.get('/report-peruser', {preHandler: authBearer}, async (request, reply) => {
    try {
      // Laporan jumlah data rambu per user
      const [users, unassignedCount] = await Promise.all([
        prisma.users.findMany({
            select: {
            name: true,
            _count: {
                select: { RambuProps: true }
            }
            },
            where: {
                RambuProps: {
                    some: {} // Only get users that have at least one Rambu, optional but cleaner for charts
                }
            }
        }),
        prisma.rambuProps.count({
            where: {
                user_id: null
            }
        })
      ]);

      const data = users.map(u => ({
        label: u.name || 'Unknown',
        value: u._count.RambuProps
      }));

      if (unassignedCount > 0) {
        data.push({
            label: "Tidak Diketahui",
            value: unassignedCount
        });
      }

      data.sort((a, b) => b.value - a.value); // Sort by count descending

      return {
        data
      };
    } catch (error) {
      return reply.status(500).send({ message: 'Internal Server Error', error });
    }
  });
};

export default reportRoutes;
