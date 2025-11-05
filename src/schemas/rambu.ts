import { z } from 'zod'

export const rambuCreateSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    categoryId: z.string().min(1),
    disasterTypeId: z.string().min(1),
})
