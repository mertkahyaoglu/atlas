import { CircleSlash, Compass, Sparkles, Target } from "lucide-react";
import { TECH_CLOSING_TITLES, TECH_OPENING_TITLES, slugifyHeading } from "@/lib/content";
import type { TechCapability, TechDetails } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FollowUps } from "./FollowUps";
import { InlineMarkdown } from "./InlineMarkdown";
import { Markdown } from "./Markdown";
import { CardHeading, MarkedList, PanelLabel } from "./Panels";

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

/**
 * Which capability cards span both columns: ones with code or tables, or long
 * bodies, the same rule the design trade-off cards use.
 */
function wideCards(items: TechCapability[]): boolean[] {
  const wide = items.map((item) => /```|^\s*\|/m.test(item.body) || item.body.length > 620);
  let column = 0;
  for (let i = 0; i < items.length; i++) {
    if (wide[i]) {
      if (column === 1) wide[i - 1] = true;
      column = 0;
    } else {
      column = (column + 1) % 2;
    }
  }
  if (column === 1) wide[items.length - 1] = true;
  return wide;
}

/** The facts strip, rendered before the markdown body. */
export function TechOverview({ tech }: { tech: TechDetails }) {
  const [glanceTitle] = TECH_OPENING_TITLES;
  if (tech.facts.length === 0) return null;

  return (
    <>
      <h2 id={slugifyHeading(glanceTitle)}>{glanceTitle}</h2>
      <FactsPanel facts={tech.facts} />
      <hr />
    </>
  );
}

/** Capabilities, when to reach for it, and what gets probed: after the body. */
export function TechDeepDives({ tech }: { tech: TechDetails }) {
  const [capabilitiesTitle, useTitle, probesTitle] = TECH_CLOSING_TITLES;
  const wide = wideCards(tech.capabilities);

  return (
    <>
      {tech.capabilities.length > 0 && (
        <>
          <h2 id={slugifyHeading(capabilitiesTitle)}>{capabilitiesTitle}</h2>
          <div className="my-6 grid gap-4 md:grid-cols-2">
            {tech.capabilities.map((capability, i) => (
              <div
                key={capability.title}
                className={cn("min-w-0 rounded-md border border-rule bg-surface p-5", wide[i] && "md:col-span-2")}
              >
                <div className="mb-3 flex items-start gap-2.5">
                  <Sparkles className="mt-px h-4 w-4 shrink-0 text-[color:var(--accent)]" aria-hidden />
                  <CardHeading>
                    <InlineMarkdown>{capability.title}</InlineMarkdown>
                  </CardHeading>
                </div>
                <div className="min-w-0 text-small leading-relaxed text-inkMuted [&>*+*]:mt-3 [&_p]:max-w-none">
                  <Markdown content={capability.body} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {(tech.useWhen.length > 0 || tech.avoidWhen.length > 0) && (
        <>
          <h2 id={slugifyHeading(useTitle)}>{useTitle}</h2>
          <div className="my-6 grid gap-4 md:grid-cols-2">
            {tech.useWhen.length > 0 && (
              <div className="rounded-md border border-rule bg-surface p-5">
                <PanelLabel icon={Compass} note="the natural pick">
                  Reach for it
                </PanelLabel>
                <MarkedList items={tech.useWhen} marker="check" />
              </div>
            )}
            {tech.avoidWhen.length > 0 && (
              <div className="rounded-md border border-dashed border-ruleStrong p-5">
                <PanelLabel icon={CircleSlash} note="the wrong answer">
                  Reach for something else
                </PanelLabel>
                <MarkedList items={tech.avoidWhen} marker="cross" />
              </div>
            )}
          </div>
        </>
      )}

      {tech.probes.length > 0 && (
        <>
          <h2 id={slugifyHeading(probesTitle)}>{probesTitle}</h2>
          <div className="mt-4 flex items-center gap-2 text-small text-inkMuted">
            <Target className="h-4 w-4 shrink-0 text-[color:var(--accent)]" aria-hidden />
            Where the conversation goes once you have named it.
          </div>
          <FollowUps items={tech.probes} />
        </>
      )}
    </>
  );
}
