"""Runnable check for the length-cap guard (routes._enforce_max_duration).

No framework: `python test_cap.py` prints OK or raises AssertionError.
"""
from fastapi import HTTPException

from app.api.routes import _enforce_max_duration, MAX_DURATION_SEC


def check() -> None:
    # Over the cap -> 413.
    try:
        _enforce_max_duration(int(490 * 8000), 8000)  # 490s @ 8kHz
        raise AssertionError("expected HTTPException for an over-length track")
    except HTTPException as e:
        assert e.status_code == 413, e.status_code

    # Just over the boundary -> 413.
    try:
        _enforce_max_duration((MAX_DURATION_SEC + 1) * 44100, 44100)
        raise AssertionError("expected HTTPException just over the cap")
    except HTTPException as e:
        assert e.status_code == 413, e.status_code

    # Under the cap -> no raise.
    _enforce_max_duration(int(60 * 44100), 44100)  # 60s
    _enforce_max_duration(MAX_DURATION_SEC * 44100, 44100)  # exactly at the cap

    print(f"cap check OK (MAX_DURATION_SEC={MAX_DURATION_SEC}s)")


if __name__ == "__main__":
    check()
