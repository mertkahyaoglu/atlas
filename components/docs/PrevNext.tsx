import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { DocMeta } from "@/lib/types";
import { accentVar, docHref } from "@/lib/utils";

interface PrevNextProps {
  prev?: DocMeta;
  next?: DocMeta;
}

function Card({ doc, direction }: { doc: DocMeta; direction: "prev" | "next" }) {
  const isNext = direction === "next";
  return (
    <Link
      href={docHref(doc)}
      style={accentVar(doc.group)}
      className={`group flex flex-1 flex-col gap-1 rounded border border-rule p-4 transition-colors duration-fast hover:border-[color:var(--accent)] ${
        isNext ? "items-end text-right" : "items-start"
      }`}
    >
      <span className="flex items-center gap-1.5 font-mono text-micro text-inkFaint">
        {!isNext && <ArrowLeft className="h-3 w-3" />}
        {isNext ? "Next" : "Previous"}
        {isNext && <ArrowRight className="h-3 w-3" />}
      </span>
      <span className="text-small text-ink group-hover:text-[color:var(--accent)]">{doc.title}</span>
    </Link>
  );
}

export function PrevNext({ prev, next }: PrevNextProps) {
  if (!prev && !next) return null;

  return (
    <nav className="mt-16 flex flex-col gap-3 border-t border-rule pt-8 sm:flex-row">
      {prev ? <Card doc={prev} direction="prev" /> : <div className="flex-1" />}
      {next ? <Card doc={next} direction="next" /> : <div className="flex-1" />}
    </nav>
  );
}
