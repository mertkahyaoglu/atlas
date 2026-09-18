"use client";

import dynamic from "next/dynamic";

/** The canvas reads persisted state from localStorage, so it only renders on the client. */
export const PlaygroundView = dynamic(() => import("./PlaygroundCanvas").then((m) => m.PlaygroundCanvas), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-small text-inkFaint">Loading playground…</div>,
});
