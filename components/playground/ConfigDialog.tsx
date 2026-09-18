"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BookOpen, Minus, Plus, Trash2, X } from "lucide-react";
import { COMPONENTS, type FieldDef } from "@/lib/playground/components";
import { fmt } from "@/lib/playground/sim";
import type { NodeStats, PlaygroundNode } from "@/lib/playground/types";
import { usePlaygroundStore } from "@/store/usePlaygroundStore";
import { cn } from "@/lib/utils";

interface ConfigDialogProps {
  node: PlaygroundNode;
  stats?: NodeStats;
  onClose: () => void;
}

function stepFor(field: FieldDef, value: number, dir: 1 | -1) {
  // Log fields step by ~25% so 1 → 5000 instances takes a few clicks, not thousands.
  if (field.log) {
    const next = dir > 0 ? Math.ceil(value * 1.25) : Math.floor(value / 1.25);
    return Math.max(field.min, Math.min(field.max, next === value ? value + dir : next));
  }
  return Math.max(field.min, Math.min(field.max, value + dir * field.step));
}

function Field({ field, value, onChange }: { field: FieldDef; value: number; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="flex items-baseline justify-between text-tiny text-inkMuted">
        {field.label}
        {field.unit && <span className="font-mono text-micro text-inkFaint">{field.unit}</span>}
      </label>
      <div className="mt-1 flex items-stretch overflow-hidden rounded border border-rule">
        <button type="button" aria-label="Decrease" onClick={() => onChange(stepFor(field, value, -1))} className="flex w-8 items-center justify-center text-inkMuted hover:bg-raised hover:text-ink">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          id={id}
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={value}
          onChange={(e) => onChange(Math.max(field.min, Math.min(field.max, Number(e.target.value) || field.min)))}
          className="min-w-0 flex-1 border-x border-rule bg-transparent px-2 py-1.5 text-center font-mono text-small tabular-nums text-ink outline-none"
        />
        <button type="button" aria-label="Increase" onClick={() => onChange(stepFor(field, value, 1))} className="flex w-8 items-center justify-center text-inkMuted hover:bg-raised hover:text-ink">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Tune one component. Reuses the doc diagram's dialog styling; live load stays in view while editing. */
export function ConfigDialog({ node, stats, onClose }: ConfigDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const def = COMPONENTS[node.data.kind];
  const updateNode = usePlaygroundStore((s) => s.updateNode);
  const removeNode = usePlaygroundStore((s) => s.removeNode);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const setField = (key: string, value: number) => updateNode(node.id, { config: { ...node.data.config, [key]: value } });
  const util = stats ? Math.round(stats.utilization * 100) : 0;

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="flow-dialog"
      style={{ "--tone": def.tone } as CSSProperties}
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flow-dialog__header flex items-start gap-3 border-b border-rule px-5 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <span className="flow-dialog__kind">{def.label}</span>
            <input
              id={titleId}
              aria-label="Name"
              value={node.data.name}
              onChange={(e) => updateNode(node.id, { name: e.target.value })}
              className="mt-2 w-full rounded border border-transparent bg-transparent px-1 -mx-1 text-h3 font-semibold text-ink outline-none hover:border-rule focus:border-ruleStrong"
            />
            <p className="mt-1 text-tiny text-inkFaint">{def.description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-inkMuted transition-colors duration-fast hover:bg-raised hover:text-ink">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="space-y-5 overflow-y-auto px-5 py-5">
          {stats && !def.source && (
            <section className={cn("rounded border px-3 py-2.5", stats.status === "overloaded" ? "border-[color:var(--tone-red-line)] bg-[color:var(--tone-red-soft)]" : "border-rule bg-raised")}>
              <div className="flex items-baseline justify-between">
                <span className="text-tiny text-inkMuted">Current load</span>
                <span className={cn("font-mono text-small tabular-nums", stats.status === "overloaded" ? "text-[color:var(--tone-red)]" : "text-ink")}>{util}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rule">
                <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(100, util)}%`, background: stats.status === "overloaded" ? "var(--tone-red)" : stats.status === "hot" ? "var(--tone-amber)" : "var(--tone)" }} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-micro text-inkMuted">
                <dt>Requests</dt>
                <dd className="text-right tabular-nums text-ink">{fmt(stats.rpsIn)} / {fmt(stats.rpsCapacity)} rps</dd>
                {stats.connectionsCapacity !== Infinity && (
                  <>
                    <dt>Sockets</dt>
                    <dd className="text-right tabular-nums text-ink">{fmt(stats.connectionsIn)} / {fmt(stats.connectionsCapacity)}</dd>
                  </>
                )}
                {stats.shed > 0 && (
                  <>
                    <dt>Dropped</dt>
                    <dd className="text-right tabular-nums text-[color:var(--tone-red)]">{fmt(stats.shed)} rps</dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {def.fields.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {def.fields.map((field) => (
                <Field key={field.key} field={field} value={node.data.config[field.key] ?? def.defaults[field.key] ?? field.min} onChange={(v) => setField(field.key, v)} />
              ))}
            </div>
          ) : (
            <p className="text-small text-inkMuted">Traffic from clients is set by the scale panel.</p>
          )}

          <div className="flex items-center justify-between border-t border-rule pt-4">
            {def.href ? (
              <Link href={`/docs/${def.href}`} className="flex items-center gap-1.5 text-tiny text-inkMuted hover:text-ink">
                <BookOpen className="h-3.5 w-3.5" aria-hidden /> Read about {def.label.toLowerCase()}s
              </Link>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => {
                removeNode(node.id);
                onClose();
              }}
              className="flex items-center gap-1.5 rounded border border-rule px-2.5 py-1.5 text-tiny text-inkMuted transition-colors duration-fast hover:border-[color:var(--tone-red-line)] hover:text-[color:var(--tone-red)]"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
            </button>
          </div>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
