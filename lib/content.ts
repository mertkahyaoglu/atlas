import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { parseScript } from "./script";
import type {
  CodingDetails,
  ComplexityRow,
  DesignDetails,
  DesignTradeoff,
  Doc,
  DocGroup,
  DocMeta,
  FollowUp,
  InterviewScript,
  TechDetails,
  TechFact,
  TocEntry,
  Track,
} from "./types";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const GROUP_DIR: Record<DocGroup, string> = {
  concept: "concepts",
  design: "designs",
  tech: "tech",
  coding: "coding",
};

/**
 * Reading order of the groups: the ideas, then the tools, then the problems.
 * Coding sits last because it is a separate track with its own route, not a
 * step in the system design sequence.
 */
const GROUP_ORDER: DocGroup[] = ["concept", "tech", "design", "coding"];

const WORDS_PER_MINUTE = 200;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

/** A list of objects, keeping only entries `pick` can turn into a complete record. */
function records<T>(value: unknown, pick: (item: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const picked = item && typeof item === "object" ? pick(item as Record<string, unknown>) : null;
    return picked ? [picked] : [];
  });
}

/**
 * Design docs keep their opening sections (concepts, hard part, requirements,
 * scale) in frontmatter. Missing pieces are reported rather than silently
 * rendering an empty panel.
 */
function readDesign(slug: string, data: Record<string, unknown>): DesignDetails | undefined {
  const requirements = (data.requirements ?? {}) as Record<string, unknown>;
  const scale = (data.scale ?? {}) as Record<string, unknown>;

  const design: DesignDetails = {
    hardPart: String(data.hardPartDetail ?? data.hardPart ?? ""),
    concepts: strings(data.concepts),
    requirements: {
      functional: strings(requirements.functional),
      nonFunctional: strings(requirements.nonFunctional),
      outOfScope: strings(requirements.outOfScope),
    },
    scale: scale.numbers
      ? {
          numbers: String(scale.numbers).replace(/\n+$/, ""),
          conclusion: scale.conclusion ? String(scale.conclusion) : undefined,
        }
      : undefined,
    tradeoffs: records<DesignTradeoff>(data.tradeoffs, (item) =>
      item.title && item.body ? { title: String(item.title), body: String(item.body) } : null,
    ),
    followUps: records<FollowUp>(data.followUps, (item) =>
      item.question && item.answer ? { question: String(item.question), answer: String(item.answer) } : null,
    ),
  };

  const missing = [
    !data.hardPartDetail && "hardPartDetail",
    design.concepts.length === 0 && "concepts",
    design.requirements.functional.length === 0 && "requirements.functional",
    design.requirements.nonFunctional.length === 0 && "requirements.nonFunctional",
    !design.scale && "scale.numbers",
    design.tradeoffs.length === 0 && "tradeoffs",
    design.followUps.length === 0 && "followUps",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.warn(`[content] ${slug}: design frontmatter is missing ${missing.join(", ")}`);
  }

  const hasPanels = design.concepts.length > 0 || design.requirements.functional.length > 0;
  return hasPanels ? design : undefined;
}

/**
 * Technology docs open with two panels read from frontmatter: the facts strip
 * and the concept bullets. The body is the use cases, each with its diagram.
 */
function readTech(slug: string, data: Record<string, unknown>): TechDetails | undefined {
  const tech: TechDetails = {
    role: String(data.role ?? ""),
    facts: records<TechFact>(data.facts, (item) =>
      item.label && item.value ? { label: String(item.label), value: String(item.value) } : null,
    ),
    concepts: strings(data.concepts),
  };

  const missing = [!tech.role && "role", tech.facts.length === 0 && "facts", tech.concepts.length === 0 && "concepts"]
    .filter(Boolean);
  if (missing.length > 0) {
    console.warn(`[content] ${slug}: tech frontmatter is missing ${missing.join(", ")}`);
  }

  return tech.facts.length > 0 || tech.concepts.length > 0 ? tech : undefined;
}

/**
 * Coding docs keep their cost table, the signals that call for the structure,
 * the pitfalls and the follow-ups in frontmatter, so those sections stay
 * uniform across concepts and can be scanned without reading the body.
 */
function readCoding(slug: string, data: Record<string, unknown>): CodingDetails | undefined {
  const coding: CodingDetails = {
    complexity: records<ComplexityRow>(data.complexity, (item) =>
      item.op && item.time
        ? {
            op: String(item.op),
            time: String(item.time),
            space: item.space ? String(item.space) : undefined,
            note: item.note ? String(item.note) : undefined,
          }
        : null,
    ),
    reachFor: strings(data.reachFor),
    pitfalls: strings(data.pitfalls),
    followUps: records<FollowUp>(data.followUps, (item) =>
      item.question && item.answer ? { question: String(item.question), answer: String(item.answer) } : null,
    ),
  };

  const missing = [
    coding.complexity.length === 0 && "complexity",
    coding.reachFor.length === 0 && "reachFor",
    coding.pitfalls.length === 0 && "pitfalls",
    coding.followUps.length === 0 && "followUps",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.warn(`[content] ${slug}: coding frontmatter is missing ${missing.join(", ")}`);
  }

  return coding.complexity.length > 0 || coding.reachFor.length > 0 ? coding : undefined;
}

/** Words shown in the coding panels, counted for the same reason. */
function codingWordCount(coding: CodingDetails | undefined): number {
  if (!coding) return 0;
  const text = [
    ...coding.complexity.flatMap((row) => [row.op, row.note ?? ""]),
    ...coding.reachFor,
    ...coding.pitfalls,
    ...coding.followUps.flatMap((f) => [f.question, f.answer]),
  ].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

/** Words shown in the design panels, so reading time still counts them. */
function designWordCount(design: DesignDetails | undefined): number {
  if (!design) return 0;
  const text = [
    design.hardPart,
    ...design.concepts,
    ...design.requirements.functional,
    ...design.requirements.nonFunctional,
    ...design.requirements.outOfScope,
    design.scale?.numbers ?? "",
    design.scale?.conclusion ?? "",
    ...design.tradeoffs.flatMap((t) => [t.title, t.body]),
    ...design.followUps.flatMap((f) => [f.question, f.answer]),
  ].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

/** Words shown in the technology panels, counted for the same reason. */
function techWordCount(tech: TechDetails | undefined): number {
  if (!tech) return 0;
  const text = [...tech.facts.flatMap((fact) => [fact.label, fact.value]), ...tech.concepts].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

function readGroup(group: DocGroup): Doc[] {
  const dir = path.join(CONTENT_ROOT, GROUP_DIR[group]);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .flatMap((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { data, content: body } = matter(raw);
      const slug = file.replace(/\.md$/, "");
      // `hidden: true` parks a finished doc: it stays on disk but leaves the
      // sidebar, the home page, search and the routes until the flag is removed.
      if (data.hidden === true) return [];
      // DocHeader renders the title, so drop the body's leading H1.
      const content = body.replace(/^\s*#\s+.*\n+/, "");
      const design = group === "design" ? readDesign(slug, data) : undefined;
      const tech = group === "tech" ? readTech(slug, data) : undefined;
      const coding = group === "coding" ? readCoding(slug, data) : undefined;
      const words =
        content.split(/\s+/).length + designWordCount(design) + techWordCount(tech) + codingWordCount(coding);

      const doc = {
        slug,
        group,
        order: Number(data.order ?? 0),
        title: String(data.title ?? slug),
        summary: String(data.summary ?? ""),
        hardPart: data.hardPart ? String(data.hardPart) : undefined,
        role: data.role ? String(data.role) : undefined,
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        viz: data.viz ? String(data.viz) : undefined,
        readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
        content,
        design,
        tech,
        coding,
      } satisfies Doc;

      return [doc];
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
  if (process.env.NODE_ENV !== "production") return GROUP_ORDER.flatMap(readGroup);
  if (!cache) cache = GROUP_ORDER.flatMap(readGroup);
  return cache;
}

export function getDocsByGroup(group: DocGroup): Doc[] {
  return getAllDocs().filter((doc) => doc.group === group);
}

/**
 * The atlas has two tracks with their own routes: system design under /docs
 * and coding under /coding. Lookups name the track, so a slug that happens to
 * exist in both can never resolve to the wrong page.
 */
const inTrack = (doc: DocMeta, track: Track) => (doc.group === "coding") === (track === "coding");

export function getDocsInTrack(track: Track): Doc[] {
  return getAllDocs().filter((doc) => inTrack(doc, track));
}

export function getDoc(slug: string, track: Track = "sysdesign"): Doc | undefined {
  return getDocsInTrack(track).find((doc) => doc.slug === slug);
}

/**
 * The worked interview script for a design, if one has been written. Scripts
 * are optional: a design without `content/scripts/<slug>.md` simply doesn't
 * offer the button.
 */
export function getScript(slug: string): InterviewScript | undefined {
  const file = path.join(CONTENT_ROOT, "scripts", `${slug}.md`);
  if (!fs.existsSync(file)) return undefined;
  const script = parseScript(fs.readFileSync(file, "utf8"));
  if (script.phases.length === 0) {
    console.warn(`[content] ${slug}: script file has no phases`);
    return undefined;
  }
  return script;
}

/** Strip content so client components receive only what they render. */
export function toMeta(doc: Doc): DocMeta {
  const { content: _content, design: _design, tech: _tech, coding: _coding, ...meta } = doc;
  return meta;
}

export function getAllMeta(): DocMeta[] {
  return getAllDocs().map(toMeta);
}

/** Previous/next within the same group, for sequential reading. */
export function getSiblings(slug: string, track: Track = "sysdesign"): { prev?: DocMeta; next?: DocMeta } {
  const doc = getDoc(slug, track);
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

/**
 * Mirrors github-slugger (what rehype-slug uses) so anchors generated here
 * match rendered heading ids. Each space becomes its own hyphen, so
 * "API / Model" is `api--model`, not `api-model`.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*~]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/ /g, "-");
}

/** Headings rendered by the design panels, which don't exist in the markdown body. */
export const DESIGN_OPENING_TITLES = ["Primary concepts and the hard part", "Requirements"] as const;
export const DESIGN_CLOSING_TITLES = ["Trade-offs and deep dives", "Possible follow-up questions"] as const;

const tocEntry = (text: string): TocEntry => ({ id: slugifyHeading(text), text, depth: 2 });

/** Table-of-contents entries for the panels before and after the markdown body. */
export function designToc(design: DesignDetails): { opening: TocEntry[]; closing: TocEntry[] } {
  const [tradeoffsTitle, followUpsTitle] = DESIGN_CLOSING_TITLES;
  return {
    opening: DESIGN_OPENING_TITLES.map(tocEntry),
    closing: [
      ...(design.tradeoffs.length > 0 ? [tocEntry(tradeoffsTitle)] : []),
      ...(design.followUps.length > 0 ? [tocEntry(followUpsTitle)] : []),
    ],
  };
}

/** Headings rendered by the technology panels, ahead of the markdown body. */
export const TECH_OPENING_TITLES = ["At a glance", "Key concepts and capabilities"] as const;

export function techToc(tech: TechDetails): { opening: TocEntry[]; closing: TocEntry[] } {
  const [glanceTitle, conceptsTitle] = TECH_OPENING_TITLES;
  return {
    opening: [
      ...(tech.facts.length > 0 ? [tocEntry(glanceTitle)] : []),
      ...(tech.concepts.length > 0 ? [tocEntry(conceptsTitle)] : []),
    ],
    closing: [],
  };
}

/** Headings rendered by the coding panels, which bracket the markdown body. */
export const CODING_TITLES = {
  cost: "Cost",
  reachFor: "Reach for it when",
  pitfalls: "Where candidates slip",
  followUps: "Possible follow-up questions",
} as const;

export function codingToc(coding: CodingDetails): { opening: TocEntry[]; closing: TocEntry[] } {
  return {
    opening: [
      ...(coding.complexity.length > 0 ? [tocEntry(CODING_TITLES.cost)] : []),
      ...(coding.reachFor.length > 0 ? [tocEntry(CODING_TITLES.reachFor)] : []),
    ],
    closing: [
      ...(coding.pitfalls.length > 0 ? [tocEntry(CODING_TITLES.pitfalls)] : []),
      ...(coding.followUps.length > 0 ? [tocEntry(CODING_TITLES.followUps)] : []),
    ],
  };
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
