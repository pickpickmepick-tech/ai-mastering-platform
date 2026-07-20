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

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty (0 bytes)")

    try:
        data, sr = sf.read(io.BytesIO(raw), always_2d=True, dtype="float32")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read audio file: {exc}")

    if data.size == 0 or data.shape[0] == 0:
        raise HTTPException(status_code=400, detail="Audio file contains no samples (decoded to 0 frames)")

    audio = data.T  # (channels, samples)

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

    buf = io.BytesIO()
    sf.write(buf, processed.T, out_sr, format="WAV", subtype="PCM_24")
    buf.seek(0)

    base_name = file.filename.rsplit(".", 1)[0]
    out_name = f"mastered_{base_name}.wav"

    headers = {
        "Content-Disposition": f'attachment; filename="{out_name}"',
        "X-Master-Report": json.dumps(report),
        "Access-Control-Expose-Headers": "X-Master-Report, Content-Disposition",
    }
    return StreamingResponse(buf, media_type="audio/wav", headers=headers)
