"""
AI Pre-Mastering Preset (Gemini)
---------------------------------
Called once, up front, by POST /api/analyze -- NOT from the mastering_chain
render path. Gemini reads a quick 10-second frequency snapshot of the track
plus the user's style prompt and recommends a full starting preset (EQ,
reverb, chopping, target LUFS). The frontend then moves each knob/slider to
that recommended position; from there on the user is just adjusting normal
absolute-value controls, and POST /api/master renders whatever values it's
given deterministically, with no further Gemini dependency. This keeps the
value the user previewed and the value that gets rendered into the final
WAV always in sync (an LLM call inside the render path could return a
slightly different answer next time and silently shift the final mix away
from what was previewed).

If GEMINI_API_KEY isn't set, the request fails, or the response can't be
parsed, this falls back to FALLBACK_PRESET so a Gemini outage/misconfig
never blocks the analyze step.
"""
from __future__ import annotations

import json
import logging
import os

import numpy as np
import requests

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
REQUEST_TIMEOUT_S = 8.0

LOW_GAIN_RANGE_DB = 3.0
MID_GAIN_RANGE_DB = 2.0
HIGH_GAIN_RANGE_DB = 3.0
REVERB_MIX_MAX = 0.25
CHOPPING_MAX = 0.8
TARGET_LUFS_MIN = -14.0
TARGET_LUFS_MAX = -10.0

FALLBACK_PRESET = {
    "low_gain_db": 1.0,
    "mid_gain_db": 0.5,
    "high_gain_db": 1.0,
    "reverb_on": False,
    "reverb_mix": 0.0,
    "chopping_level": 0.3,
    "target_lufs": -11.0,
}

_SYSTEM_INSTRUCTION = (
    "You are a professional mastering engineer specializing in Suno AI-generated "
    "tracks headed for music distributors (Melon, Spotify, Apple Music) and YouTube "
    "playlist channels. Given a style prompt (Korean or English, e.g. '웅장한 시네마틱', "
    "'몽환적인 로파이', 'sad acoustic ballad') describing the desired mood/genre, and a "
    "quick frequency snapshot of the track's first ~10 seconds, recommend a starting "
    "mastering preset as JSON with exactly these keys:\n"
    f"- low_gain_db: number, -{LOW_GAIN_RANGE_DB} to +{LOW_GAIN_RANGE_DB} (90Hz low-shelf, kick/bass weight)\n"
    f"- mid_gain_db: number, -{MID_GAIN_RANGE_DB} to +{MID_GAIN_RANGE_DB} (1kHz peak, vocal presence)\n"
    f"- high_gain_db: number, -{HIGH_GAIN_RANGE_DB} to +{HIGH_GAIN_RANGE_DB} (8kHz high-shelf, air/brightness)\n"
    "- reverb_on: boolean, true if this genre/mood benefits from added space (lofi, "
    "acoustic, ballad, cinematic) -- false for already-dense or punchy/dry genres\n"
    f"- reverb_mix: number, 0.0 to {REVERB_MIX_MAX} (0 if reverb_on is false)\n"
    f"- chopping_level: number, 0.0 to {CHOPPING_MAX} -- how hard to suppress Suno's "
    "characteristic 7.2kHz/14kHz digital noise; raise it for bright/harsh-sounding "
    "snapshots, keep it lower for already-warm/dark ones\n"
    f"- target_lufs: number, {TARGET_LUFS_MIN} to {TARGET_LUFS_MAX} -- loudness target "
    f"appropriate for the genre/use-case ({TARGET_LUFS_MIN} for dynamic playlist/lofi "
    f"material, toward {TARGET_LUFS_MAX} for loud/competitive pop/hiphop masters)\n"
    "Keep all values tasteful and modest -- this is a starting point, not the final mix."
)

_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "low_gain_db": {"type": "NUMBER"},
        "mid_gain_db": {"type": "NUMBER"},
        "high_gain_db": {"type": "NUMBER"},
        "reverb_on": {"type": "BOOLEAN"},
        "reverb_mix": {"type": "NUMBER"},
        "chopping_level": {"type": "NUMBER"},
        "target_lufs": {"type": "NUMBER"},
    },
    "required": [
        "low_gain_db", "mid_gain_db", "high_gain_db",
        "reverb_on", "reverb_mix", "chopping_level", "target_lufs",
    ],
}


def quick_frequency_snapshot(audio: np.ndarray, sr: int, seconds: float = 10.0) -> dict:
    """
    Fast low/mid/high dB energy read over just the first `seconds` of the
    track (not the whole file) -- this feeds Gemini's genre/mood judgment,
    kept separate from the full-track adaptive_analyzer.py used elsewhere
    in the DSP chain for de-essing/low-shelf-cleaner/ceiling decisions.
    audio: shape (channels, samples)
    """
    n = audio.shape[1]
    take = max(1, min(n, int(seconds * sr)))
    mono = audio[:, :take].mean(axis=0)
    spec = np.fft.rfft(mono)
    freqs = np.fft.rfftfreq(len(mono), 1.0 / sr)

    def band_db(lo: float, hi: float) -> float:
        mask = (freqs >= lo) & (freqs < hi)
        if not np.any(mask):
            return -120.0
        energy = np.mean(np.abs(spec[mask]) ** 2)
        return float(10.0 * np.log10(energy + 1e-12))

    return {
        "low_db": round(band_db(20.0, 150.0), 2),
        "mid_db": round(band_db(150.0, 4000.0), 2),
        "high_db": round(band_db(4000.0, 20000.0), 2),
    }


def get_ai_preset(prompt: str, snapshot: dict) -> dict:
    """
    Returns the full starting preset dict (see _RESPONSE_SCHEMA keys),
    clamped to their documented ranges. Falls back to FALLBACK_PRESET if
    Gemini is unavailable/misconfigured/errors.
    """
    if not GEMINI_API_KEY:
        logger.info("GEMINI_API_KEY not set; using fallback AI preset")
        return dict(FALLBACK_PRESET)

    user_content = f"Style prompt: {prompt!r}\nFrequency snapshot (dBFS, first ~10s): {json.dumps(snapshot)}"

    body = {
        "systemInstruction": {"parts": [{"text": _SYSTEM_INSTRUCTION}]},
        "contents": [{"role": "user", "parts": [{"text": user_content}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": _RESPONSE_SCHEMA,
        },
    }

    try:
        resp = requests.post(
            GEMINI_URL,
            params={"key": GEMINI_API_KEY},
            json=body,
            timeout=REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        p = json.loads(text)
        return {
            "low_gain_db": float(np.clip(float(p["low_gain_db"]), -LOW_GAIN_RANGE_DB, LOW_GAIN_RANGE_DB)),
            "mid_gain_db": float(np.clip(float(p["mid_gain_db"]), -MID_GAIN_RANGE_DB, MID_GAIN_RANGE_DB)),
            "high_gain_db": float(np.clip(float(p["high_gain_db"]), -HIGH_GAIN_RANGE_DB, HIGH_GAIN_RANGE_DB)),
            "reverb_on": bool(p["reverb_on"]),
            "reverb_mix": float(np.clip(float(p["reverb_mix"]), 0.0, REVERB_MIX_MAX)) if p["reverb_on"] else 0.0,
            "chopping_level": float(np.clip(float(p["chopping_level"]), 0.0, CHOPPING_MAX)),
            "target_lufs": float(np.clip(float(p["target_lufs"]), TARGET_LUFS_MIN, TARGET_LUFS_MAX)),
        }
    except Exception:
        logger.exception("Gemini AI preset call failed; using fallback preset")
        return dict(FALLBACK_PRESET)
