"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.photoTypeMap = exports.rambuUpdateSchema = exports.rambuCreateSchema = void 0;
const zod_1 = require("zod");
const toNum = (v) => {
    if (v === '' || v === null || typeof v === 'undefined')
        return NaN;
    if (typeof v === 'number')
        return v;
    if (typeof v === 'string') {
        const s = v.trim().replace(',', '.');
        const n = Number(s);
        return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
};
const latCoerce = zod_1.z.preprocess((v) => toNum(v), zod_1.z.number().min(-90).max(90));
const lngCoerce = zod_1.z.preprocess((v) => toNum(v), zod_1.z.number().min(-180).max(180));
exports.rambuCreateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    description: zod_1.z.string().optional(),
    // lat: z.coerce.number().min(-90).max(90),
    // lng: z.coerce.number().min(-180).max(180),
    lat: latCoerce,
    lng: lngCoerce,
    categoryId: zod_1.z.coerce.number().int().positive(),
    disasterTypeId: zod_1.z.coerce.number().int().positive(),
    prov_id: zod_1.z.coerce.number().int().optional(),
    city_id: zod_1.z.coerce.number().int().optional(),
    district_id: zod_1.z.coerce.number().int().optional(),
    subdistrict_id: zod_1.z.coerce.number().int().optional(),
    jmlUnit: zod_1.z.coerce.number().int().optional()
});
exports.rambuUpdateSchema = exports.rambuCreateSchema.partial();
// tipe foto:
// 1: gps_handled, 2: pemasangan 0%, 3: pemasangan 50%, 4: pemasangan 100%
exports.photoTypeMap = {
    gps: 1, zero: 2, fifty: 3, hundred: 4
};
