"use client";

import { useEffect, useRef, useState } from "react";
import FileDropzone from "@/components/FileDropzone";
import PromptInput from "@/components/PromptInput";
import EQKnobs from "@/components/EQKnobs";
import MasterSettings from "@/components/MasterSettings";
import ReverbPanel from "@/components/ReverbPanel";
import StretchPanel from "@/components/StretchPanel";
import { masterTrack, downloadBlob } from "@/lib/api";

type Status = "idle" | "processing" | "done" | "error";
type CompareMode = "before" | "after";

const PROGRESS_ESTIMATE_MS = 7000;

function stageMessageForProgress(pct: number): string {
  if (pct >= 100) return "마스터링 완료! 고해상도 WAV 자동 다운로드 중";
  if (pct >= 76) return "4단계: 최종 어댑티브 LUFS 매칭 및 True-Peak 안전 리미팅 렌더링 중...";
  if (pct >= 51) return "3단계: Suno 특유의 초고역 화이트 노이즈 및 고음 보컬 쇳소리(디에싱) 정밀 억제 중...";
  if (pct >= 26) return "2단계: 스마트 트랜지언트 셰이퍼 가동 및 드럼 어택 복원 중...";
  return "1단계: 오디오 대역 및 프롬프트 하이브리드 분석 중...";
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [bass, setBass] = useState(0);
  const [vocal, setVocal] = useState(0);
  const [clarity, setClarity] = useState(0);
  const [targetLufs, setTargetLufs] = useState(-9);
  const [antiAiIntensity, setAntiAiIntensity] = useState(50);

  const [reverbEnabled, setReverbEnabled] = useState(false);
  const [reverbMix, setReverbMix] = useState(50);
  const [reverbSize, setReverbSize] = useState(25);
  const [reverbTone, setReverbTone] = useState(90);

  const [stretchEnabled, setStretchEnabled] = useState(false);
  const [stretchSpeed, setStretchSpeed] = useState(1.0);
  const [stretchPitch, setStretchPitch] = useState(0);

  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [report, setReport] = useState<Record<string, unknown> | null>(null);

  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [masteredUrl, setMasteredUrl] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<CompareMode>("after");
  const audioRef = useRef<HTMLAudioElement>(null);
  const urlsRef = useRef<{ before: string | null; after: string | null }>({
    before: null,
    after: null,
  });

  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Revoke any Before/After object URLs on unmount, and stop any running
  // progress-bar timer.
  useEffect(() => {
    return () => {
      if (urlsRef.current.before) URL.revokeObjectURL(urlsRef.current.before);
      if (urlsRef.current.after) URL.revokeObjectURL(urlsRef.current.after);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  // Load the freshly mastered track into the player as soon as it's ready.
  useEffect(() => {
    if (audioRef.current && masteredUrl) {
      audioRef.current.src = masteredUrl;
      audioRef.current.currentTime = 0;
    }
  }, [masteredUrl]);

  const handleToggleCompare = () => {
    const audio = audioRef.current;
    if (!audio || !originalUrl || !masteredUrl) return;
    const nextMode: CompareMode = compareMode === "after" ? "before" : "after";
    const nextUrl = nextMode === "after" ? masteredUrl : originalUrl;
    const wasPlaying = !audio.paused;
    const t = audio.currentTime;
    audio.src = nextUrl;
    audio.currentTime = t;
    if (wasPlaying) audio.play().catch(() => {});
    setCompareMode(nextMode);
  };

  const handleSliderChange = (key: "bass" | "vocal" | "clarity", value: number) => {
    if (key === "bass") setBass(value);
    if (key === "vocal") setVocal(value);
    if (key === "clarity") setClarity(value);
  };

  const handleMaster = async () => {
    if (!file) {
      alert("먼저 음원 파일을 업로드해주세요.");
      return;
    }
    setStatus("processing");
    setErrorMsg("");
    setReport(null);
    setProgress(0);
    setProgressMsg(stageMessageForProgress(0));

    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    const startedAt = Date.now();
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // Ease toward 99% so the bar never claims "done" before the response
      // actually arrives; the real jump to 100% happens on success below.
      const eased = 99 * (1 - Math.exp(-elapsed / PROGRESS_ESTIMATE_MS));
      const next = Math.min(99, eased);
      setProgress((prev) => (next > prev ? next : prev));
      setProgressMsg(stageMessageForProgress(next));
    }, 150);

    try {
      const result = await masterTrack(file, {
        prompt,
        bass,
        vocal,
        clarity,
        targetLufs,
        antiAiIntensity,
        reverbMix: reverbEnabled ? reverbMix : 0,
        reverbSize,
        reverbTone,
        stretchSpeed: stretchEnabled ? stretchSpeed : 1.0,
        stretchPitch: stretchEnabled ? stretchPitch : 0,
      });

      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setProgress(100);
      setProgressMsg(stageMessageForProgress(100));

      downloadBlob(result.blob, result.filename);

      if (urlsRef.current.before) URL.revokeObjectURL(urlsRef.current.before);
      if (urlsRef.current.after) URL.revokeObjectURL(urlsRef.current.after);
      const beforeUrl = URL.createObjectURL(file);
      const afterUrl = URL.createObjectURL(result.blob);
      urlsRef.current = { before: beforeUrl, after: afterUrl };
      setOriginalUrl(beforeUrl);
      setMasteredUrl(afterUrl);
      setCompareMode("after");

      setReport(result.report);
      // Let the 100% state render briefly before switching to the done view.
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStatus("done");
    } catch (err) {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setProgress(0);
      setErrorMsg(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      setStatus("error");
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <header className="mb-10 flex flex-col items-center text-center">
        <div className="mb-4 flex items-center gap-2 rounded-full border border-surface-border bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-glow shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          Pick Me · Mastering Studio
        </div>
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-glow text-3xl shadow-glow">
          🎚️
        </div>
        <h1 className="bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">
          Suno AI 하이브리드 어댑티브 마스터링
        </h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-500">
          Dynamic EQ · 스마트 트랜지언트 셰이퍼 · Anti-AI 초미세 지터링/디더링 ·
          True Peak -1.0 dBTP 리미터
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <FileDropzone file={file} onFileSelect={setFile} />
          <PromptInput value={prompt} onChange={setPrompt} />
          <EQKnobs bass={bass} vocal={vocal} clarity={clarity} onChange={handleSliderChange} />
          <ReverbPanel
            enabled={reverbEnabled}
            mix={reverbMix}
            size={reverbSize}
            tone={reverbTone}
            onToggle={setReverbEnabled}
            onMixChange={setReverbMix}
            onSizeChange={setReverbSize}
            onToneChange={setReverbTone}
          />
          <StretchPanel
            file={file}
            enabled={stretchEnabled}
            speed={stretchSpeed}
            pitch={stretchPitch}
            onToggle={setStretchEnabled}
            onSpeedChange={setStretchSpeed}
            onPitchChange={setStretchPitch}
          />
        </div>

        <div className="space-y-5 lg:col-span-2">
          <MasterSettings
            targetLufs={targetLufs}
            antiAiIntensity={antiAiIntensity}
            onLufsChange={setTargetLufs}
            onAntiAiChange={setAntiAiIntensity}
          />

          <button
            onClick={handleMaster}
            disabled={status === "processing"}
            className="w-full rounded-2xl bg-gradient-to-r from-accent to-accent-glow px-6 py-4 text-sm font-bold text-black shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "processing" ? "마스터링 처리 중..." : "🎛️ 마스터링 시작 & 자동 다운로드"}
          </button>

          {status === "processing" && (
            <div className="rounded-2xl border border-surface-border bg-surface-card p-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-zinc-200">⚙️ 마스터링 진행 중</span>
                <span className="rounded-md bg-black/30 px-2 py-0.5 font-mono text-xs text-accent-soft">
                  {Math.round(progress)}%
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent-glow transition-all duration-150 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-zinc-500">{progressMsg}</p>
            </div>
          )}

          {status === "done" && originalUrl && masteredUrl && (
            <div className="rounded-2xl border border-surface-border bg-surface-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-200">🎧 Before / After 비교 청취</h3>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    compareMode === "after"
                      ? "bg-accent/20 text-accent-soft"
                      : "bg-zinc-700/40 text-zinc-400"
                  }`}
                >
                  {compareMode === "after" ? "AFTER · 마스터링본" : "BEFORE · 원본"}
                </span>
              </div>
              <audio ref={audioRef} controls className="w-full" />
              <button
                type="button"
                onClick={handleToggleCompare}
                className="w-full rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-semibold text-accent-soft transition hover:bg-accent/20"
              >
                🔁 {compareMode === "after" ? "원본(Before) 들어보기" : "마스터링본(After) 들어보기"}
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {errorMsg}
            </div>
          )}

          {status === "done" && report && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
              <p className="mb-1 font-semibold">✓ 마스터링 완료, 다운로드됨</p>
              <ul className="space-y-0.5 text-emerald-400/80">
                {Object.entries(report).map(([k, v]) => (
                  <li key={k}>
                    {k}: {String(v)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <footer className="mt-12 text-center text-[11px] text-zinc-700">
        FastAPI + pedalboard/scipy DSP engine · Next.js + Tailwind dashboard
      </footer>
    </main>
  );
}
