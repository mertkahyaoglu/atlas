import { ListChecks } from "lucide-react";
import { TECH_OPENING_TITLES, slugifyHeading } from "@/lib/content";
import type { TechDetails } from "@/lib/types";
import { InlineMarkdown } from "./InlineMarkdown";
import { MarkedList, PanelLabel } from "./Panels";

/** Structured panels for the sections a technology doc keeps in frontmatter. */

/**
 * The facts strip: what the thing is, in the terms you would compare two
 * stores on. Hairline grid rather than separate cards, so a dozen short
 * values stay scannable.
 */
function FactsPanel({ facts }: Pick<TechDetails, "facts">) {
  return (
    <div className="my-6 grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
      {facts.map((fact) => (
        <div key={fact.label} className="bg-surface px-4 py-3.5">
          <div className="font-mono text-micro uppercase tracking-wide text-inkFaint">{fact.label}</div>
          <div className="mt-1 text-small leading-relaxed text-ink">
            <InlineMarkdown>{fact.value}</InlineMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Both opening panels: the facts strip, then the concepts as one plain list. */
export function TechOverview({ tech }: { tech: TechDetails }) {
  const [glanceTitle, conceptsTitle] = TECH_OPENING_TITLES;

  return (
    <>
      {tech.facts.length > 0 && (
        <>
          <h2 id={slugifyHeading(glanceTitle)}>{glanceTitle}</h2>
          <FactsPanel facts={tech.facts} />
        </>
      )}

      {tech.concepts.length > 0 && (
        <>
          <h2 id={slugifyHeading(conceptsTitle)}>{conceptsTitle}</h2>
          <div className="my-6 rounded-md border border-rule bg-surface p-5">
            <PanelLabel icon={ListChecks} note="what it gives you">
              The short list
            </PanelLabel>
            <MarkedList items={tech.concepts} marker="diamond" />
          </div>
        </>
      )}

      <hr />
    </>
  );
}
