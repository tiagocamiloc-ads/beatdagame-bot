/**
 * Bootstraps a CRM login. There is no public signup page (this is an
 * internal tool for a handful of editors), so accounts are created here.
 *
 * Usage: pnpm create-user user@example.com "some-password" "Optional Name"
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "@beatdagame/db";

async function main() {
  const [, , email, password, name] = process.argv;

  if (!email || !password) {
    console.error('Usage: pnpm create-user <email> <password> ["name"]');
    process.exitCode = 1;
    return;
  }
  if (password.length < 7) {
    console.error("Password must be at least 7 characters.");
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name: name ?? undefined },
    create: { email, passwordHash, name },
  });

  console.log(`User ready: ${user.email} (id: ${user.id})`);
}

main()
  .catch((err) => {
    console.error("Failed to create user:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
