"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, Scale, Target, X } from "lucide-react";
import { FLAGS, KINDS } from "@/lib/diagram/kinds";
import type { DiagramLayout, LaidOutNode } from "@/lib/diagram/layout";
import { useDocTitle } from "./DocTitles";

interface NodeDetailDialogProps {
  node: LaidOutNode;
  layout: DiagramLayout;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function Section({ icon: Icon, label, children }: { icon: typeof Target; label: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-rule bg-raised text-inkMuted">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h3 className="font-mono text-micro uppercase tracking-wider text-inkFaint">{label}</h3>
        <div className="mt-1 text-small text-ink">{children}</div>
      </div>
    </section>
  );
}

/**
 * Explains one node: what it does here and what it costs, from the chart's
 * `click` line when there is one and from its kind otherwise. Portalled to
 * <body> so the doc's prose styles don't reach it; a native modal <dialog>
 * provides the focus trap, Escape and backdrop.
 */
export function NodeDetailDialog({ node, layout, onSelect, onClose }: NodeDetailDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const docTitle = useDocTitle(node.href);
  const info = KINDS[node.kind];
  const [title, ...details] = node.lines;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // A chart's own notes replace the general ones, rather than sitting beside them.
  const specific = Boolean(node.role || node.tradeoff);
  const purpose = specific ? node.role : info.purpose;
  const tradeoff = specific ? node.tradeoff : info.tradeoff;

  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const visible = layout.edges.filter((edge) => edge.line !== "invisible");
  const connections = [
    ...visible
      .filter((edge) => edge.target === node.id && byId.has(edge.source))
      .map((edge) => ({ edge, other: byId.get(edge.source)!, incoming: true })),
    ...visible
      .filter((edge) => edge.source === node.id && byId.has(edge.target))
      .map((edge) => ({ edge, other: byId.get(edge.target)!, incoming: false })),
  ];

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // The dialog box itself has no padding, so a click on it is a click on the backdrop.
      onClick={(event) => event.target === event.currentTarget && onClose()}
      className="flow-dialog"
      style={{ "--tone": info.tone } as CSSProperties}
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flow-dialog__header flex items-start gap-3 border-b border-rule px-5 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flow-dialog__kind">{info.label}</span>
              {node.hot && <span className="flow-dialog__flag flow-dialog__flag--hot">{FLAGS.hot.label}</span>}
              {node.scaled && <span className="flow-dialog__flag">{FLAGS.scaled.label}</span>}
            </div>
            <h2 id={titleId} className="mt-2 text-h3 font-semibold text-ink">
              {title}
            </h2>
            {details.length > 0 && (
              <div className="mt-1 space-y-0.5 font-mono text-tiny text-inkMuted">
                {details.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-inkMuted transition-colors duration-fast hover:bg-raised hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="space-y-5 overflow-y-auto px-5 py-5">
          {!specific && (
            <p className="text-tiny text-inkFaint">
              General notes on this kind of component. This diagram doesn&apos;t add specifics for it.
            </p>
          )}
          {purpose && (
            <Section icon={Target} label="Purpose">
              {purpose}
            </Section>
          )}
          {tradeoff && (
            <Section icon={Scale} label="Trade-off">
              {tradeoff}
            </Section>
          )}
          {node.note && <p className="text-small text-inkMuted">{node.note}</p>}
          {node.hot && <p className="text-small text-inkMuted">{FLAGS.hot.description}</p>}
          {node.scaled && <p className="text-small text-inkMuted">{FLAGS.scaled.description}</p>}

          {connections.length > 0 && (
            <section>
              <h3 className="font-mono text-micro uppercase tracking-wider text-inkFaint">Connections</h3>
              <ul className="mt-2 divide-y divide-rule overflow-hidden rounded border border-rule">
                {connections.map(({ edge, other, incoming }) => (
                  <li key={edge.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(other.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-fast hover:bg-raised"
                    >
                      {incoming ? (
                        <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-inkFaint" aria-label="From" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-inkFaint" aria-label="To" />
                      )}
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: KINDS[other.kind].tone }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-small text-ink">{other.lines[0]}</span>
                      {edge.label.length > 0 && (
                        <span className="max-w-[45%] truncate font-mono text-micro text-inkFaint">
                          {edge.label.join(" ")}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {node.href && (
          <footer className="border-t border-rule px-5 py-3">
            <Link
              href={node.href}
              onClick={onClose}
              className="group inline-flex items-center gap-2 text-small font-medium text-[color:var(--concept)]"
            >
              <BookOpen className="h-4 w-4" aria-hidden />
              <span>
                Read the concept{docTitle ? <>: {docTitle}</> : null}
              </span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-fast group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </footer>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
