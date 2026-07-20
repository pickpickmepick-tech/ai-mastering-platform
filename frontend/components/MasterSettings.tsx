"use client";

interface Props {
  targetLufs: number;
  antiAiIntensity: number;
  choppingIntensity: number;
  onLufsChange: (v: number) => void;
  onAntiAiChange: (v: number) => void;
  onChoppingChange: (v: number) => void;
}

const LUFS_PRESETS = [
  { label: "Streaming (-14)", value: -14 },
  { label: "Loud (-9)", value: -9 },
  { label: "Club (-6)", value: -6 },
];

export default function MasterSettings({
  targetLufs,
  antiAiIntensity,
  choppingIntensity,
  onLufsChange,
  onAntiAiChange,
  onChoppingChange,
}: Props) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-zinc-200">마스터링 설정</h3>

      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-medium text-zinc-200">
            📈 목표 LUFS
          </span>
          <span className="rounded-md bg-black/30 px-2 py-0.5 font-mono text-xs text-accent-soft">
            {targetLufs.toFixed(1)} LUFS
          </span>
        </div>
        <input
          type="range"
          min={-24}
          max={-6}
          step={0.5}
          value={targetLufs}
          onChange={(e) => onLufsChange(parseFloat(e.target.value))}
        />
        <div className="mt-2 flex gap-2">
          {LUFS_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onLufsChange(p.value)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                targetLufs === p.value
                  ? "border-accent bg-accent/20 text-accent-soft"
                  : "border-surface-border text-zinc-500 hover:border-accent/50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-medium text-zinc-200">
            🛡️ Anti-AI 우회 강도
          </span>
          <span className="rounded-md bg-black/30 px-2 py-0.5 font-mono text-xs text-accent-soft">
            {antiAiIntensity.toFixed(0)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={antiAiIntensity}
          onChange={(e) => onAntiAiChange(parseFloat(e.target.value))}
        />
        <p className="mt-2 text-[11px] text-zinc-600">
          초미세 지터링 + 가우시안 디더링 강도. 100%에서도 청감상 인지 불가한
          수준으로 설계되어 있습니다.
        </p>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-medium text-zinc-200">
            ✂️ Chopping 강도
          </span>
          <span className="rounded-md bg-black/30 px-2 py-0.5 font-mono text-xs text-accent-soft">
            {choppingIntensity.toFixed(0)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={choppingIntensity}
          onChange={(e) => onChoppingChange(parseFloat(e.target.value))}
        />
        <p className="mt-2 text-[11px] text-zinc-600">
          Suno 특유의 7.2kHz / 14kHz 고역 노이즈를 노치 필터 + 컴프레서로
          부드럽게 감쇄합니다.
        </p>
      </div>
    </div>
  );
}
