import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buildToc, designToc, getAllDocs, getAllMeta, getDoc, getScript, getSiblings, techToc, toMeta } from "@/lib/content";
import { DocTitlesProvider } from "@/components/docs/diagram/DocTitles";
import { splitTabs } from "@/lib/tabs";
import { accentVar, cn } from "@/lib/utils";
import { TopBar } from "@/components/layout/TopBar";
import { DocHeader } from "@/components/docs/DocHeader";
import { Markdown } from "@/components/docs/Markdown";
import { ContentTabs } from "@/components/docs/ContentTabs";
import { DesignDeepDives, DesignOverview } from "@/components/docs/DesignPanels";
import { TechDeepDives, TechOverview } from "@/components/docs/TechPanels";
import { PrevNext } from "@/components/docs/PrevNext";
import { Toc } from "@/components/docs/Toc";
import { ReadingProgress } from "@/components/docs/ReadingProgress";

interface PageProps {
  params: { slug: string };
}

export function generateStaticParams() {
  return getAllDocs().map((doc) => ({ slug: doc.slug }));
}

export function generateMetadata({ params }: PageProps): Metadata {
  const doc = getDoc(params.slug);
  if (!doc) return { title: "Not found" };
  return { title: doc.title, description: doc.summary };
}

export default function DocPage({ params }: PageProps) {
  const doc = getDoc(params.slug);
  if (!doc) notFound();

  // Panels render sections the markdown body doesn't contain, so they bracket its headings.
  const panelSections = doc.design ? designToc(doc.design) : doc.tech ? techToc(doc.tech) : { opening: [], closing: [] };
  const toc = [...panelSections.opening, ...buildToc(doc.content), ...panelSections.closing];
  const { prev, next } = getSiblings(doc.slug);
  // Lets a diagram node's dialog name the concept module it links to.
  const titles = Object.fromEntries(getAllMeta().map((meta) => [meta.slug, meta.title]));

  return (
    <div style={accentVar(doc.group)}>
      <TopBar crumb={doc.title} />

      <div className="mx-auto flex max-w-shell gap-12 px-4 pb-24 pt-10 sm:px-8">
        <main id="doc-main" className="min-w-0 flex-1">
          <DocHeader doc={toMeta(doc)} showHardPart={!doc.design} script={getScript(doc.slug)} />
          <DocTitlesProvider titles={titles}>
            <article className={cn("doc", (doc.group === "design" || doc.group === "tech") && "doc-wide")}>
              {doc.design && <DesignOverview design={doc.design} />}
              {doc.tech && <TechOverview tech={doc.tech} />}
              {splitTabs(doc.content).map((segment, i) =>
                segment.kind === "tabs" ? (
                  <ContentTabs key={i} tabs={segment.tabs} />
                ) : (
                  <Markdown key={i} content={segment.content} />
                ),
              )}
              {doc.design && <DesignDeepDives design={doc.design} />}
              {doc.tech && <TechDeepDives tech={doc.tech} />}
            </article>
          </DocTitlesProvider>
          <PrevNext prev={prev} next={next} />
        </main>

        <div className="hidden w-toc shrink-0 xl:block">
          <div className="sticky top-20 space-y-8">
            <ReadingProgress targetId="doc-main" slug={doc.slug} />
            <Toc entries={toc} />
          </div>
        </div>
      </div>
    </div>
  );
}
