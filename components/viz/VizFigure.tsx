"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import type { Viz } from "@/lib/viz/types";
import { cn } from "@/lib/utils";
import { TONE_VAR } from "./VizNodes";
import { VizCode } from "./VizCode";

/** React Flow measures its container, so it only renders on the client. */
const VizCanvas = dynamic(() => import("./VizCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[color:var(--flow-canvas)]" />,
});

/** Time a frame holds at 1×, long enough to read its caption. */
const FRAME_MS = 3200;

const SPEEDS = [1, 1.5, 0.5];

const DEFAULT_CODE_WIDTH = 384;
const MIN_CODE_WIDTH = 220;

function Control({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded border border-rule text-inkMuted transition-colors duration-fast hover:border-ruleStrong hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function VizFigure({ viz }: { viz: Viz }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(SPEEDS[0]);
  const [codeWidth, setCodeWidth] = useState(DEFAULT_CODE_WIDTH);
  const captionRef = useRef<HTMLElement>(null);

  const last = viz.frames.length - 1;
  const frame = viz.frames[step];

  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setStep((current) => current + 1), FRAME_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, step, last, speed]);

  /**
   * Dragging the divider trades caption width for code width. Clamped so
   * neither side can be squeezed out, and reset by double-clicking it.
   */
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = codeWidth;
    const available = captionRef.current?.clientWidth ?? 0;
    const max = Math.max(MIN_CODE_WIDTH, available - 280);

    // Dragging over text would select it, and the cursor must not flicker back
    // to a caret the moment it leaves the 8px handle.
    const previousSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (move: PointerEvent) => {
      setCodeWidth(Math.min(Math.max(startWidth - (move.clientX - startX), MIN_CODE_WIDTH), max));
    };
    const onUp = () => {
      document.body.style.userSelect = previousSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function resizeByKey(event: React.KeyboardEvent) {
    const delta = event.key === "ArrowLeft" ? 24 : event.key === "ArrowRight" ? -24 : 0;
    if (delta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const available = captionRef.current?.clientWidth ?? 0;
    const max = Math.max(MIN_CODE_WIDTH, available - 280);
    setCodeWidth((current) => Math.min(Math.max(current + delta, MIN_CODE_WIDTH), max));
  }

  function togglePlay() {
    // Playing from the end is a replay, not a no-op.
    if (step >= last) setStep(0);
    setPlaying((value) => !value);
  }

  function go(next: number) {
    setPlaying(false);
    setStep(Math.min(Math.max(next, 0), last));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowRight") go(step + 1);
    else if (event.key === "ArrowLeft") go(step - 1);
    else if (event.key === " " || event.key === "Enter") togglePlay();
    else return;
    event.preventDefault();
  }

  return (
    <figure
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Step through the visualisation with the left and right arrow keys"
      className="my-8 overflow-hidden rounded-md border border-rule bg-surface focus-visible:outline-2"
    >
      {/* The drawing takes the full width; the code sits beside the caption below it,
          where a 20-line listing and a paragraph are about the same height. */}
      <div className="relative h-[280px] sm:h-[340px] lg:h-[380px]">
        <VizCanvas frame={frame} width={viz.width} height={viz.height} />
        {viz.legend && (
          <ul className="pointer-events-none absolute bottom-2 left-3 flex flex-wrap gap-x-3 gap-y-1">
            {viz.legend.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 font-mono text-micro text-inkMuted">
                <span className="h-2 w-2 rounded-sm" style={{ background: TONE_VAR[item.tone] }} aria-hidden />
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      <figcaption
        ref={captionRef}
        className="grid border-t border-rule lg:grid-cols-[minmax(0,1fr)_var(--code-w)]"
        style={{ ["--code-w" as string]: `${codeWidth}px` }}
      >
        {viz.code && (
          <div className="relative order-2">
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the code panel"
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={resizeByKey}
              onDoubleClick={() => setCodeWidth(DEFAULT_CODE_WIDTH)}
              className="absolute -left-1 top-0 z-10 hidden h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-[color:var(--accent)] lg:block"
            />
            <VizCode source={viz.code.source} language={viz.code.language} highlight={frame.codeLines ?? []} />
          </div>
        )}

        <div className="order-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
            <span className="font-mono text-micro tabular-nums text-inkFaint">
              {String(step + 1).padStart(2, "0")} / {viz.frames.length}
            </span>
            <span className="text-small font-medium text-ink">{frame.label}</span>
            {frame.stats && (
              <span className="ml-auto flex flex-wrap gap-x-3 gap-y-1">
                {frame.stats.map((stat) => (
                  <span key={stat.label} className="font-mono text-micro text-inkMuted">
                    {stat.label} <span className="tabular-nums text-ink">{stat.value}</span>
                  </span>
                ))}
              </span>
            )}
          </div>

          <p aria-live="polite" className="min-h-[4.25rem] px-4 pt-1.5 text-small text-inkMuted sm:min-h-[3.5rem]">
            {frame.caption}
          </p>

          <div className="flex flex-wrap items-center gap-3 px-4 pb-3 pt-2">
            <div className="flex items-center gap-1.5">
              <Control label="Restart" onClick={() => go(0)} disabled={step === 0 && !playing}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              </Control>
              <Control label="Previous step" onClick={() => go(step - 1)} disabled={step === 0}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Control>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? "Pause" : "Play"}
                className="flex h-8 items-center gap-1.5 rounded border border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] px-3 text-small text-[color:var(--accent)] transition-colors duration-fast hover:bg-[color:color-mix(in_srgb,var(--accent)_22%,transparent)]"
              >
                {playing ? (
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Play className="h-3.5 w-3.5" aria-hidden />
                )}
                {playing ? "Pause" : step >= last ? "Replay" : "Play"}
              </button>
              <Control label="Next step" onClick={() => go(step + 1)} disabled={step === last}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Control>
            </div>

            {/* Narrow screens have the prev/next buttons; the rail would wrap to three rows. */}
            <ol className="hidden flex-1 flex-wrap items-center gap-1 sm:flex">
              {viz.frames.map((item, i) => (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    title={`${i + 1}. ${item.label}`}
                    aria-label={`Step ${i + 1}: ${item.label}`}
                    aria-current={i === step ? "step" : undefined}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-200",
                      i === step
                        ? "w-7 bg-[color:var(--accent)]"
                        : i < step
                          ? "w-3 bg-ruleStrong"
                          : "w-3 bg-rule hover:bg-ruleStrong",
                    )}
                  />
                </li>
              ))}
            </ol>

            <button
              type="button"
              onClick={() => setSpeed((current) => SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length])}
              aria-label={`Playback speed ${speed}×`}
              className="rounded border border-rule px-2 py-1 font-mono text-micro tabular-nums text-inkMuted transition-colors duration-fast hover:border-ruleStrong hover:text-ink"
            >
              {speed}×
            </button>
          </div>
        </div>
      </figcaption>
    </figure>
  );
}
