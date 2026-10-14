"use client";

import { lazy, Suspense, useState } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
}

const HighlightedCode = lazy(() => import("./HighlightedCode").then((m) => ({ default: m.HighlightedCode })));

/**
 * Fence tags that get syntax highlighting. An explicit list rather than a
 * lookup in Prism's registry, so deciding costs nothing and pages whose blocks
 * are all `text` never load Prism at all.
 */
const HIGHLIGHTED = new Set([
  "bash", "sh", "shell",
  "css",
  "go",
  "js", "javascript", "jsx",
  "json",
  "py", "python",
  "rust",
  "sql",
  "ts", "typescript", "tsx",
  "yaml", "yml",
]);

/**
 * Most fenced blocks are schemas, API shapes and ASCII sketches tagged `text`,
 * which stay plain. Blocks tagged with a real language (python, sql, ts) are
 * highlighted, since the AI course reads mostly as code. The plain block is
 * also the fallback while the highlighter loads on a client-side navigation.
 */
export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lang = language?.toLowerCase();
  const plain = <code className="font-mono text-tiny leading-relaxed text-ink">{code}</code>;

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="group relative my-6 rounded border border-rule bg-surface">
      <div className="flex items-center justify-between border-b border-rule px-3 py-1.5">
        <span className="font-mono text-micro text-inkFaint">{language || "text"}</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="text-inkFaint transition-colors duration-fast hover:text-ink"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5">
        {lang && HIGHLIGHTED.has(lang) ? (
          <Suspense fallback={plain}>
            <HighlightedCode code={code} language={lang} />
          </Suspense>
        ) : (
          plain
        )}
      </pre>
    </div>
  );
}
