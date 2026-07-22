import asyncio
import io
import json
import logging

import numpy as np
import soundfile as sf
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import StreamingResponse

from ..dsp.mastering_chain import master_audio, DEFAULT_TARGET_LUFS

logger = logging.getLogger(__name__)
router = APIRouter()

# Hard length cap: peak RSS scales ~linearly with track length. Measured on the
# 2GB instance (post memory-fix): a full request peaks ~1.5GB at 5 min and
# ~1.9GB at 6 min, and OOM-kills past ~7 min. Cap at 5 min for a solid headroom
# margin -- Suno single generations are shorter anyway; this rejects mistaken
# long uploads (mixes/podcasts) with a clear error instead of an opaque OOM.
MAX_DURATION_SEC = 300  # 5 minutes

# Serialize mastering so two concurrent requests can't stack their (large)
# working buffers and OOM the instance together. One master at a time.
_master_lock = asyncio.Semaphore(1)


def _enforce_max_duration(n_frames: int, sr: int) -> None:
    """Rejects tracks longer than MAX_DURATION_SEC with a clear 413 before any
    heavy DSP allocates. Pure/synchronous so it is unit-testable on its own."""
    duration_sec = n_frames / float(sr)
    if duration_sec > MAX_DURATION_SEC:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Track too long: {duration_sec / 60:.1f} min "
                f"(max {MAX_DURATION_SEC // 60} min). "
                f"트랙이 너무 깁니다 ({duration_sec / 60:.1f}분) — "
                f"{MAX_DURATION_SEC // 60}분 이하만 마스터링할 수 있어요."
            ),
        )


def _safe_float(value: str, default: float) -> float:
    """Falls back to `default` instead of erroring on a missing/blank/invalid slider value."""
    if value is None or str(value).strip() == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@router.get("/health")
def health():
    return {"status": "ok"}


@router.post("/master")
async def master(
    file: UploadFile = File(...),
    prompt: str = Form(""),
    bass: str = Form(""),
    vocal: str = Form(""),
    clarity: str = Form(""),
    target_lufs: str = Form(""),
    anti_ai_intensity: str = Form(""),
    reverb_mix: str = Form(""),
    reverb_size: str = Form(""),
    reverb_tone: str = Form(""),
    stretch_speed: str = Form(""),
    stretch_pitch: str = Form(""),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")

    logger.info("route: request received, filename=%s", file.filename)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty (0 bytes)")

    logger.info("route: file read, %d bytes", len(raw))

    try:
        data, sr = sf.read(io.BytesIO(raw), always_2d=True, dtype="float32")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read audio file: {exc}")

    del raw  # uploaded bytes are decoded; free them before the heavy DSP allocates
    logger.info("route: decoded, shape=%s sr=%s", data.shape, sr)

    if data.size == 0 or data.shape[0] == 0:
        raise HTTPException(status_code=400, detail="Audio file contains no samples (decoded to 0 frames)")

    audio = data.T  # (channels, samples)

    _enforce_max_duration(data.shape[0], sr)

    bass_db = _safe_float(bass, 0.0)
    vocal_db = _safe_float(vocal, 0.0)
    clarity_db = _safe_float(clarity, 0.0)
    target_lufs_val = _safe_float(target_lufs, DEFAULT_TARGET_LUFS)
    anti_ai_val = _safe_float(anti_ai_intensity, 50.0)
    reverb_mix_val = _safe_float(reverb_mix, 0.0)
    reverb_size_val = _safe_float(reverb_size, 50.0)
    reverb_tone_val = _safe_float(reverb_tone, 50.0)
    stretch_speed_val = _safe_float(stretch_speed, 1.0)
    stretch_pitch_val = _safe_float(stretch_pitch, 0.0)

    async with _master_lock:  # one master at a time; don't stack working buffers
        try:
            processed, out_sr, report = master_audio(
                audio,
                sr,
                bass_db=bass_db,
                vocal_db=vocal_db,
                clarity_db=clarity_db,
                target_lufs=target_lufs_val,
                anti_ai_intensity=anti_ai_val / 100.0,
                prompt=prompt,
                reverb_mix=reverb_mix_val,
                reverb_size=reverb_size_val,
                reverb_tone=reverb_tone_val,
                stretch_speed=stretch_speed_val,
                stretch_pitch_semitones=stretch_pitch_val,
            )
        except Exception as exc:
            logger.exception("Mastering failed")
            raise HTTPException(status_code=500, detail=f"Mastering failed: {exc}")

    logger.info("route: master_audio returned, encoding WAV")

    buf = io.BytesIO()
    sf.write(buf, processed.T, out_sr, format="WAV", subtype="PCM_24")
    buf.seek(0)

    logger.info("route: WAV encoded, sending response")

    base_name = file.filename.rsplit(".", 1)[0]
    out_name = f"mastered_{base_name}.wav"

    headers = {
        "Content-Disposition": f'attachment; filename="{out_name}"',
        "X-Master-Report": json.dumps(report),
        "Access-Control-Expose-Headers": "X-Master-Report, Content-Disposition",
    }
    return StreamingResponse(buf, media_type="audio/wav", headers=headers)
