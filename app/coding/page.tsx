import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Clock } from "lucide-react";
import { getDocsInTrack, toMeta } from "@/lib/content";
import { accentVar, docHref } from "@/lib/utils";
import { TopBar } from "@/components/layout/TopBar";

export const metadata: Metadata = {
  title: "Coding",
  description:
    "Data structures and algorithms for coding interviews, each explained with a step-through visualisation and the code running beside it.",
  alternates: { canonical: "/coding" },
};

export default function CodingIndex() {
  const docs = getDocsInTrack("coding").map(toMeta);

  return (
    <div style={accentVar("coding")}>
      <TopBar />

      <div className="mx-auto max-w-shell px-4 pb-24 pt-12 sm:px-8">
        <header className="max-w-reading">
          <p className="font-mono text-micro uppercase tracking-wider text-[color:var(--accent)]">
            Coding interview prep
          </p>
          <h1 className="mt-3 text-h1 font-semibold text-ink sm:text-display">
            Data structures and algorithms, drawn step by step.
          </h1>
          <p className="mt-4 text-lead text-inkMuted">
            One page per concept. Each opens with a visualisation you can step through — the structure on top, the code
            running beside it — then the costs, the signals that call for it, and the mistakes that cost offers.
          </p>
        </header>

        <section className="mt-14">
          <div className="mb-4 flex items-baseline justify-between border-b border-rule pb-2">
            <h2 className="text-small font-semibold text-ink">Concepts</h2>
            <span className="font-mono text-micro text-inkFaint">{docs.length} in order</span>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {docs.map((doc) => (
              <li key={doc.slug}>
                <Link
                  href={docHref(doc)}
                  className="group flex h-full flex-col rounded border border-rule bg-surface p-4 transition-colors duration-fast hover:border-[color:var(--accent)]"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-micro tabular-nums text-[color:var(--accent)]">
                      {String(doc.order).padStart(2, "0")}
                    </span>
                    <span className="ml-auto flex items-center gap-1.5 font-mono text-micro text-inkFaint">
                      <Clock className="h-3 w-3" aria-hidden />
                      {doc.readingMinutes} min
                    </span>
                  </div>
                  <h3 className="mt-2 text-h3 font-semibold text-ink group-hover:text-[color:var(--accent)]">
                    {doc.title}
                  </h3>
                  <p className="mt-2 flex-1 text-small text-inkMuted">{doc.summary}</p>
                  <span className="mt-4 flex items-center gap-1.5 font-mono text-micro text-inkFaint group-hover:text-[color:var(--accent)]">
                    Open
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
