"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fetch_1 = __importDefault(require("node-fetch"));
const provinceGeomMap_1 = require("../lib/provinceGeomMap");
const provinceGeomRoutes = async (app) => {
    app.get("/province-geom/:provId", async (req, reply) => {
        const { provId } = req.params;
        const id = Number(provId);
        const key = provinceGeomMap_1.PROVINCE_GEOM_MAP[id];
        if (!key) {
            return reply.code(404).send({ error: "Provinsi tidak ditemukan" });
        }
        const githubUrl = `https://raw.githubusercontent.com/JfrAziz/indonesia-district/master/provincia/${key}.geojson`;
        try {
            const res = await (0, node_fetch_1.default)(githubUrl);
            if (!res.ok) {
                return reply.code(404).send({
                    error: "GeoJSON tidak ditemukan di GitHub",
                    url: githubUrl,
                });
            }
            const json = await res.json();
            return json;
        }
        catch (err) {
            return reply
                .code(500)
                .send({ error: "Gagal mengambil GeoJSON", detail: err.message });
        }
    });
};
exports.default = provinceGeomRoutes;
