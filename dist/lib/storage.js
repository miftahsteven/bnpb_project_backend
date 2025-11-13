"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveBufferLocal = saveBufferLocal;
exports.sha256 = sha256;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const UPLOAD_DIR = path_1.default.join(process.cwd(), 'uploads');
if (!fs_1.default.existsSync(UPLOAD_DIR))
    fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
function saveBufferLocal(filename, buf) {
    const target = path_1.default.join(UPLOAD_DIR, filename);
    fs_1.default.writeFileSync(target, buf);
    return `/uploads/${filename}`;
}
function sha256(buf) {
    return crypto_1.default.createHash('sha256').update(buf).digest('hex');
}
