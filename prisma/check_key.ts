import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const apiKey = 'atIZJ3oo9E91Vwu6Cg6x5+fImuZ276Y1k+EDNW+z1kU='
  const keyRecord = await prisma.user_openapi.findFirst({
    where: { key: apiKey }
  })

  if (keyRecord) {
    console.log('API Key found:', keyRecord)
  } else {
    console.log('API Key NOT found. Creating one...')
    const newKey = await prisma.user_openapi.create({
      data: {
        email: 'admin@bnpb.go.id',
        key: apiKey,
        domain: 'localhost',
        status: 1,
        institusi: 'internal-frontend'
      }
    })
    console.log('Created new API Key:', newKey)
  }
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
