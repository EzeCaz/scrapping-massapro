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
    });

    let stdout = '';
    let stderr = '';
    let finalResultParsed = false;

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;

      // Parse progress messages from stderr (they are printed to stdout by the Python script)
      // But also check for progress in the accumulated stdout
    });

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;

      // Parse progress messages from Python's print statements
      // These appear on stderr because Python flushes there
      const lines = chunk.split('\n');
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed.progress !== undefined) {
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
          // Try to parse the final JSON result from stdout
          // The Python script prints progress to stdout AND the final result
          // We need to find the last valid JSON object in stdout
          const stdoutLines = stdout.trim().split('\n');
          let lastJson = '';

          // Find the last line that parses as a valid JSON with 'success' key
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
          } else {
            // Try parsing entire stdout
            job.result = JSON.parse(stdout);
          }
          job.status = 'completed';
          job.progress = 100;
        } catch {
          // If JSON parsing fails, try to find the result in stderr
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
