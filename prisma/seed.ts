import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // 1. Seed Superadmin User
  const superUsername = 'useradmin'
  const superPassword = 'password123'
  const superHashed = await bcrypt.hash(superPassword, 10)

  const admin = await prisma.users.upsert({
    where: { username: superUsername },
    update: {},
    create: {
      username: superUsername,
      password: superHashed,
      name: 'User Admin (Pusat)',
      role: 1, // SUPERADMIN
      status: 1, // Active
      satker_id: null,
    },
  })

  console.log("Superadmin seeded:", { admin })

  // 2. Define Regional Satker & User configurations
  const regionalConfig = [
    {
      username: 'bpbdbantul',
      password: 'password123',
      name: 'BPBD Kabupaten Bantul',
      satkerName: 'BPBD Kabupaten Bantul',
      prov_id: 14,
      city_id: 211
    },
    {
      username: 'bpbdgunungkidul',
      password: 'password123',
      name: 'BPBD Kabupaten Gunungkidul',
      satkerName: 'BPBD Kabupaten Gunungkidul',
      prov_id: 14,
      city_id: 213
    },
    {
      username: 'bpbdcilacap',
      password: 'password123',
      name: 'BPBD Kabupaten Cilacap',
      satkerName: 'BPBD Kabupaten Cilacap',
      prov_id: 13,
      city_id: 182
    },
    {
      username: 'bpbdlampung',
      password: 'password123',
      name: 'BPBD Kota Bandar Lampung',
      satkerName: 'BPBD Kota Bandar Lampung',
      prov_id: 8,
      city_id: 136
    }
  ]

  for (const config of regionalConfig) {
    // A. Upsert Satuan Kerja
    let satker = await prisma.satuanKerja.findFirst({
      where: {
        prov_id: config.prov_id,
        citiy_id: config.city_id
      }
    })

    if (!satker) {
      satker = await prisma.satuanKerja.create({
        data: {
          name: config.satkerName,
          prov_id: config.prov_id,
          citiy_id: config.city_id
        }
      })
    }

    // B. Upsert User
    const hashedPwd = await bcrypt.hash(config.password, 10)
    const seededUser = await prisma.users.upsert({
      where: { username: config.username },
      update: {
        satker_id: satker.id,
        role: 2, // Regional Admin
        status: 1
      },
      create: {
        username: config.username,
        password: hashedPwd,
        name: config.name,
        role: 2, // Regional Admin
        status: 1,
        satker_id: satker.id
      }
    })

    console.log(`Regional user seeded: ${config.username} (Satker: ${config.satkerName})`)
  }

  console.log("Seeding completed successfully.")
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
