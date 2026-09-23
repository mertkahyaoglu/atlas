import type { Element, ElementContent, Root } from "hast";
import { GLOSSARY } from "./glossary";

/**
 * Wraps abbreviations from the glossary in `<abbr class="abbr" title="…">`,
 * which `AbbrTooltip` turns into a hover and focus tooltip.
 *
 * Only the first use of each abbreviation per section is marked: that is where
 * a reader meets it, and marking all of them would stripe every paragraph of a
 * page like the CDN one. A heading starts a new section, so a reader who jumps
 * in from the table of contents still finds it explained.
 */

/** Text in these is left alone: code is literal, links and headings have their own styling. */
const SKIP = new Set(["a", "abbr", "code", "pre", "kbd", "svg", "h1", "h2", "h3", "h4", "h5", "h6"]);
const SECTION = new Set(["h2", "h3"]);

const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Longest first, so "SHA-256" is tried before "SHA" and "LL-HLS" before "HLS".
// The optional "s" lets the singular entry cover the plural. Word boundaries
// only, no lookbehind, because this also runs in older Safari.
const PATTERN = new RegExp(
  `\\b(${Object.keys(GLOSSARY)
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|")})s?\\b`,
  "g",
);

export function rehypeAbbr() {
  return (tree: Root) => {
    let seen = new Set<string>();

    const mark = (value: string): ElementContent[] => {
      const out: ElementContent[] = [];
      let last = 0;
      for (const match of value.matchAll(PATTERN)) {
        const term = match[1];
        if (seen.has(term)) continue;
        seen.add(term);
        const start = match.index ?? 0;
        if (start > last) out.push({ type: "text", value: value.slice(last, start) });
        out.push({
          type: "element",
          tagName: "abbr",
          properties: { className: ["abbr"], title: GLOSSARY[term], dataTerm: term, tabIndex: 0 },
          children: [{ type: "text", value: match[0] }],
        });
        last = start + match[0].length;
      }
      if (last === 0) return [{ type: "text", value }];
      if (last < value.length) out.push({ type: "text", value: value.slice(last) });
      return out;
    };

    const walk = (node: Root | Element) => {
      const children: ElementContent[] = [];
      for (const child of node.children) {
        if (child.type === "text") {
          children.push(...mark(child.value));
          continue;
        }
        if (child.type === "element") {
          if (SECTION.has(child.tagName)) seen = new Set();
          if (!SKIP.has(child.tagName)) walk(child);
        }
        children.push(child as ElementContent);
      }
      node.children = children;
    };

    walk(tree);
  };
}
