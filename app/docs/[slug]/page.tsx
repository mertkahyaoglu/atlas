import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buildToc, getAllDocs, getDoc, getSiblings, toMeta } from "@/lib/content";
import { accentVar } from "@/lib/utils";
import { TopBar } from "@/components/layout/TopBar";
import { DocHeader } from "@/components/docs/DocHeader";
import { Markdown } from "@/components/docs/Markdown";
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

  const toc = buildToc(doc.content);
  const { prev, next } = getSiblings(doc.slug);

  return (
    <div style={accentVar(doc.group)}>
      <TopBar crumb={doc.title} />

      <div className="mx-auto flex max-w-shell gap-12 px-4 pb-24 pt-10 sm:px-8">
        <main id="doc-main" className="min-w-0 flex-1">
          <DocHeader doc={toMeta(doc)} />
          <article className="doc">
            <Markdown content={doc.content} />
          </article>
          <PrevNext prev={prev} next={next} />
        </main>

        <div className="hidden w-toc shrink-0 xl:block">
          <div className="sticky top-20 space-y-8">
            <ReadingProgress targetId="doc-main" />
            <Toc entries={toc} />
          </div>
        </div>
      </div>
    </div>
  );
}
