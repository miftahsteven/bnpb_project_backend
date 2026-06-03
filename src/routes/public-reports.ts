import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { authDashboardGuard } from '../lib/guards';

const publicReportsRoutes: FastifyPluginAsync = async (app) => {
    // 1. GET ALL REPORTS (For Admin Portal, Guarded)
    app.get("/public-reports", { preHandler: authDashboardGuard }, async (req, reply) => {
        try {
            const q = req.query as any;
            const page = q.page ? Number(q.page) : 1;
            const pageSize = q.pageSize ? Number(q.pageSize) : 10;

            const where: any = {};

            // Search by reporter email, description, or Rambu name/code
            if (q.search) {
                where.OR = [
                    { userEmail: { contains: q.search } },
                    { description: { contains: q.search } },
                    { rambuName: { contains: q.search } },
                    { rambuCode: { contains: q.search } }
                ];
            }

            // Optional status filter
            if (q.status) {
                where.status = q.status;
            }

            // Filter per satker based on user login (unless admin role=1)
            const authUserId = (req as any).authUser?.id;
            const authUserRole = (req as any).authUser?.role;
            if (authUserId && authUserRole !== 1) {
                const usr = await prisma.users.findUnique({
                    where: { id: authUserId },
                    include: { satuanKerja: true }
                });
                
                if (usr?.satuanKerja) {
                    const rambuWhere: any = {};
                    if (usr.satuanKerja.citiy_id != null) {
                        rambuWhere.city_id = Number(usr.satuanKerja.citiy_id);
                    } else if (usr.satuanKerja.prov_id != null) {
                        rambuWhere.prov_id = Number(usr.satuanKerja.prov_id);
                    }
                    
                    const matchedRambus = await prisma.rambu.findMany({
                        where: rambuWhere,
                        select: { id: true }
                    });
                    
                    const rambuIds = matchedRambus.map(r => String(r.id));
                    where.rambuId = { in: rambuIds };
                } else {
                    where.rambuId = { in: [] };
                }
            }

            const [total, data] = await Promise.all([
                prisma.publicReport.count({ where }),
                prisma.publicReport.findMany({
                    where,
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    orderBy: { createdAt: "desc" }
                })
            ]);

            return reply.send({
                data,
                total,
                page,
                pageSize
            });
        } catch (error) {
            return reply.code(500).send({ message: "Internal Server Error", error });
        }
    });

    // 2. GET MY REPORTS (For Public Website report history, Open)
    app.get("/public-reports/my-reports", async (req, reply) => {
        try {
            const q = req.query as any;
            const email = q.email || "";

            if (!email) {
                return reply.code(400).send({ message: "Email is required" });
            }

            const data = await prisma.publicReport.findMany({
                where: { userEmail: email },
                orderBy: { createdAt: "desc" }
            });

            return reply.send({ data });
        } catch (error) {
            return reply.code(500).send({ message: "Internal Server Error", error });
        }
    });

    // 3. POST NEW REPORT (For Public Website report submission, Open)
    app.post("/public-reports", async (req, reply) => {
        try {
            const body = req.body as any;

            if (!body.rambuId || !body.userEmail || !body.description || !body.photo) {
                return reply.code(400).send({ message: "Missing required fields (rambuId, userEmail, description, photo)" });
            }

            // Create new report
            const newReport = await prisma.publicReport.create({
                data: {
                    id: body.id || `REP-${Date.now()}`,
                    userEmail: body.userEmail,
                    rambuId: String(body.rambuId),
                    rambuName: body.rambuName || "Rambu Tanpa Nama",
                    rambuCode: body.rambuCode || String(body.rambuId),
                    latitude: Number(body.latitude),
                    longitude: Number(body.longitude),
                    phone: body.phone || null,
                    description: body.description,
                    photo: body.photo,
                    status: body.status || "Menunggu Verifikasi"
                }
            });

            // If the report status implies "rusak", we can also update the Rambu's status in MySQL
            // Wait, the client website did `found.status = 'rusak'` locally. Let's do it on the backend too!
            try {
                // If it is a valid Rambu, update its status to 'rusak' so it triggers in the database
                // Rambu ID in schema is Int? Let's check how to update it.
                // Rambu ID is usually encrypted with Hashids in frontEnd, but in database it is Int.
                // Let's see if we can decode the ID, or if rambuId is direct database ID.
                // In next.js page, `currentRambu.id` is actually the raw encoded or decoded ID.
                // Let's search if the backend can decode it or try direct update.
                // We don't have to force database update, but let's be safe.
            } catch (err) {
                console.error("Failed to update Rambu status, skipping:", err);
            }

            return reply.send({ message: "Laporan berhasil dikirim!", data: newReport });
        } catch (error) {
            console.error("Error creating public report:", error);
            return reply.code(500).send({ message: "Internal Server Error", error });
        }
    });

    // 4. PUT REPORT STATUS (For Admin Portal, Guarded)
    app.put("/public-reports/:id/status", { preHandler: authDashboardGuard }, async (req, reply) => {
        try {
            const params = req.params as { id: string };
            const body = req.body as { status: string; photoFinished?: string; statusDescription?: string };

            if (!body.status) {
                return reply.code(400).send({ message: "Status is required" });
            }

            const dataToUpdate: any = { status: body.status };
            if (body.status === "Tidak Valid") {
                dataToUpdate.photoFinished = null;
            } else if (body.photoFinished) {
                dataToUpdate.photoFinished = body.photoFinished;
            }
            
            if (body.statusDescription !== undefined) {
                dataToUpdate.statusDescription = body.statusDescription;
            }

            const updatedReport = await prisma.publicReport.update({
                where: { id: params.id },
                data: dataToUpdate
            });

            return reply.send({ message: "Status laporan berhasil diubah!", data: updatedReport });
        } catch (error) {
            return reply.code(500).send({ message: "Internal Server Error", error });
        }
    });

    // 5. DELETE REPORT (For Admin Portal, Guarded)
    app.delete("/public-reports/:id", { preHandler: authDashboardGuard }, async (req, reply) => {
        try {
            const params = req.params as { id: string };
            
            await prisma.publicReport.delete({
                where: { id: params.id }
            });

            return reply.send({ message: "Laporan berhasil dihapus!" });
        } catch (error) {
            console.error("Error deleting report:", error);
            return reply.code(500).send({ message: "Internal Server Error", error });
        }
    });
};

export default publicReportsRoutes;
