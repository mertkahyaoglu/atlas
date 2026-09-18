"use client";

import { AlertTriangle, CheckCircle2, CircleAlert, RotateCcw, Trash2 } from "lucide-react";
import { CHAT_PRESETS } from "@/lib/playground/scenarios/chat";
import { fmt } from "@/lib/playground/sim";
import type { SimResult } from "@/lib/playground/types";
import { usePlaygroundStore } from "@/store/usePlaygroundStore";
import { cn } from "@/lib/utils";

interface WorkloadPanelProps {
  result: SimResult;
}

/** Slider over a log scale so 200 and 4,000,000 fit on one track. */
function LogSlider({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  const pos = ((Math.log10(Math.max(min, value)) - lo) / (hi - lo)) * 1000;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-tiny text-inkMuted">{label}</span>
        <span className="font-mono text-tiny tabular-nums text-ink">
          {fmt(value)} {unit}
        </span>
      </span>
      <input
        type="range"
        min={0}
        max={1000}
        value={pos}
        onChange={(e) => onChange(Math.round(Math.pow(10, lo + (Number(e.target.value) / 1000) * (hi - lo))))}
        className="pg-range mt-1 w-full"
      />
    </label>
  );
}

export function WorkloadPanel({ result }: WorkloadPanelProps) {
  const workload = usePlaygroundStore((s) => s.workload);
  const preset = usePlaygroundStore((s) => s.preset);
  const setWorkload = usePlaygroundStore((s) => s.setWorkload);
  const applyPreset = usePlaygroundStore((s) => s.applyPreset);
  const loadStarter = usePlaygroundStore((s) => s.loadStarter);
  const clear = usePlaygroundStore((s) => s.clear);
  const select = usePlaygroundStore((s) => s.select);

  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-rule bg-surface">
      <div className="border-b border-rule px-4 py-3">
        <h2 className="text-small font-semibold text-ink">Chat app · scale</h2>
        <p className="mt-0.5 text-tiny leading-snug text-inkFaint">Pick a target, then make the system hold it.</p>
      </div>

      <div className="space-y-5 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-1.5">
          {CHAT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              className={cn(
                "rounded border px-2.5 py-1.5 text-left transition-colors duration-fast",
                preset === p.id ? "border-design bg-designSoft text-ink" : "border-rule text-inkMuted hover:border-ruleStrong hover:text-ink",
              )}
            >
              <span className="block text-small font-medium">{p.label}</span>
              <span className="block font-mono text-micro text-inkFaint">{p.note}</span>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <LogSlider label="Messages sent" value={workload.rps} min={10} max={10_000_000} unit="/s" onChange={(rps) => setWorkload({ rps })} />
          <LogSlider label="Concurrent sockets" value={workload.connections} min={100} max={100_000_000} unit="" onChange={(connections) => setWorkload({ connections })} />
          <label className="block">
            <span className="flex items-baseline justify-between">
              <span className="text-tiny text-inkMuted">Recipients per message</span>
              <span className="font-mono text-tiny tabular-nums text-ink">{workload.fanout}×</span>
            </span>
            <input type="range" min={1} max={50} value={workload.fanout} onChange={(e) => setWorkload({ fanout: Number(e.target.value) })} className="pg-range mt-1 w-full" />
          </label>
        </div>

        <section
          className={cn(
            "rounded border px-3 py-2.5",
            result.holds ? "border-[color:var(--tone-green-line)] bg-[color:var(--tone-green-soft)]" : "border-[color:var(--tone-red-line)] bg-[color:var(--tone-red-soft)]",
          )}
        >
          <p className="flex items-center gap-2 text-small font-medium text-ink">
            {result.holds ? (
              <CheckCircle2 className="h-4 w-4 text-[color:var(--tone-green)]" aria-hidden />
            ) : (
              <CircleAlert className="h-4 w-4 text-[color:var(--tone-red)]" aria-hidden />
            )}
            {result.holds ? "System holds" : `System breaks · ${errors.length} ${errors.length === 1 ? "problem" : "problems"}`}
          </p>
          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="mt-2 space-y-1.5">
              {[...errors, ...warnings].map((issue, i) => (
                <li key={i} className="flex items-start gap-1.5 text-tiny leading-snug text-inkMuted">
                  {issue.severity === "warning" && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[color:var(--tone-amber)]" aria-hidden />}
                  {issue.nodeId ? (
                    <button type="button" onClick={() => select(issue.nodeId!)} className="text-left hover:text-ink hover:underline">
                      {issue.message}
                    </button>
                  ) : (
                    <span>{issue.message}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-auto flex gap-1.5 border-t border-rule px-4 py-3">
        <button type="button" onClick={loadStarter} className="flex items-center gap-1.5 rounded border border-rule px-2.5 py-1.5 text-tiny text-inkMuted transition-colors duration-fast hover:text-ink">
          <RotateCcw className="h-3 w-3" aria-hidden /> Reset design
        </button>
        <button type="button" onClick={clear} className="flex items-center gap-1.5 rounded border border-rule px-2.5 py-1.5 text-tiny text-inkMuted transition-colors duration-fast hover:text-ink">
          <Trash2 className="h-3 w-3" aria-hidden /> Clear
        </button>
      </div>
    </aside>
  );
}
