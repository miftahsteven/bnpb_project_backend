"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.excelRowSchema = void 0;
exports.parseRambuExcel = parseRambuExcel;
const xlsx_1 = __importDefault(require("xlsx"));
const rambu_1 = require("@/schemas/rambu");
exports.excelRowSchema = rambu_1.rambuCreateSchema.extend({
// dukung kolom tambahan jika perlu
});
function parseRambuExcel(buffer) {
    const wb = xlsx_1.default.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = xlsx_1.default.utils.sheet_to_json(sheet, { defval: '' });
    const ok = [];
    const errors = [];
    json.forEach((row, idx) => {
        try {
            // mapping kolom -> field
            const mapped = {
                name: row['name'] || row['nama_rambu'],
                description: row['description'] || row['deskripsi'] || undefined,
                lat: row['lat'],
                lng: row['lng'],
                categoryId: row['categoryId'] || row['kategori_id'],
                disasterTypeId: row['disasterTypeId'] || row['jenis_id'],
            };
            const parsed = exports.excelRowSchema.parse(mapped);
            ok.push(parsed);
        }
        catch (e) {
            errors.push({ row: idx + 2, message: e.message });
        }
    });
    return { ok, errors };
}
