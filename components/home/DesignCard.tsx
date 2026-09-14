import Link from "next/link";
import type { DocMeta } from "@/lib/types";
import { Tag } from "@/components/ui/Tag";
import { accentVar } from "@/lib/utils";

/**
 * Designs get a wider row than concepts because the "hard part" line is the
 * most useful thing on the card — it's what you'd scan for when choosing what
 * to practise next.
 */
export function DesignCard({ doc }: { doc: DocMeta }) {
  return (
    <Link
      href={`/docs/${doc.slug}`}
      style={accentVar("design")}
      className="group grid grid-cols-[2.5rem_1fr] gap-x-2 rounded border border-rule bg-surface p-5 transition-colors duration-fast hover:border-[color:var(--accent)]"
    >
      <span className="pt-0.5 font-mono text-tiny tabular-nums text-[color:var(--accent)]">
        {String(doc.order).padStart(2, "0")}
      </span>

      <div className="min-w-0">
        <h3 className="text-h3 font-semibold leading-tight text-ink">{doc.title}</h3>
        <p className="mt-2 text-small leading-relaxed text-inkMuted">{doc.summary}</p>

        {doc.hardPart && (
          <p className="mt-3 border-l-2 border-rule pl-3 text-tiny leading-relaxed text-inkFaint">
            {doc.hardPart}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {doc.tags.slice(0, 5).map((tag) => (
            <Tag key={tag} id={tag} />
          ))}
        </div>
      </div>
    </Link>
  );
}
