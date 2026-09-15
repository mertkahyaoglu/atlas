# System Design Atlas

A reading app for twenty-six system design documents: ten concept modules built from
the ground up, and sixteen worked designs with rendered architecture diagrams.

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
  designs/*.md            sixteen designs
```

## Adding a document

1. Drop a `.md` file into `content/concepts/` or `content/designs/`.
2. Give it frontmatter:

```yaml
---
group: "design"
order: 17
title: "Design a Feature Flag Service"
summary: "One line shown on the card and in search results."
hardPart: "Designs only. What the interviewer is actually testing."
tags: ["caching", "redis"]
---
```

3. Any tag you use must exist in `lib/tags.ts`. Unknown tags fall back to their raw id
   rather than throwing, but they won't appear in the filter bar until registered.
4. Designs also keep their opening and closing panels in frontmatter: `hardPartDetail`,
   `concepts`, `requirements`, `scale`, `tradeoffs` and `followUps`. `lib/content.ts`
   logs a warning for any that are missing. An existing design such as
   `content/designs/02-chat-slack.md` is the easiest template to copy.

That's it — the sidebar, index cards, filters, prev/next links and static routes all
derive from the file. Nothing else needs editing.

## Diagrams

Fenced blocks tagged `mermaid` render as diagrams; everything else renders as a
copyable code block. Mermaid is dynamically imported so its ~500 KB stays out of the
initial bundle, and it re-renders when the theme changes.

Each design's architecture diagram is written directly in its markdown, under
`## High-level architecture`. Hover tooltips come from Mermaid `click` lines that
link a node to a concept module:

```text
click Node href "/docs/05-async-messaging-and-event-driven" "Role: …<br/>Trade-off: …"
```

If a chart fails to parse, the `Mermaid` component catches it and falls back to showing
the source rather than blanking the page.

Node colour is by type, not per diagram, so the same colour means the same thing on
every page:

```text
classDef db       fill:#34526e,stroke:#6cb2ee,color:#d7dee8   /* durable stores: Postgres, Cassandra tables */
classDef cache    fill:#623e43,stroke:#f07a73,color:#d7dee8   /* Redis, or anything explicitly TTL'd */
classDef blob     fill:#5f5830,stroke:#e6c43c,color:#d7dee8   /* object storage: S3-style blobs */
classDef queue    fill:#4b4771,stroke:#ad94f7,color:#d7dee8   /* message buses, topics, pub/sub */
classDef external fill:#2f5a4d,stroke:#5cc98f,color:#d7dee8   /* third-party systems: APNs, SMTP, a PSP, a CDN */
classDef gateway  fill:#22565e,stroke:#38bdc1,color:#d7dee8   /* the edge reverse-proxy tier: an API gateway */
classDef lb       fill:#5d3759,stroke:#e066b2,color:#d7dee8   /* a load balancer */
classDef hot      stroke:#e8a33d,stroke-width:2px             /* the node the deep dive is actually about */
```

Only add a `classDef` a diagram uses — most designs don't need all seven. `hot` is an
emphasis layered on top of a type (`class Node1 db` and `class Node1 hot` both apply),
not a type of its own. A stateful, per-connection **WS gateway** (the socket-holding
tier in the chat-style designs) is deliberately left uncoloured — it's a different thing
from an API gateway's reverse-proxy role, and colouring both the same would blur that
distinction rather than sharpen it. Everything else stays the unclassed default box, so
the coloured nodes read as "this holds state," "this is async," "this isn't ours," and
"this is the edge tier" at a glance, rather than fighting for attention with the
majority of plain service nodes.

These are flat hex, not `var(--token)` or `rgba(...)` — Mermaid's `classDef` grammar
parses the style string itself and rejects any value with parentheses in it, so both
fail to parse. That also means these colours don't adapt to the light theme; they're
picked to still read fine there since dark is this app's default.

A design's `## High-level architecture` can also show how the design changes at a
higher scale, as a second tab. `lib/tabs.ts` splits the body on comment markers; each
marker starts a tab, and the part of a label after ` · ` renders as a muted note:

```markdown
<!-- tab: Today · ~200 msg/s -->
…today's diagram and walkthrough…
<!-- tab: At 100x · ~20k msg/s -->
…the scaled diagram and what changes…
<!-- /tabs -->
```

Keep headings out of tabs, since the table of contents would link into a hidden panel.
In the scaled diagram, layer `classDef scaled stroke-dasharray:5 3` on nodes that are
new or reshaped compared with today's design, the same way `hot` layers on a type.

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
