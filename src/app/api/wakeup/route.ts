import { NextResponse } from 'next/server';

const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL || '';

// GET /api/wakeup — Ping the Render scraper service to wake it from sleep
// Call this when the user opens the scraper page so Render is ready by the time they search
export async function GET() {
  if (!SCRAPER_SERVICE_URL) {
    return NextResponse.json({ woken: false, message: 'No scraper service URL configured' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s max wait for cold start

    const res = await fetch(`${SCRAPER_SERVICE_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({ woken: true, status: data.status, message: 'Scraper service is awake' });
    }

    return NextResponse.json({ woken: false, message: `Service returned ${res.status}` });
  } catch (err) {
    // Service is likely still waking up — that's okay, the warm-up request is in progress
    return NextResponse.json({
      woken: false,
      message: 'Scraper service is waking up (this is normal on first request)',
      hint: 'Wait 20-30 seconds and try scraping',
    });
  }
}
