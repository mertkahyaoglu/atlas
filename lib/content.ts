import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { Doc, DocGroup, DocMeta, TocEntry } from "./types";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const GROUP_DIR: Record<DocGroup, string> = {
  concept: "concepts",
  design: "designs",
};

const WORDS_PER_MINUTE = 200;

function readGroup(group: DocGroup): Doc[] {
  const dir = path.join(CONTENT_ROOT, GROUP_DIR[group]);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { data, content: body } = matter(raw);
      const slug = file.replace(/\.md$/, "");
      // DocHeader renders the title, so drop the body's leading H1.
      const content = body.replace(/^\s*#\s+.*\n+/, "");

      return {
        slug,
        group,
        order: Number(data.order ?? 0),
        title: String(data.title ?? slug),
        summary: String(data.summary ?? ""),
        hardPart: data.hardPart ? String(data.hardPart) : undefined,
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        readingMinutes: Math.max(1, Math.round(content.split(/\s+/).length / WORDS_PER_MINUTE)),
        content,
      } satisfies Doc;
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * Read once per process. Content is static on disk, so caching here keeps
 * repeated calls across pages and layouts from re-parsing every file.
 */
let cache: Doc[] | null = null;

export function getAllDocs(): Doc[] {
  // In dev, re-read so markdown edits show up without restarting the server.
  if (process.env.NODE_ENV !== "production") return [...readGroup("concept"), ...readGroup("design")];
  if (!cache) cache = [...readGroup("concept"), ...readGroup("design")];
  return cache;
}

export function getDocsByGroup(group: DocGroup): Doc[] {
  return getAllDocs().filter((doc) => doc.group === group);
}

export function getDoc(slug: string): Doc | undefined {
  return getAllDocs().find((doc) => doc.slug === slug);
}

/** Strip content so client components receive only what they render. */
export function toMeta(doc: Doc): DocMeta {
  const { content: _content, ...meta } = doc;
  return meta;
}

export function getAllMeta(): DocMeta[] {
  return getAllDocs().map(toMeta);
}

/** Previous/next within the same group, for sequential reading. */
export function getSiblings(slug: string): { prev?: DocMeta; next?: DocMeta } {
  const doc = getDoc(slug);
  if (!doc) return {};
  const siblings = getDocsByGroup(doc.group);
  const index = siblings.findIndex((d) => d.slug === slug);
  return {
    prev: index > 0 ? toMeta(siblings[index - 1]) : undefined,
    next: index < siblings.length - 1 ? toMeta(siblings[index + 1]) : undefined,
  };
}

const HEADING = /^(#{2,3})\s+(.+)$/gm;
const FENCE = /```[\s\S]*?```/g;

/** Mirrors rehype-slug so anchors generated here match rendered heading ids. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function buildToc(content: string): TocEntry[] {
  // Blank out fenced code first so `## comments` inside samples aren't headings.
  const prose = content.replace(FENCE, "");
  const entries: TocEntry[] = [];
  const pattern = new RegExp(HEADING.source, "gm");

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prose)) !== null) {
    const text = match[2].replace(/[`*]/g, "").trim();
    entries.push({
      id: slugifyHeading(text),
      text,
      depth: match[1].length === 2 ? 2 : 3,
    });
  }
  return entries;
}
