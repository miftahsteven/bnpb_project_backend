const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const SERVER_FRONTEND_KEY = 'dlfPFYuptjbaRJXdGbxP4r/88d8kaNy3CBgWKf4BVWM=';
  const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY || 'map-public-key-value-here';

  await prisma.user_openapi.create({
    data: {
      key: SERVER_FRONTEND_KEY,
      institusi: 'map-public-frontend',
      domain: 'localhost',
      status: 1
    }
  }).catch(e => console.log('SERVER frontend key might already exist', e.message));
  
  console.log('Done inserting frontend keys');
}

main().catch(console.error).finally(() => prisma.$disconnect());
