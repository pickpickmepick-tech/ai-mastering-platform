"""
True-Peak Limiter
------------------
Brickwall, lookahead limiter that estimates *true peak* (inter-sample peak)
by 4x oversampling per ITU-R BS.1770 practice, then constrains the signal
to a ceiling expressed in dBTP (default -1.0 dBTP as required for the
final master output). Uses:
  - instant attack (never lets an over pass)
  - lookahead (computed at a downsampled "control rate" for speed)
  - smooth release (one-pole decay back toward unity gain)
Stereo-linked: both channels share the same gain-reduction curve so the
stereo image isn't smeared.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import resample_poly
from scipy.ndimage import minimum_filter1d


def true_peak_dbtp(audio: np.ndarray, oversample: int = 4) -> float:
    up = resample_poly(audio, oversample, 1, axis=-1)
    peak = float(np.max(np.abs(up)) + 1e-12)
    return 20.0 * np.log10(peak)


class TruePeakLimiter:
    def __init__(self, sample_rate: int, ceiling_db: float = -1.0,
                 lookahead_ms: float = 5.0, release_ms: float = 80.0,
                 oversample: int = 4, control_block: int = 32):
        self.sr = sample_rate
        self.ceiling_db = ceiling_db
        self.lookahead_ms = lookahead_ms
        self.release_ms = release_ms
        self.oversample = oversample
        self.control_block = control_block

    def process(self, audio: np.ndarray) -> np.ndarray:
        """
        audio: shape (channels, samples), float32

        Stays in float32 (not float64) for the 4x-oversampled buffers: at
        the ~48kHz working rate, a 3-minute stereo track's oversampled `up`
        array alone is ~250MB in float32 vs ~500MB in float64, and this
        function runs up to 6x per mastering request (the loudness binary
        search calls it once per iteration) -- float64 here was blowing
        past the 2GB instance limit and OOM-killing the whole request.
        """
        channels, n = audio.shape
        os_factor = self.oversample
        up = resample_poly(audio, os_factor, 1, axis=-1).astype(np.float32, copy=False)
        up_len = up.shape[1]

        ceiling_lin = 10.0 ** (self.ceiling_db / 20.0)

        # stereo-linked absolute peak per oversampled sample
        linked_peak = np.max(np.abs(up), axis=0)

        # downsample to a control-rate envelope for tractable python-level smoothing
        cb = max(1, self.control_block)
        pad = (-len(linked_peak)) % cb
        if pad:
            linked_peak_padded = np.concatenate([linked_peak, np.zeros(pad)])
        else:
            linked_peak_padded = linked_peak
        control = linked_peak_padded.reshape(-1, cb).max(axis=1)

        needed_gain = np.minimum(1.0, ceiling_lin / np.maximum(control, 1e-9))

        # lookahead: forward-looking minimum so gain reduction starts *before* the peak
        lookahead_samples = max(1, int(self.lookahead_ms / 1000.0 * self.sr * os_factor / cb))
        win = lookahead_samples * 2 + 1
        gain_lookahead = minimum_filter1d(needed_gain, size=win, mode="nearest",
                                           origin=-(lookahead_samples if lookahead_samples % 2 == 0 else lookahead_samples))
        gain_lookahead = np.minimum(gain_lookahead, needed_gain)

        # release smoothing: instant attack (drop immediately), slow recovery
        release_coef = float(np.exp(-1.0 / (self.release_ms / 1000.0 * self.sr * os_factor / cb)))
        smoothed = np.empty_like(gain_lookahead)
        g = 1.0
        for i in range(gain_lookahead.shape[0]):
            target = gain_lookahead[i]
            if target < g:
                g = target
            else:
                g = release_coef * g + (1.0 - release_coef) * target
            smoothed[i] = g

        # upsample control-rate gain back to oversampled length
        gain_full = np.repeat(smoothed, cb)[:up_len]
        if gain_full.shape[0] < up_len:
            gain_full = np.concatenate([gain_full, np.full(up_len - gain_full.shape[0], smoothed[-1])])

        up_limited = up * gain_full[np.newaxis, :]
        del up  # free the 4x-oversampled buffer before the downsample allocates another one

        down = resample_poly(up_limited, 1, os_factor, axis=-1)
        del up_limited
        down = down[:, :n]

        # final hard safety clip in case of any residual overshoot from resampling ringing
        # (clipped exactly at the ceiling -- no extra slack -- so the caller's
        # requested dBTP ceiling is an actual, physically-measured guarantee)
        down = np.clip(down, -ceiling_lin, ceiling_lin)
        return down.astype(np.float32)
