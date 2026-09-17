"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { Maximize2, Minimize2, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { FIT_PADDING } from "./DiagramFrame";

function subscribeCoarse(onChange: () => void) {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Touch screens: dragging the inline diagram would trap the page's scroll. */
export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

/**
 * Fit from the drawing's known size rather than measured nodes: a diagram in
 * a hidden tab has nothing to measure, and this also refits when the pane is
 * resized, shown, or expanded. Never enlarges past 100%. `ready` turns true
 * after the first fit, so the canvas can stay hidden until then.
 */
export function useFitView(contentWidth: number, contentHeight: number) {
  const { setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const [ready, setReady] = useState(false);

  const fit = useCallback(
    (duration = 0) => {
      if (!width || !height) return;
      const z = Math.min((width - FIT_PADDING * 2) / contentWidth, (height - FIT_PADDING * 2) / contentHeight, 1);
      setViewport({ x: (width - contentWidth * z) / 2, y: (height - contentHeight * z) / 2, zoom: z }, { duration });
    },
    [width, height, contentWidth, contentHeight, setViewport],
  );

  useEffect(() => {
    if (!width || !height) return;
    fit();
    setReady(true);
  }, [width, height, fit]);

  return { fit, ready };
}

function ToolbarButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-sm text-inkMuted transition-colors duration-fast hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function CanvasToolbar({ expanded, onToggleExpanded, onFit }: {
  expanded: boolean;
  onToggleExpanded: () => void;
  onFit: () => void;
}) {
  const { zoomIn, zoomOut } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const minZoom = useStore((s) => s.minZoom);
  const maxZoom = useStore((s) => s.maxZoom);

  return (
    <div
      role="toolbar"
      aria-label="Diagram view"
      className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded border border-rule bg-surface/90 p-0.5 shadow-sm backdrop-blur"
    >
      <ToolbarButton label="Zoom out" onClick={() => zoomOut({ duration: 150 })} disabled={zoom <= minZoom}>
        <ZoomOut className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <span aria-live="polite" className="min-w-[2.75rem] text-center font-mono text-micro tabular-nums text-inkMuted">
        {Math.round(zoom * 100)}%
      </span>
      <ToolbarButton label="Zoom in" onClick={() => zoomIn({ duration: 150 })} disabled={zoom >= maxZoom}>
        <ZoomIn className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton label="Fit to view" onClick={onFit}>
        <Scan className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <span className="mx-0.5 h-4 w-px bg-rule" aria-hidden />
      <ToolbarButton label={expanded ? "Exit full screen" : "Full screen"} onClick={onToggleExpanded}>
        {expanded ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
      </ToolbarButton>
    </div>
  );
}
