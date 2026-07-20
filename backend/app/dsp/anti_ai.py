"""
Anti-AI Fingerprint Evasion
----------------------------
Two extremely subtle, inaudible-at-normal-listening-levels processes designed
to break the exact-sample-level fingerprints that automated "AI-generated
audio" classifiers/detectors key off of, without harming perceived audio
quality:

  1. Ultra-fine micro-jitter: a sub-sample-accurate, randomized time-domain
     warp (well under 1 sample of deviation) that decorrelates the waveform
     from its original sample grid.
  2. Gaussian dithering: low-level, normally-distributed noise injected
     below the audible noise floor, which also has the side effect of
     randomizing LSB-level quantization patterns.

`intensity` is 0..1 (mapped from the 0-100 "Anti-AI strength" UI slider).
"""
from __future__ import annotations

import numpy as np


def micro_jitter(audio: np.ndarray, intensity: float, seed: int | None = None) -> np.ndarray:
    """
    audio: shape (channels, samples)
    Applies a randomized sub-sample time warp per channel via linear
    interpolation. Max jitter is deliberately kept under 1 sample so it
    stays inaudible.
    """
    rng = np.random.default_rng(seed)
    channels, n = audio.shape
    max_jitter = 0.04 + float(np.clip(intensity, 0.0, 1.0)) * 0.30  # fraction of a sample

    idx = np.arange(n, dtype=np.float64)
    jitter = rng.normal(0.0, max_jitter, size=n)
    jitter = np.clip(jitter, -0.9, 0.9)
    warped_idx = np.clip(idx + jitter, 0, n - 1)

    out = np.empty_like(audio)
    for ch in range(channels):
        out[ch] = np.interp(warped_idx, idx, audio[ch])
    return out.astype(np.float32)


def gaussian_dither(audio: np.ndarray, intensity: float, bit_depth: int = 16, seed: int | None = None) -> np.ndarray:
    """
    Adds sub-LSB Gaussian dither noise, scaled by intensity.
    """
    rng = np.random.default_rng(seed)
    lsb = 2.0 ** -(bit_depth - 1)
    sigma = lsb * (0.15 + float(np.clip(intensity, 0.0, 1.0)) * 0.85) * 0.5
    noise = rng.normal(0.0, sigma, size=audio.shape)
    return (audio + noise).astype(np.float32)


def apply_anti_ai(audio: np.ndarray, sr: int, intensity: float, seed: int | None = None) -> np.ndarray:
    """
    intensity: 0..1
    """
    processed = micro_jitter(audio, intensity, seed=seed)
    processed = gaussian_dither(processed, intensity, seed=None if seed is None else seed + 1)
    return processed
