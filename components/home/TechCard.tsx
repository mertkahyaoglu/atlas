import Link from "next/link";
import type { DocMeta } from "@/lib/types";
import { Tag } from "@/components/ui/Tag";
import { accentVar } from "@/lib/utils";

/**
 * Technology cards lead with the role rather than the number: when you are
 * choosing a store or a transport, "wide-column store" is what you are
 * scanning for, and the ordering is only a suggested reading path.
 */
export function TechCard({ doc }: { doc: DocMeta }) {
  return (
    <Link
      href={`/docs/${doc.slug}`}
      style={accentVar("tech")}
      className="group flex flex-col rounded border border-rule bg-surface p-5 transition-colors duration-fast hover:border-[color:var(--accent)]"
    >
      <div className="mb-1 flex items-baseline gap-3">
        <span className="font-mono text-tiny tabular-nums text-[color:var(--accent)]">
          {String(doc.order).padStart(2, "0")}
        </span>
        <h3 className="text-h3 font-semibold leading-tight text-ink">{doc.title}</h3>
        {doc.role && (
          <span className="ml-auto shrink-0 font-mono text-micro uppercase tracking-wide text-inkFaint">
            {doc.role}
          </span>
        )}
      </div>

      <p className="mt-2 flex-1 text-small leading-relaxed text-inkMuted">{doc.summary}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {doc.tags.slice(0, 4).map((tag) => (
          <Tag key={tag} id={tag} />
        ))}
      </div>
    </Link>
  );
}
