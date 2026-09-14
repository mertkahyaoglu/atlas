"use client";

import { useMemo } from "react";
import type { DocMeta } from "@/lib/types";
import { filterDocs } from "@/lib/search";
import { useFilterStore } from "@/store/useFilterStore";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConceptCard } from "./ConceptCard";
import { DesignCard } from "./DesignCard";
import { FilterBar } from "./FilterBar";

interface HomeViewProps {
  concepts: DocMeta[];
  designs: DocMeta[];
}

interface SectionProps {
  title: string;
  note: string;
  count: number;
  total: number;
  accent: string;
  children: React.ReactNode;
}

function Section({ title, note, count, total, accent, children }: SectionProps) {
  if (count === 0) return null;

  return (
    <section className="mt-16">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule pb-3">
        <h2 className="text-h2 font-semibold text-ink">{title}</h2>
        <span className="font-mono text-tiny" style={{ color: accent }}>
          {count === total ? `${total}` : `${count} of ${total}`}
        </span>
        <p className="w-full text-small text-inkMuted">{note}</p>
      </div>
      {children}
    </section>
  );
}

export function HomeView({ concepts, designs }: HomeViewProps) {
  const { query, tags, sort, clear } = useFilterStore();
  const all = useMemo(() => [...concepts, ...designs], [concepts, designs]);

  const filtered = useMemo(
    () => filterDocs(all, { query, tags, sort }),
    [all, query, tags, sort],
  );

  const visibleConcepts = filtered.filter((d) => d.group === "concept");
  const visibleDesigns = filtered.filter((d) => d.group === "design");

  return (
    <>
      <FilterBar docs={all} />

      {filtered.length === 0 && (
        <div className="mt-16">
          <EmptyState
            title="Nothing matches those filters."
            action={
              <button
                type="button"
                onClick={clear}
                className="rounded border border-rule px-3 py-1.5 text-small text-ink hover:border-ruleStrong"
              >
                Reset filters
              </button>
            }
          />
        </div>
      )}

      <Section
        title="Concepts"
        note="Ten modules, in order. Foundations first, then the patterns everything else is built from."
        count={visibleConcepts.length}
        total={concepts.length}
        accent="var(--concept)"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleConcepts.map((doc) => (
            <ConceptCard key={doc.slug} doc={doc} />
          ))}
        </div>
      </Section>

      <Section
        title="Designs"
        note="Fifteen worked problems, ranked by how often they come up. The first five cover most of what gets asked."
        count={visibleDesigns.length}
        total={designs.length}
        accent="var(--design)"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleDesigns.map((doc) => (
            <DesignCard key={doc.slug} doc={doc} />
          ))}
        </div>
      </Section>
    </>
  );
}
