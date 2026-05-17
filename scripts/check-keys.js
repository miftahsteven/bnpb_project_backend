const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const keys = await prisma.user_openapi.findMany();
  console.log("OPENAPI KEYS:", JSON.stringify(keys, null, 2));
}
run().catch(console.error).finally(() => prisma.$disconnect());
