import type { DocMeta, SortKey } from "./types";

/** Case-insensitive substring match across the fields a reader would recall. */
function matchesQuery(doc: DocMeta, query: string): boolean {
  if (!query) return true;
  const haystack = [doc.title, doc.summary, doc.hardPart ?? "", doc.role ?? "", doc.tags.join(" ")]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

/** Tag filter is AND: selecting two tags narrows rather than widens. */
function matchesTags(doc: DocMeta, tags: string[]): boolean {
  return tags.every((tag) => doc.tags.includes(tag));
}

const SORTERS: Record<SortKey, (a: DocMeta, b: DocMeta) => number> = {
  order: (a, b) => a.order - b.order,
  title: (a, b) => a.title.localeCompare(b.title),
  length: (a, b) => b.readingMinutes - a.readingMinutes,
};

export function filterDocs(
  docs: DocMeta[],
  { query, tags, sort }: { query: string; tags: string[]; sort: SortKey },
): DocMeta[] {
  return docs
    .filter((doc) => matchesQuery(doc, query) && matchesTags(doc, tags))
    .sort(SORTERS[sort]);
}
