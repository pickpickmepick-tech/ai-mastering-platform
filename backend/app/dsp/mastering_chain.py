"""
Full Mastering Chain Orchestration
------------------------------------
Order of operations:
 -1. Upsample to a 96kHz working resolution (see UPSAMPLE_RATE below) so
      every nonlinear stage that follows has far more headroom against
      aliasing and inter-sample clipping.
  0. Real-time adaptive analysis (adaptive_analyzer.py): measure this
      track's own low(30-150Hz)/mid(150-4000Hz)/high(4000Hz+)/sibilance
      (4-8kHz) energy balance and turn any excess into 0..1 severity
      scores. Every track is different, so a fixed preset either
      under-corrects a harsher track or over-dulls a cleaner one -- these
      severity scores drive the dynamic_low_cleaner / dynamic_high_cleaner
      / adaptive true-peak ceiling below, instead.
  1. Tone Repair (tone_repair.py): fixed corrective EQ (highpass, fizz/mud
      dips) plus the *dynamic* de-essing depth and lowpass slope steepness
      from dynamic_high_cleaner_params.
  1b. dynamic_low_cleaner: LowShelfFilter(90Hz), gain interpolated
      -3.0..-7.0dB from low_severity.
  2. True 120Hz multiband split (Linkwitz-Riley crossover, lowband.py):
      - Low band (<=120Hz): static bass tonal shelf (user slider) + an
        *independent* compressor with an 800ms release, so a long bass cycle
        is never fought mid-waveform by a shared envelope also trying to
        react to vocals/highs (this is what caused the low-end
        pumping/tearing).
      - High band (>120Hz): the (now bass-free) Dynamic EQ, vocal/clarity
        bands only.
      Recombined by simple addition (the LR4 split reconstructs flat).
  3. Smart Transient Shaper (automatic, on the recombined signal)
  4. Anti-AI processing     (micro-jitter + Gaussian dither, intensity slider)
  5. Loudness-to-target *by riding the limiter's ceiling*, not by computing a
      static makeup gain and then slamming a fixed limiter with it. A
      binary search finds how hard to drive into a limiter whose ceiling is
      already fixed at an *adaptive_ceiling_db* (tightened below the -1.5
      dBTP baseline for tracks that needed heavier low/high correction),
      converging on target_lufs without ever exceeding that ceiling.
 +1. Downsample to the 44.1kHz export rate, then re-run the true-peak
      limiter once more at the same adaptive ceiling so it holds on the
      actual exported file (downsampling reconstruction can reintroduce a
      small amount of ripple).
"""
from __future__ import annotations

import logging

try:
    import resource  # Unix-only; unavailable on Windows (local dev).
except ImportError:
    resource = None

import numpy as np
from scipy.signal import resample
from pedalboard import Pedalboard, LowShelfFilter

from .adaptive_analyzer import (
    analyze_track,
    dynamic_low_cleaner_gain_db,
    dynamic_high_cleaner_params,
    adaptive_ceiling_db,
)
from .lowband import split_bands, compress_low_band
from .tone_repair import repair_tone
from .dynamic_eq import DynamicEQ
from .transient_shaper import shape_transients
from .anti_ai import apply_anti_ai
from .reverb import apply_reverb
from .stretch import apply_stretch
from .loudness import measure_integrated_lufs
from .limiter import TruePeakLimiter, true_peak_dbtp

logger = logging.getLogger(__name__)


def _rss_mb() -> float:
    """Peak resident set size so far, in MB (Linux ru_maxrss is in KB)."""
    if resource is None:
        return -1.0
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0

# Safe headroom kept below the absolute -1.0 dBTP digital ceiling. Loudness is
# only ever raised by driving harder into a limiter that already enforces
# this ceiling -- never by a pre-gain boost applied ahead of a fixed limiter.
# The actual ceiling used per-track is tightened further by adaptive_ceiling_db
# based on how much correction that track's own analysis needed.
BASE_TRUE_PEAK_CEILING_DBTP = -1.5

CROSSOVER_HZ = 120.0
LOW_SHELF_CLEANER_HZ = 90.0

# Safe Default Preset: if the adaptive analyzer errors out for any reason,
# the chain falls back to these (the same values a perfectly "clean",
# zero-severity track would get) instead of ever failing the request.
SAFE_DEFAULT_ANALYSIS = {
    "low_db": None, "mid_db": None, "high_db": None, "sibilance_db": None,
    "low_excess_db": None, "high_excess_db": None,
    "low_severity": 0.0, "high_severity": 0.0,
}
SAFE_DEFAULT_LOW_SHELF_GAIN_DB = -3.0
SAFE_DEFAULT_DEESS_GAIN_DB = -3.0
SAFE_DEFAULT_LOWPASS_STAGES = 1

# High-resolution working rate that all mastering DSP runs at internally.
UPSAMPLE_RATE = 96000
# Standard rate the final master is delivered at.
EXPORT_RATE = 44100

# Always-on baseline tonal lift for Suno-generated audio (its typical output is
# comparatively dull/boxy), applied on top of the user's sliders so that even
# 0 dB sliders yield an audibly upgraded master.
BASE_BASS_DB = 1.5
BASE_VOCAL_DB = 1.0
BASE_CLARITY_DB = 2.0

DEFAULT_TARGET_LUFS = -9.0

_PROMPT_KEYWORDS = {
    "bass": {"bass": 1.5, "clarity": 0.0, "vocal": 0.0},
    "warm": {"bass": 1.0, "clarity": -0.5, "vocal": 0.0},
    "bright": {"bass": -0.5, "clarity": 1.5, "vocal": 0.0},
    "vocal": {"bass": 0.0, "clarity": 0.0, "vocal": 1.5},
    "clean": {"bass": 0.0, "clarity": 1.0, "vocal": 0.5},
    "punchy": {"bass": 1.0, "clarity": 0.5, "vocal": 0.0},
    "lofi": {"bass": 0.5, "clarity": -1.5, "vocal": 0.0},
    "airy": {"bass": -0.5, "clarity": 2.0, "vocal": 0.0},
}


def apply_prompt_bias(prompt: str, bass_db: float, vocal_db: float, clarity_db: float):
    """Nudges slider values slightly based on Suno-style prompt keywords."""
    if not prompt:
        return bass_db, vocal_db, clarity_db
    lowered = prompt.lower()
    for kw, deltas in _PROMPT_KEYWORDS.items():
        if kw in lowered:
            bass_db += deltas["bass"]
            vocal_db += deltas["vocal"]
            clarity_db += deltas["clarity"]
    bass_db = float(np.clip(bass_db, -12.0, 12.0))
    vocal_db = float(np.clip(vocal_db, -12.0, 12.0))
    clarity_db = float(np.clip(clarity_db, -12.0, 12.0))
    return bass_db, vocal_db, clarity_db


def _ride_limiter_to_target(
    audio: np.ndarray,
    sr: int,
    target_lufs: float,
    ceiling_db: float,
    iterations: int = 5,
) -> tuple[np.ndarray, float, float]:
    """
    Raises loudness by binary-searching how hard to drive into a limiter
    whose ceiling is already fixed at `ceiling_db`, converging the *output*
    integrated LUFS on `target_lufs`. The ceiling is enforced at every step
    of the search, so this can never overshoot it the way "compute a static
    makeup gain from the pre-limiter LUFS, then apply it before a fixed
    limiter" can (that pattern is what drove the limiter into distortion).

    Returns (processed_audio, pre_limiter_lufs, achieved_lufs).
    """
    limiter = TruePeakLimiter(sr, ceiling_db=ceiling_db)

    pre_lufs = measure_integrated_lufs(audio, sr)
    naive_gain_db = target_lufs - pre_lufs

    lo_db = naive_gain_db - 2.0
    hi_db = naive_gain_db + 10.0

    best_audio = limiter.process(audio)
    best_lufs = measure_integrated_lufs(best_audio, sr)

    for _ in range(iterations):
        mid_db = (lo_db + hi_db) / 2.0
        drive_lin = 10.0 ** (mid_db / 20.0)
        candidate = limiter.process(audio * drive_lin)
        measured = measure_integrated_lufs(candidate, sr)
        best_audio, best_lufs = candidate, measured
        if measured < target_lufs:
            lo_db = mid_db
        else:
            hi_db = mid_db

    return best_audio, pre_lufs, best_lufs


def master_audio(
    audio: np.ndarray,
    sr: int,
    bass_db: float = 0.0,
    vocal_db: float = 0.0,
    clarity_db: float = 0.0,
    target_lufs: float = DEFAULT_TARGET_LUFS,
    anti_ai_intensity: float = 0.5,
    prompt: str = "",
    reverb_mix: float = 0.0,
    reverb_size: float = 50.0,
    reverb_tone: float = 50.0,
    stretch_speed: float = 1.0,
    stretch_pitch_semitones: float = 0.0,
) -> tuple[np.ndarray, int, dict]:
    """
    audio: shape (channels, samples), float32, normalized to [-1, 1]
    returns (processed_audio, sample_rate, report_dict)
    """
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 1:
        audio = audio[np.newaxis, :]

    logger.info("master_audio: start, shape=%s sr=%s, rss=%.0fMB", audio.shape, sr, _rss_mb())

    # Speed/pitch ("key up/down") is a creative, duration-changing edit, so it
    # runs first on the raw input -- everything after (analysis, EQ, loudness
    # targeting) then operates on the track at its final length/key.
    audio = apply_stretch(audio, sr, stretch_speed, stretch_pitch_semitones)
    logger.info("master_audio: checkpoint after stretch")

    bass_db += BASE_BASS_DB
    vocal_db += BASE_VOCAL_DB
    clarity_db += BASE_CLARITY_DB

    bass_db, vocal_db, clarity_db = apply_prompt_bias(prompt, bass_db, vocal_db, clarity_db)

    # -1. Upsample to the 96kHz working resolution for the entire chain.
    n_in = audio.shape[1]
    n_hi = int(round(n_in * UPSAMPLE_RATE / sr))
    hi_res = resample(audio, n_hi, axis=1).astype(np.float32)
    work_sr = UPSAMPLE_RATE
    logger.info("master_audio: checkpoint after upsample, hi_res shape=%s, rss=%.0fMB", hi_res.shape, _rss_mb())

    # 0. Real-time adaptive analysis -- this track's own frequency balance.
    # If the analyzer errors out for *any* reason, fall back to the Safe
    # Default Preset (the same values a clean, zero-severity track would
    # get) rather than letting the whole mastering request fail.
    try:
        analysis = analyze_track(hi_res, work_sr)
        low_shelf_gain_db = dynamic_low_cleaner_gain_db(analysis["low_severity"])
        deess_gain_db, lowpass_stages = dynamic_high_cleaner_params(analysis["high_severity"])
    except Exception:
        logger.exception("Adaptive analyzer failed; falling back to Safe Default Preset")
        analysis = dict(SAFE_DEFAULT_ANALYSIS)
        low_shelf_gain_db = SAFE_DEFAULT_LOW_SHELF_GAIN_DB
        deess_gain_db = SAFE_DEFAULT_DEESS_GAIN_DB
        lowpass_stages = SAFE_DEFAULT_LOWPASS_STAGES
    logger.info("master_audio: checkpoint after adaptive analysis")

    # 1. Tone repair, parameterized by the dynamic_high_cleaner results.
    stage1 = repair_tone(hi_res, work_sr, deess_gain_db=deess_gain_db, lowpass_stages=lowpass_stages)
    logger.info("master_audio: checkpoint after tone repair")

    # 1b. dynamic_low_cleaner: adaptive 90Hz low-shelf trim.
    low_cleaner_board = Pedalboard([
        LowShelfFilter(cutoff_frequency_hz=LOW_SHELF_CLEANER_HZ, gain_db=low_shelf_gain_db)
    ])
    stage1 = low_cleaner_board(stage1, work_sr).astype(np.float32)
    logger.info("master_audio: checkpoint after low-shelf cleaner")

    # 2. True multiband split at 120Hz: independent low-band handling.
    low, high = split_bands(stage1, work_sr, crossover_hz=CROSSOVER_HZ)
    logger.info("master_audio: checkpoint after band split")

    bass_board = Pedalboard([LowShelfFilter(cutoff_frequency_hz=100.0, gain_db=bass_db)])
    low = bass_board(low, work_sr).astype(np.float32)
    low = compress_low_band(low, work_sr, release_ms=800.0)
    logger.info("master_audio: checkpoint after low-band compress")

    eq = DynamicEQ(work_sr, vocal_db=vocal_db, clarity_db=clarity_db)
    high = eq.process(high)
    logger.info("master_audio: checkpoint after dynamic EQ")

    combined = low + high

    # 3. Smart Transient Shaper
    stage3 = shape_transients(combined, work_sr)
    logger.info("master_audio: checkpoint after transient shaper")

    # 4. Anti-AI evasion (micro-jitter + gaussian dither)
    stage4 = apply_anti_ai(stage3, work_sr, intensity=float(np.clip(anti_ai_intensity, 0.0, 1.0)))
    logger.info("master_audio: checkpoint after anti-ai")

    # 4b. Studio Reverb send (Mix/Size/Tone). Applied before loudness
    # targeting so the target LUFS is matched on the track *including* the
    # reverb tail, not before it.
    stage4 = apply_reverb(stage4, work_sr, reverb_mix, reverb_size, reverb_tone)
    logger.info("master_audio: checkpoint after reverb")

    # 5. Loudness-to-target by riding an adaptive limiter ceiling (see
    # docstring): tracks needing heavier low/high correction get a slightly
    # tighter true-peak ceiling as extra safety margin.
    ceiling_db = adaptive_ceiling_db(
        analysis["low_severity"], analysis["high_severity"], BASE_TRUE_PEAK_CEILING_DBTP
    )
    stage5, measured_lufs_before, _ = _ride_limiter_to_target(
        stage4, work_sr, target_lufs, ceiling_db
    )
    logger.info("master_audio: checkpoint after loudness ride")

    # +1. Downsample the finished hi-res master down to the 44.1kHz export
    # rate, then re-lock the same adaptive true-peak ceiling once more since
    # downsampling reconstruction can reintroduce a small amount of ripple.
    n_out = int(round(stage5.shape[1] * EXPORT_RATE / work_sr))
    export_audio = resample(stage5, n_out, axis=1).astype(np.float32)
    logger.info("master_audio: checkpoint after downsample")
    export_limiter = TruePeakLimiter(EXPORT_RATE, ceiling_db=ceiling_db)
    final_audio = export_limiter.process(export_audio)
    logger.info("master_audio: checkpoint after export limiter")

    final_lufs = measure_integrated_lufs(final_audio, EXPORT_RATE)
    final_true_peak = true_peak_dbtp(final_audio)
    logger.info(
        "master_audio: checkpoint done, final_lufs=%.2f true_peak=%.2f, rss=%.0fMB",
        final_lufs, final_true_peak, _rss_mb(),
    )

    report = {
        "measured_lufs_before_normalization": round(measured_lufs_before, 2),
        "target_lufs": target_lufs,
        "final_integrated_lufs": round(final_lufs, 2),
        "final_true_peak_dbtp": round(final_true_peak, 2),
        "true_peak_ceiling_dbtp": round(ceiling_db, 2),
        "anti_ai_intensity": anti_ai_intensity,
        "applied_bass_db": round(bass_db, 2),
        "applied_vocal_db": round(vocal_db, 2),
        "applied_clarity_db": round(clarity_db, 2),
        "prompt": prompt,
        "reverb_mix_pct": reverb_mix,
        "reverb_size_pct": reverb_size,
        "reverb_tone_pct": reverb_tone,
        "stretch_speed": stretch_speed,
        "stretch_pitch_semitones": stretch_pitch_semitones,
        "analysis": {
            **analysis,
            "low_shelf_cleaner_gain_db": round(low_shelf_gain_db, 2),
            "deess_gain_db": round(deess_gain_db, 2),
            "lowpass_stages": lowpass_stages,
        },
    }
    return final_audio, EXPORT_RATE, report
