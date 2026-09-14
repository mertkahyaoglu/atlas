"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DocMeta, SortKey } from "@/lib/types";
import { TAG_KIND_LABEL, TAG_KIND_ORDER, tagsInUse } from "@/lib/tags";
import { useFilterStore } from "@/store/useFilterStore";
import { SearchInput } from "@/components/ui/SearchInput";
import { Tag } from "@/components/ui/Tag";
import { cn } from "@/lib/utils";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "order", label: "Suggested order" },
  { value: "title", label: "Title" },
  { value: "length", label: "Longest first" },
];

export function FilterBar({ docs }: { docs: DocMeta[] }) {
  const { query, tags, sort, setQuery, toggleTag, setSort, clear } = useFilterStore();
  const [expanded, setExpanded] = useState(false);

  // Only offer tags that exist in the corpus — no dead filters.
  const grouped = useMemo(() => tagsInUse(docs.flatMap((d) => d.tags)), [docs]);
  const hasFilters = query !== "" || tags.length > 0 || sort !== "order";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search titles, tags, concepts" />

        <label className="sr-only" htmlFor="sort">
          Sort by
        </label>
        <select
          id="sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded border border-rule bg-surface px-3 py-2 text-small text-ink"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 rounded border border-rule bg-surface px-3 py-2 text-small text-inkMuted hover:text-ink"
        >
          Tags
          {tags.length > 0 && (
            <span className="font-mono text-micro text-[color:var(--concept)]">{tags.length}</span>
          )}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform duration-fast", expanded && "rotate-180")}
          />
        </button>

        {hasFilters && (
          <button
            type="button"
            onClick={clear}
            className="px-2 py-2 text-small text-inkFaint underline underline-offset-2 hover:text-ink"
          >
            Reset
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-4 rounded border border-rule bg-surface p-4">
          {TAG_KIND_ORDER.map((kind) =>
            grouped[kind].length === 0 ? null : (
              <div key={kind}>
                <p className="mb-2 text-tiny font-semibold text-inkMuted">{TAG_KIND_LABEL[kind]}</p>
                <div className="flex flex-wrap gap-1.5">
                  {grouped[kind].map((tag) => (
                    <Tag
                      key={tag.id}
                      id={tag.id}
                      active={tags.includes(tag.id)}
                      onClick={toggleTag}
                    />
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
