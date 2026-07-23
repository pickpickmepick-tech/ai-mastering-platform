"""CLI adapter for viral-music-auto's step-4 mastering.

Wraps app.dsp.mastering_chain.master_audio() so it can be invoked as a
subprocess: `python master_cli.py <in.wav> <out.wav> --bass N --vocal N
--clarity N --target-lufs N --prompt keyword`. Prints the report dict as
the last line of stdout (JSON).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import soundfile as sf

from app.dsp.mastering_chain import master_audio, DEFAULT_TARGET_LUFS


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--bass", type=float, default=0.0)
    parser.add_argument("--vocal", type=float, default=0.0)
    parser.add_argument("--clarity", type=float, default=0.0)
    parser.add_argument("--target-lufs", type=float, default=DEFAULT_TARGET_LUFS)
    parser.add_argument("--prompt", default="")
    args = parser.parse_args()

    data, sr = sf.read(args.input, always_2d=True, dtype="float32")
    audio = data.T  # (channels, samples)

    processed, out_sr, report = master_audio(
        audio,
        sr,
        bass_db=args.bass,
        vocal_db=args.vocal,
        clarity_db=args.clarity,
        target_lufs=args.target_lufs,
        prompt=args.prompt,
    )

    sf.write(args.output, processed.T, out_sr, subtype="PCM_24")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
