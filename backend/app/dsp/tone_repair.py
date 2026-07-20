"""
Tone Repair Pre-Stage
---------------------------------------------
Runs first in the chain, ahead of the dynamic EQ/compression stages, to tame
the harsh "cheap digital" artifacts typical of Suno-generated audio:
  - 28Hz highpass to strip inaudible sub-bass garbage/rumble that otherwise
    gets amplified along with everything else downstream and shows up as
    low-end "fizz"/crackle once the master is brought up to full loudness.
  - 15kHz lowpass (dynamic_high_cleaner drives how many cascaded stages --
    i.e. how steep the slope is -- based on how sibilant/harsh the track's
    own 4-8kHz energy measured) to shave off harsh ultrasonic/aliasing noise.
  - De-essing dip at 6.5kHz (dynamic_high_cleaner drives the depth,
    -3.0..-6.0dB, based on that same measurement) for harsh vocal
    sibilance / cymbal splash.
  - -2.5dB wide dip at 4.5kHz (the digital "fizz" clustered in Suno vocals).
  - -1.5dB dip at 250Hz to clear boxy, muddy midrange.
  - -2.0dB dip at 120Hz to clear thick, muddy low-end boominess.
"""
from __future__ import annotations

import numpy as np
from pedalboard import Pedalboard, HighpassFilter, LowpassFilter, PeakFilter


def repair_tone(
    audio: np.ndarray,
    sr: int,
    deess_gain_db: float = -3.0,
    lowpass_stages: int = 1,
) -> np.ndarray:
    plugins = [
        HighpassFilter(cutoff_frequency_hz=28.0),
    ]
    plugins += [LowpassFilter(cutoff_frequency_hz=15000.0) for _ in range(max(1, lowpass_stages))]
    plugins += [
        PeakFilter(cutoff_frequency_hz=6500.0, gain_db=deess_gain_db, q=1.5),
        PeakFilter(cutoff_frequency_hz=4500.0, gain_db=-2.5, q=0.5),
        PeakFilter(cutoff_frequency_hz=250.0, gain_db=-1.5, q=1.0),
        PeakFilter(cutoff_frequency_hz=120.0, gain_db=-2.0, q=1.2),
    ]
    board = Pedalboard(plugins)
    return board(audio, sr).astype(np.float32)
