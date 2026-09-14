import { Fragment } from "react";
import { parseSpec } from "@/lib/blocks";
import { cn } from "@/lib/utils";
import { HTTP_METHODS, MethodBadge, StatusBadge } from "./HttpBadge";
import { BlockHeader } from "./SchemaBlock";

type Lead = { kind: "method"; method: string } | { kind: "status"; code: number } | { kind: "none" };

interface Endpoint {
  lead: Lead;
  target: string;
  request: string;
  statuses: number[];
  response: string;
  note: string;
  details: string[];
}

const STATUS_CODE = /^[1-5]\d\d$/;
const LEADING_STATUSES = /^([1-5]\d\d(?:[\s,]+[1-5]\d\d)*)(?:\s+(.*))?$/;

/**
 * Row fields: `target || request || response || note`.
 * The target starts with an HTTP method (or, with @commands, any upper-case
 * command), a status code, or nothing at all for plain function calls.
 * Status codes at the start of the response become badges.
 */
function toEndpoint(fields: string[], details: string[], commands: boolean): Endpoint {
  const [target = "", request = "", response = "", note = ""] = fields;
  const [first = "", ...rest] = target.split(/\s+/);

  let lead: Lead = { kind: "none" };
  let path = target;
  if (STATUS_CODE.test(first)) {
    lead = { kind: "status", code: Number(first) };
    path = rest.join(" ");
  } else if (commands ? /^[A-Z]+$/.test(first) : HTTP_METHODS.has(first)) {
    lead = { kind: "method", method: first };
    path = rest.join(" ");
  }

  const match = LEADING_STATUSES.exec(response);
  return {
    lead,
    target: path,
    request,
    statuses: match ? match[1].split(/[\s,]+/).map(Number) : [],
    response: match ? (match[2] ?? "") : response,
    note,
    details,
  };
}

/** Path params and placeholders pick up the accent; the query string steps back. */
function Path({ value }: { value: string }) {
  const queryAt = value.indexOf("?");
  const base = queryAt === -1 ? value : value.slice(0, queryAt);
  const query = queryAt === -1 ? "" : value.slice(queryAt);

  return (
    <>
      {base.split(/(\{[^}]*\}|<[^>]*>)/).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="text-[color:var(--accent)]">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
      {query && <span className="text-inkFaint">{query}</span>}
    </>
  );
}

export function ApiBlock({ source }: { source: string }) {
  const { flags, groups } = parseSpec(source);
  const commands = flags.has("commands");
  const parsed = groups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => toEndpoint(row.fields, row.details, commands)),
  }));
  const hasLead = parsed.some((group) => group.rows.some((row) => row.lead.kind !== "none"));

  return (
    <div className="my-6 overflow-hidden rounded border border-rule bg-surface">
      {parsed.map((group, gi) => (
        <section key={gi} className={cn(gi > 0 && "border-t border-rule")}>
          <BlockHeader title={group.title} note={group.note} />
          <div className="divide-y divide-rule">
            {group.rows.map((row, ri) => (
              <div
                key={ri}
                className={cn(
                  "grid gap-x-3 gap-y-1.5 px-4 py-2.5",
                  hasLead
                    ? "grid-cols-[3.75rem_minmax(0,1fr)] md:grid-cols-[3.75rem_minmax(0,1fr)_minmax(0,17rem)]"
                    : "grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]",
                )}
              >
                {hasLead && (
                  <span className="pt-0.5">
                    {row.lead.kind === "method" && <MethodBadge method={row.lead.method} neutral={commands} />}
                    {row.lead.kind === "status" && <StatusBadge code={row.lead.code} withText={false} />}
                    {row.lead.kind === "none" && <MethodBadge method="FN" neutral />}
                  </span>
                )}

                <div className="min-w-0">
                  <div className="break-words font-mono text-small text-ink">
                    {row.lead.kind === "status" ? row.target : <Path value={row.target} />}
                  </div>
                  {row.request && (
                    <div className="mt-0.5 break-words font-mono text-tiny text-inkMuted">{row.request}</div>
                  )}
                  {row.details.length > 0 && (
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-tiny leading-relaxed text-inkMuted">
                      {row.details.join("\n")}
                    </pre>
                  )}
                  {row.note && <div className="mt-1 text-tiny text-inkFaint">{row.note}</div>}
                </div>

                {(row.statuses.length > 0 || row.response) && (
                  <div
                    className={cn(
                      "flex min-w-0 flex-wrap items-center gap-1.5 md:justify-end md:self-start md:pt-0.5",
                      hasLead && "col-start-2 md:col-start-auto",
                    )}
                  >
                    {row.statuses.map((code) => (
                      <StatusBadge key={code} code={code} />
                    ))}
                    {row.response && (
                      <span className="break-words font-mono text-tiny text-inkMuted">
                        <span aria-hidden className="text-inkFaint">
                          →{" "}
                        </span>
                        {row.response}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
