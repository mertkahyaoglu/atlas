import { Check, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineMarkdown } from "./InlineMarkdown";

/**
 * The pieces the design and technology panels share. Built from divs and
 * spans rather than ul/p so the long-form `.doc` list and paragraph styles
 * don't leak in.
 */

export const ACCENT_TINT = "bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface))]";

export function PanelLabel({ icon: Icon, children, note }: {
  icon: LucideIcon;
  children: React.ReactNode;
  note?: string;
}) {
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

export function MarkedList({ items, marker }: { items: string[]; marker: "check" | "diamond" | "cross" }) {
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

/**
 * A heading rendered by a panel rather than by the markdown body. Not an
 * <h3>: `.doc h3` outranks utility classes and would restyle it.
 */
export function CardHeading({ children }: { children: React.ReactNode }) {
  return (
    <div role="heading" aria-level={3} className="text-small font-semibold leading-snug text-ink">
      {children}
    </div>
  );
}
