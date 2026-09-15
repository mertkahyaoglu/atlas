"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useUiStore } from "@/store/useUiStore";

/** Mermaid's theme is set at init, so both palettes are declared up front. */
function themeVariables(dark: boolean) {
  return dark
    ? {
        background: "#161e29",
        primaryColor: "#1d2734",
        primaryTextColor: "#d7dee8",
        primaryBorderColor: "#35455a",
        lineColor: "#64728a",
        secondaryColor: "#1d2734",
        tertiaryColor: "#101720",
        clusterBkg: "#131b24",
        clusterBorder: "#253242",
        titleColor: "#d7dee8",
        edgeLabelBackground: "#101720",
        textColor: "#d7dee8",
        noteBkgColor: "#1d2734",
        noteBorderColor: "#35455a",
        noteTextColor: "#d7dee8",
        attributeBackgroundColorOdd: "#161e29",
        attributeBackgroundColorEven: "#1d2734",
        fontSize: "13px",
      }
    : {
        background: "#ffffff",
        primaryColor: "#f2f4f7",
        primaryTextColor: "#16202c",
        primaryBorderColor: "#c2ccd8",
        lineColor: "#8593a6",
        secondaryColor: "#e9edf2",
        tertiaryColor: "#f7f9fb",
        clusterBkg: "#f7f9fb",
        clusterBorder: "#dbe2ea",
        titleColor: "#16202c",
        edgeLabelBackground: "#ffffff",
        textColor: "#16202c",
        noteBkgColor: "#f7f9fb",
        noteBorderColor: "#c2ccd8",
        noteTextColor: "#16202c",
        attributeBackgroundColorOdd: "#ffffff",
        attributeBackgroundColorEven: "#f2f4f7",
        fontSize: "13px",
      };
}

/**
 * With SVG labels Mermaid sanitizes label text into serialized HTML and then
 * writes it as textContent, so `>` shows up as a literal "&gt;". Decode the
 * common entities back; assigning textContent never parses markup.
 */
const ENTITIES: Record<string, string> = { "&gt;": ">", "&lt;": "<", "&amp;": "&", "&quot;": '"', "&#39;": "'" };

function decodeLabelEntities(root: HTMLElement) {
  root.querySelectorAll("text, tspan").forEach((el) => {
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes("&")) {
        node.textContent = node.textContent.replace(/&(gt|lt|amp|quot|#39);/g, (m) => ENTITIES[m]);
      }
    });
  });
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

/**
 * Mermaid sizes a chart as 100% wide, capped at its natural width. Zoom scales
 * both terms, so 1 is the default fit and the SVG is redrawn crisp at any size.
 */
function applyZoom(host: HTMLElement, zoom: number) {
  const svg = host.querySelector("svg");
  const natural = svg?.viewBox.baseVal?.width;
  if (!svg || !natural) return;
  svg.style.maxWidth = "none";
  svg.style.width = `min(${natural * zoom}px, ${zoom * 100}%)`;
}

function ZoomButton({ label, onClick, disabled, children }: {
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
      className="flex h-6 w-6 items-center justify-center rounded-sm text-inkMuted transition-colors duration-fast hover:bg-surface hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function Mermaid({ chart }: { chart: string }) {
  const theme = useUiStore((s) => s.theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  // Read by the render effect, so a theme re-render keeps the current zoom.
  const zoomRef = useRef(1);
  const reactId = useId();
  const graphId = `mermaid-${reactId.replace(/[:]/g, "")}`;

  useEffect(() => {
    let cancelled = false;

    async function render() {
      // Dynamic import keeps ~500KB of Mermaid out of the initial bundle.
      const mermaid = (await import("mermaid")).default;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        // Strict mode sanitizes the SVG, which strips HTML inside <foreignObject>
        // and leaves every label blank. Plain SVG <text> labels survive it.
        htmlLabels: false,
        theme: "base",
        fontFamily: "var(--font-mono), monospace",
        themeVariables: themeVariables(theme === "dark"),
        flowchart: { htmlLabels: false, curve: "basis", nodeSpacing: 36, rankSpacing: 46, padding: 12 },
      });

      try {
        const { svg } = await mermaid.render(graphId, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          decodeLabelEntities(containerRef.current);
          applyZoom(containerRef.current, zoomRef.current);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Diagram failed to render");
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [chart, theme, graphId]);

  function changeZoom(next: number) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const scroller = scrollerRef.current;
    const host = containerRef.current;
    if (!scroller || !host) return;

    // Keep whatever is in the middle of the view in the middle after resizing.
    const center = (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth;
    zoomRef.current = clamped;
    setZoom(clamped);
    applyZoom(host, clamped);
    scroller.scrollLeft = center * scroller.scrollWidth - scroller.clientWidth / 2;
  }

  if (error) {
    return (
      <div className="my-6 rounded border border-rule bg-surface p-4">
        <p className="mb-2 text-tiny text-inkMuted">
          This diagram could not be drawn. The source is below.
        </p>
        <pre className="overflow-x-auto font-mono text-tiny text-inkFaint">{chart}</pre>
      </div>
    );
  }

  return (
    <figure className="relative my-8 rounded border border-rule bg-surface">
      <div
        role="toolbar"
        aria-label="Diagram zoom"
        className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded border border-rule bg-raised p-0.5"
      >
        <ZoomButton label="Zoom out" onClick={() => changeZoom(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}>
          <ZoomOut className="h-3.5 w-3.5" aria-hidden />
        </ZoomButton>
        <span aria-live="polite" className="min-w-[2.75rem] text-center font-mono text-micro tabular-nums text-inkMuted">
          {Math.round(zoom * 100)}%
        </span>
        <ZoomButton label="Zoom in" onClick={() => changeZoom(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}>
          <ZoomIn className="h-3.5 w-3.5" aria-hidden />
        </ZoomButton>
        <ZoomButton label="Reset zoom" onClick={() => changeZoom(1)} disabled={zoom === 1}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </ZoomButton>
      </div>

      {/* Top padding clears the toolbar so it never covers the first row of nodes. */}
      <div ref={scrollerRef} className="overflow-x-auto px-5 pb-5 pt-11">
        <div ref={containerRef} className="mermaid-host min-h-[3rem]" />
      </div>
    </figure>
  );
}
