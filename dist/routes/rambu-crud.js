"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
const hashid_1 = require("../utils/hashid");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
async function authGuard(req, reply) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7).trim();
    if (!token)
        return reply.code(401).send({ error: "Unauthorized" });
    const JWT_SECRET = process.env.JWT_SECRET || "5w6xiQ8WWu25bbKPpVbUimXkXbXwb1X5M58I9ISPneA=";
    let decoded;
    try {
        decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch (err) {
        return reply.code(401).send({ error: "Unauthorized: Invalid or expired token" });
    }
    // Pastikan token benar-benar valid dan sesuai di db untuk sesi saat ini
    const user = await prisma_1.prisma.users.findFirst({ where: { id: decoded.id, token } });
    if (!user || user.status !== 1) {
        return reply.code(401).send({ error: "Unauthorized" });
    }
    req.authUser = { id: user.id, role: user.role };
}
const rambuCrudRoutes = async (app) => {
    app.get("/rambu-crud", { preHandler: authGuard }, async (req, reply) => {
        const q = req.query;
        const { isSimulation } = req.query;
        const page = q.page ? Number(q.page) : 1;
        const pageSize = q.pageSize ? Number(q.pageSize) : 20;
        const where = {};
        // PENCARIAN — versi aman MySQL semua versi
        if (q.search) {
            where.OR = [
                { name: { contains: q.search } },
                { description: { contains: q.search } }
            ];
        }
        if (q.categoryId)
            where.categoryId = Number(q.categoryId);
        if (q.disasterTypeId)
            where.disasterTypeId = Number(q.disasterTypeId);
        if (q.prov_id)
            where.prov_id = Number(q.prov_id);
        if (q.city_id)
            where.city_id = Number(q.city_id);
        if (q.district_id)
            where.district_id = Number(q.district_id);
        if (q.subdistrict_id)
            where.subdistrict_id = Number(q.subdistrict_id);
        if (q.status) {
            let statuses = [];
            if (Array.isArray(q.status)) {
                statuses = q.status.map((s) => String(s));
            }
            else if (typeof q.status === 'string') {
                statuses = q.status.split(',').map((s) => s.trim());
            }
            if (statuses.length > 0) {
                where.status = { in: statuses };
            }
        }
        else {
            // Default: exclude trash
            where.status = { not: 'trash' };
        }
        if (isSimulation !== undefined && isSimulation !== null && String(isSimulation) !== '') {
            const simVal = Number(isSimulation) === 1 ? 1 : 0;
            // jika isSimulation disimpan di relasi RambuProps:
            where.RambuProps = { some: { isSimulation: simVal } };
            // jika di kolom langsung: where.isSimulation = simVal
        }
        // Filter per satker berdasarkan user login (kecuali admin role=1)
        const authUserId = req.authUser?.id;
        const authUserRole = req.authUser?.role;
        if (authUserId && authUserRole !== 1) {
            const usr = await prisma_1.prisma.users.findUnique({
                where: { id: authUserId },
                include: { satuanKerja: true },
            });
            if (usr?.satuanKerja) {
                if (usr.satuanKerja.citiy_id != null) {
                    where.city_id = Number(usr.satuanKerja.citiy_id);
                }
                else if (usr.satuanKerja.prov_id != null) {
                    where.prov_id = Number(usr.satuanKerja.prov_id);
                }
            }
        }
        const [total, dataRaw] = await Promise.all([
            prisma_1.prisma.rambu.count({ where }),
            prisma_1.prisma.rambu.findMany({
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
                    inputBy: true,
                    category: { select: { name: true } },
                    disasterType: { select: { name: true } },
                    provinces: { select: { prov_name: true } },
                    cities: { select: { city_name: true } },
                    districts: { select: { dis_name: true } },
                    subdistricts: { select: { subdis_name: true } },
                    RambuProps: {
                        take: 1,
                        orderBy: { createdAt: "desc" },
                        select: {
                            id: true,
                            createdAt: true,
                            updatedAt: true,
                            year: true,
                            cost_id: true,
                            model: true,
                            isPlanning: true,
                            isSimulation: true,
                            rambuId: true,
                            users: { select: { id: true, satker_id: true } },
                        },
                    },
                    _count: {
                        select: { photos: true }
                    }
                },
            })
        ]);
        const data = dataRaw.map((row) => ({
            id: (0, hashid_1.encodeId)(row.id),
            name: row.name,
            description: row.description,
            status: row.status,
            createdAt: row.createdAt,
            inputBy: row.inputBy,
            lat: row.lat,
            lng: row.lng,
            categoryName: row.category?.name ?? null,
            disasterTypeName: row.disasterType?.name ?? null,
            provinceName: row.provinces?.prov_name ?? null,
            cityName: row.cities?.city_name ?? null,
            districtName: row.districts?.dis_name ?? null,
            subdistrictName: row.subdistricts?.subdis_name ?? null,
            photosCount: row._count?.photos ?? 0,
            //tambahkan properti dari RambuProps jika ada
            ...(row.RambuProps?.[0]
                ? {
                    idProp: (0, hashid_1.encodeId)(row.RambuProps[0].id),
                    createdAtProp: row.RambuProps[0].createdAt,
                    updatedAtProp: row.RambuProps[0].updatedAt,
                    year: row.RambuProps[0].year,
                    cost_id: row.RambuProps[0].cost_id,
                    model: row.RambuProps[0].model,
                    isPlanning: row.RambuProps[0].isPlanning,
                    isSimulation: row.RambuProps[0].isSimulation,
                    rambuIdProp: row.RambuProps[0].rambuId ? (0, hashid_1.encodeId)(row.RambuProps[0].rambuId) : null,
                    user_id: row.RambuProps[0].users?.id,
                    satker_id: row.RambuProps[0].users?.satker_id,
                }
                : {}),
        }));
        reply.send({
            data,
            total,
            page,
            pageSize,
        });
    });
};
exports.default = rambuCrudRoutes;
