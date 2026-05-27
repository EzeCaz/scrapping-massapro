import { NextResponse } from 'next/server';
import { createClient } from '@libsql/client';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  
  const results: any = { url: databaseUrl?.substring(0, 30) + '...', authSet: !!authToken };
  
  // Test 1: Direct libsql
  try {
    const client = createClient({
      url: databaseUrl!,
      authToken: authToken || undefined,
    });
    const result = await client.execute('SELECT COUNT(*) as count FROM Lead');
    results.directLibsql = { success: true, count: result.rows[0]?.count };
  } catch (err: any) {
    results.directLibsql = { error: err.message };
  }
  
  // Test 2: Prisma with adapter (fresh instance, no caching)
  try {
    const libsql = createClient({
      url: databaseUrl!,
      authToken: authToken || undefined,
    });
    const adapter = new PrismaLibSQL(libsql);
    const prisma = new PrismaClient({ adapter } as any);
    
    const leads = await prisma.lead.findMany({ take: 1 });
    results.prismaWithAdapter = { success: true, count: leads.length };
    await prisma.$disconnect();
  } catch (err: any) {
    results.prismaWithAdapter = { 
      error: err.message,
      errorType: err.constructor.name,
      stack: err.stack?.substring(0, 300)
    };
  }
  
  return NextResponse.json(results);
}
