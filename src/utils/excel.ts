import XLSX from 'xlsx'
import { z } from 'zod'
import { rambuCreateSchema } from '@/schemas/rambu'

export const excelRowSchema = rambuCreateSchema.extend({
    // dukung kolom tambahan jika perlu
})

export function parseRambuExcel(buffer: Buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' })

    const ok: any[] = []
    const errors: any[] = []

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
            }
            const parsed = excelRowSchema.parse(mapped)
            ok.push(parsed)
        } catch (e: any) {
            errors.push({ row: idx + 2, message: e.message })
        }
    })

    return { ok, errors }
}
