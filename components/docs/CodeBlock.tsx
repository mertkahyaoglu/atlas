"use client";

import { Fragment, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Highlight, Prism, type PrismTheme } from "prism-react-renderer";

interface CodeBlockProps {
  code: string;
  language?: string;
}

// prism-react-renderer bundles the common grammars but not a shell one. This is
// enough to tell commands, flags, strings and comments apart in a setup snippet.
Prism.languages.bash ??= {
  comment: { pattern: /(^|\s)#.*/, lookbehind: true },
  string: /"(?:\\.|[^"\\])*"|'[^']*'/,
  variable: /\$\{?[\w]+\}?/,
  function: { pattern: /(^|[;&|]\s*|\n\s*)[\w./-]+/, lookbehind: true },
  parameter: /(?:^|\s)--?[\w-]+(?:=\S+)?/,
  operator: /&&|\|\||[|>]/,
};
Prism.languages.sh ??= Prism.languages.bash;
Prism.languages.shell ??= Prism.languages.bash;

/**
 * Token colours come from CSS (`.code-hl .token` in globals.css), so they follow
 * the theme like everything else. The theme object only has to exist.
 */
const THEME: PrismTheme = { plain: {}, styles: [] };

/** Fences tagged with anything prism doesn't know render plain, as before. */
function grammar(language: string | undefined): string | null {
  if (!language) return null;
  const lang = language.toLowerCase();
  return lang in Prism.languages ? lang : null;
}

/**
 * Most fenced blocks are schemas, API shapes and ASCII sketches tagged `text`,
 * which stay plain. Blocks tagged with a real language (python, sql, ts) are
 * highlighted, since the AI course reads mostly as code.
 */
export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lang = grammar(language);

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
        {lang ? (
          <Highlight code={code} language={lang} theme={THEME} prism={Prism}>
            {({ tokens, getTokenProps }) => (
              <code className="code-hl font-mono text-tiny leading-relaxed text-ink">
                {tokens.map((line, i) => (
                  <Fragment key={i}>
                    {i > 0 && "\n"}
                    {line.map((token, j) => {
                      const { className, children } = getTokenProps({ token });
                      return (
                        <span key={j} className={className}>
                          {children}
                        </span>
                      );
                    })}
                  </Fragment>
                ))}
              </code>
            )}
          </Highlight>
        ) : (
          <code className="font-mono text-tiny leading-relaxed text-ink">{code}</code>
        )}
      </pre>
    </div>
  );
}
