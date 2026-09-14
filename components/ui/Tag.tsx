"use client";

import { getTag } from "@/lib/tags";
import { cn } from "@/lib/utils";

interface TagProps {
  id: string;
  active?: boolean;
  onClick?: (id: string) => void;
}

/**
 * Tags are borders-only by default so a card with six of them stays calm.
 * Active state fills, because a selected filter should be unmissable.
 */
export function Tag({ id, active = false, onClick }: TagProps) {
  const tag = getTag(id);
  const interactive = Boolean(onClick);

  const className = cn(
    "inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-micro transition-colors duration-fast",
    active
      ? "border-[color:var(--concept)] bg-[color:var(--concept-soft)] text-[color:var(--concept)]"
      : "border-rule text-inkMuted",
    interactive && !active && "hover:border-ruleStrong hover:text-ink",
  );

  if (!interactive) return <span className={className}>{tag.label}</span>;

  return (
    <button type="button" onClick={() => onClick?.(id)} aria-pressed={active} className={className}>
      {tag.label}
    </button>
  );
}
