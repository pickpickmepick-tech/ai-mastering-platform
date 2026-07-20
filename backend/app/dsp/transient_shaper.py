"""
Smart Transient Shaper
-----------------------
Detects transient (attack) energy using a fast/slow dual envelope-follower
pair, then adaptively boosts attacks and gently tames sustain, punching up
percussive/vocal onsets without needing manual per-track tuning.

The boosted transient is rounded off with an analog-style tanh waveshaper
rather than left to hard-clip downstream: a plain gain multiply on a sharp
kick transient can push isolated samples into an abrupt, knife-edge peak
that reads as a "click"/digital tick once anything later in the chain
(limiter, resampling) clips or rings on it. The tanh curve keeps the attack
punchy while rounding that peak off smoothly instead of tearing it flat.
"""
from __future__ import annotations

import numpy as np


def _one_pole_envelope(signal: np.ndarray, sr: int, time_ms: float) -> np.ndarray:
    from scipy.signal import lfilter
    coef = float(np.exp(-1.0 / (max(time_ms, 0.05) / 1000.0 * sr)))
    b = [1.0 - coef]
    a = [1.0, -coef]
    env = lfilter(b, a, np.abs(signal))
    return env


def _soft_clip(x: np.ndarray, drive: float = 1.5) -> np.ndarray:
    """
    Analog-style tanh waveshaper: unity gain through the middle of the
    range, progressively rounding amplitude off as it approaches full
    scale instead of hard-clipping at a sharp corner. `drive` controls how
    early the curve starts rounding; normalized by tanh(drive) so a
    full-scale (+/-1.0) input still maps to +/-1.0.
    """
    return (np.tanh(x * drive) / np.tanh(drive)).astype(np.float32)


def shape_transients(
    audio: np.ndarray,
    sr: int,
    attack_boost_db: float = 1.1,
    sustain_reduce_db: float = 1.7,
    fast_ms: float = 2.0,
    slow_ms: float = 60.0,
    soft_clip_drive: float = 1.5,
) -> np.ndarray:
    """
    audio: shape (channels, samples)
    """
    channels, n = audio.shape
    mono = np.mean(np.abs(audio), axis=0)

    fast_env = _one_pole_envelope(mono, sr, fast_ms)
    slow_env = _one_pole_envelope(mono, sr, slow_ms)

    transient = np.clip(fast_env - slow_env, 0.0, None)
    denom = slow_env + 1e-6
    transient_ratio = np.clip(transient / denom, 0.0, 3.0)
    transient_norm = np.clip(transient_ratio / 3.0, 0.0, 1.0)

    boost_lin = 10.0 ** ((transient_norm * attack_boost_db) / 20.0)
    reduce_lin = 10.0 ** ((-(1.0 - transient_norm) * sustain_reduce_db * 0.3) / 20.0)
    gain = boost_lin * reduce_lin

    # smooth the gain curve itself slightly to avoid zipper artifacts
    smooth_kernel = np.ones(64) / 64.0
    gain = np.convolve(gain, smooth_kernel, mode="same")

    out = audio * gain[np.newaxis, :]
    out = _soft_clip(out, drive=soft_clip_drive)
    return out.astype(np.float32)
