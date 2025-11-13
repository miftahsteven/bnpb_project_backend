"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const jwt_1 = require("../lib/jwt");
exports.default = (0, fastify_plugin_1.default)(async (app) => {
    app.decorate("authenticate", async (req, reply) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer "))
                return reply.status(401).send({ message: "Missing Bearer token" });
            const token = authHeader.split(" ")[1];
            const decoded = (0, jwt_1.verifyToken)(token);
            req.user = decoded;
        }
        catch (err) {
            reply.status(401).send({ message: "Invalid or expired token" });
        }
    });
});
