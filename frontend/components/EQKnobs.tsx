"use client";

import Knob from "./Knob";

interface Props {
  bass: number;
  vocal: number;
  clarity: number;
  onChange: (key: "bass" | "vocal" | "clarity", value: number) => void;
}

export default function EQKnobs({ bass, vocal, clarity, onChange }: Props) {
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)} dB`;
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-zinc-200">톤 밸런스 (Low / Mid / High)</h3>
      <div className="flex justify-around gap-2">
        <Knob
          label="🔊 Low"
          value={bass}
          min={-12}
          max={12}
          step={0.05}
          defaultValue={0}
          displayValue={fmt}
          onChange={(v) => onChange("bass", v)}
          size={72}
          color="#22d3ee"
          glowColor="#67e8f9"
        />
        <Knob
          label="🎤 Mid"
          value={vocal}
          min={-12}
          max={12}
          step={0.05}
          defaultValue={0}
          displayValue={fmt}
          onChange={(v) => onChange("vocal", v)}
          size={72}
          color="#8b5cf6"
          glowColor="#a78bfa"
        />
        <Knob
          label="✨ High"
          value={clarity}
          min={-12}
          max={12}
          step={0.05}
          defaultValue={0}
          displayValue={fmt}
          onChange={(v) => onChange("clarity", v)}
          size={72}
          color="#ec4899"
          glowColor="#f472b6"
        />
      </div>
      <p className="mt-3 text-center text-[11px] text-zinc-600">
        더블클릭하면 0dB로 초기화됩니다. 드래그(위/아래)로 조절하세요.
      </p>
    </div>
  );
}
