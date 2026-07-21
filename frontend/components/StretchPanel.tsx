"use client";

interface Props {
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

export default function StretchPanel({
  enabled,
  speed,
  pitch,
  onToggle,
  onSpeedChange,
  onPitchChange,
}: Props) {
  const handleUndo = () => {
    onSpeedChange(1.0);
    onPitchChange(0);
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
          aria-pressed={enabled}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            enabled ? "bg-accent" : "bg-white/10"
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-[20px]" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <div className={enabled ? "" : "pointer-events-none opacity-40"}>
        <div className="flex items-center justify-around gap-4">
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
          속도와 피치는 서로 독립적으로 조절됩니다. 위 라이브 미리듣기에 바로 반영되며, 실제
          마스터링 결과물은 서버에서 고품질 알고리즘으로 처리됩니다.
        </p>

        <button
          type="button"
          onClick={handleUndo}
          className="mt-4 w-full rounded-xl border border-surface-border bg-white/[0.03] py-2.5 text-xs font-semibold text-zinc-400 transition hover:border-accent/40 hover:text-accent-soft"
        >
          되돌리기
        </button>
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
