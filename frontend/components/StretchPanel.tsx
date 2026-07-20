"use client";

import Knob from "./Knob";
import ToggleSwitch from "./ToggleSwitch";

interface Props {
  enabled: boolean;
  speed: number;
  pitch: number;
  onToggle: (v: boolean) => void;
  onSpeedChange: (v: number) => void;
  onPitchChange: (v: number) => void;
}

export default function StretchPanel({
  enabled,
  speed,
  pitch,
  onToggle,
  onSpeedChange,
  onPitchChange,
}: Props) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          ⏱️ Audio Stretch
        </h3>
        <ToggleSwitch checked={enabled} onChange={onToggle} />
      </div>
      <div className={`flex justify-around gap-2 ${enabled ? "" : "pointer-events-none opacity-40"}`}>
        <Knob
          label="Speed"
          value={speed}
          min={0.5}
          max={2.0}
          step={0.01}
          defaultValue={1.0}
          displayValue={(v) => `${v.toFixed(2)}x`}
          onChange={onSpeedChange}
          disabled={!enabled}
        />
        <Knob
          label="Pitch (Key)"
          value={pitch}
          min={-12}
          max={12}
          step={1}
          defaultValue={0}
          displayValue={(v) => `${v > 0 ? "+" : ""}${v} st`}
          onChange={onPitchChange}
          disabled={!enabled}
        />
      </div>
      <p className="mt-3 text-center text-[11px] text-zinc-600">
        속도(재생 길이)와 피치(음정/키)는 서로 독립적으로 조절됩니다. 더블클릭 시 기본값으로 초기화됩니다.
      </p>
    </div>
  );
}
