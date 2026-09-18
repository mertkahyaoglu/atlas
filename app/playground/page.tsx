import type { Metadata } from "next";
import { TopBar } from "@/components/layout/TopBar";
import { PlaygroundView } from "@/components/playground/PlaygroundView";

export const metadata: Metadata = {
  title: "Playground",
  description: "Build a system on a canvas, set the scale, and see whether it holds.",
};

export default function PlaygroundPage() {
  return (
    <>
      <TopBar crumb="Playground" />
      <main className="pg-page">
        <PlaygroundView />
      </main>
    </>
  );
}
