"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  file: File | null;
  enabled: boolean;
  speed: number;
  pitch: number;
  onToggle: (v: boolean) => void;
  onSpeedChange: (v: number | ((prev: number) => number)) => void;
  onPitchChange: (v: number | ((prev: number) => number)) => void;
}

const SPEED_MIN = 0.5;
const SPEED_MAX = 2.0;
const SPEED_STEP = 0.05;
const PITCH_MIN = -12;
const PITCH_MAX = 12;
const PEAK_BUCKETS = 48;

function computePeaks(buffer: AudioBuffer, buckets: number): number[] {
  const data = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(data.length / buckets));
  const result: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const start = i * blockSize;
    let max = 0;
    for (let j = 0; j < blockSize && start + j < data.length; j++) {
      const v = Math.abs(data[start + j]);
      if (v > max) max = v;
    }
    result.push(max);
  }
  return result;
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function StretchPanel({
  file,
  enabled,
  speed,
  pitch,
  onToggle,
  onSpeedChange,
  onPitchChange,
}: Props) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const playStartOffsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef(speed);
  const pitchRef = useRef(pitch);

  const [isDecoding, setIsDecoding] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    pitchRef.current = pitch;
  }, [pitch]);

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      const Ctor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctor();
    }
    return audioCtxRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try {
        sourceRef.current.stop();
      } catch {
        // already stopped
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const ctx = audioCtxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;
    const elapsedCtx = ctx.currentTime - playStartCtxTimeRef.current;
    const elapsedTrack = playStartOffsetRef.current + elapsedCtx * speedRef.current;
    if (elapsedTrack >= buffer.duration) {
      setCurrentTime(buffer.duration);
      setIsPlaying(false);
      stopPlayback();
      return;
    }
    setCurrentTime(elapsedTrack);
    rafRef.current = requestAnimationFrame(tick);
  }, [stopPlayback]);

  const playFrom = useCallback(
    (offsetSeconds: number) => {
      const buffer = bufferRef.current;
      if (!buffer) return;
      const ctx = getAudioContext();
      if (ctx.state === "suspended") ctx.resume();
      stopPlayback();

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = speedRef.current;
      // playbackRate shifts pitch by 12*log2(speed) semitones as a side
      // effect; detune corrects for that so the Pitch control is independent
      // of the Speed control, matching how the server-side stretch behaves.
      const speedInducedSemitones = 12 * Math.log2(speedRef.current);
      source.detune.value = (pitchRef.current - speedInducedSemitones) * 100;
      source.connect(ctx.destination);
      source.onended = () => setIsPlaying(false);
      source.start(0, Math.min(offsetSeconds, buffer.duration - 0.01));

      sourceRef.current = source;
      playStartCtxTimeRef.current = ctx.currentTime;
      playStartOffsetRef.current = offsetSeconds;
      setIsPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    },
    [getAudioContext, stopPlayback, tick]
  );

  // Live-update an already-playing source's rate/detune when Speed or Pitch
  // change mid-playback, instead of restarting it.
  useEffect(() => {
    if (sourceRef.current) {
      sourceRef.current.playbackRate.value = speed;
      const speedInducedSemitones = 12 * Math.log2(speed);
      sourceRef.current.detune.value = (pitch - speedInducedSemitones) * 100;
    }
  }, [speed, pitch]);

  useEffect(() => {
    let cancelled = false;
    stopPlayback();
    bufferRef.current = null;
    setPeaks([]);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);

    if (!file) return;

    setIsDecoding(true);
    (async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const ctx = getAudioContext();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        if (cancelled) return;
        bufferRef.current = audioBuffer;
        setDuration(audioBuffer.duration);
        setPeaks(computePeaks(audioBuffer, PEAK_BUCKETS));
      } catch {
        // Unsupported/corrupt for client-side decode -- waveform preview
        // just stays empty; the server-side mastering path is unaffected.
      } finally {
        if (!cancelled) setIsDecoding(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, getAudioContext, stopPlayback]);

  useEffect(() => {
    return () => {
      stopPlayback();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [stopPlayback]);

  const handlePlayPause = () => {
    if (!bufferRef.current) return;
    if (isPlaying) {
      stopPlayback();
      setIsPlaying(false);
    } else {
      playFrom(currentTime >= bufferRef.current.duration - 0.02 ? 0 : currentTime);
    }
  };

  const handleRewind = () => {
    stopPlayback();
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const handleSkipForward = () => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const next = Math.min(buffer.duration, currentTime + 5);
    if (isPlaying) playFrom(next);
    else setCurrentTime(next);
  };

  const handleApply = () => {
    if (!bufferRef.current) return;
    playFrom(0);
  };

  const handleUndo = () => {
    onSpeedChange(1.0);
    onPitchChange(0);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const target = Math.min(buffer.duration, Math.max(0, pct * buffer.duration));
    if (isPlaying) playFrom(target);
    else setCurrentTime(target);
  };

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm transition ${
              enabled ? "bg-accent/20 shadow-[0_0_10px_rgba(124,92,255,0.5)]" : "bg-white/5 grayscale opacity-60"
            }`}
          >
            ⏱️
          </span>
          <h3 className="text-base font-bold leading-none text-white">Audio Stretch</h3>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          title={enabled ? "끄기" : "켜기"}
          className="flex h-7 w-7 shrink-0 items-center justify-center text-xl leading-none text-zinc-500 transition hover:text-zinc-300"
        >
          ×
        </button>
      </div>

      <div className={enabled ? "" : "pointer-events-none opacity-40"}>
        {!file ? (
          <p className="py-6 text-center text-xs text-zinc-600">
            먼저 음원 파일을 업로드하면 파형이 표시됩니다.
          </p>
        ) : (
          <>
            <div
              onClick={handleSeek}
              className="relative h-20 cursor-pointer overflow-hidden rounded-lg bg-black/30"
            >
              {isDecoding ? (
                <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
                  파형 분석 중...
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
                            background: played
                              ? "linear-gradient(180deg, #22d3ee, #8b5cf6)"
                              : "linear-gradient(180deg, #3d3d56, #2a2a3d)",
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
            <div className="mt-1.5 flex justify-between text-[10px] text-zinc-600">
              <span>{fmtTime(currentTime)}</span>
              <span>{fmtTime(duration)}</span>
            </div>

            <div className="mt-4 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={handleRewind}
                className="text-lg text-zinc-400 transition hover:text-accent-soft"
                aria-label="처음으로"
              >
                ⏮
              </button>
              <button
                type="button"
                onClick={handlePlayPause}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-glow text-lg text-black shadow-glow"
                aria-label={isPlaying ? "일시정지" : "재생"}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>
              <button
                type="button"
                onClick={handleSkipForward}
                className="text-lg text-zinc-400 transition hover:text-accent-soft"
                aria-label="5초 앞으로"
              >
                ⏭
              </button>
            </div>
          </>
        )}

        <div className="mt-5 flex items-center justify-around gap-4">
          <Stepper
            label="SPEED"
            display={`${speed.toFixed(2)}x`}
            onDecrement={() =>
              onSpeedChange((prev) => Math.max(SPEED_MIN, parseFloat((prev - SPEED_STEP).toFixed(2))))
            }
            onIncrement={() =>
              onSpeedChange((prev) => Math.min(SPEED_MAX, parseFloat((prev + SPEED_STEP).toFixed(2))))
            }
            decLabel="−"
            incLabel="+"
          />
          <Stepper
            label="PITCH"
            display={`${pitch > 0 ? "+" : ""}${pitch.toFixed(2)} st`}
            onDecrement={() => onPitchChange((prev) => Math.max(PITCH_MIN, prev - 1))}
            onIncrement={() => onPitchChange((prev) => Math.min(PITCH_MAX, prev + 1))}
            decLabel="♭"
            incLabel="♯"
          />
        </div>

        <p className="mt-3 text-center text-[11px] text-zinc-600">
          속도와 피치는 서로 독립적으로 조절됩니다. 위 재생은 빠른 미리듣기용(브라우저 리샘플링)이며,
          실제 마스터링 결과물은 서버에서 고품질 알고리즘으로 처리됩니다.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleUndo}
            className="rounded-xl border border-surface-border bg-white/[0.03] py-2.5 text-xs font-semibold text-zinc-400 transition hover:border-accent/40 hover:text-accent-soft"
          >
            되돌리기
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!file}
            className="rounded-xl bg-gradient-to-r from-accent to-accent-glow py-2.5 text-xs font-bold text-black shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({
  label,
  display,
  onDecrement,
  onIncrement,
  decLabel,
  incLabel,
}: {
  label: string;
  display: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decLabel: string;
  incLabel: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-2 rounded-full border border-surface-border bg-black/20 px-2 py-1.5">
        <button
          type="button"
          onClick={onDecrement}
          className="flex h-6 w-6 items-center justify-center rounded-full text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent-soft"
        >
          {decLabel}
        </button>
        <span className="min-w-[64px] text-center font-mono text-sm font-semibold text-zinc-100">{display}</span>
        <button
          type="button"
          onClick={onIncrement}
          className="flex h-6 w-6 items-center justify-center rounded-full text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent-soft"
        >
          {incLabel}
        </button>
      </div>
      <span className="text-[10px] tracking-wider text-zinc-600">{label}</span>
    </div>
  );
}
