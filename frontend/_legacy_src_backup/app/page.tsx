"use client";

import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import {
  UploadCloud,
  FileAudio,
  Music4,
  Wand2,
  Loader2,
  ShieldCheck,
  Gauge,
  Mic2,
  Waves,
  Sparkles,
  X,
  AlertCircle,
} from "lucide-react";

const API_URL = "http://localhost:8000/api/master";

const LUFS_OPTIONS = [
  { value: "-14", label: "-14 LUFS · Spotify / YouTube 스트리밍 표준" },
  { value: "-11", label: "-11 LUFS · SoundCloud 권장" },
  { value: "-9", label: "-9 LUFS · 클럽 / EDM 고음압" },
  { value: "-16", label: "-16 LUFS · Apple Music / 팟캐스트" },
];

const ANTI_AI_OPTIONS = [
  { value: "0", label: "미적용 (Off)" },
  { value: "35", label: "약하게 (Low)" },
  { value: "65", label: "보통 (Medium)" },
  { value: "100", label: "강력하게 (Maximum)" },
];

interface SliderRowProps {
  icon: ReactNode;
  label: string;
  value: number;
  onChange: (value: number) => void;
  accentClass: string;
}

function SliderRow({ icon, label, value, onChange, accentClass }: SliderRowProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-gray-300">
          {icon}
          {label}
        </span>
        <span
          className={`font-mono text-xs px-2 py-0.5 rounded-md bg-white/5 ${accentClass}`}
        >
          {value}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

export default function MasteringDashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [bass, setBass] = useState(50);
  const [vocal, setVocal] = useState(50);
  const [clarity, setClarity] = useState(50);
  const [targetLufs, setTargetLufs] = useState("-14");
  const [antiAiStrength, setAntiAiStrength] = useState("65");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isValidAudioFile = (f: File) => /\.(wav|mp3)$/i.test(f.name);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleFileSelect = (selected: File | null) => {
    setError(null);
    setSuccessMsg(null);
    if (!selected) return;
    if (!isValidAudioFile(selected)) {
      setError("WAV 또는 MP3 파일만 업로드할 수 있습니다.");
      return;
    }
    setFile(selected);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0] ?? null;
    handleFileSelect(dropped);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    handleFileSelect(selected);
  };

  const handleMaster = async () => {
    if (!file) {
      setError("먼저 마스터링할 오디오 파일을 업로드해 주세요.");
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("user_bass", String(bass));
      formData.append("user_vocal", String(vocal));
      formData.append("user_clarity", String(clarity));
      formData.append("target_lufs", targetLufs);
      formData.append("anti_ai_strength", antiAiStrength);
      formData.append("prompt", prompt);

      const response = await fetch(API_URL, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const detailText = await response.text();
        throw new Error(detailText || `서버 오류가 발생했습니다 (${response.status})`);
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const baseName = file.name.replace(/\.(wav|mp3)$/i, "");
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `mastered_${baseName}.wav`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);

      const finalLufs = response.headers.get("X-Final-LUFS");
      const finalPeak = response.headers.get("X-Final-True-Peak-DBTP");
      const details = [
        finalLufs ? `최종 LUFS ${finalLufs}` : null,
        finalPeak ? `True Peak ${finalPeak} dBTP` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      setSuccessMsg(`마스터링 완료, 다운로드를 시작합니다. ${details}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "마스터링 처리 중 알 수 없는 오류가 발생했습니다."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="min-h-screen bg-background bg-grid-pattern bg-[size:32px_32px] relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -left-40 w-96 h-96 bg-accent/20 rounded-full blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-96 h-96 bg-accent-cyan/20 rounded-full blur-[120px]" />

      <div className="relative max-w-5xl mx-auto px-6 py-12">
        <header className="flex items-center gap-3 mb-10">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center shadow-glow">
            <Waves className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">
              Suno Adaptive Mastering
            </h1>
            <p className="text-xs text-gray-400">
              하이브리드 어댑티브 마스터링 · Anti-AI 우회 엔진
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* 좌측: 업로드 + 프롬프트 */}
          <section className="lg:col-span-3 space-y-6">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-all backdrop-blur-xl bg-surface/60 ${
                isDragging
                  ? "border-accent bg-accent/10 shadow-glow"
                  : "border-border hover:border-accent/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".wav,.mp3,audio/wav,audio/mpeg"
                className="hidden"
                onChange={handleInputChange}
              />
              {!file ? (
                <div className="flex flex-col items-center gap-3">
                  <UploadCloud className="w-10 h-10 text-accent" />
                  <p className="text-gray-200 font-medium">
                    WAV / MP3 파일을 드래그하거나 클릭해서 업로드
                  </p>
                  <p className="text-xs text-gray-500">
                    Suno에서 생성한 원본 음원을 그대로 업로드하세요.
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4 bg-white/5 rounded-xl px-4 py-3 text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileAudio className="w-8 h-8 text-accent-cyan shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-gray-100 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">{formatBytes(file.size)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-surface/60 backdrop-blur-xl p-6 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-200">
                <Sparkles className="w-4 h-4 text-accent-pink" />
                Suno 스타일 프롬프트
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="예: dark trap, heavy 808 bass, female vocal, bright hi-hats..."
                rows={4}
                className="w-full resize-none rounded-xl bg-black/30 border border-border px-4 py-3 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <p className="text-xs text-gray-500">
                프롬프트에 포함된 키워드(bass, vocal, bright 등)를 분석해 부족한 주파수 대역을 자동 보정합니다.
              </p>
            </div>
          </section>

          {/* 우측: 컨트롤 패널 */}
          <section className="lg:col-span-2 space-y-6">
            <div className="rounded-2xl border border-border bg-surface/60 backdrop-blur-xl p-6 space-y-5">
              <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                <Gauge className="w-4 h-4 text-accent" />
                톤 밸런스 컨트롤
              </h2>
              <SliderRow
                icon={<Waves className="w-4 h-4 text-accent" />}
                label="저음 타격감 (Bass)"
                value={bass}
                onChange={setBass}
                accentClass="text-accent"
              />
              <SliderRow
                icon={<Mic2 className="w-4 h-4 text-accent-cyan" />}
                label="보컬 존재감 (Vocal)"
                value={vocal}
                onChange={setVocal}
                accentClass="text-accent-cyan"
              />
              <SliderRow
                icon={<Sparkles className="w-4 h-4 text-accent-pink" />}
                label="선명도 (Clarity)"
                value={clarity}
                onChange={setClarity}
                accentClass="text-accent-pink"
              />
            </div>

            <div className="rounded-2xl border border-border bg-surface/60 backdrop-blur-xl p-6 space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-200 mb-2">
                  <Music4 className="w-4 h-4 text-accent" />
                  목표 음압 (Target LUFS)
                </label>
                <select
                  value={targetLufs}
                  onChange={(e) => setTargetLufs(e.target.value)}
                  className="w-full rounded-xl bg-black/30 border border-border px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  {LUFS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-surface">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-200 mb-2">
                  <ShieldCheck className="w-4 h-4 text-accent-cyan" />
                  Anti-AI 우회 강도
                </label>
                <select
                  value={antiAiStrength}
                  onChange={(e) => setAntiAiStrength(e.target.value)}
                  className="w-full rounded-xl bg-black/30 border border-border px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  {ANTI_AI_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-surface">
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-2">
                  초미세 시간축 지터링 + 디더링으로 AI 지문 검출을 무력화합니다.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleMaster}
              disabled={isProcessing}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-accent to-accent-cyan py-4 font-semibold text-white shadow-glow hover:opacity-90 active:scale-[0.99] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  마스터링 처리 중...
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5" />
                  마스터링 시작
                </>
              )}
            </button>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            {successMsg && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                {successMsg}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
