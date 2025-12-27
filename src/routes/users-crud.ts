import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';

async function authGuard(req: any, reply: any) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7).trim();
    if (!token) return reply.code(401).send({ error: "Unauthorized" });

    // Cari user berdasarkan token yang tersimpan
    const user = await prisma.users.findFirst({ where: { token } });
    if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
    }
    req.authUser = { id: user.id, role: user.role };
}

const usersCrudRoutes: FastifyPluginAsync = async (app) => {
    app.get("/users-crud", { preHandler: authGuard }, async (req, reply) => {
        try {
            const q = req.query as any;
            
            const page = q.page ? Number(q.page) : 1;
            const pageSize = q.pageSize ? Number(q.pageSize) : 30; // Default 10 if not provided

            const where: any = {};

            // Search by name or username
            if (q.search) {
                where.OR = [
                    { name: { contains: q.search } },
                    { username: { contains: q.search } }
                ];
            }

            // Filters
            if (q.role) where.role = Number(q.role);
            if (q.satker_id) where.satker_id = Number(q.satker_id);
            if (q.status) where.status = Number(q.status);

            // Filter based on logged-in user's role (optional, based on rambu-crud pattern)
            // If the user wants similar role-based restriction:
            const authUserId: number | undefined = (req as any).authUser?.id;
            const authUserRole: number | undefined = (req as any).authUser?.role;

            // Example restriction: Non-superadmin (assume role 1 is superadmin) can only see users in their satker? 
            // The user didn't explicitly ask for this logic for users, but if they want "sangat mirip rambu-crud", 
            // usually user management is stricter. Rambu-crud restricted by satker_id. 
            // For now, I'll assume standard admin access or requested filters. 
            // If current user is not superadmin (role 1) and has satker_id, maybe force filter?
            // Users table usually accessible by admins. I will stick to query params first to avoid breaking view for admins.
            // If needed, I can add:
            /*
            if (authUserId && authUserRole !== 1) {
                const usr = await prisma.users.findUnique({ where: { id: authUserId } });
                if (usr?.satker_id) {
                    where.satker_id = usr.satker_id; 
                }
            }
            */

             const [total, dataRaw] = await Promise.all([
                prisma.users.count({ where }),
                prisma.users.findMany({
                    where,
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    orderBy: { id: "desc" },
                    select: {
                        id: true,
                        username: true,
                        name: true,
                        role: true,
                        status: true,
                        satker_id: true,
                        satuanKerja: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                })
            ]);

            // Format data if needed (flattening or keeping as is)
            const data = dataRaw.map(user => ({
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                status: user.status,
                satker_id: user.satker_id,
                satker_name: user.satuanKerja?.name || null
            }));

            return reply.send({
                data,
                total,
                page,
                pageSize,
            });

        } catch (error) {
            return reply.code(500).send({ message: "Internal Server Error", error });
        }
    });
};

export default usersCrudRoutes;
