"use client";

import { RefObject, useEffect, useRef, useState } from "react";
import { computePeaks, fmtTime } from "@/lib/waveform";

interface Props {
  audioRef: RefObject<HTMLAudioElement>;
  blob: Blob | null;
  accentColor?: string;
}

const PEAK_BUCKETS = 64;

export default function WaveformPlayer({ audioRef, blob, accentColor = "#7c5cff" }: Props) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isDecoding, setIsDecoding] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const decodeCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPeaks([]);
    if (!blob) return;

    setIsDecoding(true);
    (async () => {
      try {
        if (!decodeCtxRef.current) {
          const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          decodeCtxRef.current = new Ctor();
        }
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await decodeCtxRef.current.decodeAudioData(arrayBuffer.slice(0));
        if (cancelled) return;
        setPeaks(computePeaks(audioBuffer, PEAK_BUCKETS));
      } catch {
        // Unsupported/corrupt for client-side decode -- waveform just stays empty.
      } finally {
        if (!cancelled) setIsDecoding(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blob]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrentTime(audio.currentTime);
    const onLoaded = () => setDuration(audio.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onLoaded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);

    if (audio.duration) setDuration(audio.duration);
    setCurrentTime(audio.currentTime);
    setIsPlaying(!audio.paused);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", onLoaded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
    };
  }, [audioRef, blob]);

  useEffect(() => {
    return () => {
      decodeCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = Math.min(duration, Math.max(0, pct * duration));
  };

  return (
    <div>
      <div
        onClick={handleSeek}
        className="relative h-16 cursor-pointer overflow-hidden rounded-lg bg-black/30"
      >
        {isDecoding ? (
          <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
            파형 분석 중...
          </div>
        ) : peaks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
            파형을 표시할 수 없습니다.
          </div>
        ) : (
          <>
            <div className="flex h-full items-center gap-1 px-2 py-2">
              {peaks.map((p, i) => {
                const played = duration > 0 && i / peaks.length < currentTime / duration;
                return (
                  <div
                    key={i}
                    className="min-h-[6%] flex-1 rounded-full"
                    style={{
                      height: `${Math.max(10, p * 100)}%`,
                      background: played ? accentColor : "#3d3d56",
                    }}
                  />
                );
              })}
            </div>
            {duration > 0 && (
              <div
                className="pointer-events-none absolute top-0 h-full w-px bg-accent-glow shadow-[0_0_6px_rgba(34,211,238,0.9)]"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              />
            )}
          </>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handlePlayPause}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-glow text-sm text-black shadow-glow"
          aria-label={isPlaying ? "일시정지" : "재생"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <span className="font-mono text-[11px] text-zinc-500">
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </span>
      </div>
    </div>
  );
}
