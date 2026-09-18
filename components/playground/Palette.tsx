"use client";

import type { CSSProperties, DragEvent } from "react";
import { COMPONENTS, PALETTE } from "@/lib/playground/components";
import type { ComponentKind } from "@/lib/playground/types";
import { KIND_ICONS } from "./ComponentNode";

export const DRAG_TYPE = "application/atlas-component";

interface PaletteProps {
  /** Tap-to-add for touch screens, where HTML drag and drop doesn't fire. */
  onAdd: (kind: ComponentKind) => void;
}

export function Palette({ onAdd }: PaletteProps) {
  function onDragStart(event: DragEvent, kind: ComponentKind) {
    event.dataTransfer.setData(DRAG_TYPE, kind);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-rule bg-surface">
      <div className="border-b border-rule px-4 py-3">
        <h2 className="text-small font-semibold text-ink">Components</h2>
        <p className="mt-0.5 text-tiny leading-snug text-inkFaint">Drag onto the canvas, or click to add.</p>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
        {PALETTE.map((kind) => {
          const def = COMPONENTS[kind];
          const Icon = KIND_ICONS[kind];
          return (
            <li key={kind}>
              <button
                type="button"
                draggable
                onDragStart={(e) => onDragStart(e, kind)}
                onClick={() => onAdd(kind)}
                title={def.description}
                style={{ "--tone": def.tone } as CSSProperties}
                className="pg-palette-item flex w-full cursor-grab items-center gap-2.5 rounded border border-transparent px-2 py-1.5 text-left transition-colors duration-fast hover:border-rule hover:bg-raised active:cursor-grabbing"
              >
                <span className="flow-node__icon" aria-hidden>
                  <Icon strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className="block text-small text-ink">{def.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
