import { Ban, Check, Crosshair, Gauge, Layers, ListChecks, Ruler, X, type LucideIcon } from "lucide-react";
import { DESIGN_CLOSING_TITLES, DESIGN_OPENING_TITLES, slugifyHeading } from "@/lib/content";
import type { DesignDetails, DesignTradeoff } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FollowUps } from "./FollowUps";
import { InlineMarkdown } from "./InlineMarkdown";
import { Markdown } from "./Markdown";

/**
 * Structured panels for the opening sections of a design doc, rendered from
 * frontmatter. Built from divs and spans rather than ul/p so the long-form
 * `.doc` list and paragraph styles don't leak in.
 */

const ACCENT_TINT = "bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface))]";

function PanelLabel({ icon: Icon, children, note }: { icon: LucideIcon; children: React.ReactNode; note?: string }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-rule bg-raised text-[color:var(--accent)]">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="font-mono text-micro uppercase tracking-wide text-inkMuted">{children}</span>
      {note && <span className="text-tiny text-inkFaint">{note}</span>}
    </div>
  );
}

function ConceptsPanel({ concepts, hardPart }: { concepts: string[]; hardPart: string }) {
  return (
    <div className="my-6 grid gap-4 md:grid-cols-2">
      <div className="rounded-md border border-rule bg-surface p-5">
        <PanelLabel icon={Layers}>Concepts</PanelLabel>
        <div className="flex flex-wrap gap-1.5">
          {concepts.map((concept) => (
            <span
              key={concept}
              className="rounded-sm border border-rule bg-raised px-2 py-1 text-tiny leading-snug text-ink"
            >
              <InlineMarkdown>{concept}</InlineMarkdown>
            </span>
          ))}
        </div>
      </div>

      <div className={cn("rounded-md border border-l-2 border-rule border-l-[color:var(--accent)] p-5", ACCENT_TINT)}>
        <PanelLabel icon={Crosshair}>The hard part they&rsquo;re probing</PanelLabel>
        <div className="text-small leading-relaxed text-ink">
          <InlineMarkdown>{hardPart}</InlineMarkdown>
        </div>
      </div>
    </div>
  );
}

function RequirementList({ items, marker }: { items: string[]; marker: "check" | "diamond" | "cross" }) {
  return (
    <div role="list" className="space-y-2.5">
      {items.map((item, i) => (
        <div
          role="listitem"
          key={i}
          className={cn("flex gap-2.5 text-small leading-relaxed", marker === "cross" ? "text-inkMuted" : "text-ink")}
        >
          {marker === "check" ? (
            <Check className="mt-[5px] h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" aria-hidden />
          ) : marker === "cross" ? (
            <X className="mt-[5px] h-3.5 w-3.5 shrink-0 text-inkFaint" aria-hidden />
          ) : (
            <span aria-hidden className="ml-1 mr-0.5 mt-[9px] h-1.5 w-1.5 shrink-0 rotate-45 bg-[color:var(--accent)]" />
          )}
          <span className="min-w-0">
            <InlineMarkdown>{item}</InlineMarkdown>
          </span>
        </div>
      ))}
    </div>
  );
}

function RequirementsPanel({ requirements, scale }: Pick<DesignDetails, "requirements" | "scale">) {
  return (
    <div className="my-6 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-rule bg-surface p-5">
          <PanelLabel icon={ListChecks} note="what it must do">
            Functional
          </PanelLabel>
          <RequirementList items={requirements.functional} marker="check" />
        </div>
        <div className="rounded-md border border-rule bg-surface p-5">
          <PanelLabel icon={Gauge} note="how well it must do it">
            Non-functional
          </PanelLabel>
          <RequirementList items={requirements.nonFunctional} marker="diamond" />
        </div>
      </div>

      {requirements.outOfScope.length > 0 && (
        <div className="rounded-md border border-dashed border-ruleStrong p-5">
          <PanelLabel icon={Ban} note="deliberately left out">
            Out of scope
          </PanelLabel>
          <RequirementList items={requirements.outOfScope} marker="cross" />
        </div>
      )}

      {scale && (
        <div className="overflow-hidden rounded-md border border-rule bg-surface">
          <div className="px-5 pt-4">
            <PanelLabel icon={Ruler}>Scale</PanelLabel>
          </div>
          <pre className="overflow-x-auto px-5 pb-4 font-mono text-tiny leading-relaxed text-ink">{scale.numbers}</pre>
          {scale.conclusion && (
            <div className={cn("border-t border-rule px-5 py-4", ACCENT_TINT)}>
              <span className="mb-1.5 block font-mono text-micro uppercase tracking-wide text-[color:var(--accent)]">
                Conclusion
              </span>
              <div className="text-small leading-relaxed text-ink">
                <InlineMarkdown>{scale.conclusion}</InlineMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The two opening sections, with real headings so the table of contents
 * (see `designToc`) can link to them.
 */
export function DesignOverview({ design }: { design: DesignDetails }) {
  const [conceptsTitle, requirementsTitle] = DESIGN_OPENING_TITLES;

  return (
    <>
      <h2 id={slugifyHeading(conceptsTitle)}>{conceptsTitle}</h2>
      <ConceptsPanel concepts={design.concepts} hardPart={design.hardPart} />
      <hr />
      <h2 id={slugifyHeading(requirementsTitle)}>{requirementsTitle}</h2>
      <RequirementsPanel requirements={design.requirements} scale={design.scale} />
      <hr />
    </>
  );
}

/**
 * Which trade-off cards span both columns: ones with code or tables, or long
 * bodies. A narrow card that would sit alone in a row widens to fill it, so
 * the grid never leaves a hole while keeping the reading order.
 */
function wideTradeoffs(items: DesignTradeoff[]): boolean[] {
  const wide = items.map((item) => /```|^\s*\|/m.test(item.body) || item.body.length > 700);
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

/** The two closing sections, rendered after the markdown body. */
export function DesignDeepDives({ design }: { design: DesignDetails }) {
  const [tradeoffsTitle, followUpsTitle] = DESIGN_CLOSING_TITLES;
  const wide = wideTradeoffs(design.tradeoffs);

  return (
    <>
      {design.tradeoffs.length > 0 && (
        <>
          <h2 id={slugifyHeading(tradeoffsTitle)}>{tradeoffsTitle}</h2>
          <div className="my-6 grid gap-4 md:grid-cols-2">
            {design.tradeoffs.map((tradeoff, i) => (
              <div
                key={i}
                className={cn("min-w-0 rounded-md border border-rule bg-surface p-5", wide[i] && "md:col-span-2")}
              >
                <div className="mb-3 flex items-start gap-3">
                  <span className="mt-px flex h-6 min-w-[1.75rem] shrink-0 items-center justify-center rounded border border-rule bg-raised px-1 font-mono text-micro tabular-nums text-[color:var(--accent)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {/* Not an <h3>: `.doc h3` outranks utility classes and would restyle it. */}
                  <div role="heading" aria-level={3} className="text-small font-semibold leading-snug text-ink">
                    <InlineMarkdown>{tradeoff.title}</InlineMarkdown>
                  </div>
                </div>
                <div className="min-w-0 text-small leading-relaxed text-inkMuted [&>*+*]:mt-3 [&_p]:max-w-none">
                  <Markdown content={tradeoff.body} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {design.followUps.length > 0 && (
        <>
          {design.tradeoffs.length > 0 && <hr />}
          <h2 id={slugifyHeading(followUpsTitle)}>{followUpsTitle}</h2>
          <FollowUps items={design.followUps} />
        </>
      )}
    </>
  );
}
