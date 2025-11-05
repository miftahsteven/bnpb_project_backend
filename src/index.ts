import path from 'path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { ZodTypeProvider } from 'fastify-type-provider-zod'

import refRoutes from '@/routes/ref'
import rambuRoutes from '@/routes/rambu'
import importRoutes from '@/routes/import'

const app = Fastify({ logger: { transport: { target: 'pino-pretty' } } }).withTypeProvider<ZodTypeProvider>()

async function main() {
    await app.register(cors, { origin: true })
    await app.register(multipart)
    await app.register(fastifyStatic, {
        root: path.join(process.cwd(), 'uploads'),
        prefix: '/uploads/'
    })

    app.get('/health', () => ({ ok: true }))

    await app.register(refRoutes, { prefix: '/api' })
    await app.register(rambuRoutes, { prefix: '/api' })
    await app.register(importRoutes, { prefix: '/api' })

    const port = process.env.PORT ? Number(process.env.PORT) : 4000
    await app.listen({ port })
    app.log.info(`API ready at http://localhost:${port}`)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
