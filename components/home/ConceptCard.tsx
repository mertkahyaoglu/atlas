import Link from "next/link";
import type { DocMeta } from "@/lib/types";
import { Tag } from "@/components/ui/Tag";
import { accentVar } from "@/lib/utils";

/**
 * Concept modules are a reading sequence, so the number is real information
 * rather than ornament: it tells you where the module sits in the progression.
 */
export function ConceptCard({ doc }: { doc: DocMeta }) {
  return (
    <Link
      href={`/docs/${doc.slug}`}
      style={accentVar("concept")}
      className="group flex flex-col rounded border border-rule bg-surface p-5 transition-colors duration-fast hover:border-[color:var(--accent)]"
    >
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-tiny tabular-nums text-[color:var(--accent)]">
          {String(doc.order).padStart(2, "0")}
        </span>
        <h3 className="text-h3 font-semibold leading-tight text-ink">{doc.title}</h3>
      </div>

      <p className="flex-1 text-small leading-relaxed text-inkMuted">{doc.summary}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {doc.tags.slice(0, 4).map((tag) => (
          <Tag key={tag} id={tag} />
        ))}
      </div>
    </Link>
  );
}
