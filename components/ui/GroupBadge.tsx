import type { DocGroup } from "@/lib/types";
import { accentVar } from "@/lib/utils";

const LABEL: Record<DocGroup, string> = {
  concept: "Concept module",
  tech: "Key technology",
  design: "Design",
};

/** Small coloured marker that tells the reader which half of the atlas they're in. */
export function GroupBadge({ group }: { group: DocGroup }) {
  return (
    <span
      style={accentVar(group)}
      className="inline-flex items-center gap-1.5 font-mono text-micro text-[color:var(--accent)]"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" aria-hidden />
      {LABEL[group]}
    </span>
  );
}
