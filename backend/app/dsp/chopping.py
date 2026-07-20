"""
Anti-AI Chopping (Suno HF-Noise Notch + Compressor)
-----------------------------------------------------
Suno-generated audio tends to carry two characteristic high-frequency noise
concentrations: a "digital fizz" cluster around 7.2kHz and a hiss/aliasing
cluster around 14kHz. "Chopping" targets both:

  1. Two static pinpoint notches (narrow PeakFilter cuts) right on those
     frequencies, whose depth scales with `intensity`.
  2. A parallel-band downward compressor on the same 6-16kHz region, so any
     transient spike that pokes back up through the static notch gets
     smoothly clamped rather than passing through unchecked -- this is what
     makes the reduction "gentle" rather than a flat static cut.

`intensity` is 0..1 (mapped from the 0-100 "Chopping 강도" UI slider).
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt
from pedalboard import Pedalboard, PeakFilter, Compressor

NOTCH_7K2_HZ = 7200.0
NOTCH_7K2_Q = 2.5
NOTCH_7K2_MAX_CUT_DB = 10.0

NOTCH_14K_HZ = 14000.0
NOTCH_14K_Q = 1.5
NOTCH_14K_MAX_CUT_DB = 8.0

COMP_BAND_LO_HZ = 6000.0
COMP_BAND_HI_HZ = 16000.0
COMP_THRESHOLD_DB = -28.0
COMP_MAX_RATIO = 6.0


def _band_sos(sr: int):
    nyq = sr / 2.0
    lo = COMP_BAND_LO_HZ / nyq
    hi = min(0.999, COMP_BAND_HI_HZ / nyq)
    return butter(2, [lo, hi], btype="bandpass", output="sos")


def apply_chopping(audio: np.ndarray, sr: int, intensity: float) -> np.ndarray:
    """
    audio: shape (channels, samples), float32
    intensity: 0..1 -- 0 bypasses entirely.
    """
    intensity = float(np.clip(intensity, 0.0, 1.0))
    if intensity <= 0.0:
        return audio

    # 1. Static pinpoint notches, depth scaled by intensity.
    notch_board = Pedalboard([
        PeakFilter(cutoff_frequency_hz=NOTCH_7K2_HZ, gain_db=-intensity * NOTCH_7K2_MAX_CUT_DB, q=NOTCH_7K2_Q),
        PeakFilter(cutoff_frequency_hz=NOTCH_14K_HZ, gain_db=-intensity * NOTCH_14K_MAX_CUT_DB, q=NOTCH_14K_Q),
    ])
    notched = notch_board(audio, sr).astype(np.float32)

    # 2. Parallel-band compressor: isolate the same HF region, compress it,
    # and swap it back in for the original (uncompressed) energy there.
    sos = _band_sos(sr)
    hf_band = sosfilt(sos, notched, axis=-1).astype(np.float32)
    rest = notched - hf_band

    ratio = 1.0 + intensity * (COMP_MAX_RATIO - 1.0)
    comp_board = Pedalboard([
        Compressor(threshold_db=COMP_THRESHOLD_DB, ratio=ratio, attack_ms=5.0, release_ms=120.0)
    ])
    hf_band_compressed = comp_board(hf_band, sr).astype(np.float32)

    return (rest + hf_band_compressed).astype(np.float32)
