"use client";

import Knob from "./Knob";
import ToggleSwitch from "./ToggleSwitch";

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
  const pct = (v: number) => `${Math.round(v)}%`;
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          🌊 Studio Reverb
        </h3>
        <ToggleSwitch checked={enabled} onChange={onToggle} />
      </div>
      <div className={`flex justify-around gap-2 ${enabled ? "" : "pointer-events-none opacity-40"}`}>
        <Knob label="Mix" value={mix} min={0} max={100} step={1} defaultValue={50} displayValue={pct} onChange={onMixChange} disabled={!enabled} />
        <Knob label="Size" value={size} min={0} max={100} step={1} defaultValue={25} displayValue={pct} onChange={onSizeChange} disabled={!enabled} />
        <Knob label="Tone" value={tone} min={0} max={100} step={1} defaultValue={90} displayValue={pct} onChange={onToneChange} disabled={!enabled} />
      </div>
    </div>
  );
}
