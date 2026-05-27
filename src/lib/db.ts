import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'
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
  const isVercel = !!(process.env.VERCEL || process.env.NOW_BUILDER)

  console.log(`[db] Initializing PrismaClient — env: ${isVercel ? 'Vercel' : 'local'}, DATABASE_URL: ${databaseUrl ? databaseUrl.substring(0, 25) + '...' : 'NOT SET'}`)
  console.log(`[db] AUTH_TOKEN: ${authToken ? 'SET (' + authToken.length + ' chars)' : 'NOT SET'}`)
  console.log(`[db] VERCEL: ${process.env.VERCEL || 'no'}, NOW_BUILDER: ${process.env.NOW_BUILDER || 'no'}`)
  console.log(`[db] _prismaClient already exists: ${!!_prismaClient}`)

  // On Vercel: DATABASE_URL MUST be set to a libsql:// URL
  if (isVercel) {
    if (!databaseUrl || databaseUrl === 'undefined' || databaseUrl === 'file:./tmp.db') {
      throw new Error(
        'DATABASE_URL is not configured for production. ' +
        'Please set DATABASE_URL and DATABASE_AUTH_TOKEN in your Vercel project settings (Settings → Environment Variables). ' +
        'DATABASE_URL should be a libsql://... URL from your Turso database.'
      )
    }

    if (!databaseUrl.startsWith('libsql://') && !databaseUrl.startsWith('http://') && !databaseUrl.startsWith('https://')) {
      throw new Error(
        `DATABASE_URL must start with libsql:// on Vercel. Got: ${databaseUrl.substring(0, 30)}... ` +
        'Please check your Turso database URL in Vercel Environment Variables.'
      )
    }

    const cleanAuthToken =
      authToken && typeof authToken === 'string' && authToken !== 'undefined' && authToken.length > 0
        ? authToken
        : undefined

    if (!cleanAuthToken) {
      console.warn('[db] WARNING: DATABASE_AUTH_TOKEN is not set. This may cause authentication errors with Turso.')
    }

    try {
      const libsql = createClient({
        url: databaseUrl,
        authToken: cleanAuthToken,
      })
      const adapter = new PrismaLibSQL(libsql)
      return new PrismaClient({ adapter, datasourceUrl: databaseUrl } as any)
    } catch (err) {
      console.error('[db] Turso connection failed:', err)
      throw err
    }
  }

  // Local dev: Use Turso if configured, otherwise fall back to local SQLite
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
      const adapter = new PrismaLibSQL(libsql)
      return new PrismaClient({ adapter, datasourceUrl: databaseUrl } as any)
    } catch (err) {
      console.error('[db] Turso connection failed, falling back to SQLite:', err)
    }
  }

  // Fallback: local SQLite (dev only)
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
