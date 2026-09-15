"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ProgressState {
  completed: Record<string, true>;
  setCompleted: (slug: string, done: boolean) => void;
}

export const useProgressStore = create<ProgressState>()(
  persist(
    (set) => ({
      completed: {},
      setCompleted: (slug, done) =>
        set((s) => {
          const completed = { ...s.completed };
          if (done) completed[slug] = true;
          else delete completed[slug];
          return { completed };
        }),
    }),
    { name: "atlas-progress" },
  ),
);

const subscribeNever = () => () => {};

/** Reads false on the server and during hydration, so the first client render matches the HTML. */
export function useIsCompleted(slug: string) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const completed = useProgressStore((s) => s.completed[slug] === true);
  return hydrated && completed;
}
