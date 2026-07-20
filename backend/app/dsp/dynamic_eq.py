"""
Dynamic EQ
----------
2-band dynamic equalizer (Vocal-Presence / Clarity-Air) that combines a
user-controlled static tonal balance with real-time, envelope-driven gain
adaptation (i.e. the band gently backs off when that band gets loud, and
opens back up when it's quiet -- classic "dynamic EQ" behaviour).

Bass is *not* handled here: it's split out and compressed independently by
`lowband.py` (see mastering_chain.py), since a shared block-based envelope
fighting both the kick fundamental and the vocal/clarity bands at once is
exactly what caused the low-end pumping/tearing this module used to produce.

Processing is done in overlapping blocks (STFT-style overlap-add with a Hann
window) so that per-block filter parameter changes don't produce audible
zipper/clicking artifacts.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt
from pedalboard import Pedalboard, LowShelfFilter, PeakFilter, HighShelfFilter


def _db_to_lin(db: float) -> float:
    return float(10.0 ** (db / 20.0))


class _Band:
    def __init__(self, name, kind, freq_hz, q, base_gain_db,
                 env_lo_hz, env_hi_hz, threshold_db=-22.0, ratio=1.5,
                 max_dynamic_db=4.0, attack_ms=10.0, release_ms=120.0):
        self.name = name
        self.kind = kind  # "low_shelf" | "peak" | "high_shelf"
        self.freq_hz = freq_hz
        self.q = q
        self.base_gain_db = base_gain_db
        self.env_lo_hz = env_lo_hz
        self.env_hi_hz = env_hi_hz
        self.threshold_db = threshold_db
        self.ratio = ratio
        self.max_dynamic_db = max_dynamic_db
        self.attack_ms = attack_ms
        self.release_ms = release_ms
        self._sos = None
        self._smoothed_gain_db = base_gain_db
        self._attack_coef = 0.0
        self._release_coef = 0.0

    def build_envelope_filter(self, sr: int):
        nyq = sr / 2.0
        lo = max(10.0, self.env_lo_hz) / nyq
        hi = min(nyq - 100.0, self.env_hi_hz) / nyq
        hi = max(hi, lo + 0.01)
        self._sos = butter(2, [lo, hi], btype="bandpass", output="sos")

    def configure_smoothing(self, hop_ms: float):
        """
        Converts attack_ms/release_ms into per-hop one-pole coefficients.
        A longer release_ms (e.g. bass) lets long low-frequency cycles decay
        back to unity gently instead of snapping/pumping against the
        waveform, which is what causes low-end "tearing" distortion.
        """
        hop_ms = max(hop_ms, 1e-6)
        self._attack_coef = float(np.exp(-hop_ms / max(self.attack_ms, 1e-6)))
        self._release_coef = float(np.exp(-hop_ms / max(self.release_ms, 1e-6)))

    def envelope_rms_db(self, block: np.ndarray) -> float:
        # block: mono mixdown, shape (samples,)
        band_signal = sosfilt(self._sos, block)
        rms = np.sqrt(np.mean(band_signal ** 2) + 1e-12)
        return 20.0 * np.log10(rms + 1e-9)

    def dynamic_gain_db(self, level_db: float) -> float:
        if level_db <= self.threshold_db:
            # slight, gentle lift when the band is under-energetic
            delta = min((self.threshold_db - level_db) / self.ratio, self.max_dynamic_db) * 0.15
            return delta
        # compress (reduce) gain the louder this band gets above threshold
        over = level_db - self.threshold_db
        delta = -min(over - over / self.ratio, self.max_dynamic_db)
        return delta

    def target_gain_db(self, level_db: float) -> float:
        target = self.base_gain_db + self.dynamic_gain_db(level_db)
        # Attack when gain is dropping (band getting louder / more gain
        # reduction), release when gain is recovering back toward baseline.
        coef = self._attack_coef if target < self._smoothed_gain_db else self._release_coef
        self._smoothed_gain_db = coef * self._smoothed_gain_db + (1.0 - coef) * target
        return self._smoothed_gain_db


class DynamicEQ:
    """
    vocal_db / clarity_db: user slider values in dB, range approx -12..+12.
    """

    _BLOCK = 8192

    def __init__(self, sample_rate: int, vocal_db: float, clarity_db: float):
        self.sr = sample_rate
        self.bands = [
            _Band("vocal", "peak", 1000.0, 0.7, vocal_db, 500.0, 2000.0),
            _Band("clarity", "high_shelf", 8000.0, 0.8, clarity_db, 6000.0, 16000.0),
        ]
        hop_ms = (self._BLOCK // 2) / sample_rate * 1000.0
        for b in self.bands:
            b.build_envelope_filter(sample_rate)
            b.configure_smoothing(hop_ms)

    def _make_board(self, gains_db: dict) -> Pedalboard:
        plugins = []
        for b in self.bands:
            g = gains_db[b.name]
            if b.kind == "low_shelf":
                plugins.append(LowShelfFilter(cutoff_frequency_hz=b.freq_hz, gain_db=g, q=b.q))
            elif b.kind == "peak":
                plugins.append(PeakFilter(cutoff_frequency_hz=b.freq_hz, gain_db=g, q=b.q))
            else:
                plugins.append(HighShelfFilter(cutoff_frequency_hz=b.freq_hz, gain_db=g, q=b.q))
        return Pedalboard(plugins)

    def process(self, audio: np.ndarray) -> np.ndarray:
        """
        audio: shape (channels, samples), float32
        returns processed audio, same shape
        """
        channels, n = audio.shape
        block = self._BLOCK
        hop = block // 2
        window = np.hanning(block).astype(np.float32)

        out = np.zeros((channels, n + block), dtype=np.float32)
        norm = np.zeros(n + block, dtype=np.float32)

        mono = np.mean(audio, axis=0)

        pos = 0
        while pos < n:
            end = min(pos + block, n)
            seg = audio[:, pos:end]
            seg_len = seg.shape[1]
            if seg_len < block:
                pad = np.zeros((channels, block - seg_len), dtype=np.float32)
                seg_padded = np.concatenate([seg, pad], axis=1)
                mono_seg = np.concatenate([mono[pos:end], np.zeros(block - seg_len, dtype=np.float32)])
            else:
                seg_padded = seg
                mono_seg = mono[pos:end]

            gains = {}
            for b in self.bands:
                level_db = b.envelope_rms_db(mono_seg)
                gains[b.name] = b.target_gain_db(level_db)

            board = self._make_board(gains)
            processed = board(seg_padded, self.sr)
            processed = processed * window[np.newaxis, :]

            out[:, pos:pos + block] += processed
            norm[pos:pos + block] += window

            pos += hop

        norm[norm < 1e-6] = 1.0
        out = out / norm[np.newaxis, :]
        return out[:, :n].astype(np.float32)
