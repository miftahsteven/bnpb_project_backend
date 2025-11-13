"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const locationsGeomRoutes = async (app) => {
    const prisma = (await Promise.resolve().then(() => __importStar(require('@/lib/prisma')))).prisma;
    app.get('/locations/province-geojson', async (req, reply) => {
        const { prov_id } = req.query ?? {};
        if (!prov_id)
            return reply.code(400).send({ error: 'prov_id is required' });
        // Ambil hanya kolom geom
        const row = await prisma.provinces.findUnique({
            where: { prov_id: Number(prov_id) },
            select: { geom: true }
        });
        if (!row?.geom)
            return reply.code(404).send({ error: 'geometry not found' });
        // Handle bila geom tersimpan sebagai JSON atau string
        let gjson;
        if (typeof row.geom === 'string') {
            // try {
            //     gjson = JSON.parse(row.geom as string)
            // } catch (e) {
            //     return reply.code(500).send({ error: 'invalid geometry json string' })
            // }
            try {
                const g = JSON.parse(row.geom); // geometry murni
                return {
                    type: 'Feature',
                    geometry: g,
                    properties: { prov_id: Number(prov_id) }
                };
            }
            catch {
                return reply.code(500).send({ error: 'invalid geometry json string' });
            }
        }
        else {
            // Prisma.JsonValue | object
            gjson = row.geom;
        }
        // Validasi minimal GeoJSON
        if (typeof gjson !== 'object' || !gjson) {
            return reply.code(500).send({ error: 'invalid geometry json' });
        }
        return gjson;
    });
};
exports.default = locationsGeomRoutes;
