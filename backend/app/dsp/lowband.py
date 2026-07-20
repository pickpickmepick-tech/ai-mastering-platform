"""
120Hz Multiband Bass Compressor
-----------------------------------------------------------------
split_bands / compress_low_band: a genuine 120Hz crossover split (two
cascaded 2nd-order Butterworth stages per branch = 4th-order
Linkwitz-Riley, so low + high reconstructs the original with a flat
combined response) so the low end can be compressed on its own, with a
slow, independent 800ms release -- instead of one shared block-based
envelope fighting both the kick fundamental and the vocal/clarity bands at
once, which is what caused the low-end pumping/tearing.

(Sub-bass energy analysis now lives in adaptive_analyzer.py, which feeds a
per-track dynamic low-shelf trim into the mastering chain ahead of this
split.)
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt


def split_bands(audio: np.ndarray, sr: int, crossover_hz: float = 120.0):
    """
    4th-order Linkwitz-Riley crossover split. Returns (low, high), each the
    same shape as `audio`.
    """
    nyq = sr / 2.0
    wn = crossover_hz / nyq
    sos_lp = butter(2, wn, btype="low", output="sos")
    sos_hp = butter(2, wn, btype="high", output="sos")

    low = sosfilt(sos_lp, audio, axis=-1)
    low = sosfilt(sos_lp, low, axis=-1)
    high = sosfilt(sos_hp, audio, axis=-1)
    high = sosfilt(sos_hp, high, axis=-1)
    return low.astype(np.float32), high.astype(np.float32)


def compress_low_band(
    low: np.ndarray,
    sr: int,
    threshold_db: float = -18.0,
    ratio: float = 2.0,
    attack_ms: float = 20.0,
    release_ms: float = 800.0,
    max_reduction_db: float = 6.0,
    control_block: int = 64,
) -> np.ndarray:
    """
    Independent compressor for the sub-120Hz band only, with a long 800ms
    release so gain-reduction recovery never lands mid-cycle of a long bass
    wave (the "physically tearing" pumping artifact). Runs at a downsampled
    control rate (like the True-Peak limiter) for speed, then the gain
    envelope is upsampled back to full rate.
    """
    channels, n = low.shape
    mono = np.mean(np.abs(low), axis=0)

    cb = max(1, control_block)
    pad = (-len(mono)) % cb
    mono_padded = np.concatenate([mono, np.zeros(pad, dtype=mono.dtype)]) if pad else mono
    control = mono_padded.reshape(-1, cb).max(axis=1)

    attack_coef = float(np.exp(-1.0 / (max(attack_ms, 1e-6) / 1000.0 * sr / cb)))
    release_coef = float(np.exp(-1.0 / (max(release_ms, 1e-6) / 1000.0 * sr / cb)))

    level = np.empty_like(control)
    lvl = float(control[0]) if control.size else 0.0
    for i in range(control.shape[0]):
        target = control[i]
        coef = attack_coef if target > lvl else release_coef
        lvl = coef * lvl + (1.0 - coef) * target
        level[i] = lvl

    level_db = 20.0 * np.log10(level + 1e-9)
    over = np.clip(level_db - threshold_db, 0.0, None)
    reduction_db = np.minimum(over - over / ratio, max_reduction_db)
    gain_control = 10.0 ** (-reduction_db / 20.0)

    gain_full = np.repeat(gain_control, cb)[:n]
    if gain_full.shape[0] < n:
        gain_full = np.concatenate(
            [gain_full, np.full(n - gain_full.shape[0], gain_control[-1] if gain_control.size else 1.0)]
        )

    return (low * gain_full[np.newaxis, :]).astype(np.float32)
