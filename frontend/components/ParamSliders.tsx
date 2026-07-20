"use client";

interface Props {
  bass: number;
  vocal: number;
  clarity: number;
  onChange: (key: "bass" | "vocal" | "clarity", value: number) => void;
}

function Slider({
  label,
  icon,
  value,
  min = -12,
  max = 12,
  step = 0.5,
  unit = "dB",
  onChange,
}: {
  label: string;
  icon: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium text-zinc-200">
          <span>{icon}</span> {label}
        </span>
        <span className="rounded-md bg-black/30 px-2 py-0.5 font-mono text-xs text-accent-soft">
          {value > 0 ? "+" : ""}
          {value.toFixed(1)} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export default function ParamSliders({ bass, vocal, clarity, onChange }: Props) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-zinc-200">톤 밸런스</h3>
      <div className="space-y-5">
        <Slider label="Bass" icon="🔊" value={bass} onChange={(v) => onChange("bass", v)} />
        <Slider label="Vocal" icon="🎤" value={vocal} onChange={(v) => onChange("vocal", v)} />
        <Slider label="Clarity" icon="✨" value={clarity} onChange={(v) => onChange("clarity", v)} />
      </div>
    </div>
  );
}
