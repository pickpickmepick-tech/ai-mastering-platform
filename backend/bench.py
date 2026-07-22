"""
Memory/latency benchmark for the mastering chain (OOM before/after harness).

Runs master_audio() on a synthetic stereo track of a given length and prints a
single JSON line with peak RSS (MB) and wall time. Under a container memory cap
(docker run --memory=2g), an OOM is a SIGKILL (exit 137) with no output -- the
runner detects that as "oom". Not a server; imported deps only.

Usage: python bench.py <seconds> [label]
"""
import sys
import time
import json
import resource

import numpy as np


def gen_audio(seconds: float, sr: int = 44100) -> np.ndarray:
    """Musical-ish stereo signal (tones + light noise) so every DSP stage does
    real work instead of short-circuiting on silence."""
    n = int(seconds * sr)
    t = np.arange(n, dtype=np.float32) / sr
    sig = (0.30 * np.sin(2 * np.pi * 110 * t)
           + 0.20 * np.sin(2 * np.pi * 440 * t)
           + 0.15 * np.sin(2 * np.pi * 2500 * t)).astype(np.float32)
    rng = np.random.default_rng(42)
    sig += (0.03 * rng.standard_normal(n)).astype(np.float32)
    right = (sig * 0.98 + 0.02 * np.roll(sig, 5)).astype(np.float32)
    return np.stack([sig, right], axis=0)  # (2, n)


def main() -> None:
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 360.0
    label = sys.argv[2] if len(sys.argv) > 2 else ""

    import io as _io
    import soundfile as sf
    from app.dsp.mastering_chain import master_audio

    # Emulate the real /api/master path faithfully so peak RSS matches production:
    # uploaded WAV bytes -> decode -> del raw -> master -> encode delivered WAV.
    audio0 = gen_audio(seconds)
    _rawbuf = _io.BytesIO()
    sf.write(_rawbuf, audio0.T, 44100, format="WAV", subtype="PCM_16")
    raw = _rawbuf.getvalue()
    del audio0, _rawbuf

    t0 = time.time()
    ok, err, report = False, None, None
    try:
        data, sr = sf.read(_io.BytesIO(raw), always_2d=True, dtype="float32")
        del raw
        audio = data.T
        out, out_sr, report = master_audio(
            audio, sr, bass_db=2.0, vocal_db=1.0, clarity_db=1.0,
            target_lufs=-9.0, anti_ai_intensity=0.5,
        )
        _buf = _io.BytesIO()
        sf.write(_buf, out.T, out_sr, format="WAV", subtype="PCM_24")
        ok = True
    except MemoryError as e:
        err = "MemoryError: " + str(e)
    except Exception as e:  # noqa: BLE001 - benchmark harness, report any failure
        err = type(e).__name__ + ": " + str(e)

    wall = time.time() - t0
    peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0  # Linux: KB -> MB
    print(json.dumps({
        "label": label,
        "duration_sec": seconds,
        "wall_sec": round(wall, 1),
        "peak_rss_mb": round(peak_mb, 1),
        "ok": ok,
        "error": err,
        "final_lufs": report.get("final_integrated_lufs") if report else None,
        "true_peak_dbtp": report.get("final_true_peak_dbtp") if report else None,
    }), flush=True)


if __name__ == "__main__":
    main()
