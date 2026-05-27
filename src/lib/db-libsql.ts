import { createClient, Client } from '@libsql/client';

let _client: Client | null = null;

export function getLibsqlClient(): Client {
  if (_client) return _client;
  
  const databaseUrl = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }
  
  _client = createClient({
    url: databaseUrl,
    authToken: authToken || undefined,
  });
  
  return _client;
}
