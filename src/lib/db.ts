import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'

// ─── Lazy singleton ───────────────────────────────────────────────────
// The PrismaClient is NEVER created at module-import time.
// It is only constructed the first time getDb() is called at request-time,
// when Vercel environment variables are guaranteed to be available.
// ──────────────────────────────────────────────────────────────────────

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let _prismaClient: PrismaClient | null = null

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL
  const authToken = process.env.DATABASE_AUTH_TOKEN

  console.log(`[db] Initializing PrismaClient — DATABASE_URL is ${databaseUrl ? databaseUrl.substring(0, 20) + '...' : 'NOT SET'}`)

  // Use Turso/libSQL if URL is provided and looks like a remote DB
  if (
    databaseUrl &&
    typeof databaseUrl === 'string' &&
    databaseUrl !== 'undefined' &&
    databaseUrl.length > 0 &&
    (databaseUrl.startsWith('libsql://') || databaseUrl.startsWith('http://') || databaseUrl.startsWith('https://'))
  ) {
    const cleanAuthToken =
      authToken && typeof authToken === 'string' && authToken !== 'undefined' && authToken.length > 0
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

  // Fallback: local SQLite (dev / build-time only)
  console.log('[db] Using local SQLite fallback')
  return new PrismaClient()
}

/**
 * Get the singleton PrismaClient — creates it lazily on first call.
 * This is the ONLY safe way to obtain a PrismaClient at runtime.
 */
export function getDb(): PrismaClient {
  // Reuse global singleton in dev to avoid connection pool exhaustion
  if (process.env.NODE_ENV !== 'production' && globalForPrisma.prisma) {
    return globalForPrisma.prisma
  }

  if (!_prismaClient) {
    _prismaClient = createPrismaClient()
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = _prismaClient
    }
  }
  return _prismaClient
}

/**
 * Proxy-based `db` export — safe to import at module level because
 * the PrismaClient is NOT constructed until a property is actually accessed.
 * Every property access is forwarded to the lazily-created client.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getDb()
    const value = (client as any)[prop]
    // Preserve function `this` binding
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})
