import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL
  const authToken = process.env.DATABASE_AUTH_TOKEN

  console.log('[db] DATABASE_URL:', databaseUrl ? `${databaseUrl.substring(0, 30)}...` : 'NOT SET')
  console.log('[db] DATABASE_AUTH_TOKEN:', authToken ? 'SET (hidden)' : 'NOT SET')

  // If using Turso/libSQL, use the driver adapter
  if (databaseUrl && typeof databaseUrl === 'string' && databaseUrl !== 'undefined' &&
      (databaseUrl.startsWith('libsql://') || databaseUrl.startsWith('http://') || databaseUrl.startsWith('https://'))) {
    console.log('[db] Using Turso/libSQL adapter')

    // Dynamic imports to avoid build-time issues
    const { createClient } = require('@libsql/client')
    const { PrismaLibSql } = require('@prisma/adapter-libsql')

    const libsql = createClient({
      url: databaseUrl,
      authToken: authToken && authToken !== 'undefined' ? authToken : undefined,
    })
    const adapter = new PrismaLibSql(libsql)
    return new PrismaClient({ adapter, log: ['query'] } as any)
  }

  // Default: local SQLite file (for dev / Z.AI container)
  console.log('[db] Using local SQLite (no Turso URL detected)')
  return new PrismaClient({ log: ['query'] })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
