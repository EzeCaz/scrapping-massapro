import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL
  const authToken = process.env.DATABASE_AUTH_TOKEN

  // Use Turso/libSQL if URL is provided and valid
  if (databaseUrl &&
      typeof databaseUrl === 'string' &&
      databaseUrl !== 'undefined' &&
      databaseUrl.length > 0 &&
      (databaseUrl.startsWith('libsql://') || databaseUrl.startsWith('http://') || databaseUrl.startsWith('https://'))) {

    const cleanAuthToken = (authToken && typeof authToken === 'string' && authToken !== 'undefined' && authToken.length > 0)
      ? authToken
      : undefined

    try {
      const libsql = createClient({
        url: databaseUrl,
        authToken: cleanAuthToken,
      })
      const adapter = new PrismaLibSql(libsql)
      return new PrismaClient({ adapter } as any)
    } catch (err) {
      console.error('[db] Turso connection failed:', err)
      throw err
    }
  }

  // Fallback: local SQLite (dev only)
  return new PrismaClient()
}

// Singleton — only create once per process
export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
