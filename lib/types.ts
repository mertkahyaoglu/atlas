export type DocGroup = "concept" | "design" | "tech";

/** Facets used by the filter bar. Kept as a union so new facets fail loudly. */
export type TagKind = "concept" | "tech" | "pattern";

export interface Tag {
  id: string;
  label: string;
  kind: TagKind;
  /** One short line shown in the tag's hover tooltip. */
  description?: string;
  /** Technology tags only: the core traits that make it the right pick. */
  features?: string[];
  /** Technology tags only: situations where it is the natural choice. */
  useWhen?: string[];
}

export interface DocMeta {
  slug: string;
  group: DocGroup;
  /** Position within its group. Designs are ranked by interview frequency. */
  order: number;
  title: string;
  /** One line shown on the card and in search results. */
  summary: string;
  /** Designs only: the thing the interviewer is actually testing. */
  hardPart?: string;
  /** Technology pages only: the two-word role, e.g. "Event log". */
  role?: string;
  tags: string[];
  readingMinutes: number;
}

export interface DesignTradeoff {
  title: string;
  /** Markdown: may contain code blocks, tables and lists. */
  body: string;
}

/** A question a reader should try to answer before revealing the answer. */
export interface FollowUp {
  question: string;
  answer: string;
}

/** The structured sections of a design doc, read from frontmatter. */
export interface DesignDetails {
  /** Full version of the short `hardPart` used on cards; shown on the doc page. */
  hardPart: string;
  concepts: string[];
  requirements: {
    functional: string[];
    nonFunctional: string[];
    outOfScope: string[];
  };
  scale?: {
    numbers: string;
    conclusion?: string;
  };
  tradeoffs: DesignTradeoff[];
  followUps: FollowUp[];
}

export interface TechFact {
  label: string;
  value: string;
}

export interface TechCapability {
  title: string;
  /** Markdown: may contain code blocks, tables and lists. */
  body: string;
}

/** The structured sections of a technology doc, read from frontmatter. */
export interface TechDetails {
  /** The two-word role, repeated from `DocMeta` so the panels are self-contained. */
  role: string;
  facts: TechFact[];
  capabilities: TechCapability[];
  useWhen: string[];
  avoidWhen: string[];
  probes: FollowUp[];
}

/** Who is speaking in an interview script. `note` is a coaching aside, not a voice. */
export type ScriptSpeaker = "you" | "interviewer" | "note";

export interface ScriptTurn {
  speaker: ScriptSpeaker;
  /** Optional stage direction: "drawing", "pushing on scope". */
  cue?: string;
  /** Markdown: may contain lists, tables and inline code. */
  body: string;
}

/** One phase of the Module 10.1 framework. */
export interface ScriptPhase {
  title: string;
  minutes?: number;
  goal?: string;
  turns: ScriptTurn[];
}

export interface InterviewScript {
  phases: ScriptPhase[];
  /** Budgeted total, summed from the phases. */
  minutes: number;
  /** Spoken turns, notes excluded. */
  turns: number;
}

export interface Doc extends DocMeta {
  content: string;
  /** Design docs only. Kept off DocMeta so sidebar and card payloads stay small. */
  design?: DesignDetails;
  /** Technology docs only, for the same reason. */
  tech?: TechDetails;
}

export interface TocEntry {
  id: string;
  text: string;
  depth: 2 | 3;
}

export type SortKey = "order" | "title" | "length";
