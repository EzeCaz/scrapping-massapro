import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let _db: PrismaClient | undefined = undefined

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL
  const authToken = process.env.DATABASE_AUTH_TOKEN

  console.log('[db] DATABASE_URL:', databaseUrl ? `${databaseUrl.substring(0, 30)}...` : 'NOT SET')
  console.log('[db] DATABASE_AUTH_TOKEN:', authToken ? 'SET (hidden)' : 'NOT SET')

  // If using Turso/libSQL, use the driver adapter
  if (databaseUrl &&
      typeof databaseUrl === 'string' &&
      databaseUrl !== 'undefined' &&
      databaseUrl.length > 0 &&
      (databaseUrl.startsWith('libsql://') || databaseUrl.startsWith('http://') || databaseUrl.startsWith('https://'))) {
    console.log('[db] Using Turso/libSQL adapter')

    const libsql = createClient({
      url: databaseUrl,
      authToken: (authToken && authToken !== 'undefined' && authToken.length > 0) ? authToken : undefined,
    })
    const adapter = new PrismaLibSql(libsql)
    return new PrismaClient({ adapter, log: ['query'] } as any)
  }

  // Default: local SQLite file (for dev / Z.AI container)
  console.log('[db] Using local SQLite (no Turso URL detected)')
  return new PrismaClient({ log: ['query'] })
}

// Lazy getter — only creates the client when first accessed, not at import time
export function getDb(): PrismaClient {
  if (_db) return _db
  _db = globalForPrisma.prisma ?? createPrismaClient()
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = _db
  return _db
}

// For backward compatibility — but uses lazy init
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const realDb = getDb()
    const value = Reflect.get(realDb, prop, receiver)
    if (typeof value === 'function') {
      return value.bind(realDb)
    }
    return value
  },
})
