import { z } from 'zod'

const toNum = (v: unknown) => {
    if (v === '' || v === null || typeof v === 'undefined') return NaN
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
        const s = v.trim().replace(',', '.')
        const n = Number(s)
        return Number.isFinite(n) ? n : NaN
    }
    return NaN
}

const latCoerce = z.preprocess((v) => toNum(v), z.number().min(-90).max(90))
const lngCoerce = z.preprocess((v) => toNum(v), z.number().min(-180).max(180))


export const rambuCreateSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    // lat: z.coerce.number().min(-90).max(90),
    // lng: z.coerce.number().min(-180).max(180),
    lat: latCoerce,
    lng: lngCoerce,
    categoryId: z.coerce.number().int().positive(),
    disasterTypeId: z.coerce.number().int().positive(),
    prov_id: z.coerce.number().int().optional(),
    city_id: z.coerce.number().int().optional(),
    district_id: z.coerce.number().int().optional(),
    subdistrict_id: z.coerce.number().int().optional(),
    jmlUnit: z.coerce.number().int().optional()
})

export const rambuUpdateSchema = rambuCreateSchema.partial()

// tipe foto:
// 1: gps_handled, 2: pemasangan 0%, 3: pemasangan 50%, 4: pemasangan 100%
export const photoTypeMap = {
    gps: 1, zero: 2, fifty: 3, hundred: 4
} as const
