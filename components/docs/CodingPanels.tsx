import { AlertTriangle, Target } from "lucide-react";
import { CODING_TITLES, slugifyHeading } from "@/lib/content";
import type { CodingDetails } from "@/lib/types";
import { InlineMarkdown } from "./InlineMarkdown";

function PanelHeading({ title, icon }: { title: string; icon?: React.ReactNode }) {
  return (
    <h2 id={slugifyHeading(title)} className="flex items-center gap-2">
      {icon}
      {title}
    </h2>
  );
}

/** The cost table and the signals that call for the structure, above the body. */
export function CodingOverview({ coding }: { coding: CodingDetails }) {
  return (
    <>
      {coding.complexity.length > 0 && (
        <section>
          <PanelHeading title={CODING_TITLES.cost} />
          <div className="overflow-x-auto rounded border border-rule">
            <table className="w-full border-collapse text-small">
              <thead>
                <tr>
                  <th className="border-b border-ruleStrong px-3 py-2 text-left font-semibold text-inkMuted">
                    Operation
                  </th>
                  <th className="w-20 border-b border-ruleStrong px-3 py-2 text-left font-semibold text-inkMuted">
                    Time
                  </th>
                  <th className="w-20 border-b border-ruleStrong px-3 py-2 text-left font-semibold text-inkMuted">
                    Space
                  </th>
                  <th className="border-b border-ruleStrong px-3 py-2 text-left font-semibold text-inkMuted">Why</th>
                </tr>
              </thead>
              <tbody>
                {coding.complexity.map((row) => (
                  <tr key={row.op} className="border-b border-rule last:border-b-0">
                    <td className="px-3 py-2.5 align-top text-ink">{row.op}</td>
                    <td className="px-3 py-2.5 align-top font-mono text-tiny text-[color:var(--accent)]">{row.time}</td>
                    <td className="px-3 py-2.5 align-top font-mono text-tiny text-inkMuted">{row.space ?? "—"}</td>
                    <td className="px-3 py-2.5 align-top text-inkMuted">
                      {row.note && <InlineMarkdown>{row.note}</InlineMarkdown>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {coding.reachFor.length > 0 && (
        <section>
          <PanelHeading
            title={CODING_TITLES.reachFor}
            icon={<Target className="h-4 w-4 text-[color:var(--accent)]" aria-hidden />}
          />
          <ul className="plain grid gap-2 sm:grid-cols-2">
            {coding.reachFor.map((item) => (
              <li key={item} className="rounded border border-rule bg-surface px-3 py-2.5 text-small text-inkMuted">
                <InlineMarkdown>{item}</InlineMarkdown>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** The pitfalls, below the body. */
export function CodingPitfalls({ coding }: { coding: CodingDetails }) {
  if (coding.pitfalls.length === 0) return null;

  return (
    <section>
      <PanelHeading
        title={CODING_TITLES.pitfalls}
        icon={<AlertTriangle className="h-4 w-4 text-[color:var(--tone-amber)]" aria-hidden />}
      />
      <ul className="plain grid gap-2">
        {coding.pitfalls.map((item) => (
          <li
            key={item}
            className="border-l-2 border-[color:var(--tone-amber)] bg-surface py-2 pl-4 pr-3 text-small text-inkMuted"
          >
            <InlineMarkdown>{item}</InlineMarkdown>
          </li>
        ))}
      </ul>
    </section>
  );
}
