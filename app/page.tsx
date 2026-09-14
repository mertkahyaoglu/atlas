import { getDocsByGroup, toMeta } from "@/lib/content";
import { TopBar } from "@/components/layout/TopBar";
import { Hero } from "@/components/home/Hero";
import { HomeView } from "@/components/home/HomeView";

export default function HomePage() {
  const concepts = getDocsByGroup("concept").map(toMeta);
  const designs = getDocsByGroup("design").map(toMeta);

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-shell px-4 pb-24 pt-10 sm:px-8">
        <Hero />
        <div id="library" className="mt-10">
          <HomeView concepts={concepts} designs={designs} />
        </div>
      </main>
    </>
  );
}
