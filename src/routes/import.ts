import { FastifyPluginAsync } from 'fastify'
import XLSX from 'xlsx'
import AdmZip from 'adm-zip'
import { prisma } from '../lib/prisma'
import { saveBufferLocal, sha256 } from '../lib/storage'
import { randomUUID } from 'crypto'

// helper baca excel buffer -> array record
function readExcel(buf: Buffer) {
    const wb = XLSX.read(buf, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' })
    return rows
}

// mapping contoh dari "Jenis Rambu" ke Category / DisasterType
async function resolveCategoryAndDisaster(jenis: string, defaults: { categoryId?: number, disasterTypeId?: number }) {
    if (defaults.categoryId && defaults.disasterTypeId) {
        return { categoryId: defaults.categoryId, disasterTypeId: defaults.disasterTypeId }
    }
    // contoh sangat sederhana: coba cari Category.name == jenis (case-insensitive)
    const cat = await prisma.category.findFirst({
        where: { name: { equals: jenis } }
    })
    // fallback: pakai default kalau ada
    return {
        categoryId: cat?.id ?? defaults.categoryId ?? (() => { throw new Error('categoryId tidak ditemukan & default tidak diisi') })(),
        disasterTypeId: defaults.disasterTypeId ?? (() => { throw new Error('disasterTypeId default tidak diisi') })()
    }
}

const importRoutes: FastifyPluginAsync = async (app) => {
    // POST /api/import/rambu-excel
    // Form fields:
    //  - file: excel (.xlsx)
    //  - imagesZip: (optional) .zip berisi file gambar, dipetakan lewat kolom PhotoGPS/Photo0/Photo50/Photo100
    //  - defaults (opsional): categoryId, disasterTypeId, prov_id, city_id, district_id, subdistrict_id
    app.post('/import/rambu-excel', async (req, reply) => {
        const q = req.query as any
        const defaults = {
            categoryId: q.categoryId ? Number(q.categoryId) : undefined,
            disasterTypeId: q.disasterTypeId ? Number(q.disasterTypeId) : undefined,
            prov_id: q.prov_id ? Number(q.prov_id) : undefined,
            city_id: q.city_id ? Number(q.city_id) : undefined,
            district_id: q.district_id ? Number(q.district_id) : undefined,
            subdistrict_id: q.subdistrict_id ? Number(q.subdistrict_id) : undefined,
        }

        let excelBuf: Buffer | null = null
        let zipBuf: Buffer | null = null

        const parts = req.parts()
        for await (const part of parts) {
            if (part.type === 'file') {
                const chunks: Buffer[] = []
                for await (const chunk of part.file) {
                    chunks.push(chunk as Buffer)
                }
                const buf = Buffer.concat(chunks)
                if (part.fieldname === 'file') {
                    excelBuf = buf
                } else if (part.fieldname === 'imagesZip') {
                    zipBuf = buf
                }
            }
        }

        if (!excelBuf) return reply.code(400).send({ error: 'Excel file (field "file") wajib.' })

        // siapkan lookup gambar dari zip (jika ada)
        const zipLookup = new Map<string, Buffer>()
        if (zipBuf) {
            const zip = new AdmZip(zipBuf)
            zip.getEntries().forEach(e => {
                if (!e.isDirectory && e.entryName) {
                    zipLookup.set(e.entryName.split('/').pop()!, e.getData())
                }
            })
        }

        const rows = readExcel(excelBuf)
        const createdIds: number[] = []
        const errors: Array<{ row: number; message: string }> = []

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            try {
                const jenis = String(row['Jenis Rambu'] ?? row['jenis_rambu'] ?? '').trim()
                const jmlUnit = row['jumlah unit'] ?? row['Jumlah Unit'] ?? row['jmlUnit'] ?? null
                const alamat = row['Alamat Pemasangan'] ?? row['alamat'] ?? null
                const lat = Number(row['Latitude'] ?? row['lat'])
                const lng = Number(row['Longitude'] ?? row['lng'])

                if (!lat || !lng) throw new Error('Latitude/Longitude tidak valid')
                const { categoryId, disasterTypeId } = await resolveCategoryAndDisaster(jenis, defaults)

                const rambu = await prisma.rambu.create({
                    data: {
                        name: jenis || `Rambu-${Date.now()}`,
                        description: alamat || undefined,
                        lat, lng,
                        categoryId, disasterTypeId,
                        prov_id: defaults.prov_id,
                        city_id: defaults.city_id,
                        district_id: defaults.district_id,
                        subdistrict_id: defaults.subdistrict_id,
                        jmlUnit: jmlUnit ? Number(jmlUnit) : null
                    }
                })

                // jika Excel menyediakan kolom nama file gambar & ZIP diberikan
                const photoCols = [
                    { key: 'PhotoGPS', type: 1 },
                    { key: 'Photo0', type: 2 },
                    { key: 'Photo50', type: 3 },
                    { key: 'Photo100', type: 4 },
                ]
                for (const pc of photoCols) {
                    const fname = row[pc.key]
                    if (fname && zipLookup.size) {
                        const base = String(fname).trim()
                        const buf = zipLookup.get(base)
                        if (buf) {
                            const ext = (base.split('.').pop() || 'jpg').toLowerCase()
                            const url = saveBufferLocal(`${rambu.id}-${pc.key}-${randomUUID()}.${ext}`, buf)
                            await prisma.photo.create({
                                data: { rambuId: rambu.id, url, checksum: sha256(buf), type: pc.type }
                            })
                        }
                    }
                }

                createdIds.push(rambu.id)
            } catch (e: any) {
                errors.push({ row: i + 2, message: e.message || String(e) })
            }
        }

        reply.send({ created: createdIds.length, ids: createdIds, errors })
    })
}

export default importRoutes
