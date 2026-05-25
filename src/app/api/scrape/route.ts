import { NextRequest, NextResponse } from 'next/server';

// Scraper service URL — deployed on Render separately from Vercel
const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL || '';
const IS_VERCEL = !!(process.env.VERCEL || process.env.NOW_BUILDER);

// In-memory job store for async scraping (fallback when scraper service is local)
interface ScrapeJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  detailCount: number;
  result: any;
  error: string;
  startedAt: number;
}

const jobs = new Map<string, ScrapeJob>();

// Clean up old jobs every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > 30 * 60 * 1000) {
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000);

interface ScrapeRequest {
  type: 'google-maps' | 'generic' | 'search';
  query?: string;
  url?: string;
  maxResults?: number;
  maxPages?: number;
  depth?: number;
  fetcher: 'basic' | 'stealthy' | 'dynamic';
  fetchDetails?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: ScrapeRequest = await request.json();
    const { type, query, url, maxResults, maxPages, depth, fetcher, fetchDetails } = body;

    // Validate request
    if (type === 'google-maps' && !query) {
      return NextResponse.json(
        { success: false, error: 'Query is required for Google Maps scraping' },
        { status: 400 }
      );
    }
    if (type === 'generic' && !url) {
      return NextResponse.json(
        { success: false, error: 'URL is required for generic scraping' },
        { status: 400 }
      );
    }
    if (type === 'search' && !query) {
      return NextResponse.json(
        { success: false, error: 'Query is required for search scraping' },
        { status: 400 }
      );
    }

    // --- Mode 1: Call remote scraper service (Vercel → Render) ---
    if (SCRAPER_SERVICE_URL) {
      console.log(`[scrape] Calling remote scraper service: ${SCRAPER_SERVICE_URL}/scrape`);
      try {
        const scraperRes = await fetch(`${SCRAPER_SERVICE_URL}/scrape`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            query,
            url,
            maxResults: maxResults || 20,
            maxPages: maxPages || 5,
            depth: depth || 0,
            fetcher: fetcher || 'dynamic',
            fetchDetails: fetchDetails !== false,
          }),
          signal: AbortSignal.timeout(60000), // 60s timeout (Render free tier needs ~30s cold start)
        });

        if (scraperRes.ok) {
          const data = await scraperRes.json();
          if (data.jobId) {
            const jobId = data.jobId;
            jobs.set(jobId, {
              id: jobId,
              status: 'running',
              progress: 0,
              message: 'Job forwarded to scraper service',
              detailCount: 0,
              result: null,
              error: '',
              startedAt: Date.now(),
            });
            return NextResponse.json({
              success: true,
              jobId,
              message: 'Scraping job started',
            });
          }
        } else {
          const errorText = await scraperRes.text();
          console.error(`[scrape] Remote service returned ${scraperRes.status}: ${errorText}`);
        }
      } catch (fetchErr) {
        console.error('[scrape] Remote service unavailable:', fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
      }
    } else {
      console.log('[scrape] SCRAPER_SERVICE_URL not set');
    }

    // --- Mode 2: Local subprocess fallback (Z.AI container / dev mode only) ---
    // On Vercel, there are no local scripts, so this will always fail.
    // Skip local fallback on Vercel and return a clear error instead.
    if (IS_VERCEL) {
      return NextResponse.json({
        success: false,
        error: 'Scraper service is unavailable. This could mean:\n1. The scraper service on Render is still waking up (free tier sleeps after 15min). Please try again in 30 seconds.\n2. The SCRAPER_SERVICE_URL environment variable may not be set in Vercel.',
      }, { status: 503 });
    }

    // Local subprocess mode (for Z.AI / dev only)
    const { spawn } = await import('child_process');
    const path = await import('path');
    const fs = await import('fs');

    const PROJECT_ROOT = process.env.PROJECT_ROOT || '/home/z/my-project';
    const PYTHON_PATH = process.env.PYTHON_PATH || path.join(PROJECT_ROOT, 'scrapling_env/bin/python3.12');
    const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(PROJECT_ROOT, 'scraping-scripts');

    let scriptName: string;
    let args: string[];

    switch (type) {
      case 'google-maps':
        scriptName = 'google_maps_scraper.py';
        args = ['--query', query!, '--max-results', String(maxResults || 20), '--fetcher', fetcher || 'dynamic'];
        if (fetchDetails === false) args.push('--no-details');
        break;
      case 'generic':
        scriptName = 'generic_scraper.py';
        args = ['--url', url!, '--depth', String(depth || 0), '--fetcher', fetcher || 'stealthy'];
        break;
      case 'search':
        scriptName = 'search_scraper.py';
        args = ['--query', query!, '--max-pages', String(maxPages || 5), '--fetcher', fetcher || 'stealthy'];
        break;
      default:
        return NextResponse.json({ success: false, error: 'Invalid scrape type' }, { status: 400 });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job: ScrapeJob = {
      id: jobId,
      status: 'running',
      progress: 0,
      message: 'Starting scraper...',
      detailCount: 0,
      result: null,
      error: '',
      startedAt: Date.now(),
    };
    jobs.set(jobId, job);

    const scriptPath = path.join(SCRIPTS_DIR, scriptName);

    if (!fs.existsSync(scriptPath)) {
      jobs.delete(jobId);
      return NextResponse.json({
        success: false,
        error: `Scraper script not found: ${scriptPath}. Ensure the scraper service is running or scripts are deployed.`,
      }, { status: 500 });
    }

    let resolvedPythonPath = PYTHON_PATH;
    if (!fs.existsSync(resolvedPythonPath)) {
      const altPaths = [
        path.join(PROJECT_ROOT, 'scrapling_env/bin/python3'),
        '/usr/bin/python3',
        '/usr/local/bin/python3',
      ];
      for (const alt of altPaths) {
        if (fs.existsSync(alt)) { resolvedPythonPath = alt; break; }
      }
    }

    const proc = spawn(resolvedPythonPath, [scriptPath, ...args], {
      timeout: 300000,
      detached: false,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '/home/z/.cache/ms-playwright',
        PYTHONPATH: process.env.PYTHONPATH || path.join(PROJECT_ROOT, 'scrapling_env/lib/python3.12/site-packages'),
        PYTHONUNBUFFERED: '1',
        PROJECT_ROOT,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const parseProgress = (chunk: string) => {
      for (const line of chunk.split('\n')) {
        try {
          const trimmed = line.trim();
          if (!trimmed || trimmed === '===RESULT===' || !trimmed.startsWith('{')) continue;
          const parsed = JSON.parse(trimmed);
          if (parsed.progress !== undefined && parsed.message !== undefined) {
            job.progress = parsed.progress;
            job.message = parsed.message || '';
            job.detailCount = parsed.detail_count || parsed.detailCount || 0;
          }
        } catch { /* not JSON progress */ }
      }
    };

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); parseProgress(data.toString()); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); parseProgress(data.toString()); });

    proc.on('close', (code: number | null, signal: string | null) => {
      if (signal) {
        job.status = 'failed';
        job.error = `Process killed by ${signal}`;
        return;
      }
      if (code === 0) {
        try {
          const marker = '===RESULT===';
          const idx = stdout.indexOf(marker);
          let resultJson = '';
          if (idx >= 0) {
            const after = stdout.substring(idx + marker.length).trim();
            const jsonStart = after.indexOf('{');
            if (jsonStart >= 0) resultJson = after.substring(jsonStart);
          }
          if (!resultJson) {
            for (let i = stdout.trim().split('\n').length - 1; i >= 0; i--) {
              const line = stdout.trim().split('\n')[i].trim();
              if (line.startsWith('{')) {
                try { const p = JSON.parse(line); if (p.success !== undefined) { resultJson = line; break; } } catch {}
              }
            }
          }
          if (resultJson) {
            job.result = JSON.parse(resultJson);
            job.status = 'completed';
            job.progress = 100;
          } else {
            job.status = 'failed';
            job.error = `Failed to parse scraper output. Raw: ${stdout.slice(-300)}`;
          }
        } catch {
          job.status = 'failed';
          job.error = `Failed to parse scraper output. Stderr: ${stderr.slice(-300)}`;
        }
      } else {
        job.status = 'failed';
        job.error = stderr.trim().split('\n').filter(l => l.trim() && !l.includes('[INFO]')).slice(-3).join('\n') || `Script exited with code ${code}`;
      }
    });

    proc.on('error', (err: Error) => {
      job.status = 'failed';
      job.error = `Failed to start scraper: ${err.message}`;
    });

    return NextResponse.json({ success: true, jobId, message: 'Scraping job started (local mode)' });

  } catch (error) {
    console.error('Scraping error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// GET endpoint — poll job status
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'jobId parameter is required' }, { status: 400 });
  }

  // Try local job store first
  const localJob = jobs.get(jobId);
  if (localJob) {
    // If job is running and we have a remote scraper, also check remote
    if (localJob.status === 'running' && SCRAPER_SERVICE_URL) {
      try {
        const remoteRes = await fetch(`${SCRAPER_SERVICE_URL}/scrape/${jobId}`, {
          signal: AbortSignal.timeout(30000), // 30s for Render cold start
        });
        if (remoteRes.ok) {
          const remoteData = await remoteRes.json();
          if (remoteData.status === 'completed' || remoteData.status === 'failed') {
            // Update local store with remote result
            localJob.status = remoteData.status;
            localJob.progress = remoteData.progress;
            localJob.message = remoteData.message;
            localJob.detailCount = remoteData.detailCount;
            localJob.result = remoteData.result;
            localJob.error = remoteData.error;
          } else if (remoteData.status === 'running') {
            // Update progress from remote
            localJob.progress = remoteData.progress || localJob.progress;
            localJob.message = remoteData.message || localJob.message;
            localJob.detailCount = remoteData.detailCount || localJob.detailCount;
          }
        }
      } catch { /* remote unavailable, return local state */ }
    }

    return NextResponse.json({
      success: true,
      jobId: localJob.id,
      status: localJob.status,
      progress: localJob.progress,
      message: localJob.message,
      detailCount: localJob.detailCount,
      result: localJob.result,
      error: localJob.error,
    });
  }

  // Try remote scraper service directly
  if (SCRAPER_SERVICE_URL) {
    try {
      const remoteRes = await fetch(`${SCRAPER_SERVICE_URL}/scrape/${jobId}`, {
        signal: AbortSignal.timeout(30000), // 30s for Render cold start
      });
      if (remoteRes.ok) {
        const remoteData = await remoteRes.json();
        return NextResponse.json(remoteData);
      }
    } catch { /* remote unavailable */ }
  }

  return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
}
