const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
async function run() {
  // Total users
  const totalResult = await prisma.$queryRaw`SELECT COUNT(*) FROM "users"`;
  const total = Number(totalResult[0].count);

  // Diagnostic accounts
  const diagnosticEmails = Array.from({length:9}, (_,i)=> `diagnostic${String(i+1).padStart(2,'0')}@test.amphixmeet.local`);
  const placeholders = diagnosticEmails.map((_, i) => `$${i + 1}`).join(', ');
  const diagQuery = `SELECT COUNT(*) FROM "users" WHERE "email" IN (${placeholders})`;
  const diagResult = await prisma.$queryRaw(diagQuery, ...diagnosticEmails);
  const diagCount = Number(diagResult[0].count);

  console.log(`TOTAL UTILISATEURS : ${total}`);
  console.log(`COMPTES DIAGNOSTIC : ${diagCount}/9`);
  console.log(`Requête SQL utilisée : SELECT COUNT(*) FROM "users"`);
  await prisma.$disconnect();
}
run().catch(e=>{console.error(e);process.exit(1);});
