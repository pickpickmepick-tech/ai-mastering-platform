"use client";

import { useCallback, useRef } from "react";

interface Props {
  enabled: boolean;
  mix: number;
  size: number;
  tone: number;
  onToggle: (v: boolean) => void;
  onMixChange: (v: number) => void;
  onSizeChange: (v: number) => void;
  onToneChange: (v: number) => void;
}

function MixTrack({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      onChange(Math.round(Math.min(100, Math.max(0, pct))));
    },
    [onChange]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    updateFromClientX(e.clientX);
    const handleMove = (ev: PointerEvent) => updateFromClientX(ev.clientX);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-xs text-zinc-500">{Math.round(value)}%</span>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        className={`relative h-9 flex-1 touch-none ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-surface-border" />
        <div
          className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-accent/50 bg-surface-card px-3 py-1.5 text-xs font-semibold text-accent-soft shadow-glow"
          style={{ left: `${value}%` }}
        >
          Mix <span className="text-[9px]">◆</span>
        </div>
      </div>
    </div>
  );
}

function MiniDotSlider({
  label,
  value,
  color,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const HEIGHT = 44;

  const updateFromClientY = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((rect.bottom - clientY) / rect.height) * 100;
      onChange(Math.round(Math.min(100, Math.max(0, pct))));
    },
    [onChange]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    updateFromClientY(e.clientY);
    const handleMove = (ev: PointerEvent) => updateFromClientY(ev.clientY);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        className={`relative w-px touch-none ${disabled ? "cursor-not-allowed" : "cursor-ns-resize"}`}
        style={{ height: HEIGHT, backgroundColor: "#242534" }}
      >
        <div
          className="absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full"
          style={{ bottom: `${value}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
      <span className="font-mono text-xs font-semibold" style={{ color }}>
        {Math.round(value)}%
      </span>
    </div>
  );
}

export default function ReverbPanel({
  enabled,
  mix,
  size,
  tone,
  onToggle,
  onMixChange,
  onSizeChange,
  onToneChange,
}: Props) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm transition ${
              enabled ? "bg-accent/20 shadow-[0_0_10px_rgba(124,92,255,0.5)]" : "bg-white/5 grayscale opacity-60"
            }`}
          >
            🌊
          </span>
          <h3 className="text-base font-bold leading-none text-white">Studio Reverb</h3>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          aria-pressed={enabled}
          title={enabled ? "끄기" : "켜기"}
          className="flex items-center gap-2"
        >
          <span className={`text-[11px] font-semibold ${enabled ? "text-accent-soft" : "text-zinc-600"}`}>
            {enabled ? "ON" : "OFF"}
          </span>
          <span
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              enabled ? "bg-accent shadow-glow" : "bg-white/10"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      <div className={enabled ? "" : "pointer-events-none opacity-40"}>
        <MixTrack value={mix} onChange={onMixChange} disabled={!enabled} />
        <div className="mt-7 flex justify-center gap-12">
          <MiniDotSlider label="Size" value={size} color="#ec4899" onChange={onSizeChange} disabled={!enabled} />
          <MiniDotSlider label="Tone" value={tone} color="#8b5cf6" onChange={onToneChange} disabled={!enabled} />
        </div>
      </div>
    </div>
  );
}
