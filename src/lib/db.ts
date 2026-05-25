import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL || ''
  const authToken = process.env.DATABASE_AUTH_TOKEN || ''

  // If using Turso/libSQL (URL starts with libsql://), use the driver adapter
  if (databaseUrl && (databaseUrl.startsWith('libsql://') || databaseUrl.startsWith('http://') || databaseUrl.startsWith('https://'))) {
    console.log('[db] Using Turso/libSQL adapter:', databaseUrl.replace(/\/\/.*@/, '//***@'))
    const libsql = createClient({
      url: databaseUrl,
      authToken: authToken || undefined,
    })
    const adapter = new PrismaLibSql(libsql)
    return new PrismaClient({ adapter, log: ['query'] } as any)
  }

  // Default: local SQLite file (for dev / Z.AI container)
  console.log('[db] Using local SQLite (DATABASE_URL not set or not a libsql URL)')
  return new PrismaClient({ log: ['query'] })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
