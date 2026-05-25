#!/usr/bin/env python3
"""
FastAPI Scraper Service
Wraps the Python scraper scripts as an HTTP API so they can run on Railway/Render
while the Next.js frontend runs on Vercel.

Endpoints:
  POST /scrape          - Start an async scraping job
  GET  /scrape/{job_id} - Poll job status/progress/result
  GET  /health          - Health check
"""

import asyncio
import json
import os
import signal
import sys
import traceback
import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(title="Scrapling Scraper Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory job store (for single-instance deployment)
# ---------------------------------------------------------------------------
jobs: dict = {}

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ScrapeRequest(BaseModel):
    type: str  # 'google-maps' | 'generic' | 'search'
    query: Optional[str] = None
    url: Optional[str] = None
    maxResults: Optional[int] = 20
    maxPages: Optional[int] = 5
    depth: Optional[int] = 0
    fetcher: Optional[str] = 'dynamic'
    fetchDetails: Optional[bool] = True


class JobStatus(BaseModel):
    id: str
    status: str  # 'running' | 'completed' | 'failed'
    progress: int
    message: str
    detailCount: int
    result: Optional[dict] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Scraper runners  (run in thread pool so they don't block the event loop)
# ---------------------------------------------------------------------------

def _run_google_maps(query: str, max_results: int, fetcher: str, fetch_details: bool) -> dict:
    """Run the Google Maps scraper synchronously and return the result dict."""
    from google_maps_scraper import scrape_google_maps
    result = scrape_google_maps(query, max_results, fetcher, fetch_details)
    return result


def _run_generic(url: str, depth: int, fetcher: str) -> dict:
    """Run the generic scraper synchronously and return the result dict."""
    from generic_scraper import scrape_generic
    result = scrape_generic(url, depth, fetcher)
    return result


def _run_search(query: str, max_pages: int, fetcher: str) -> dict:
    """Run the search scraper synchronously and return the result dict."""
    from search_scraper import scrape_search_engine
    result = scrape_search_engine(query, max_pages, fetcher)
    return result


# ---------------------------------------------------------------------------
# Progress callback – updates the job in real-time
# ---------------------------------------------------------------------------

_progress_callbacks: dict = {}  # job_id -> callback


def _make_progress_callback(job_id: str):
    """Return a callback that updates the job's progress fields."""
    def callback(progress: int, message: str, detail_count: int = 0):
        job = jobs.get(job_id)
        if job:
            job["progress"] = progress
            job["message"] = message
            job["detailCount"] = detail_count
    return callback


# ---------------------------------------------------------------------------
# Background task runner
# ---------------------------------------------------------------------------

async def _run_scraper_job(job_id: str, req: ScrapeRequest):
    """Execute the appropriate scraper in a thread and update the job store."""
    import concurrent.futures
    loop = asyncio.get_event_loop()

    job = jobs[job_id]
    job["status"] = "running"
    job["message"] = "Starting scraper..."

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            if req.type == "google-maps":
                result = await loop.run_in_executor(
                    pool,
                    _run_google_maps,
                    req.query,
                    req.maxResults or 20,
                    req.fetcher or "dynamic",
                    req.fetchDetails if req.fetchDetails is not None else True,
                )
            elif req.type == "generic":
                result = await loop.run_in_executor(
                    pool,
                    _run_generic,
                    req.url,
                    req.depth or 0,
                    req.fetcher or "stealthy",
                )
            elif req.type == "search":
                result = await loop.run_in_executor(
                    pool,
                    _run_search,
                    req.query,
                    req.maxPages or 5,
                    req.fetcher or "stealthy",
                )
            else:
                job["status"] = "failed"
                job["error"] = f"Invalid scrape type: {req.type}"
                return

        job["status"] = "completed" if result.get("success") else "failed"
        job["progress"] = 100
        job["message"] = "Scraping complete!" if result.get("success") else "Scraping failed"
        job["result"] = result
        if not result.get("success") and result.get("error"):
            job["error"] = result["error"]

    except Exception as e:
        job["status"] = "failed"
        job["error"] = f"{type(e).__name__}: {str(e)}"
        traceback.print_exc()


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.post("/scrape")
async def start_scrape(req: ScrapeRequest):
    """Start an async scraping job and return the job ID immediately."""
    # Validate request
    if req.type == "google-maps" and not req.query:
        raise HTTPException(status_code=400, detail="Query is required for google-maps scraping")
    if req.type == "generic" and not req.url:
        raise HTTPException(status_code=400, detail="URL is required for generic scraping")
    if req.type == "search" and not req.query:
        raise HTTPException(status_code=400, detail="Query is required for search scraping")

    job_id = f"job_{uuid.uuid4().hex[:12]}"
    jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "message": "Job queued...",
        "detailCount": 0,
        "result": None,
        "error": None,
        "startedAt": __import__("time").time(),
    }

    # Fire-and-forget background task
    asyncio.create_task(_run_scraper_job(job_id, req))

    return {"success": True, "jobId": job_id, "message": "Scraping job started"}


@app.get("/scrape/{job_id}")
async def get_job_status(job_id: str):
    """Poll the status of a scraping job."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "success": True,
        "jobId": job["id"],
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
        "detailCount": job["detailCount"],
        "result": job["result"],
        "error": job["error"],
    }


@app.get("/health")
async def health():
    return {"status": "ok", "service": "scrapling-scraper"}


# ---------------------------------------------------------------------------
# Cleanup old jobs periodically
# ---------------------------------------------------------------------------
import time as _time

@app.on_event("startup")
async def _startup():
    async def _cleanup_loop():
        while True:
            await asyncio.sleep(600)  # every 10 min
            now = _time.time()
            expired = [jid for jid, j in jobs.items() if now - j["startedAt"] > 1800]
            for jid in expired:
                jobs.pop(jid, None)
    asyncio.create_task(_cleanup_loop())


# ---------------------------------------------------------------------------
# Entry point (for uvicorn)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
