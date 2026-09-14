import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-reading flex-col items-start px-6 py-32">
      <h1 className="text-h1 font-semibold text-ink">That page isn&rsquo;t in the atlas.</h1>
      <p className="mt-3 text-base text-inkMuted">
        The link may be out of date, or the document may have been renamed.
      </p>
      <Link
        href="/"
        className="mt-6 rounded border border-rule px-3 py-2 text-small text-ink hover:border-ruleStrong"
      >
        Back to the index
      </Link>
    </main>
  );
}
