"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
const hashid_1 = require("../utils/hashid");
const roles_1 = require("../constants/roles");
const guards_1 = require("../lib/guards");
const usersCrudRoutes = async (app) => {
    app.get("/users-crud", { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        try {
            const q = req.query;
            const page = q.page ? Number(q.page) : 1;
            const pageSize = q.pageSize ? Number(q.pageSize) : 10; // Default 10 if not provided
            const where = {
                role: { not: 9 }
            };
            // Search by name or username
            if (q.search) {
                where.OR = [
                    { name: { contains: q.search } },
                    { username: { contains: q.search } }
                ];
            }
            // Filters
            if (q.role)
                where.role = Number(q.role);
            if (q.satker_id)
                where.satker_id = Number(q.satker_id);
            if (q.status)
                where.status = Number(q.status);
            // Filter based on logged-in user's role (optional, based on rambu-crud pattern)
            // If the user wants similar role-based restriction:
            const authUserId = req.authUser?.id;
            const authUserRole = req.authUser?.role;
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
                prisma_1.prisma.users.count({ where }),
                prisma_1.prisma.users.findMany({
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
                        twoFactorSecret: true,
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
                id: (0, hashid_1.encodeId)(user.id),
                username: user.username,
                name: user.name,
                role: user.role,
                status: user.status,
                satker_id: user.satker_id,
                twoFactorSecret: user.twoFactorSecret,
                satker_name: user.satuanKerja?.name || null
            }));
            return reply.send({
                data,
                total,
                page,
                pageSize,
            });
        }
        catch (error) {
            return reply.code(500).send({ message: "Internal Server Error", error });
        }
    });
    // POST RESET MFA (Hanya Superadmin/Manager)
    app.post("/users-crud/:id/reset-mfa", { preHandler: guards_1.authDashboardGuard }, async (req, reply) => {
        try {
            const callerRole = req.authUser?.role;
            if (callerRole !== roles_1.ROLE.ADMIN && callerRole !== roles_1.ROLE.SUPERADMIN) {
                return reply.code(403).send({ message: "Forbidden" });
            }
            const params = req.params;
            const decodedIdArray = (0, hashid_1.decodeId)(params.id);
            const decodedId = Array.isArray(decodedIdArray) ? decodedIdArray[0] : decodedIdArray;
            if (!decodedId) {
                return reply.code(400).send({ message: "ID Rambu tidak valid" });
            }
            await prisma_1.prisma.users.update({
                where: { id: decodedId },
                data: { twoFactorSecret: null }
            });
            return reply.send({ message: "MFA berhasil direset. User dapat melakukan scan QR dari awal pada sesi login berikutnya." });
        }
        catch (error) {
            return reply.code(500).send({ message: "Internal Server Error", error });
        }
    });
};
exports.default = usersCrudRoutes;
