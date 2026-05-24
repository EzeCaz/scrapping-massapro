import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL || ''

  // If using Turso/libSQL (URL starts with libsql://), use the driver adapter
  if (databaseUrl.startsWith('libsql://') || databaseUrl.startsWith('http://') || databaseUrl.startsWith('https://')) {
    const libsql = createClient({
      url: databaseUrl,
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    })
    const adapter = new PrismaLibSQL(libsql)
    return new PrismaClient({ adapter, log: ['query'] } as any)
  }

  // Default: local SQLite file (for dev / Z.AI container)
  return new PrismaClient({ log: ['query'] })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
