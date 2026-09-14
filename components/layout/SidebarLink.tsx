"use client";

import Link from "next/link";
import type { DocMeta } from "@/lib/types";
import { accentVar, cn } from "@/lib/utils";

interface SidebarLinkProps {
  doc: DocMeta;
  active: boolean;
  onNavigate: () => void;
}

export function SidebarLink({ doc, active, onNavigate }: SidebarLinkProps) {
  return (
    <Link
      href={`/docs/${doc.slug}`}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      style={accentVar(doc.group)}
      className={cn(
        "group flex items-baseline gap-2.5 border-l-2 py-1.5 pl-3 pr-2 text-small transition-colors duration-fast",
        active
          ? "border-[color:var(--accent)] bg-[color:var(--accent-soft,transparent)] text-ink"
          : "border-transparent text-inkMuted hover:border-rule hover:text-ink",
      )}
    >
      <span
        className={cn(
          "w-4 shrink-0 font-mono text-micro tabular-nums",
          active ? "text-[color:var(--accent)]" : "text-inkFaint",
        )}
      >
        {String(doc.order).padStart(2, "0")}
      </span>
      <span className="leading-snug">{doc.title}</span>
    </Link>
  );
}
