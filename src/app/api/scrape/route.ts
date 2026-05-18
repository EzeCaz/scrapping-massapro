import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

const PYTHON_PATH = '/home/z/my-project/scrapling_env/bin/python3';
const SCRIPTS_DIR = '/home/z/my-project/scraping-scripts';

interface ScrapeRequest {
  type: 'google-maps' | 'generic' | 'search';
  query?: string;
  url?: string;
  maxResults?: number;
  maxPages?: number;
  depth?: number;
  fetcher: 'basic' | 'stealthy' | 'dynamic';
}

function runPythonScript(scriptName: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const proc = spawn(PYTHON_PATH, [scriptPath, ...args], {
      timeout: 120000, // 2 minute timeout
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Script exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const body: ScrapeRequest = await request.json();
    const { type, query, url, maxResults, maxPages, depth, fetcher } = body;

    let result: string;

    switch (type) {
      case 'google-maps': {
        if (!query) {
          return NextResponse.json(
            { success: false, error: 'Query is required for Google Maps scraping' },
            { status: 400 }
          );
        }
        const args = [
          '--query', query,
          '--max-results', String(maxResults || 20),
          '--fetcher', fetcher || 'dynamic',
        ];
        result = await runPythonScript('google_maps_scraper.py', args);
        break;
      }

      case 'generic': {
        if (!url) {
          return NextResponse.json(
            { success: false, error: 'URL is required for generic scraping' },
            { status: 400 }
          );
        }
        const args = [
          '--url', url,
          '--depth', String(depth || 0),
          '--fetcher', fetcher || 'stealthy',
        ];
        result = await runPythonScript('generic_scraper.py', args);
        break;
      }

      case 'search': {
        if (!query) {
          return NextResponse.json(
            { success: false, error: 'Query is required for search scraping' },
            { status: 400 }
          );
        }
        const args = [
          '--query', query,
          '--max-pages', String(maxPages || 5),
          '--fetcher', fetcher || 'stealthy',
        ];
        result = await runPythonScript('search_scraper.py', args);
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid scrape type' },
          { status: 400 }
        );
    }

    try {
      const parsed = JSON.parse(result);
      return NextResponse.json(parsed);
    } catch {
      return NextResponse.json({
        success: true,
        raw_output: result,
      });
    }
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
