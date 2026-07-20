"""
Real-Time Adaptive Dynamic Analysis (Dynamic Adaptive DSP)
-------------------------------------------------------------
Every Suno track has a different frequency balance -- a fixed preset tuned
to fix one track's harshness will under-correct a harsher track and
over-dull a cleaner one. This module measures each track's own low
(30-150Hz) / mid (150-4000Hz) / high (4000Hz+) energy balance up front,
turns the excess (if any) into a 0..1 severity score per problem area, and
the mastering chain uses those scores to drive:

  - dynamic_low_cleaner_gain_db:  LowShelfFilter(90Hz) gain, -3.0..-7.0dB
  - dynamic_high_cleaner_params:  de-essing depth (-3.0..-6.0dB @ 6.5kHz)
                                   and lowpass slope steepness (more
                                   cascaded stages) for oversized 4-8kHz
                                   "harsh"/sibilant energy
  - adaptive_ceiling_db:          a slightly tighter true-peak ceiling for
                                   tracks that needed heavier correction,
                                   as an extra safety margin
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt

LOW_BAND_HZ = (30.0, 150.0)
MID_BAND_HZ = (150.0, 4000.0)
HIGH_BAND_HZ = (4000.0, 20000.0)
SIBILANCE_BAND_HZ = (4000.0, 8000.0)

LOW_EXCESS_THRESHOLD_DB = 6.0
LOW_EXCESS_RANGE_DB = 8.0
HIGH_EXCESS_THRESHOLD_DB = 4.0
HIGH_EXCESS_RANGE_DB = 8.0

LOW_SHELF_GAIN_MIN_DB = -3.0
LOW_SHELF_GAIN_MAX_DB = -7.0
DEESS_GAIN_BASELINE_DB = -3.0
DEESS_GAIN_MAX_DB = -6.0
LOWPASS_STAGES_MAX = 3


def _rms_db(x: np.ndarray) -> float:
    return float(20.0 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12))


def _band_rms_db(mono: np.ndarray, sr: int, lo_hz: float, hi_hz: float) -> float:
    nyq = sr / 2.0
    hi_hz = min(hi_hz, nyq - 100.0)
    if lo_hz <= 20.0:
        sos = butter(4, hi_hz / nyq, btype="low", output="sos")
    else:
        sos = butter(4, [lo_hz / nyq, hi_hz / nyq], btype="bandpass", output="sos")
    return float(_rms_db(sosfilt(sos, mono)))


def _to_mono(audio: np.ndarray) -> np.ndarray:
    """
    Safely collapses a (channels, samples) array to a 1D mono array by
    averaging across the channel axis. A already-1D array (mono with no
    channel axis) is passed through untouched -- np.mean(x, axis=0) on a 1D
    array would collapse it to a scalar instead, which is exactly the kind
    of dimension mismatch this guards against.
    """
    audio = np.asarray(audio)
    if audio.ndim == 1:
        return audio
    return np.mean(audio, axis=0)


def analyze_track(audio: np.ndarray, sr: int) -> dict:
    """
    Measures this track's own low/mid/high/sibilance band energy and
    derives normalized (0..1) severity scores for the low- and
    high-cleaner logic.
    """
    mono = _to_mono(audio)

    low_db = _band_rms_db(mono, sr, *LOW_BAND_HZ)
    mid_db = _band_rms_db(mono, sr, *MID_BAND_HZ)
    high_db = _band_rms_db(mono, sr, *HIGH_BAND_HZ)
    sibilance_db = _band_rms_db(mono, sr, *SIBILANCE_BAND_HZ)

    low_excess_db = low_db - mid_db
    high_excess_db = sibilance_db - mid_db

    low_severity = float(np.clip((low_excess_db - LOW_EXCESS_THRESHOLD_DB) / LOW_EXCESS_RANGE_DB, 0.0, 1.0))
    high_severity = float(np.clip((high_excess_db - HIGH_EXCESS_THRESHOLD_DB) / HIGH_EXCESS_RANGE_DB, 0.0, 1.0))

    return {
        "low_db": round(float(low_db), 2),
        "mid_db": round(float(mid_db), 2),
        "high_db": round(float(high_db), 2),
        "sibilance_db": round(float(sibilance_db), 2),
        "low_excess_db": round(float(low_excess_db), 2),
        "high_excess_db": round(float(high_excess_db), 2),
        "low_severity": round(low_severity, 3),
        "high_severity": round(high_severity, 3),
    }


def dynamic_low_cleaner_gain_db(low_severity: float) -> float:
    """LowShelfFilter(90Hz) gain, interpolated -3.0dB (mild) .. -7.0dB (severe boom)."""
    low_severity = float(low_severity)
    gain_db = LOW_SHELF_GAIN_MIN_DB + (LOW_SHELF_GAIN_MAX_DB - LOW_SHELF_GAIN_MIN_DB) * low_severity
    return float(gain_db)


def dynamic_high_cleaner_params(high_severity: float) -> tuple[float, int]:
    """
    Returns (deess_gain_db, lowpass_stage_count). De-essing deepens toward
    -6dB and the 15kHz lowpass gets progressively steeper (pedalboard's
    LowpassFilter has no order/slope parameter, so steepness is achieved by
    cascading more identical stages) as sibilance severity increases.
    """
    high_severity = float(high_severity)
    deess_gain_db = DEESS_GAIN_BASELINE_DB + (DEESS_GAIN_MAX_DB - DEESS_GAIN_BASELINE_DB) * high_severity
    stages = 1 + round((LOWPASS_STAGES_MAX - 1) * high_severity)
    return float(deess_gain_db), int(stages)


def adaptive_ceiling_db(
    low_severity: float,
    high_severity: float,
    base_ceiling_db: float,
    max_extra_margin_db: float = 0.5,
) -> float:
    """
    Tracks that needed heavier correction (i.e. were more overloaded to
    begin with) get a slightly tighter true-peak ceiling as extra safety
    margin, rather than every track being pushed to the exact same limit
    regardless of how hot/messy the source was.
    """
    severity = max(float(low_severity), float(high_severity))
    return float(base_ceiling_db - max_extra_margin_db * severity)
