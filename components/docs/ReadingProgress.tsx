"use client";

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { useProgressStore } from "@/store/useProgressStore";

/**
 * How far the reader has scrolled through the element with `targetId`:
 * 0 while its top is still below the viewport top, 1 once its bottom is in view.
 */
function useScrollProgress(targetId: string) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      const ratio = scrollable <= 0 ? 1 : -rect.top / scrollable;
      setProgress(Math.min(1, Math.max(0, ratio)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Diagrams draw after mount and grow the page, so track height changes too.
    const observer = new ResizeObserver(schedule);
    observer.observe(el);

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [targetId]);

  return progress;
}

export function ReadingProgress({ targetId, slug }: { targetId: string; slug: string }) {
  const percent = Math.round(useScrollProgress(targetId) * 100);
  const setCompleted = useProgressStore((s) => s.setCompleted);
  const reachedEnd = percent === 100;

  // Fires each time the end is reached, not on every render, so un-marking while still at the end sticks.
  // The scrollY check skips pages short enough to start at 100%.
  useEffect(() => {
    if (reachedEnd && window.scrollY > 0) setCompleted(slug, true);
  }, [reachedEnd, slug, setCompleted]);

  return (
    <div className="rounded border border-rule bg-surface px-4 py-3.5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-tiny font-semibold text-ink">Reading progress</p>
        <BookOpen className="h-4 w-4 text-inkFaint" aria-hidden />
      </div>
      <div
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-raised"
      >
        <div
          className="h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-fast"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
