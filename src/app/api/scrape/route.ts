import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

const PYTHON_PATH = '/home/z/my-project/scrapling_env/bin/python3.12';
const SCRIPTS_DIR = '/home/z/my-project/scraping-scripts';

// In-memory job store for async scraping
interface ScrapeJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
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
    if (now - job.startedAt > 30 * 60 * 1000) { // 30 min TTL
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

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: NextRequest) {
  try {
    const body: ScrapeRequest = await request.json();
    const { type, query, url, maxResults, maxPages, depth, fetcher, fetchDetails } = body;

    const jobId = generateJobId();

    // Build args based on scrape type
    let scriptName: string;
    let args: string[];

    switch (type) {
      case 'google-maps': {
        if (!query) {
          return NextResponse.json(
            { success: false, error: 'Query is required for Google Maps scraping' },
            { status: 400 }
          );
        }
        scriptName = 'google_maps_scraper.py';
        args = [
          '--query', query,
          '--max-results', String(maxResults || 20),
          '--fetcher', fetcher || 'dynamic',
        ];
        // Default fetchDetails to true unless explicitly set to false
        if (fetchDetails === false) {
          args.push('--no-details');
        }
        break;
      }

      case 'generic': {
        if (!url) {
          return NextResponse.json(
            { success: false, error: 'URL is required for generic scraping' },
            { status: 400 }
          );
        }
        scriptName = 'generic_scraper.py';
        args = [
          '--url', url,
          '--depth', String(depth || 0),
          '--fetcher', fetcher || 'stealthy',
        ];
        break;
      }

      case 'search': {
        if (!query) {
          return NextResponse.json(
            { success: false, error: 'Query is required for search scraping' },
            { status: 400 }
          );
        }
        scriptName = 'search_scraper.py';
        args = [
          '--query', query,
          '--max-pages', String(maxPages || 5),
          '--fetcher', fetcher || 'stealthy',
        ];
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid scrape type' },
          { status: 400 }
        );
    }

    // Initialize job
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

    // Spawn Python process asynchronously
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const proc = spawn(PYTHON_PATH, [scriptPath, ...args], {
      timeout: 300000, // 5 minute timeout
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: '/home/z/.cache/ms-playwright',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;

      // Parse progress messages from stdout
      const lines = chunk.split('\n');
      for (const line of lines) {
        try {
          const trimmed = line.trim();
          if (!trimmed || trimmed === '===RESULT===' || !trimmed.startsWith('{')) continue;
          const parsed = JSON.parse(trimmed);
          if (parsed.progress !== undefined && parsed.message !== undefined) {
            job.progress = parsed.progress;
            job.message = parsed.message || '';
            job.detailCount = parsed.detail_count || parsed.detailCount || 0;
          }
        } catch {
          // Not a JSON progress line, ignore
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;

      // Also parse progress messages from stderr (some Python output goes there)
      const lines = chunk.split('\n');
      for (const line of lines) {
        try {
          const trimmed = line.trim();
          if (!trimmed || trimmed === '===RESULT===' || !trimmed.startsWith('{')) continue;
          const parsed = JSON.parse(trimmed);
          if (parsed.progress !== undefined && parsed.message !== undefined) {
            job.progress = parsed.progress;
            job.message = parsed.message || '';
            job.detailCount = parsed.detail_count || parsed.detailCount || 0;
          }
        } catch {
          // Not a JSON progress line, ignore
        }
      }
    });

    proc.on('close', (code: number) => {
      if (code === 0) {
        try {
          // Strategy 1: Look for ===RESULT=== marker and parse JSON after it
          const resultMarker = '===RESULT===';
          const markerIdx = stdout.indexOf(resultMarker);

          if (markerIdx >= 0) {
            const afterMarker = stdout.substring(markerIdx + resultMarker.length).trim();
            // The JSON starts after the marker
            const jsonStart = afterMarker.indexOf('{');
            if (jsonStart >= 0) {
              const jsonStr = afterMarker.substring(jsonStart);
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.success !== undefined) {
                  job.result = parsed;
                  job.status = 'completed';
                  job.progress = 100;
                  return;
                }
              } catch {
                // Try to find the end of valid JSON
              }
            }
          }

          // Strategy 2: Find the last valid JSON with 'success' key in stdout
          const stdoutLines = stdout.trim().split('\n');
          let lastJson = '';

          for (let i = stdoutLines.length - 1; i >= 0; i--) {
            const line = stdoutLines[i].trim();
            if (line.startsWith('{')) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.success !== undefined) {
                  lastJson = line;
                  break;
                }
              } catch {
                // Not a valid JSON result, might be a progress message
              }
            }
          }

          if (lastJson) {
            job.result = JSON.parse(lastJson);
            job.status = 'completed';
            job.progress = 100;
          } else {
            // Strategy 3: Try to find JSON anywhere in the combined output
            const combined = stdout + '\n' + stderr;
            const combinedLines = combined.trim().split('\n');

            for (let i = combinedLines.length - 1; i >= 0; i--) {
              const line = combinedLines[i].trim();
              if (line.startsWith('{')) {
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.success !== undefined && parsed.results !== undefined) {
                    job.result = parsed;
                    job.status = 'completed';
                    job.progress = 100;
                    return;
                  }
                } catch {}
              }
            }

            job.status = 'failed';
            job.error = `Failed to parse scraper output: ${stdout.slice(0, 500)}`;
          }
        } catch {
          // If JSON parsing fails, try stderr
          try {
            const stderrLines = stderr.trim().split('\n');
            let lastJson = '';
            for (let i = stderrLines.length - 1; i >= 0; i--) {
              const line = stderrLines[i].trim();
              if (line.startsWith('{')) {
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.success !== undefined) {
                    lastJson = line;
                    break;
                  }
                } catch {}
              }
            }
            if (lastJson) {
              job.result = JSON.parse(lastJson);
              job.status = 'completed';
              job.progress = 100;
            } else {
              job.status = 'failed';
              job.error = `Failed to parse scraper output: ${stdout.slice(0, 500)}`;
            }
          } catch {
            job.status = 'failed';
            job.error = `Failed to parse scraper output: ${stdout.slice(0, 500)}`;
          }
        }
      } else {
        job.status = 'failed';
        // Try to extract a meaningful error from stderr
        const errorLines = stderr.trim().split('\n').filter(l => !l.trim().startsWith('{'));
        const errorMsg = errorLines.slice(-3).join('\n') || `Script exited with code ${code}`;
        job.error = errorMsg;
      }
    });

    proc.on('error', (err: Error) => {
      job.status = 'failed';
      job.error = err.message;
    });

    // Return the job ID immediately
    return NextResponse.json({
      success: true,
      jobId,
      message: 'Scraping job started',
    });
  } catch (error) {
    console.error('Scraping error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}

// GET endpoint to poll job status
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json(
      { success: false, error: 'jobId parameter is required' },
      { status: 400 }
    );
  }

  const job = jobs.get(jobId);
  if (!job) {
    return NextResponse.json(
      { success: false, error: 'Job not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    detailCount: job.detailCount,
    result: job.result,
    error: job.error,
  });
}
