import { NextResponse } from 'next/server';
import { createClient } from '@libsql/client';

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  
  if (!databaseUrl) {
    return NextResponse.json({ error: 'DATABASE_URL not set' });
  }
  
  try {
    const client = createClient({
      url: databaseUrl,
      authToken: authToken || undefined,
    });
    
    const result = await client.execute('SELECT COUNT(*) as count FROM Lead');
    const count = result.rows[0]?.count;
    
    return NextResponse.json({ 
      success: true, 
      leadCount: count,
      url: databaseUrl.substring(0, 30) + '...',
      authSet: !!authToken
    });
  } catch (err: any) {
    return NextResponse.json({ 
      error: err.message,
      url: databaseUrl.substring(0, 30) + '...',
      authSet: !!authToken,
      stack: err.stack?.substring(0, 500)
    });
  }
}
