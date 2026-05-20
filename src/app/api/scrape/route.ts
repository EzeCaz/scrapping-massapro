import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const PYTHON_PATH = '/home/z/my-project/scrapling_env/bin/python3.12';
const SCRIPTS_DIR = '/home/z/my-project/scraping-scripts';
const LOG_DIR = '/home/z/my-project/download/scraper-logs';

// Ensure log directory exists
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {}

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
  pid?: number;
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

    // Spawn Python process with detached mode to survive Next.js hot reloads
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);

    // Verify the script exists before spawning
    if (!fs.existsSync(scriptPath)) {
      job.status = 'failed';
      job.error = `Scraper script not found: ${scriptPath}`;
      return NextResponse.json({
        success: true,
        jobId,
        message: 'Scraping job started',
      });
    }

    const proc = spawn(PYTHON_PATH, [scriptPath, ...args], {
      timeout: 300000, // 5 minute timeout
      detached: false, // Keep attached so we can capture output
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: '/home/z/.cache/ms-playwright',
        PYTHONPATH: '/home/z/my-project/scrapling_env/lib/python3.12/site-packages',
        PYTHONUNBUFFERED: '1', // Force unbuffered output for real-time progress
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    job.pid = proc.pid;

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

      // Also parse progress messages from stderr
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

    proc.on('close', (code: number | null, signal: string | null) => {
      // Save full logs for debugging
      try {
        const logFile = path.join(LOG_DIR, `${jobId}.log`);
        fs.writeFileSync(logFile, JSON.stringify({
          jobId,
          code,
          signal,
          stdout: stdout.slice(-5000),
          stderr: stderr.slice(-5000),
          timestamp: new Date().toISOString(),
        }, null, 2));
      } catch {}

      // Check if process was killed by signal
      if (signal) {
        job.status = 'failed';
        const signalNames: Record<string, string> = {
          'SIGINT': 'Process was interrupted (SIGINT). This usually happens when the server restarts during scraping.',
          'SIGTERM': 'Process was terminated (SIGTERM). The server may have killed the scraper process.',
          'SIGKILL': 'Process was killed (SIGKILL). This may be due to memory limits or server resource constraints.',
          'SIGHUP': 'Process hung up (SIGHUP). The parent process may have exited.',
        };
        job.error = signalNames[signal] || `Process was killed by signal: ${signal}`;

        // Append stderr for more context
        const stdErrLines = stderr.trim().split('\n')
          .filter(l => l.trim() && !l.trim().startsWith('{'))
          .filter(l => !l.includes('[INFO]') && !l.includes('Fetched'))
          .slice(-3);
        if (stdErrLines.length > 0) {
          job.error += `\n\nDetails:\n${stdErrLines.join('\n')}`;
        }
        return;
      }

      if (code === 0) {
        try {
          // Strategy 1: Look for ===RESULT=== marker and parse JSON after it
          const resultMarker = '===RESULT===';
          const markerIdx = stdout.indexOf(resultMarker);

          if (markerIdx >= 0) {
            const afterMarker = stdout.substring(markerIdx + resultMarker.length).trim();
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
                // Not a valid JSON result
              }
            }
          }

          if (lastJson) {
            job.result = JSON.parse(lastJson);
            job.status = 'completed';
            job.progress = 100;
          } else {
            // Strategy 3: Try to find JSON in combined output
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
            job.error = `Failed to parse scraper output. The scraper may have crashed. Output: ${stdout.slice(-300)}`;
          }
        } catch {
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
              job.error = `Failed to parse scraper output. Stderr: ${stderr.slice(-300)}`;
            }
          } catch {
            job.status = 'failed';
            job.error = `Failed to parse scraper output. Raw: ${stdout.slice(-300)}`;
          }
        }
      } else {
        job.status = 'failed';

        // Build a meaningful error message
        const errorParts: string[] = [];

        // Exit code explanation
        const exitCodeMessages: Record<number, string> = {
          1: 'General error — the scraper encountered an exception.',
          2: 'Misuse of shell builtins — check the scraper arguments.',
          126: 'Permission denied — the Python script may not be executable.',
          127: 'Command not found — the Python interpreter may not be at the expected path.',
          128: 'Invalid argument to exit.',
          130: 'Script was interrupted (Ctrl+C / SIGINT).',
          137: 'Script was killed (SIGKILL) — possibly by the OS due to memory limits.',
          143: 'Script was terminated (SIGTERM).',
        };

        if (code && exitCodeMessages[code]) {
          errorParts.push(exitCodeMessages[code]);
        } else {
          errorParts.push(`Script exited with code ${code}`);
        }

        // Extract meaningful lines from stderr
        const stdErrLines = stderr.trim().split('\n')
          .filter(l => l.trim())
          .filter(l => !l.trim().startsWith('{'))
          .filter(l => !l.includes('[INFO]') && !l.includes('Fetched (200)') && !l.includes('Fetched (404)'))
          .slice(-5);

        if (stdErrLines.length > 0) {
          errorParts.push('Error details:');
          errorParts.push(...stdErrLines);
        }

        // Also check stdout for error info
        if (stdout.includes('Error') || stdout.includes('error') || stdout.includes('Traceback')) {
          const stdoutErrorLines = stdout.split('\n')
            .filter(l => l.includes('Error') || l.includes('Traceback') || l.includes('error'))
            .slice(-3);
          if (stdoutErrorLines.length > 0 && stdErrLines.length === 0) {
            errorParts.push('Output errors:');
            errorParts.push(...stdoutErrorLines);
          }
        }

        job.error = errorParts.join('\n');
      }
    });

    proc.on('error', (err: Error) => {
      job.status = 'failed';
      // Provide more context for common spawn errors
      if (err.message.includes('ENOENT')) {
        job.error = `Python interpreter not found at: ${PYTHON_PATH}. Please verify the installation path.`;
      } else if (err.message.includes('EACCES')) {
        job.error = `Permission denied when trying to execute: ${PYTHON_PATH}`;
      } else {
        job.error = `Failed to start scraper: ${err.message}`;
      }
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
