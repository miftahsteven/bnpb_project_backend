/* scripts/loadProvinceGeom.ts
   Isi kolom provinces.geom (LONGTEXT/JSON) dari file GeoJSON provinsi.
   Tambahan: verbose logging & pencarian properti nama yang fleksibel. */

import fs from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'

type ProvinceFeature = {
    type: 'Feature',
    properties: Record<string, any>,
    geometry: any
}
type FC = { type: 'FeatureCollection', features: ProvinceFeature[] }

function norm(s: string | null | undefined) {
    return (s ?? '').normalize('NFKD').replace(/\s+/g, ' ').trim().toUpperCase()
}

// alias umum untuk menyamakan penulisan
const NAME_ALIASES: Record<string, string> = {
    'DAERAH ISTIMEWA YOGYAKARTA': 'DI YOGYAKARTA',
    'DKI JAKARTA': 'DKI JAKARTA',
    'KEP. BANGKA BELITUNG': 'KEPULAUAN BANGKA BELITUNG',
    'PAPUA BARAT DAYA': 'PAPUA BARAT DAYA', // bisa jadi tidak ada di dataset lama
    'PAPUA TENGAH': 'PAPUA TENGAH',         // bisa jadi tidak ada di dataset lama
}

function canon(s: string) {
    const n = norm(s)
    return norm(NAME_ALIASES[n] ?? n)
}

// Temukan nama dari properti yang mengandung 'name' atau 'prov'
function pickName(props: Record<string, any>): string | null {
    // kandidat eksplisit dulu
    const candidates = [
        'name', 'NAME', 'NAME_1', 'provinsi', 'PROVINSI', 'Provinsi',
        'prov_name', 'PROV_NAME', 'Propinsi', 'PROPINSI'
    ]
    for (const k of candidates) {
        if (props[k]) return String(props[k])
    }
    // fallback: cari key yang memuat kata 'name' atau 'prov'
    const dyn = Object.keys(props).find(k => /name|prov/i.test(k))
    if (dyn && props[dyn]) return String(props[dyn])
    return null
}

async function main() {
    //const file = path.join(process.cwd(), 'data/indonesia-province.json')
    const file = path.join(process.cwd(), 'data/indonesia-province.json')
    if (!fs.existsSync(file)) {
        console.error('File GeoJSON tidak ditemukan:', file)
        process.exit(1)
    }
    const fc: FC = JSON.parse(fs.readFileSync(file, 'utf8'))

    console.log(`GeoJSON features: ${fc.features?.length ?? 0}`)
    if (!fc.features || fc.features.length === 0) {
        console.error('GeoJSON tidak memiliki fitur.')
        process.exit(1)
    }
    // tampilkan beberapa key property agar kelihatan struktur
    const sampleProps = Object.keys(fc.features[0].properties || {})
    console.log('Contoh keys properti dari fitur pertama:', sampleProps.slice(0, 12))

    // Ambil provinsi dari DB
    const dbProvs = await prisma.provinces.findMany({
        select: { prov_id: true, prov_name: true }
    }) as Array<{ prov_id: number; prov_name: string | null }>

    console.log(`DB provinces: ${dbProvs.length}`)

    const mapDb = new Map<string, number>()
    for (const p of dbProvs) {
        const key = canon(p.prov_name || '')
        if (key) mapDb.set(key, p.prov_id)
    }

    const matches: Array<{ fileName: string; provId: number }> = []
    const misses: Array<{ fileName: string }> = []

    for (const f of fc.features) {
        const rawName = pickName(f.properties)
        const key = canon(String(rawName ?? ''))
        if (!key) {
            misses.push({ fileName: '(nama tidak ditemukan di properties)' })
            continue
        }
        const provId = mapDb.get(key)
        if (!provId) {
            misses.push({ fileName: String(rawName) })
            continue
        }

        const geomStr = JSON.stringify(f.geometry)
        await prisma.provinces.update({
            where: { prov_id: provId },
            data: { geom: geomStr } // pastikan field geom ada di schema
        })
        matches.push({ fileName: String(rawName), provId })
    }

    console.log(`Updated geom untuk ${matches.length} provinsi`)
    if (matches.length) {
        console.log('Contoh match:', matches.slice(0, 5))
    }
    if (misses.length) {
        console.warn(`Tidak cocok (${misses.length}):`, misses.slice(0, 10))
        console.warn('Catatan: jika dataset lama (34 prov), PAPUA BARAT DAYA & PAPUA TENGAH mungkin tidak ada.')
    }
}

main()
    .catch(e => { console.error(e); process.exit(1) })
    .finally(() => prisma.$disconnect())
