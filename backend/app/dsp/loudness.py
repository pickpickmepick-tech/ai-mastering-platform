"""
LUFS Loudness Measurement (simplified ITU-R BS.1770-4)
--------------------------------------------------------
K-weighting (pre-filter + RLB high-pass) + 400ms/75%-overlap block gating
(absolute -70 LUFS gate, then relative -10 LU gate) to compute Integrated
Loudness. Measurement is performed at 48kHz per the standard's reference
coefficients; input is resampled to 48kHz internally for the measurement
pass only (the actual audio processing chain stays at the source sample rate).
"""
from __future__ import annotations

import numpy as np
from scipy.signal import lfilter, resample_poly

_MEASURE_SR = 48000

# BS.1770-4 K-weighting biquad coefficients @ 48kHz
_STAGE1_B = [1.53512485958697, -2.69169618940638, 1.19839281085285]
_STAGE1_A = [1.0, -1.69065929318241, 0.73248077421585]
_STAGE2_B = [1.0, -2.0, 1.0]
_STAGE2_A = [1.0, -1.99004745483398, 0.99007225036621]


def _k_weight(mono_or_stereo_at_48k: np.ndarray) -> np.ndarray:
    x = lfilter(_STAGE1_B, _STAGE1_A, mono_or_stereo_at_48k, axis=-1)
    x = lfilter(_STAGE2_B, _STAGE2_A, x, axis=-1)
    return x


def measure_integrated_lufs(audio: np.ndarray, sr: int) -> float:
    """
    audio: shape (channels, samples), float32/float64
    """
    channels, n = audio.shape
    if sr != _MEASURE_SR:
        audio_meas = resample_poly(audio, _MEASURE_SR, sr, axis=-1)
    else:
        audio_meas = audio.copy()

    weighted = _k_weight(audio_meas)

    block_len = int(0.4 * _MEASURE_SR)
    hop = int(0.1 * _MEASURE_SR)
    n_meas = weighted.shape[1]
    if n_meas < block_len:
        # too short for standard gating; fall back to simple RMS
        ms = np.mean(weighted ** 2) + 1e-12
        return -0.691 + 10.0 * np.log10(ms)

    n_blocks = 1 + (n_meas - block_len) // hop
    block_loudness = np.empty(n_blocks)
    channel_weight = 1.0  # mono/stereo only, no surround weighting needed

    for i in range(n_blocks):
        start = i * hop
        seg = weighted[:, start:start + block_len]
        ms_per_channel = np.mean(seg ** 2, axis=1)
        ms_sum = np.sum(ms_per_channel * channel_weight)
        block_loudness[i] = -0.691 + 10.0 * np.log10(ms_sum + 1e-12)

    # absolute gate at -70 LUFS
    abs_gate_mask = block_loudness > -70.0
    if not np.any(abs_gate_mask):
        return float(np.max(block_loudness)) if n_blocks else -70.0

    gated_blocks = block_loudness[abs_gate_mask]
    # relative gate: -10 LU below the mean loudness of the absolute-gated blocks
    mean_power = np.mean(10.0 ** ((gated_blocks + 0.691) / 10.0))
    relative_threshold = -0.691 + 10.0 * np.log10(mean_power + 1e-12) - 10.0

    rel_gate_mask = block_loudness > relative_threshold
    final_blocks = block_loudness[rel_gate_mask & abs_gate_mask]
    if final_blocks.size == 0:
        final_blocks = gated_blocks

    final_power = np.mean(10.0 ** ((final_blocks + 0.691) / 10.0))
    integrated_lufs = -0.691 + 10.0 * np.log10(final_power + 1e-12)
    return float(integrated_lufs)


def gain_for_target_lufs(audio: np.ndarray, sr: int, target_lufs: float) -> float:
    """Returns linear gain multiplier to move `audio` to `target_lufs`."""
    current = measure_integrated_lufs(audio, sr)
    delta_db = target_lufs - current
    return float(10.0 ** (delta_db / 20.0)), current
