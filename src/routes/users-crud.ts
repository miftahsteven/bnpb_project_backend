import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const usersCrudRoutes: FastifyPluginAsync = async (app) => {
    app.get("/users-crud", async (req, reply) => {
        try {
            const querySchema = z.object({
                page: z.string().optional().transform(v => parseInt(v || "1")),
                limit: z.string().optional().transform(v => parseInt(v || "10"))
            });

            const parseResult = querySchema.safeParse(req.query);
            
            // Default usage if parse fails or just use the parsed values
            const { page, limit } = parseResult.success 
                ? parseResult.data 
                : { page: 1, limit: 10 };

            const skip = (page - 1) * limit;

            const [users, total] = await Promise.all([
                prisma.users.findMany({
                    skip,
                    take: limit,
                    include: {
                        satuanKerja: true,
                    },
                }),
                prisma.users.count(),
            ]);

            return reply.status(200).send({
                data: users,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                },
            });
        } catch (error) {
            return reply.status(500).send({ message: "Internal Server Error", error });
        }
    });
};

export default usersCrudRoutes;
