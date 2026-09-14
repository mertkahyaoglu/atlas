/**
 * The hero states the one idea that makes the rest of the atlas usable: every
 * design decision resolves to one of four trades. That framing is the most
 * characteristic thing in this subject, so it leads rather than a stat block.
 */
const TRADES = [
  { name: "Now or later", gloss: "Precompute or compute on demand" },
  { name: "One copy or many", gloss: "Speed and availability, paid for in consistency" },
  { name: "One machine or many", gloss: "Capacity, paid for in coordination" },
  { name: "Correct or available", gloss: "What you give up during a partition" },
];

export function Hero() {
  return (
    <section className="border-b border-rule pb-12">
      <h1 className="max-w-[18ch] text-display font-semibold leading-[1.05] text-ink">
        Almost every design decision is one of four trades.
      </h1>

      <p className="mt-5 max-w-reading text-lead text-inkMuted">
        Twenty-five worked documents on distributed systems: ten concept modules built
        from the ground up, and fifteen full designs with architecture diagrams,
        trade-offs and the follow-up questions that actually get asked.
      </p>

      <dl className="mt-10 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        {TRADES.map((trade) => (
          <div key={trade.name} className="border-t border-ruleStrong pt-3">
            <dt className="text-small font-semibold text-ink">{trade.name}</dt>
            <dd className="mt-1 text-tiny leading-relaxed text-inkMuted">{trade.gloss}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-8 max-w-reading text-small text-inkFaint">
        Spot which one a novel prompt is really about, pick a side, and defend it with the
        product requirement. That is the skill being tested.
      </p>
    </section>
  );
}
