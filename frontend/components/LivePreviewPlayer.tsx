"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";

interface Props {
  file: File | null;
  // EQ, in dB, -12..12 (already resolved: AI baseline + user fine-tune)
  bass: number;
  vocal: number;
  clarity: number;
  // Reverb, already resolved to 0 when the Reverb toggle is off
  reverbMix: number; // 0..100
  reverbSize: number; // 0..100
  reverbTone: number; // 0..100
  // Anti-AI Chopping notch depth, 0..100
  choppingIntensity: number;
  // Speed/Pitch, already resolved to 1.0/0 when the Stretch toggle is off
  stretchSpeed: number; // 0.5..2.0
  stretchPitch: number; // -12..12
}

const PEAK_BUCKETS = 64;

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

/**
 * A single always-on real-time preview: every knob in the app (EQ, Reverb,
 * Chopping, Speed/Pitch) is wired to a live Tone.js node parameter here, so
 * dragging a knob while this is playing changes what you hear immediately --
 * no render/download round-trip. This is a fast approximation for audition
 * only; the actual download still goes through the exact server-side
 * pedalboard/scipy DSP chain for final quality.
 */
export default function LivePreviewPlayer({
  file,
  bass,
  vocal,
  clarity,
  reverbMix,
  reverbSize,
  reverbTone,
  choppingIntensity,
  stretchSpeed,
  stretchPitch,
}: Props) {
  const decodeCtxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);

  const grainPlayerRef = useRef<Tone.GrainPlayer | null>(null);
  const pitchShiftRef = useRef<Tone.PitchShift | null>(null);
  const chop1Ref = useRef<Tone.Filter | null>(null);
  const chop2Ref = useRef<Tone.Filter | null>(null);
  const eqLowRef = useRef<Tone.Filter | null>(null);
  const eqMidRef = useRef<Tone.Filter | null>(null);
  const eqHighRef = useRef<Tone.Filter | null>(null);
  const reverbRef = useRef<Tone.Freeverb | null>(null);

  const playStartToneTimeRef = useRef(0);
  const playStartOffsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef(stretchSpeed);
  const isPlayingRef = useRef(false);

  const [isDecoding, setIsDecoding] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const getDecodeContext = useCallback((): AudioContext => {
    if (!decodeCtxRef.current) {
      const Ctor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      decodeCtxRef.current = new Ctor();
    }
    return decodeCtxRef.current;
  }, []);

  const disposeEngine = useCallback(() => {
    grainPlayerRef.current?.dispose();
    grainPlayerRef.current = null;
    pitchShiftRef.current?.dispose();
    pitchShiftRef.current = null;
    chop1Ref.current?.dispose();
    chop1Ref.current = null;
    chop2Ref.current?.dispose();
    chop2Ref.current = null;
    eqLowRef.current?.dispose();
    eqLowRef.current = null;
    eqMidRef.current?.dispose();
    eqMidRef.current = null;
    eqHighRef.current?.dispose();
    eqHighRef.current = null;
    reverbRef.current?.dispose();
    reverbRef.current = null;
    setReady(false);
  }, []);

  const stopPlayback = useCallback(() => {
    if (grainPlayerRef.current && grainPlayerRef.current.state === "started") {
      grainPlayerRef.current.stop();
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const elapsedReal = Tone.now() - playStartToneTimeRef.current;
    const elapsedTrack = playStartOffsetRef.current + elapsedReal * speedRef.current;
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
    async (offsetSeconds: number) => {
      const player = grainPlayerRef.current;
      const buffer = bufferRef.current;
      if (!player || !buffer) return;
      await Tone.start();
      stopPlayback();

      const startOffset = Math.min(offsetSeconds, Math.max(0, buffer.duration - 0.01));
      player.start(Tone.now(), startOffset);

      playStartToneTimeRef.current = Tone.now();
      playStartOffsetRef.current = startOffset;
      setIsPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    },
    [stopPlayback, tick]
  );

  // Build the full live chain once per file:
  // GrainPlayer(speed) -> PitchShift(pitch) -> Chopping notches(7.2k/14k)
  // -> EQ(90Hz shelf / 1kHz peak / 8kHz shelf) -> Freeverb -> Destination
  useEffect(() => {
    let cancelled = false;
    stopPlayback();
    disposeEngine();
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
        const decodeCtx = getDecodeContext();
        const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
        if (cancelled) return;
        bufferRef.current = audioBuffer;
        setDuration(audioBuffer.duration);
        setPeaks(computePeaks(audioBuffer, PEAK_BUCKETS));

        const reverb = new Tone.Freeverb({ roomSize: reverbSize / 100, dampening: 500 + (reverbTone / 100) * 14500 });
        reverb.wet.value = reverbMix / 100;
        reverb.toDestination();

        const eqHigh = new Tone.Filter({ type: "highshelf", frequency: 8000, gain: clarity }).connect(reverb);
        const eqMid = new Tone.Filter({ type: "peaking", frequency: 1000, Q: 0.7, gain: vocal }).connect(eqHigh);
        const eqLow = new Tone.Filter({ type: "lowshelf", frequency: 90, gain: bass }).connect(eqMid);

        const chopGain = choppingIntensity / 100;
        const chop2 = new Tone.Filter({ type: "peaking", frequency: 14000, Q: 1.5, gain: -chopGain * 8 }).connect(eqLow);
        const chop1 = new Tone.Filter({ type: "peaking", frequency: 7200, Q: 2.5, gain: -chopGain * 10 }).connect(chop2);

        const pitchShift = new Tone.PitchShift({ pitch: stretchPitch, windowSize: 0.1 }).connect(chop1);

        const player = new Tone.GrainPlayer({
          url: audioBuffer,
          grainSize: 0.2,
          overlap: 0.1,
          playbackRate: stretchSpeed,
          detune: 0,
        }).connect(pitchShift);

        if (cancelled) {
          player.dispose();
          pitchShift.dispose();
          chop1.dispose();
          chop2.dispose();
          eqLow.dispose();
          eqMid.dispose();
          eqHigh.dispose();
          reverb.dispose();
          return;
        }
        grainPlayerRef.current = player;
        pitchShiftRef.current = pitchShift;
        chop1Ref.current = chop1;
        chop2Ref.current = chop2;
        eqLowRef.current = eqLow;
        eqMidRef.current = eqMid;
        eqHighRef.current = eqHigh;
        reverbRef.current = reverb;
        speedRef.current = stretchSpeed;
        setReady(true);
      } catch {
        // Unsupported/corrupt for client-side decode -- live preview stays
        // unavailable; the server-side mastering path is unaffected.
      } finally {
        if (!cancelled) setIsDecoding(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Rebuilt only when the file changes -- every knob below is applied to
    // the already-built graph live via the effects that follow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, getDecodeContext, stopPlayback, disposeEngine]);

  useEffect(() => {
    return () => {
      stopPlayback();
      disposeEngine();
      decodeCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Live parameter updates: every knob below is a plain param write on
  // an already-connected, already-playing node -- no restart, no gap.

  useEffect(() => {
    if (eqLowRef.current) eqLowRef.current.gain.value = bass;
  }, [bass]);
  useEffect(() => {
    if (eqMidRef.current) eqMidRef.current.gain.value = vocal;
  }, [vocal]);
  useEffect(() => {
    if (eqHighRef.current) eqHighRef.current.gain.value = clarity;
  }, [clarity]);

  useEffect(() => {
    if (reverbRef.current) reverbRef.current.wet.value = reverbMix / 100;
  }, [reverbMix]);
  useEffect(() => {
    if (reverbRef.current) reverbRef.current.roomSize.value = reverbSize / 100;
  }, [reverbSize]);
  useEffect(() => {
    if (reverbRef.current) reverbRef.current.dampening = 500 + (reverbTone / 100) * 14500;
  }, [reverbTone]);

  useEffect(() => {
    const gain = choppingIntensity / 100;
    if (chop1Ref.current) chop1Ref.current.gain.value = -gain * 10;
    if (chop2Ref.current) chop2Ref.current.gain.value = -gain * 8;
  }, [choppingIntensity]);

  useEffect(() => {
    if (pitchShiftRef.current) pitchShiftRef.current.pitch = stretchPitch;
  }, [stretchPitch]);

  // Speed changes the actual playback rate, so re-anchor the position
  // tracker (see StretchPanel.tsx for the same pattern) so the waveform
  // cursor doesn't jump when Speed changes mid-playback.
  useEffect(() => {
    const player = grainPlayerRef.current;
    if (player && isPlayingRef.current) {
      const elapsedReal = Tone.now() - playStartToneTimeRef.current;
      const elapsedTrack = playStartOffsetRef.current + elapsedReal * speedRef.current;
      playStartOffsetRef.current = Math.min(elapsedTrack, bufferRef.current?.duration ?? elapsedTrack);
      playStartToneTimeRef.current = Tone.now();
    }
    speedRef.current = stretchSpeed;
    if (player) player.playbackRate = stretchSpeed;
  }, [stretchSpeed]);

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
    <div className="rounded-2xl border border-accent/40 bg-surface-card p-5 shadow-glow">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
          🎧 실시간 미리듣기
          {isPlaying && (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent-soft">
              노브 조작이 즉시 반영됩니다
            </span>
          )}
        </h3>
      </div>

      {!ready ? (
        <p className="py-6 text-center text-xs text-zinc-600">
          {isDecoding ? "파형 분석 및 실시간 엔진 준비 중..." : "음원을 업로드하면 실시간 미리듣기가 준비됩니다."}
        </p>
      ) : (
        <>
          <div
            onClick={handleSeek}
            className="relative h-16 cursor-pointer overflow-hidden rounded-lg bg-black/30"
          >
            <div className="flex h-full items-center gap-[3px] px-2 py-2">
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
              className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-glow text-xl text-black shadow-glow"
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
            브라우저 실시간 근사 프리뷰입니다. 실제 다운로드 파일은 서버의 고품질 DSP로 별도 렌더링됩니다.
          </p>
        </>
      )}
    </div>
  );
}
