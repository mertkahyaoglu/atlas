"use client";

import { useEffect, useId, useRef, useState } from "react";
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

/**
 * Mermaid writes a node's tooltip as escaped text and only restores the exact
 * string `<br/>`, but sanitizing may have turned it into `<br>`. Runs after
 * Mermaid's own hover handler and turns any escaped break back into a real one.
 * Only break tokens are unescaped; everything else stays escaped text.
 */
function restoreTooltipBreaks() {
  const tooltip = document.querySelector(".mermaidTooltip");
  if (tooltip && tooltip.innerHTML.includes("&lt;br")) {
    tooltip.innerHTML = tooltip.innerHTML.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
  }
}

export function Mermaid({ chart }: { chart: string }) {
  const theme = useUiStore((s) => s.theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
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
        const { svg, bindFunctions } = await mermaid.render(graphId, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          decodeLabelEntities(containerRef.current);
          // Attaches node tooltips and links declared with `click` in the chart.
          bindFunctions?.(containerRef.current);
          containerRef.current.querySelectorAll(".node[title]").forEach((node) => {
            node.addEventListener("mouseover", restoreTooltipBreaks);
          });
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
    <figure className="my-8 overflow-x-auto rounded border border-rule bg-surface p-5">
      <div ref={containerRef} className="mermaid-host flex min-h-[3rem] justify-center" />
    </figure>
  );
}
