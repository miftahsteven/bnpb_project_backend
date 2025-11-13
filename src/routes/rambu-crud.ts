import { FastifyPluginAsync } from "fastify";
import { prisma } from "@/lib/prisma";

const rambuCrudRoutes: FastifyPluginAsync = async (app) => {
    app.get("/rambu-crud", async (req, reply) => {
        const q = req.query as any;

        const page = q.page ? Number(q.page) : 1;
        const pageSize = q.pageSize ? Number(q.pageSize) : 20;

        const where: any = {};

        // PENCARIAN — versi aman MySQL semua versi
        if (q.search) {
            where.OR = [
                { name: { contains: q.search } },
                { description: { contains: q.search } }
            ];
        }

        if (q.categoryId) where.categoryId = Number(q.categoryId);
        if (q.disasterTypeId) where.disasterTypeId = Number(q.disasterTypeId);
        if (q.prov_id) where.prov_id = Number(q.prov_id);
        if (q.city_id) where.city_id = Number(q.city_id);
        if (q.district_id) where.district_id = Number(q.district_id);
        if (q.subdistrict_id) where.subdistrict_id = Number(q.subdistrict_id);
        if (q.status) where.status = q.status;

        const [total, dataRaw] = await Promise.all([
            prisma.rambu.count({ where }),

            prisma.rambu.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    name: true,
                    description: true,
                    lat: true,
                    lng: true,
                    status: true,
                    createdAt: true,

                    category: { select: { name: true } },
                    disasterType: { select: { name: true } },
                    provinces: { select: { prov_name: true } },
                    cities: { select: { city_name: true } },
                    districts: { select: { dis_name: true } },
                    subdistricts: { select: { subdis_name: true } },
                },
            })
        ]);

        const data = dataRaw.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            status: row.status,
            createdAt: row.createdAt,

            categoryName: row.category?.name ?? null,
            disasterTypeName: row.disasterType?.name ?? null,
            provinceName: row.provinces?.prov_name ?? null,
            cityName: row.cities?.city_name ?? null,
            districtName: row.districts?.dis_name ?? null,
            subdistrictName: row.subdistricts?.subdis_name ?? null,
        }));

        reply.send({
            data,
            total,
            page,
            pageSize,
        });
    });
};

export default rambuCrudRoutes;
