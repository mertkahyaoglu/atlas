import { docCard, OG_CONTENT_TYPE, OG_SIZE, siteCard } from "@/lib/og";
import { getAllDocs, getDoc } from "@/lib/content";

export const alt = "System Design Atlas";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** One card per document, generated at build time alongside the pages. */
export function generateStaticParams() {
  return getAllDocs().map((doc) => ({ slug: doc.slug }));
}

export default function Image({ params }: { params: { slug: string } }) {
  const doc = getDoc(params.slug);
  // A slug with no document has no page either, so the fallback is only ever
  // reached by a direct request for the image.
  return doc ? docCard(doc) : siteCard();
}
