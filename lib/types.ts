export type DocGroup = "concept" | "design";

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
  tags: string[];
  readingMinutes: number;
}

export interface Doc extends DocMeta {
  content: string;
}

export interface TocEntry {
  id: string;
  text: string;
  depth: 2 | 3;
}

export type SortKey = "order" | "title" | "length";
