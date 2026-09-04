const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const total = await prisma.user.count();
  const diagnosticEmails = Array.from({length:9}, (_,i)=> `diagnostic${String(i+1).padStart(2,'0')}@test.amphixmeet.local`);
  const diagCount = await prisma.user.count({ where: { email: { in: diagnosticEmails } } });
  console.log(`TOTAL UTILISATEURS : ${total}`);
  console.log(`COMPTES DIAGNOSTIC : ${diagCount}/9`);
  console.log(`Requête SQL utilisée : SELECT COUNT(*) FROM "users"`);
  await prisma.$disconnect();
}
run().catch(e=>{console.error(e);process.exit(1);});
