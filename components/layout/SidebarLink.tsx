"use client";

import Link from "next/link";
import { CircleCheck } from "lucide-react";
import type { DocMeta } from "@/lib/types";
import { useIsCompleted } from "@/store/useProgressStore";
import { accentVar, cn } from "@/lib/utils";

interface SidebarLinkProps {
  doc: DocMeta;
  active: boolean;
  onNavigate: () => void;
}

export function SidebarLink({ doc, active, onNavigate }: SidebarLinkProps) {
  const completed = useIsCompleted(doc.slug);

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
      {completed && (
        <>
          <CircleCheck
            className="ml-auto h-3.5 w-3.5 shrink-0 self-center text-[color:var(--accent)]"
            aria-hidden
          />
          <span className="sr-only">(completed)</span>
        </>
      )}
    </Link>
  );
}
