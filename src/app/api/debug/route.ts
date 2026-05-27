import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    DATABASE_URL: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 40) + '...' : 'NOT SET',
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN ? `SET (${process.env.DATABASE_AUTH_TOKEN.length} chars)` : 'NOT SET',
    SCRAPER_SERVICE_URL: process.env.SCRAPER_SERVICE_URL || 'NOT SET',
    VERCEL: process.env.VERCEL || 'NOT SET',
    NOW_BUILDER: process.env.NOW_BUILDER || 'NOT SET',
    NODE_ENV: process.env.NODE_ENV || 'NOT SET',
  });
}
