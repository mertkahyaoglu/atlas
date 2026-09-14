"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
}

/**
 * Fenced blocks in this content are mostly schemas, API shapes and small
 * ASCII illustrations rather than runnable code, so there's no syntax
 * highlighter — just a legible mono block with the language noted.
 */
export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

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
        <code className="font-mono text-tiny leading-relaxed text-ink">{code}</code>
      </pre>
    </div>
  );
}
