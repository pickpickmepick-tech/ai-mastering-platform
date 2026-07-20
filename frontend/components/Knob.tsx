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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  // `value` changes from our own drag/keyboard input snap instantly (1:1
  // with the pointer). A `value` change from *outside* (e.g. an AI preset
  // moving the knob) instead tweens smoothly over ANIMATE_MS so it visibly
  // "glides" into place. `internalChangeRef` distinguishes the two.
  const [displayVal, setDisplayVal] = useState(value);
  const internalChangeRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (internalChangeRef.current) {
      internalChangeRef.current = false;
      setDisplayVal(value);
      return;
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const from = displayVal;
    const delta = value - from;
    if (Math.abs(delta) < 1e-6) return;
    const ANIMATE_MS = 550;
    const startTime = performance.now();
    const step2 = (now: number) => {
      const t = Math.min(1, (now - startTime) / ANIMATE_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayVal(from + delta * eased);
      rafRef.current = t < 1 ? requestAnimationFrame(step2) : null;
    };
    rafRef.current = requestAnimationFrame(step2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Absolute/radial control: the value is derived from the angle between
  // the knob center and the pointer, so clicking (or dragging to) a point
  // to the right of center sets a higher value and a point to the left
  // sets a lower value -- matching the arc drawn on the dial.
  const valueFromClientPos = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return value;
      const rect = svg.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      if (angle > 180) angle -= 360;
      if (angle < -180) angle += 360;
      angle = clamp(angle, ANGLE_MIN, ANGLE_MAX);
      const raw = min + ((angle - ANGLE_MIN) / (ANGLE_MAX - ANGLE_MIN)) * (max - min);
      const stepped = Math.round(raw / step) * step;
      return clamp(parseFloat(stepped.toFixed(4)), min, max);
    },
    [max, min, step, value]
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      internalChangeRef.current = true;
      onChange(valueFromClientPos(e.clientX, e.clientY));
    },
    [onChange, valueFromClientPos]
  );

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
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

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    e.preventDefault();
    // preventDefault above stops the browser's default focus-on-click, so
    // focus explicitly -- otherwise arrow-key adjustment after a click
    // silently does nothing because the knob never actually has focus.
    e.currentTarget.focus();
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    isDraggingRef.current = true;
    setIsDragging(true);
    internalChangeRef.current = true;
    onChange(valueFromClientPos(e.clientX, e.clientY));
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      internalChangeRef.current = true;
      onChange(clamp(parseFloat((value + step).toFixed(4)), min, max));
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      internalChangeRef.current = true;
      onChange(clamp(parseFloat((value - step).toFixed(4)), min, max));
    }
  };

  const handleDoubleClick = () => {
    if (disabled || defaultValue === undefined) return;
    internalChangeRef.current = true;
    onChange(defaultValue);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    internalChangeRef.current = true;
    onChange(clamp(parseFloat((value + direction * step).toFixed(4)), min, max));
  };

  const angle = ANGLE_MIN + ((displayVal - min) / (max - min)) * (ANGLE_MAX - ANGLE_MIN);
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
          ref={svgRef}
          width={size}
          height={size}
          onPointerDown={handlePointerDown}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          tabIndex={disabled ? -1 : 0}
          role="slider"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-label={label}
          className={`touch-none outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card ${
            disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
          style={{
            ...(isDragging ? { filter: `drop-shadow(0 0 8px ${glow}aa)` } : undefined),
            ...(disabled ? undefined : ({ "--tw-ring-color": glow } as React.CSSProperties)),
          }}
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
        {displayValue ? displayValue(displayVal) : displayVal}
      </span>
    </div>
  );
}
