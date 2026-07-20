"use client";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

const SUGGESTIONS = ["warm", "punchy", "bright", "clean vocal", "lofi", "airy bass"];

export default function PromptInput({ value, onChange }: Props) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <span className="text-accent-glow">✦</span> Suno 스타일 프롬프트
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="예: warm analog bass, punchy drums, clean bright vocal, airy top-end..."
        rows={3}
        className="w-full resize-none rounded-xl border border-surface-border bg-black/30 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() =>
              onChange(value.trim().length ? `${value.trim()}, ${tag}` : tag)
            }
            className="rounded-full border border-surface-border bg-white/[0.03] px-3 py-1 text-xs text-zinc-400 transition hover:border-accent/60 hover:text-accent-soft"
          >
            + {tag}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">
        프롬프트의 키워드는 다이나믹 EQ 프리셋을 미세 조정하는 데 참고됩니다.
      </p>
    </div>
  );
}
