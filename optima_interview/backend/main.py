import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError

from database import init_db
from routers import auth, interviews, jobs, matches, profile, favourites, applications, tts

# ALLOWED_ORIGINS: comma-separated list of frontend origins, or "*" for local dev.
# In production set this env var to your Vercel frontend URL, e.g.:
#   ALLOWED_ORIGINS=https://optima-frontend.vercel.app
_raw_origins = os.getenv("ALLOWED_ORIGINS", "*")
if _raw_origins.strip() == "*":
    allow_origins = ["*"]
    allow_credentials = False
else:
    allow_origins = [o.strip() for o in _raw_origins.split(",")]
    allow_credentials = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="NEXUS Interview API",
    description="AI-powered interview and job matching platform",
    version="2.0.0",
    lifespan=lifespan,
)

log = logging.getLogger("optima")


@app.middleware("http")
async def readable_errors(request: Request, call_next):
    """Turn a crash into a reply the page can read.

    Without this a crash is answered outside the CORS step below, so the browser hides the reply
    and the page can only say that the server could not be reached. This is added before CORS on
    purpose: whatever is added last runs first, so the reply made here still gets its CORS headers.
    """
    try:
        return await call_next(request)
    except IntegrityError:
        # two requests saved the same thing at once (the same address registered twice, say)
        return JSONResponse(status_code=409, content={"detail": "That was already saved. Reload the page and try again."})
    except Exception:
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Something went wrong on the server. Try again in a moment."})


app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve local uploads in development (when Vercel Blob is not configured).
# The folder is made here so the first upload can be shown without restarting the server.
_uploads_dir = Path(__file__).resolve().parent / "uploads"
if not os.getenv("BLOB_READ_WRITE_TOKEN"):
    try:
        _uploads_dir.mkdir(exist_ok=True)
    except OSError:
        pass  # a read-only disk (a hosted server without file storage set up): uploads say so when tried
    if _uploads_dir.is_dir():
        app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")

app.include_router(auth.router)
app.include_router(interviews.router)
app.include_router(jobs.router)
app.include_router(matches.router)
app.include_router(profile.router)
app.include_router(favourites.router)
app.include_router(applications.router)
app.include_router(tts.router)


@app.get("/", tags=["health"])
def root():
    return {"status": "ok", "service": "NEXUS Interview API v2"}


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}
