"use client";

import { useId, useRef, useState } from "react";
import { getTag } from "@/lib/tags";
import { cn } from "@/lib/utils";

interface TagProps {
  id: string;
  active?: boolean;
  onClick?: (id: string) => void;
}

const EDGE_GUTTER = 16;
/** Space under the sticky top bar; matches `scroll-padding-top` in globals.css. */
const TOP_CLEARANCE = 80;

/** A titled list inside the tooltip. Spans, not <ul>, because tags sit inside links. */
function TooltipSection({ title, items, className }: { title: string; items: string[]; className?: string }) {
  return (
    <span className={cn("block", className)}>
      <span className="mb-1 block font-mono text-micro uppercase text-inkFaint">{title}</span>
      {items.map((item) => (
        <span key={item} className="flex gap-1.5 text-inkMuted">
          <span aria-hidden className="text-[color:var(--concept)]">
            &middot;
          </span>
          {item}
        </span>
      ))}
    </span>
  );
}

/**
 * Tags are borders-only by default so a card with six of them stays calm.
 * Active state fills, because a selected filter should be unmissable.
 * Hovering or focusing a tag shows a one-line explanation of it; technologies
 * add core features and when to use them, side by side to keep it short.
 */
export function Tag({ id, active = false, onClick }: TagProps) {
  const tag = getTag(id);
  const interactive = Boolean(onClick);
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [below, setBelow] = useState(false);

  // Place the tooltip once its size is known: the hidden tooltip still has layout.
  // It starts at the tag's left edge and slides back inside the viewport if needed.
  function placeTooltip() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const tooltip = tooltipRef.current;
    if (!rect || !tooltip) return;

    const overflowRight = rect.left + tooltip.offsetWidth - (window.innerWidth - EDGE_GUTTER);
    const shift = overflowRight > 0 ? -overflowRight : 0;
    setOffsetX(Math.max(shift, EDGE_GUTTER - rect.left));
    setBelow(rect.top - tooltip.offsetHeight < TOP_CLEARANCE);
  }

  const features = tag.features ?? [];
  const useWhen = tag.useWhen ?? [];
  const sections = features.length > 0 || useWhen.length > 0;
  const bothSections = features.length > 0 && useWhen.length > 0;

  const className = cn(
    "inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-micro transition-colors duration-fast",
    active
      ? "border-[color:var(--concept)] bg-[color:var(--concept-soft)] text-[color:var(--concept)]"
      : "border-rule text-inkMuted",
    (interactive || tag.description) && !active && "hover:border-ruleStrong hover:text-ink",
  );

  const describedBy = tag.description ? tooltipId : undefined;
  const chip = interactive ? (
    <button
      type="button"
      onClick={() => onClick?.(id)}
      aria-pressed={active}
      aria-describedby={describedBy}
      className={className}
    >
      {tag.label}
    </button>
  ) : (
    <span aria-describedby={describedBy} className={className}>
      {tag.label}
    </span>
  );

  if (!tag.description) return chip;

  return (
    <span
      ref={wrapperRef}
      onPointerEnter={placeTooltip}
      onFocus={placeTooltip}
      className="group/tag relative inline-flex"
    >
      {chip}
      <span
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        style={{ left: offsetX }}
        className={cn(
          "pointer-events-none absolute z-30 w-max rounded border border-ruleStrong bg-raised px-2.5 py-1.5 text-left font-sans text-tiny font-normal normal-case text-ink shadow-lg",
          sections ? "max-w-[min(32rem,calc(100vw-2rem))]" : "max-w-[min(18rem,calc(100vw-2rem))]",
          "invisible opacity-0 transition duration-fast",
          below ? "top-full mt-1.5 -translate-y-0.5" : "bottom-full mb-1.5 translate-y-0.5",
          "group-hover/tag:visible group-hover/tag:translate-y-0 group-hover/tag:opacity-100 group-hover/tag:delay-150",
          "group-focus-within/tag:visible group-focus-within/tag:translate-y-0 group-focus-within/tag:opacity-100",
        )}
      >
        <span className="block">{tag.description}</span>
        {sections && (
          <span className={cn("mt-2 grid gap-y-2", bothSections && "sm:grid-cols-2")}>
            {features.length > 0 && <TooltipSection title="Core features" items={features} />}
            {useWhen.length > 0 && (
              <TooltipSection
                title="When to use"
                items={useWhen}
                className={cn(bothSections && "sm:border-l sm:border-ruleStrong sm:pl-3 sm:ml-3")}
              />
            )}
          </span>
        )}
      </span>
    </span>
  );
}
