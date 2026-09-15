/**
 * Tabs authored inside a markdown body with HTML-comment markers:
 *
 *   <!-- tab: Today · ~200 msg/s -->
 *   …first tab…
 *   <!-- tab: At 100x · ~20k msg/s -->
 *   …second tab…
 *   <!-- /tabs -->
 *
 * Each marker starts a tab; the closing marker returns to plain markdown. The
 * part of a label after ` · ` renders as a muted note. Markdown drops HTML
 * comments, so a body rendered without splitting still reads top to bottom.
 */

export interface ContentTab {
  label: string;
  content: string;
}

export type ContentSegment = { kind: "markdown"; content: string } | { kind: "tabs"; tabs: ContentTab[] };

const TAB_START = /^<!--\s*tab:\s*(.+?)\s*-->$/;
const TABS_END = /^<!--\s*\/tabs\s*-->$/;

export function splitTabs(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let prose: string[] = [];
  let tabs: { label: string; lines: string[] }[] | null = null;
  let inFence = false;

  const closeProse = () => {
    if (prose.some((line) => line.trim())) segments.push({ kind: "markdown", content: prose.join("\n") });
    prose = [];
  };
  const closeTabs = () => {
    if (tabs) segments.push({ kind: "tabs", tabs: tabs.map((tab) => ({ label: tab.label, content: tab.lines.join("\n") })) });
    tabs = null;
  };

  for (const line of content.split("\n")) {
    // Markers inside fenced blocks are sample text, not structure.
    if (/^\s*```/.test(line)) inFence = !inFence;
    const start = inFence ? null : TAB_START.exec(line.trim());

    if (start) {
      if (!tabs) closeProse();
      (tabs ??= []).push({ label: start[1], lines: [] });
    } else if (!inFence && tabs && TABS_END.test(line.trim())) {
      closeTabs();
    } else if (tabs) {
      tabs[tabs.length - 1].lines.push(line);
    } else {
      prose.push(line);
    }
  }

  // An unclosed group runs to the end of the body.
  closeTabs();
  closeProse();
  return segments;
}
