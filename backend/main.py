"""
Suno AI 음원 전용 하이브리드 어댑티브 마스터링 및 Anti-AI 우회 플랫폼
Backend entrypoint (FastAPI + uvicorn)

Run directly:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

_allow_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
_frontend_origin = os.environ.get("FRONTEND_ORIGIN")
if _frontend_origin:
    if not _frontend_origin.startswith("http"):
        _frontend_origin = f"https://{_frontend_origin}"
    _allow_origins.append(_frontend_origin)

app = FastAPI(
    title="Suno AI Adaptive Mastering & Anti-AI Bypass Engine",
    version="1.0.0",
    description=(
        "Hybrid adaptive mastering engine for Suno-generated audio: "
        "dynamic EQ, smart transient shaping, anti-AI micro-jitter/dither, "
        "LUFS normalization and a true-peak limiter (-1.0 dBTP)."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Master-Report", "Content-Disposition"],
)

app.include_router(api_router, prefix="/api")


@app.get("/")
def root():
    return {
        "service": "ai-mastering-platform-backend",
        "status": "running",
        "commit": os.environ.get("RENDER_GIT_COMMIT", "unknown"),
    }
