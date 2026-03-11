"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeId = encodeId;
exports.decodeId = decodeId;
const hashids_1 = __importDefault(require("hashids"));
const hashids = new hashids_1.default("BNPB_RAMBU_API_SECRET_SALT", 8); // Minimum length 8
function encodeId(id) {
    return hashids.encode(id);
}
function decodeId(hash) {
    if (typeof hash === 'number')
        return hash; // Fallback if already number
    const decoded = hashids.decode(hash);
    if (decoded.length === 0) {
        return null;
    }
    return Number(decoded[0]);
}
