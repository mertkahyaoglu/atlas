"use client";

import { Fragment } from "react";
import { Highlight, Prism, type PrismTheme } from "prism-react-renderer";

// prism-react-renderer bundles the common grammars but not a shell one. This is
// enough to tell commands, flags, strings and comments apart in a setup snippet.
// Comments come first so a `'` inside one is not read as a string; strings are
// greedy, so a `#` inside quotes still ends up part of the string.
Prism.languages.bash ??= {
  comment: { pattern: /(^|\s)#.*/, lookbehind: true },
  string: { pattern: /"(?:\\.|[^"\\\n])*"|'[^'\n]*'/, greedy: true },
  variable: /\$\{?[\w]+\}?/,
  // The first word of a command; a line starting with a flag continues the one above.
  function: { pattern: /(^|[;&|]\s*|\n\s*)(?!-)[\w./-]+/, lookbehind: true },
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

/**
 * The highlighted body of a code block. Loaded lazily by `CodeBlock`, so Prism
 * and its grammars only ship to pages that have a block worth highlighting.
 */
export function HighlightedCode({ code, language }: { code: string; language: string }) {
  return (
    <Highlight code={code} language={language} theme={THEME} prism={Prism}>
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
  );
}
