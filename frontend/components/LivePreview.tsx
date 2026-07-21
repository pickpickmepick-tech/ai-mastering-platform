"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computePeaks, fmtTime } from "@/lib/waveform";
import { createPitchShifter, type PitchShifterNode } from "@/lib/pitchShifter";

interface Props {
  file: File | null;
  bassDb: number;
  vocalDb: number;
  clarityDb: number;
  reverbEnabled: boolean;
  reverbMix: number;
  reverbSize: number;
  reverbTone: number;
  stretchEnabled: boolean;
  stretchSpeed: number;
  stretchPitch: number;
}

const PEAK_BUCKETS = 72;

interface LiveParams {
  bassDb: number;
  vocalDb: number;
  clarityDb: number;
  reverbEnabled: boolean;
  reverbMix: number;
  reverbSize: number;
  reverbTone: number;
  stretchEnabled: boolean;
  stretchSpeed: number;
  stretchPitch: number;
}

function buildImpulseResponse(ctx: AudioContext, sizePct: number, tonePct: number): AudioBuffer {
  const decaySeconds = 0.4 + (Math.max(0, Math.min(100, sizePct)) / 100) * 2.6;
  const length = Math.max(1, Math.floor(ctx.sampleRate * decaySeconds));
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  // Higher "tone" -> slower decay curve exponent -> brighter/longer-sustaining tail.
  const decayExponent = 3.2 - (Math.max(0, Math.min(100, tonePct)) / 100) * 2.2;
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decayExponent);
    }
  }
  return impulse;
}

export default function LivePreview({
  file,
  bassDb,
  vocalDb,
  clarityDb,
  reverbEnabled,
  reverbMix,
  reverbSize,
  reverbTone,
  stretchEnabled,
  stretchSpeed,
  stretchPitch,
}: Props) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const pitchShifterRef = useRef<PitchShifterNode | null>(null);
  const lowShelfRef = useRef<BiquadFilterNode | null>(null);
  const midPeakRef = useRef<BiquadFilterNode | null>(null);
  const highShelfRef = useRef<BiquadFilterNode | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const wetGainRef = useRef<GainNode | null>(null);
  const convolverRef = useRef<ConvolverNode | null>(null);
  const reverbSizeToneRef = useRef<{ size: number; tone: number } | null>(null);

  const playStartCtxTimeRef = useRef(0);
  const playStartOffsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const paramsRef = useRef<LiveParams>({
    bassDb,
    vocalDb,
    clarityDb,
    reverbEnabled,
    reverbMix,
    reverbSize,
    reverbTone,
    stretchEnabled,
    stretchSpeed,
    stretchPitch,
  });
  paramsRef.current = {
    bassDb,
    vocalDb,
    clarityDb,
    reverbEnabled,
    reverbMix,
    reverbSize,
    reverbTone,
    stretchEnabled,
    stretchSpeed,
    stretchPitch,
  };

  const [isDecoding, setIsDecoding] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      const Ctor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctor();
    }
    return audioCtxRef.current;
  }, []);

  // Tone/reverb chain persists across plays -- only the one-shot source node
  // is recreated each time play() runs. Built lazily once an AudioContext
  // exists, so knob turns before the first Play press are cheap no-ops.
  const ensureChain = useCallback(
    (ctx: AudioContext) => {
      if (lowShelfRef.current) return;

      const pitchShifter = createPitchShifter(ctx, 2);
      const p0 = paramsRef.current;
      const speed0 = p0.stretchEnabled ? p0.stretchSpeed : 1.0;
      const pitch0 = p0.stretchEnabled ? p0.stretchPitch : 0;
      pitchShifter.setRatio(Math.pow(2, pitch0 / 12) / speed0);

      const lowShelf = ctx.createBiquadFilter();
      lowShelf.type = "lowshelf";
      lowShelf.frequency.value = 120;
      lowShelf.gain.value = paramsRef.current.bassDb;

      const midPeak = ctx.createBiquadFilter();
      midPeak.type = "peaking";
      midPeak.frequency.value = 2500;
      midPeak.Q.value = 0.9;
      midPeak.gain.value = paramsRef.current.vocalDb;

      const highShelf = ctx.createBiquadFilter();
      highShelf.type = "highshelf";
      highShelf.frequency.value = 8000;
      highShelf.gain.value = paramsRef.current.clarityDb;

      const dryGain = ctx.createGain();
      dryGain.gain.value = 1;

      const wetGain = ctx.createGain();
      wetGain.gain.value = paramsRef.current.reverbEnabled ? paramsRef.current.reverbMix / 100 : 0;

      const convolver = ctx.createConvolver();
      convolver.buffer = buildImpulseResponse(ctx, paramsRef.current.reverbSize, paramsRef.current.reverbTone);
      reverbSizeToneRef.current = { size: paramsRef.current.reverbSize, tone: paramsRef.current.reverbTone };

      pitchShifter.connect(lowShelf);
      lowShelf.connect(midPeak);
      midPeak.connect(highShelf);
      highShelf.connect(dryGain);
      dryGain.connect(ctx.destination);
      highShelf.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(ctx.destination);

      pitchShifterRef.current = pitchShifter;
      lowShelfRef.current = lowShelf;
      midPeakRef.current = midPeak;
      highShelfRef.current = highShelf;
      dryGainRef.current = dryGain;
      wetGainRef.current = wetGain;
      convolverRef.current = convolver;
    },
    []
  );

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
    const speed = paramsRef.current.stretchEnabled ? paramsRef.current.stretchSpeed : 1.0;
    const elapsedTrack = playStartOffsetRef.current + elapsedCtx * speed;
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
      ensureChain(ctx);
      if (ctx.state === "suspended") ctx.resume();
      stopPlayback();

      const p = paramsRef.current;
      const speed = p.stretchEnabled ? p.stretchSpeed : 1.0;
      const pitch = p.stretchEnabled ? p.stretchPitch : 0;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // Speed is purely `playbackRate` (tempo). Pitch is handled entirely by
      // the separate granular pitchShifter node, whose ratio is divided by
      // `speed` to cancel out playbackRate's own resample-induced pitch
      // shift -- so Speed and Pitch land on the output fully independently,
      // unlike detune (which is just multiplied into the same playbackRate
      // and can never be independent of it).
      source.playbackRate.value = speed;
      pitchShifterRef.current!.setRatio(Math.pow(2, pitch / 12) / speed);
      source.connect(pitchShifterRef.current!);
      source.onended = () => setIsPlaying(false);
      source.start(0, Math.min(offsetSeconds, buffer.duration - 0.01));

      sourceRef.current = source;
      playStartCtxTimeRef.current = ctx.currentTime;
      playStartOffsetRef.current = offsetSeconds;
      setIsPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    },
    [ensureChain, getAudioContext, stopPlayback, tick]
  );

  // Decode the uploaded file into a peak-meter + playable buffer.
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
        // Unsupported/corrupt for client-side decode -- preview just stays
        // empty; the server-side mastering path is unaffected.
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

  // Live tone-balance updates -- plain AudioParam writes, no restart needed.
  useEffect(() => {
    if (lowShelfRef.current) lowShelfRef.current.gain.value = bassDb;
  }, [bassDb]);
  useEffect(() => {
    if (midPeakRef.current) midPeakRef.current.gain.value = vocalDb;
  }, [vocalDb]);
  useEffect(() => {
    if (highShelfRef.current) highShelfRef.current.gain.value = clarityDb;
  }, [clarityDb]);
  useEffect(() => {
    if (wetGainRef.current) wetGainRef.current.gain.value = reverbEnabled ? reverbMix / 100 : 0;
  }, [reverbEnabled, reverbMix]);
  useEffect(() => {
    const ctx = audioCtxRef.current;
    const convolver = convolverRef.current;
    if (!ctx || !convolver) return;
    const prev = reverbSizeToneRef.current;
    if (prev && prev.size === reverbSize && prev.tone === reverbTone) return;
    convolver.buffer = buildImpulseResponse(ctx, reverbSize, reverbTone);
    reverbSizeToneRef.current = { size: reverbSize, tone: reverbTone };
  }, [reverbSize, reverbTone]);

  // Speed/Pitch: live-update an already-playing source; if paused, start
  // playback so the change is immediately audible instead of a silent number.
  useEffect(() => {
    const speed = stretchEnabled ? stretchSpeed : 1.0;
    const pitch = stretchEnabled ? stretchPitch : 0;
    if (sourceRef.current) {
      sourceRef.current.playbackRate.value = speed;
      pitchShifterRef.current?.setRatio(Math.pow(2, pitch / 12) / speed);
    } else if (bufferRef.current) {
      playFrom(currentTime >= bufferRef.current.duration - 0.02 ? 0 : currentTime);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stretchEnabled, stretchSpeed, stretchPitch]);

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

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const target = Math.min(buffer.duration, Math.max(0, pct * buffer.duration));
    if (isPlaying) playFrom(target);
    else setCurrentTime(target);
  };

  if (!file) return null;

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          🎧 라이브 미리듣기
        </h3>
        <span className="text-[10px] text-zinc-600">톤 밸런스 · 리버브 · 스트레치가 실시간으로 반영됩니다</span>
      </div>

      <div
        onClick={handleSeek}
        className="relative h-16 cursor-pointer overflow-hidden rounded-lg bg-black/30"
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

      <div className="mt-3 flex items-center justify-center gap-4">
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

      <p className="mt-3 text-center text-[11px] text-zinc-600">
        재생 중이거나 일시정지 상태에서 아래 설정을 바꾸면 바로 반영됩니다. 브라우저에서 근사치로
        들려주는 미리듣기이며, Anti-AI/트랜지언트/러프니스 매칭 등은 실제 마스터링(서버 처리) 후
        Before/After에서 확인할 수 있습니다.
      </p>
    </div>
  );
}
