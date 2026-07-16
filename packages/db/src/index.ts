import { PrismaClient } from "@prisma/client";

// Single shared Prisma client. Worker jobs (GitHub Actions) are
// short-lived processes so a fresh client per run is fine; apps/web
// reuses the same singleton pattern across hot-reloads in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
export * from "./queries.js";
