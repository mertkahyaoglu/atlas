"use client";

import { createContext, useContext } from "react";

const DocTitlesContext = createContext<Record<string, string>>({});

/** Doc titles by slug, so client components can name a `/docs/…` link. */
export function DocTitlesProvider({ titles, children }: { titles: Record<string, string>; children: React.ReactNode }) {
  return <DocTitlesContext.Provider value={titles}>{children}</DocTitlesContext.Provider>;
}

export function useDocTitle(href: string | undefined): string | undefined {
  const titles = useContext(DocTitlesContext);
  const slug = href ? /^\/docs\/([^/?#]+)/.exec(href)?.[1] : undefined;
  return slug ? titles[slug] : undefined;
}
