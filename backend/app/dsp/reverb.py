"""
Studio Reverb
-------------
User-controlled send effect applied as Mix / Size / Tone knobs (matching a
typical "studio reverb" plugin), built on pedalboard's algorithmic Reverb.
"""
from __future__ import annotations

import numpy as np
from pedalboard import Pedalboard, Reverb


def apply_reverb(
    audio: np.ndarray,
    sr: int,
    mix_pct: float,
    size_pct: float,
    tone_pct: float,
) -> np.ndarray:
    """
    audio: shape (channels, samples), float32
    mix_pct / size_pct / tone_pct: 0..100

    mix_pct  -> wet/dry blend (0 = fully dry/bypassed, 100 = fully wet)
    size_pct -> room_size (0..1)
    tone_pct -> brightness of the reverb tail; higher tone lowers damping
                so more high-frequency content survives in the tail
    """
    mix = float(np.clip(mix_pct, 0.0, 100.0)) / 100.0
    if mix <= 0.0:
        return audio

    size = float(np.clip(size_pct, 0.0, 100.0)) / 100.0
    tone = float(np.clip(tone_pct, 0.0, 100.0)) / 100.0
    damping = 1.0 - tone

    board = Pedalboard([
        Reverb(
            room_size=size,
            damping=damping,
            wet_level=mix,
            dry_level=1.0 - mix,
            width=1.0,
        )
    ])
    return board(audio, sr).astype(np.float32, copy=False)
