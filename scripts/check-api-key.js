const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkApiKey() {
  const apiKey = 'bnpb-open-data-2025';
  const user = await prisma.user_openapi.findFirst({
    where: { key: apiKey }
  });

  if (user) {
    console.log('API Key exists:', user);
  } else {
    console.log('API Key not found. Creating one...');
    const newUser = await prisma.user_openapi.create({
      data: {
        email: 'public@bnpb.go.id',
        key: apiKey,
        domain: 'localhost',
        status: 1,
        institusi: 'map-public-frontend'
      }
    });
    console.log('Created API Key:', newUser);
  }
}

checkApiKey()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
