import path from 'path'
import fs from 'fs'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

export function saveBufferLocal(filename: string, buf: Buffer) {
    const target = path.join(UPLOAD_DIR, filename)
    fs.writeFileSync(target, buf)
    return `/uploads/${filename}`
}
