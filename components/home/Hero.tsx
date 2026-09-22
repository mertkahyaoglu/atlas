import Link from "next/link";
import { Copy, Scale, Server, Timer, type LucideIcon } from "lucide-react";

interface Side {
  label: string;
  gets: string;
  costs: string;
}

interface Trade {
  name: string;
  gloss: string;
  icon: LucideIcon;
  body: string;
  sides: [Side, Side];
  docs: { slug: string; label: string }[];
}

/**
 * The hero states the one idea that makes the rest of the atlas usable: every
 * design decision resolves to one of four trades. That framing is the most
 * characteristic thing in this subject, so it leads rather than a stat block.
 */
const TRADES: Trade[] = [
  {
    name: "Now or later",
    gloss: "Precompute or compute on demand",
    icon: Timer,
    body: "Do the work when data is written and reads become instant but can go stale. Do it when data is read and results stay fresh, but every request pays the cost.",
    sides: [
      { label: "Now", gets: "Instant reads", costs: "Staleness, storage, write amplification" },
      { label: "Later", gets: "Always fresh, cheap writes", costs: "Slower, costlier reads" },
    ],
    docs: [
      { slug: "06-fanout-and-feeds", label: "Fan-out" },
      { slug: "04-caching", label: "Caching" },
      { slug: "05-async-messaging-and-event-driven", label: "CQRS" },
    ],
  },
  {
    name: "One copy or many",
    gloss: "Speed and availability, paid for in consistency",
    icon: Copy,
    body: "Replicas and caches put data closer to readers and survive failures, but every extra copy can lag behind the source of truth. The real question is how stale a read the product can tolerate.",
    sides: [
      { label: "One copy", gets: "Always consistent", costs: "Bottleneck, single point of failure" },
      { label: "Many copies", gets: "Fast, resilient reads", costs: "Replication lag, conflicts" },
    ],
    docs: [
      { slug: "02-data-storage", label: "Replication" },
      { slug: "04-caching", label: "Cache layers" },
      { slug: "03-consistency-and-distributed-systems", label: "Quorums" },
    ],
  },
  {
    name: "One machine or many",
    gloss: "Capacity, paid for in coordination",
    icon: Server,
    body: "A bigger machine keeps everything simple until it hits a ceiling. Splitting data and traffic across machines removes the ceiling, but adds routing, rebalancing, hot keys and queries that span shards.",
    sides: [
      { label: "One machine", gets: "Simple, transactional", costs: "Hard capacity ceiling" },
      { label: "Many machines", gets: "Near-unlimited scale", costs: "Coordination, partial failure" },
    ],
    docs: [
      { slug: "01-foundations", label: "Scaling" },
      { slug: "02-data-storage", label: "Sharding" },
      { slug: "03-consistency-and-distributed-systems", label: "Sagas" },
    ],
  },
  {
    name: "Correct or available",
    gloss: "What you give up during a partition",
    icon: Scale,
    body: "When the network splits, a node either refuses requests it cannot guarantee or answers with data that may be stale. Payments and seat inventory lean correct; feeds and like counts lean available.",
    sides: [
      { label: "Correct", gets: "Never wrong", costs: "Errors and timeouts while split" },
      { label: "Available", gets: "Always answers", costs: "Stale reads, reconcile later" },
    ],
    docs: [
      { slug: "03-consistency-and-distributed-systems", label: "CAP and PACELC" },
      { slug: "10-payment-system", label: "Payments" },
      { slug: "01-twitter-instagram-feed", label: "Feeds" },
    ],
  },
];

function TradeCard({ trade, index }: { trade: Trade; index: number }) {
  const Icon = trade.icon;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-md border border-rule bg-surface p-5 transition-colors duration-fast hover:border-ruleStrong sm:p-6">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--concept)] to-transparent opacity-50 transition-opacity duration-fast group-hover:opacity-100"
      />

      <div className="flex items-start gap-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-rule bg-raised text-[color:var(--concept)]">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <span className="font-mono text-micro text-inkFaint">{String(index + 1).padStart(2, "0")}</span>
          <h3 className="text-h3 font-semibold leading-tight text-ink">{trade.name}</h3>
          <p className="mt-0.5 text-small text-[color:var(--concept)]">{trade.gloss}</p>
        </div>
      </div>

      <p className="mt-4 text-small leading-relaxed text-inkMuted">{trade.body}</p>

      <div className="relative mt-5 grid grid-cols-2 overflow-hidden rounded border border-rule">
        {trade.sides.map((side, i) => (
          <div key={side.label} className={i === 0 ? "border-r border-rule bg-canvas p-3" : "bg-canvas p-3 text-right"}>
            <span className="block font-mono text-micro uppercase tracking-wide text-inkFaint">{side.label}</span>
            <span className="mt-1 block text-small font-medium text-ink">{side.gets}</span>
            <span className="mt-0.5 block text-tiny leading-snug text-inkMuted">{side.costs}</span>
          </div>
        ))}
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-ruleStrong bg-surface font-mono text-micro text-inkFaint"
        >
          vs
        </span>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-5">
        <span className="mr-1 font-mono text-micro uppercase tracking-wide text-inkFaint">Go deeper</span>
        {trade.docs.map((doc) => (
          <Link
            key={doc.label}
            href={`/docs/${doc.slug}`}
            className="rounded-sm border border-rule px-2 py-0.5 font-mono text-micro text-inkMuted transition-colors duration-fast hover:border-[color:var(--concept)] hover:text-[color:var(--concept)]"
          >
            {doc.label}
          </Link>
        ))}
      </div>
    </article>
  );
}

export function Hero() {
  return (
    <section className="border-b border-rule pb-12">
      <h1 className="max-w-[18ch] text-display font-semibold leading-[1.05] text-ink">
        Almost every design decision is one of{" "}
        <span className="text-[color:var(--concept)]">four trades.</span>
      </h1>

      <p className="mt-5 max-w-reading text-lead text-inkMuted">
        Worked documents on distributed systems: concept modules built from the ground
        up, pages on the technologies they name, and full designs with architecture
        diagrams, trade-offs and the follow-up questions that actually get asked.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {TRADES.map((trade, index) => (
          <TradeCard key={trade.name} trade={trade} index={index} />
        ))}
      </div>

      <p className="mt-8 max-w-reading border-l-2 border-[color:var(--concept)] pl-4 text-small text-inkMuted">
        Spot which one a novel prompt is really about, pick a side, and defend it with the
        product requirement. <span className="text-ink">That is the skill being tested.</span>
      </p>
    </section>
  );
}
