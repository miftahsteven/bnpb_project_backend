import "fastify";

declare module "fastify" {
    interface FastifyInstance {
        authenticate: any;
    }

    interface FastifyRequest {
        user: {
            id: number;
            role: number;   // ✅ integer
            satker_id?: number;
            satuanKerja?: {
                id: number;
                name: string;
            };
        };
    }
}
