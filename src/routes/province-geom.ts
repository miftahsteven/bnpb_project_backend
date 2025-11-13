import { FastifyPluginAsync } from "fastify";
import fetch from "node-fetch";
import { PROVINCE_GEOM_MAP } from "../lib/provinceGeomMap";

const provinceGeomRoutes: FastifyPluginAsync = async (app) => {

    app.get("/province-geom/:provId", async (req, reply) => {
        const { provId } = req.params as any;
        const id = Number(provId);

        const key = PROVINCE_GEOM_MAP[id];
        if (!key) {
            return reply.code(404).send({ error: "Provinsi tidak ditemukan" });
        }

        const githubUrl = `https://raw.githubusercontent.com/JfrAziz/indonesia-district/master/provincia/${key}.geojson`;

        try {
            const res = await fetch(githubUrl);
            if (!res.ok) {
                return reply.code(404).send({
                    error: "GeoJSON tidak ditemukan di GitHub",
                    url: githubUrl,
                });
            }

            const json = await res.json();
            return json;

        } catch (err: any) {
            return reply
                .code(500)
                .send({ error: "Gagal mengambil GeoJSON", detail: err.message });
        }
    });

};

export default provinceGeomRoutes;
