"use client";

import { Circle, CircleCheck } from "lucide-react";
import { useIsCompleted, useProgressStore } from "@/store/useProgressStore";
import { cn } from "@/lib/utils";

export function CompleteButton({ slug }: { slug: string }) {
  const completed = useIsCompleted(slug);
  const setCompleted = useProgressStore((s) => s.setCompleted);
  const Icon = completed ? CircleCheck : Circle;

  return (
    <button
      type="button"
      onClick={() => setCompleted(slug, !completed)}
      aria-pressed={completed}
      title={completed ? "Mark as not completed" : "Mark as completed"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-micro transition-colors duration-fast",
        completed
          ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
          : "border-rule text-inkMuted hover:border-ruleStrong hover:text-ink",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {completed ? "Completed" : "Complete"}
    </button>
  );
}
