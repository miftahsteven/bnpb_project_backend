import { z } from 'zod'

export const categorySchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
})

export const disasterTypeSchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
})
