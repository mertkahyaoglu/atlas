import { parseSpec } from "@/lib/blocks";
import { cn } from "@/lib/utils";

interface Key {
  label?: string;
  value: string;
}

/** `PK: a  SK: b  UNIQUE: (c, d)` → labelled chips; anything unlabelled stays one chip. */
function parseKeys(text: string): Key[] {
  if (!text) return [];
  return text
    .split(/(?=\b(?:PK|SK|UNIQUE):)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(PK|SK|UNIQUE):\s*(.*)$/.exec(part);
      return match ? { label: match[1], value: match[2] } : { value: part };
    });
}

/**
 * Group heading shared by API and schema blocks. Spans rather than h4/p so the
 * long-form `.doc` heading and paragraph styles don't apply inside the block.
 */
export function BlockHeader({ title, note }: { title?: string; note?: string }) {
  if (!title) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-rule bg-canvas px-4 py-2">
      <span className="text-tiny font-semibold text-ink">{title}</span>
      {note && <span className="text-tiny text-inkFaint">{note}</span>}
    </div>
  );
}

/** Row fields: `name || keys || fields || note`. */
export function SchemaBlock({ source }: { source: string }) {
  const { groups } = parseSpec(source);

  return (
    <div className="my-6 overflow-hidden rounded border border-rule bg-surface">
      {groups.map((group, gi) => (
        <section key={gi} className={cn(gi > 0 && "border-t border-rule")}>
          <BlockHeader title={group.title} note={group.note} />
          <div className="divide-y divide-rule">
            {group.rows.map((row, ri) => {
              const [name = "", keysText = "", fields = "", note = ""] = row.fields;
              const keys = parseKeys(keysText);

              return (
                <div key={ri} className="grid gap-x-6 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <div className="break-words font-mono text-small font-semibold text-ink">{name}</div>
                    {keys.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {keys.map((key, ki) => (
                          <span
                            key={ki}
                            className="inline-flex min-w-0 max-w-full overflow-hidden rounded-sm border border-rule font-mono text-micro"
                          >
                            {key.label && (
                              <span className="shrink-0 bg-raised px-1.5 py-px font-semibold text-[color:var(--accent)]">
                                {key.label}
                              </span>
                            )}
                            <span className="min-w-0 break-words px-1.5 py-px text-inkMuted">{key.value}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 md:pt-0.5">
                    {fields && (
                      <div className="break-words font-mono text-tiny leading-relaxed text-inkMuted">{fields}</div>
                    )}
                    {row.details.length > 0 && (
                      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-tiny leading-relaxed text-inkMuted">
                        {row.details.join("\n")}
                      </pre>
                    )}
                    {note && (
                      <div className="mt-1.5 border-l-2 border-[color:var(--accent)] pl-2 text-tiny leading-relaxed text-inkMuted">
                        {note}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
