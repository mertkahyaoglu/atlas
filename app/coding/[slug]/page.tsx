import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buildToc, codingToc, CODING_TITLES, getDoc, getDocsInTrack, getSiblings, slugifyHeading, toMeta } from "@/lib/content";
import { vizzes } from "@/lib/viz/registry";
import { accentVar } from "@/lib/utils";
import { TopBar } from "@/components/layout/TopBar";
import { DocHeader } from "@/components/docs/DocHeader";
import { Markdown } from "@/components/docs/Markdown";
import { CodingOverview, CodingPitfalls } from "@/components/docs/CodingPanels";
import { FollowUps } from "@/components/docs/FollowUps";
import { PrevNext } from "@/components/docs/PrevNext";
import { Toc } from "@/components/docs/Toc";
import { ReadingProgress } from "@/components/docs/ReadingProgress";
import { VizFigure } from "@/components/viz/VizFigure";

interface PageProps {
  params: { slug: string };
}

export function generateStaticParams() {
  return getDocsInTrack("coding").map((doc) => ({ slug: doc.slug }));
}

export function generateMetadata({ params }: PageProps): Metadata {
  const doc = getDoc(params.slug, "coding");
  if (!doc) return { title: "Not found" };
  return {
    title: doc.title,
    description: doc.summary,
    openGraph: {
      type: "article",
      title: doc.title,
      description: doc.summary,
      url: `/coding/${doc.slug}`,
    },
    twitter: { card: "summary_large_image", title: doc.title, description: doc.summary },
    alternates: { canonical: `/coding/${doc.slug}` },
  };
}

export default function CodingPage({ params }: PageProps) {
  const doc = getDoc(params.slug, "coding");
  if (!doc) notFound();

  const panels = doc.coding ? codingToc(doc.coding) : { opening: [], closing: [] };
  const toc = [...panels.opening, ...buildToc(doc.content), ...panels.closing];
  const { prev, next } = getSiblings(doc.slug, "coding");
  const viz = doc.viz ? vizzes[doc.viz] : undefined;

  // Coding tags are topic words, not entries in the system design tag registry,
  // which would warn on them and link them into the wrong library.
  const meta = { ...toMeta(doc), tags: [] };

  return (
    <div style={accentVar(doc.group)}>
      <TopBar crumb={doc.title} />

      <div className="mx-auto flex max-w-shell gap-12 px-4 pb-24 pt-10 sm:px-8">
        <main id="doc-main" className="min-w-0 flex-1">
          <DocHeader doc={meta} />
          {viz && <VizFigure viz={viz} />}
          <article className="doc doc-wide">
            {doc.coding && <CodingOverview coding={doc.coding} />}
            <Markdown content={doc.content} />
            {doc.coding && <CodingPitfalls coding={doc.coding} />}
            {doc.coding && doc.coding.followUps.length > 0 && (
              <>
                <h2 id={slugifyHeading(CODING_TITLES.followUps)}>{CODING_TITLES.followUps}</h2>
                <FollowUps items={doc.coding.followUps} />
              </>
            )}
          </article>
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
