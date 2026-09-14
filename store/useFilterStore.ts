"use client";

import { create } from "zustand";
import type { SortKey } from "@/lib/types";

interface FilterState {
  query: string;
  tags: string[];
  sort: SortKey;
  setQuery: (query: string) => void;
  toggleTag: (tag: string) => void;
  setSort: (sort: SortKey) => void;
  showOnlyTag: (tag: string) => void;
  clear: () => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  query: "",
  tags: [],
  sort: "order",
  setQuery: (query) => set({ query }),
  toggleTag: (tag) =>
    set((s) => ({
      tags: s.tags.includes(tag) ? s.tags.filter((t) => t !== tag) : [...s.tags, tag],
    })),
  setSort: (sort) => set({ sort }),
  showOnlyTag: (tag) => set({ query: "", tags: [tag] }),
  clear: () => set({ query: "", tags: [], sort: "order" }),
}));
