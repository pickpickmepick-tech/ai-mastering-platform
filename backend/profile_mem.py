"""Per-stage RSS profiler: runs master_audio with INFO logging so each
checkpoint prints its resident memory. Usage: python profile_mem.py [seconds]"""
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)

from bench import gen_audio  # noqa: E402
from app.dsp.mastering_chain import master_audio  # noqa: E402

seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 360.0
audio = gen_audio(seconds)
master_audio(audio, 44100, bass_db=2.0, vocal_db=1.0, clarity_db=1.0,
             target_lufs=-9.0, anti_ai_intensity=0.5)
