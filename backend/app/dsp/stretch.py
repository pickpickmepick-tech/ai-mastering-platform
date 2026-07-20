"""
Audio Stretch
-------------
Independent speed (time-stretch, changes duration) and pitch (key up/down,
duration-preserving) controls, both delegated to pedalboard's high-quality
time_stretch utility. The two parameters never affect each other.
"""
from __future__ import annotations

import numpy as np
from pedalboard import time_stretch


def apply_stretch(
    audio: np.ndarray,
    sr: int,
    speed: float,
    pitch_semitones: float,
) -> np.ndarray:
    """
    audio: shape (channels, samples), float32
    speed: playback speed multiplier (e.g. 0.5 = half speed/double length,
           2.0 = double speed/half length). 1.0 = no change.
    pitch_semitones: key shift in semitones, +/-. 0 = no change.
    """
    speed = float(np.clip(speed, 0.25, 4.0))
    pitch_semitones = float(np.clip(pitch_semitones, -24.0, 24.0))

    if speed == 1.0 and pitch_semitones == 0.0:
        return audio

    stretched = time_stretch(
        audio,
        sr,
        stretch_factor=speed,
        pitch_shift_in_semitones=pitch_semitones,
    )
    return stretched.astype(np.float32)
