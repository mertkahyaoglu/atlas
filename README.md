# System Design Atlas

A reading app for twenty-five system design documents: ten concept modules built from
the ground up, and fifteen worked designs with rendered architecture diagrams.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build && npm start   # production
```

Node 18.17 or newer.

## How it works

Content is plain markdown on disk. `lib/content.ts` reads `content/` at build time,
parses frontmatter with gray-matter, and every page is statically generated — there is
no database and no CMS.

```
app/
  layout.tsx              root shell, theme bootstrap
  page.tsx                home index
  docs/[slug]/page.tsx    document page, statically generated per file
components/
  layout/                 sidebar, top bar, theme toggle
  home/                   hero, filter bar, cards
  docs/                   markdown renderer, Mermaid, TOC, prev/next
  ui/                     tag, search input, badges, empty state
lib/
  content.ts              filesystem loader, TOC builder, sibling lookup
  tags.ts                 tag registry (single source of truth)
  search.ts               filter and sort logic, pure and testable
  types.ts                shared types
store/
  useUiStore.ts           theme (persisted) and sidebar
  useFilterStore.ts       query, tags, sort
content/
  concepts/*.md           ten modules
  designs/*.md            fifteen designs
scripts/
  add-frontmatter.py      writes frontmatter from a metadata map
  convert-diagrams.py     swaps ASCII architecture blocks for Mermaid
  diagrams/               the Mermaid sources, split three ways
```

## Adding a document

1. Drop a `.md` file into `content/concepts/` or `content/designs/`.
2. Give it frontmatter:

```yaml
---
group: "design"
order: 16
title: "Design a Feature Flag Service"
summary: "One line shown on the card and in search results."
hardPart: "Designs only. What the interviewer is actually testing."
tags: ["caching", "redis"]
---
```

3. Any tag you use must exist in `lib/tags.ts`. Unknown tags fall back to their raw id
   rather than throwing, but they won't appear in the filter bar until registered.

That's it — the sidebar, index cards, filters, prev/next links and static routes all
derive from the file. Nothing else needs editing.

Alternatively, add the file's metadata to `scripts/add-frontmatter.py` and re-run it.
The script is idempotent: existing frontmatter is replaced, not duplicated.

## Diagrams

Fenced blocks tagged `mermaid` render as diagrams; everything else renders as a
copyable code block. Mermaid is dynamically imported so its ~500 KB stays out of the
initial bundle, and it re-renders when the theme changes.

Each design's architecture diagram lives in `scripts/diagrams/`. To change one, edit it
there and re-run:

```bash
python3 scripts/convert-diagrams.py
```

The script replaces the existing chart in place and keeps the original ASCII version
beneath it in a collapsed `<details>` block, so the plain-text form is still available.

If a chart fails to parse, the `Mermaid` component catches it and falls back to showing
the source rather than blanking the page.

## Design notes

Two accent colours carry information rather than decoration: teal marks concept
modules, amber marks designs. The accent is set once per page as a CSS variable
(`--accent`) and every component reads it, so no component branches on theme or group.

Numbered markers appear on cards and in the sidebar because the content genuinely is
ordered — concepts build on each other, and designs are ranked by how often they come
up in interviews.

Dark is the default because this is long-form night reading. The theme is stored in
`localStorage` via Zustand's persist middleware and applied by an inline script in
`<head>` before first paint, so there's no light flash on reload.

## Extending it

- **Full-text search across document bodies.** `lib/search.ts` currently matches on
  title, summary, hard part and tags. Swap in a prebuilt index (FlexSearch, Pagefind)
  generated at build time from `getAllDocs()`.
- **Progress tracking.** Add a `useProgressStore` alongside the existing stores and
  render a marker in `SidebarLink` and on the cards.
- **A second content group.** Add it to `DocGroup` in `lib/types.ts`, give it a
  directory in `GROUP_DIR`, an accent variable in `globals.css`, and a `Section` in the
  sidebar. Everything else is generic over the group.
