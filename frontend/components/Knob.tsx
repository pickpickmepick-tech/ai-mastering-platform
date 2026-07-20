"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  displayValue?: (v: number) => string;
  onChange: (v: number) => void;
  size?: number;
  disabled?: boolean;
  color?: string;
  glowColor?: string;
}

const ANGLE_MIN = -135;
const ANGLE_MAX = 135;
const DRAG_PX_FOR_FULL_RANGE = 160;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export default function Knob({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  displayValue,
  onChange,
  size = 64,
  disabled = false,
  color = "#7c5cff",
  glowColor,
}: KnobProps) {
  const glow = glowColor ?? color;
  const gradientId = useId();
  const draggingRef = useRef<{ startY: number; startValue: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const { startY, startValue } = draggingRef.current;
      const deltaY = startY - e.clientY;
      const range = max - min;
      const rawDelta = (deltaY / DRAG_PX_FOR_FULL_RANGE) * range;
      const stepped = Math.round((startValue + rawDelta) / step) * step;
      onChange(clamp(parseFloat(stepped.toFixed(4)), min, max));
    },
    [max, min, step, onChange]
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
    setIsDragging(false);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove]);

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    draggingRef.current = { startY: e.clientY, startValue: value };
    setIsDragging(true);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(clamp(parseFloat((value + step).toFixed(4)), min, max));
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(clamp(parseFloat((value - step).toFixed(4)), min, max));
    }
  };

  const handleDoubleClick = () => {
    if (disabled || defaultValue === undefined) return;
    onChange(defaultValue);
  };

  const angle = ANGLE_MIN + ((value - min) / (max - min)) * (ANGLE_MAX - ANGLE_MIN);
  const r = size / 2;
  const trackRadius = r - 6;

  const fullStart = polarToCartesian(r, r, trackRadius, ANGLE_MIN);
  const fullEnd = polarToCartesian(r, r, trackRadius, ANGLE_MAX);
  const valueEnd = polarToCartesian(r, r, trackRadius, angle);
  const largeArc = angle - ANGLE_MIN > 180 ? 1 : 0;

  const pointerLen = trackRadius - 6;
  const pointerEnd = polarToCartesian(r, r, pointerLen, angle);

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <span className="text-[11px] font-medium text-zinc-400">{label}</span>
      <div
        className={`rounded-full ${disabled ? "opacity-40" : ""}`}
        style={{
          boxShadow: `0 0 18px -4px ${glow}66, 0 6px 14px -4px rgba(0,0,0,0.6)`,
        }}
      >
        <svg
          width={size}
          height={size}
          onPointerDown={handlePointerDown}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
          tabIndex={disabled ? -1 : 0}
          role="slider"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-label={label}
          className={`touch-none outline-none ${
            disabled ? "cursor-not-allowed" : "cursor-ns-resize"
          }`}
          style={isDragging ? { filter: `drop-shadow(0 0 8px ${glow}aa)` } : undefined}
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={glow} />
            </linearGradient>
            <radialGradient id={`${gradientId}-face`} cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#22222f" />
              <stop offset="100%" stopColor="#121219" />
            </radialGradient>
          </defs>
          <path
            d={`M ${fullStart.x} ${fullStart.y} A ${trackRadius} ${trackRadius} 0 1 1 ${fullEnd.x} ${fullEnd.y}`}
            fill="none"
            stroke="#242534"
            strokeWidth={4}
            strokeLinecap="round"
          />
          <path
            d={`M ${fullStart.x} ${fullStart.y} A ${trackRadius} ${trackRadius} 0 ${largeArc} 1 ${valueEnd.x} ${valueEnd.y}`}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={4}
            strokeLinecap="round"
          />
          <circle
            cx={r}
            cy={r}
            r={trackRadius - 10}
            fill={`url(#${gradientId}-face)`}
            stroke={color}
            strokeOpacity={0.35}
            strokeWidth={1}
          />
          <line
            x1={r}
            y1={r}
            x2={pointerEnd.x}
            y2={pointerEnd.y}
            stroke="#f5f3ff"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span
        className="rounded-md bg-black/30 px-2 py-0.5 font-mono text-[11px]"
        style={{ color: glow }}
      >
        {displayValue ? displayValue(value) : value}
      </span>
    </div>
  );
}
