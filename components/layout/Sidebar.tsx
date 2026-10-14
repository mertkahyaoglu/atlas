"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, FlaskConical, PanelLeftClose, X } from "lucide-react";
import type { DocMeta, Track } from "@/lib/types";
import { useUiStore } from "@/store/useUiStore";
import { cn, partKey, trackOf } from "@/lib/utils";
import { SidebarLink } from "./SidebarLink";
import { SiteSwitcher } from "./SiteSwitcher";

interface SidebarProps {
  concepts: DocMeta[];
  tech: DocMeta[];
  designs: DocMeta[];
  ai: DocMeta[];
  courses: DocMeta[];
  coding: DocMeta[];
}

/** Ids match the `section-collapsed-*` rules in globals.css. */
const SECTIONS = [
  {
    id: "concepts",
    track: "sysdesign",
    heading: "Concepts",
    note: "Read in order. Each builds on the last.",
    accent: "var(--concept)",
  },
  {
    id: "designs",
    track: "sysdesign",
    heading: "Designs",
    note: "Ranked by how often they come up.",
    accent: "var(--design)",
  },
  {
    id: "tech",
    track: "sysdesign",
    heading: "Key Technologies",
    note: "One page per system. What it is, and when to reach for it.",
    accent: "var(--tech)",
  },
  {
    id: "ai",
    track: "sysdesign",
    heading: "AI",
    note: "The vocabulary of building with language models.",
    accent: "var(--ai)",
  },
  {
    id: "courses",
    track: "sysdesign",
    heading: "Courses",
    note: "Build one real system end to end, a lesson at a time.",
    accent: "var(--course)",
  },
  {
    id: "coding",
    track: "coding",
    heading: "Concepts",
    note: "Data structures and algorithms. Read in order — each builds on the last.",
    accent: "var(--coding)",
  },
] as const satisfies readonly { id: string; track: Track; heading: string; note: string; accent: string }[];

type SectionId = (typeof SECTIONS)[number]["id"];

interface SectionProps {
  id: SectionId;
  heading: string;
  note: string;
  accent: string;
  docs: DocMeta[];
  expanded: boolean;
  onToggle: () => void;
  /** Whether a part (by `partKey`) is shown open. */
  isPartExpanded: (key: string) => boolean;
  onTogglePart: (key: string) => void;
  activeSlug: string;
  onNavigate: () => void;
}

/**
 * Docs without a part first, then each part under its own label, parts in the
 * order they first appear. A doc can't land under a label it doesn't belong to,
 * whatever its `order`.
 */
function groupByPart(docs: DocMeta[]): { part?: string; docs: DocMeta[] }[] {
  const groups = new Map<string | undefined, DocMeta[]>([[undefined, []]]);
  for (const doc of docs) {
    const members = groups.get(doc.part) ?? [];
    members.push(doc);
    groups.set(doc.part, members);
  }
  return [...groups].filter(([, members]) => members.length > 0).map(([part, members]) => ({ part, docs: members }));
}

interface PartProps {
  part: string;
  accent: string;
  docs: DocMeta[];
  expanded: boolean;
  onToggle: () => void;
  activeSlug: string;
  onNavigate: () => void;
}

/**
 * A part (a course) inside a section, folded on its own. Its body reads a CSS
 * variable that ThemeScript and the Sidebar set to `none` on <html> while the
 * part is collapsed: the same no-flash approach as sections, without a
 * stylesheet rule per part name.
 */
function Part({ part, accent, docs, expanded, onToggle, activeSlug, onNavigate }: PartProps) {
  const key = partKey(part);
  const bodyId = `sidebar-${key}`;

  return (
    <div data-part={key} className="mt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 rounded-sm px-3 py-1 text-left transition-colors duration-fast hover:bg-raised"
      >
        <ChevronRight
          aria-hidden
          className={cn("h-3 w-3 shrink-0 text-inkFaint transition-transform duration-fast", expanded && "rotate-90")}
        />
        <span className="font-mono text-micro uppercase tracking-wide" style={{ color: accent }}>
          {part}
        </span>
        <span className="ml-auto font-mono text-micro text-inkFaint">{docs.length}</span>
      </button>
      <div
        id={bodyId}
        className="mt-1 flex-col"
        style={{ display: `var(--collapsed-${key}, flex)` }}
      >
        {docs.map((doc) => (
          <SidebarLink key={doc.slug} doc={doc} active={doc.slug === activeSlug} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

/**
 * The body is hidden by CSS rather than by unmounting it, so the collapsed
 * state can be applied before React runs (see ThemeScript) and nothing flashes
 * open on load.
 */
function Section({
  id,
  heading,
  note,
  accent,
  docs,
  expanded,
  onToggle,
  isPartExpanded,
  onTogglePart,
  activeSlug,
  onNavigate,
}: SectionProps) {
  const bodyId = `sidebar-section-${id}`;
  const groups = groupByPart(docs);
  // A course counts once, however many lessons it has.
  const count = groups.reduce((n, group) => n + (group.part ? 1 : group.docs.length), 0);

  return (
    <div data-section={id}>
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex w-full items-center gap-2 rounded-sm px-3 py-1 text-left transition-colors duration-fast hover:bg-raised"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-inkFaint transition-transform duration-fast",
              expanded && "rotate-90",
            )}
          />
          <span className="text-small font-semibold text-ink">{heading}</span>
          <span className="ml-auto font-mono text-micro" style={{ color: accent }}>
            {count}
          </span>
        </button>
      </h2>

      <div id={bodyId} data-section-body>
        <p className="mb-3 mt-2 px-3 text-tiny leading-snug text-inkFaint">{note}</p>
        <nav className="flex flex-col">
          {groups.map(({ part, docs: members }) =>
            part ? (
              <Part
                key={part}
                part={part}
                accent={accent}
                docs={members}
                expanded={isPartExpanded(partKey(part))}
                onToggle={() => onTogglePart(partKey(part))}
                activeSlug={activeSlug}
                onNavigate={onNavigate}
              />
            ) : (
              members.map((doc) => (
                <SidebarLink key={doc.slug} doc={doc} active={doc.slug === activeSlug} onNavigate={onNavigate} />
              ))
            ),
          )}
        </nav>
      </div>
    </div>
  );
}

export function Sidebar({ concepts, tech, designs, ai, courses, coding }: SidebarProps) {
  const pathname = usePathname();
  const open = useUiStore((s) => s.sidebarOpen);
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const collapsedSections = useUiStore((s) => s.collapsedSections);
  const toggleSection = useUiStore((s) => s.toggleSection);
  const expandSection = useUiStore((s) => s.expandSection);
  const track = trackOf(pathname);
  const activeSlug = pathname.startsWith("/docs/")
    ? pathname.slice("/docs/".length)
    : pathname.startsWith("/coding/")
      ? pathname.slice("/coding/".length)
      : "";

  const docsById: Record<SectionId, DocMeta[]> = { concepts, tech, designs, ai, courses, coding };
  const close = () => setOpen(false);

  // The store is restored from localStorage before the first client render,
  // which the server-rendered markup cannot know about. Render the headings
  // expanded until after mount so hydration matches; CSS is already hiding
  // whatever should be collapsed.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // The html classes are what actually hide things; keep them in step with the store.
  useEffect(() => {
    document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
  }, [collapsed]);

  useEffect(() => {
    for (const section of SECTIONS) {
      document.documentElement.classList.toggle(
        `section-collapsed-${section.id}`,
        collapsedSections.includes(section.id),
      );
    }
  }, [collapsedSections]);

  // Parts hide through a CSS variable their body reads (see Part and ThemeScript).
  const partKeys = SECTIONS.flatMap((s) => docsById[s.id].flatMap((doc) => (doc.part ? [partKey(doc.part)] : [])));
  const partKeysId = [...new Set(partKeys)].join(" ");
  useEffect(() => {
    const root = document.documentElement.style;
    for (const key of partKeysId.split(" ").filter(Boolean)) {
      if (collapsedSections.includes(key)) root.setProperty(`--collapsed-${key}`, "none");
      else root.removeProperty(`--collapsed-${key}`);
    }
  }, [collapsedSections, partKeysId]);

  // Navigating into a folded-away section or part opens it, so the current page
  // is never hidden. Only on a change of page: collapsing the section you are
  // reading has to stick, including across reloads.
  const lastSlug = useRef(activeSlug);
  useEffect(() => {
    if (activeSlug === lastSlug.current) return;
    lastSlug.current = activeSlug;
    const section = SECTIONS.find((s) => docsById[s.id].some((doc) => doc.slug === activeSlug));
    if (!section) return;
    expandSection(section.id);
    const part = docsById[section.id].find((doc) => doc.slug === activeSlug)?.part;
    if (part) expandSection(partKey(part));
    // docsById is rebuilt each render; the slug is what decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlug, expandSection]);

  // `[` toggles the desktop sidebar, unless the reader is typing somewhere.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      toggleCollapsed();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={close}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      <aside
        data-sidebar
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-sidebar flex-col border-r border-rule bg-surface transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4">
          <SiteSwitcher track={track} onNavigate={close} />
          <button
            type="button"
            onClick={close}
            aria-label="Close navigation"
            className="text-inkMuted hover:text-ink lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar  ["
            className="hidden h-8 w-8 items-center justify-center rounded text-inkFaint transition-colors duration-fast hover:bg-raised hover:text-ink lg:flex"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto py-6">
          {SECTIONS.filter((section) => section.track === track).map((section) => (
            <Section
              key={section.id}
              id={section.id}
              heading={section.heading}
              note={section.note}
              accent={section.accent}
              docs={docsById[section.id]}
              expanded={!hydrated || !collapsedSections.includes(section.id)}
              onToggle={() => toggleSection(section.id)}
              isPartExpanded={(key) => !hydrated || !collapsedSections.includes(key)}
              onTogglePart={toggleSection}
              activeSlug={activeSlug}
              onNavigate={close}
            />
          ))}
          {track === "sysdesign" && (
            <nav className="px-3">
              <Link
                href="/playground"
                onClick={close}
                aria-current={pathname === "/playground" ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded border px-3 py-2 text-small transition-colors duration-fast",
                  pathname === "/playground"
                    ? "border-design bg-designSoft text-ink"
                    : "border-rule text-inkMuted hover:border-ruleStrong hover:text-ink",
                )}
              >
                <FlaskConical className="h-4 w-4 shrink-0 text-design" aria-hidden />
                <span className="leading-snug">Playground</span>
                <span className="ml-auto font-mono text-micro text-inkFaint">beta</span>
              </Link>
            </nav>
          )}
        </div>
      </aside>
    </>
  );
}
