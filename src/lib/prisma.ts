import { PrismaClient } from "@prisma/client";
import "dotenv/config";

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        log: process.env.NODE_ENV === "production" ? [] : ["query"],
    });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
