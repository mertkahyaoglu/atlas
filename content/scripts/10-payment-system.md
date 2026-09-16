# Payment System — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design the payment system for an e-commerce marketplace.

@you
Before anything else, let me agree what "payment" covers here, because it ranges from a Stripe call to building a bank.

1. We integrate with an external processor — Stripe, Adyen — rather than talking to card networks ourselves?
2. Do we charge immediately, or authorize at checkout and capture on shipment?
3. Refunds, partial refunds, chargebacks?
4. It's a marketplace, so do we pay sellers out?
5. Fraud, tax, currency conversion — ours?

@interviewer
External processors, yes. Authorize and capture. Refunds and chargebacks, yes. Payouts to sellers, yes. Fraud, tax and FX rates are other teams.

@you
Then here's what I'm building, and what I'm not.

**Functional:** charge a customer for an order; authorize then capture; refunds, partial refunds and chargebacks; payouts to sellers; transaction history and receipts.

**Non-functional:** **never double-charge, and never lose a payment.** Every money movement must be auditable and reconcilable. Strong consistency for balances; eventual consistency is fine for reporting. Availability matters, but it's **subordinate to correctness** — failing closed is the right behaviour here. And PCI-DSS: we **never store raw card numbers**.

**Out of scope, deliberately:** fraud scoring models, FX rate sourcing and tax calculation.

I want to flag now that this is the one design where I'll choose consistency over availability, and I'll say why when it comes up.

@interviewer
Good. Scale?

@you
Let me put numbers on it — mostly to show it isn't the hard part.

@note · Playbook 10.1, phase 1
"Availability subordinate to correctness" as a stated requirement gives you permission to fail closed later without it sounding like a gap. Announcing the CP choice early tells the interviewer you know what this prompt is testing.

## Estimate · 3 min · Modest numbers, and a correctness problem

@you
- **Transactions:** ~10,000/sec at peak.
- **Ledger writes:** double-entry means at least two entries per transaction, so **~20,000 writes/sec**.
- **Retention:** 7+ years, **immutable** — that's regulatory.

The conclusion, and I want to say it explicitly: **10k/sec is modest. This is not a scale problem, it's a correctness problem.** One well-tuned Postgres primary with a synchronous standby handles it. If I launched into sharding strategies now I'd have misread the question — every minute here should go to double charges, lost payments and an unreliable processor.

@interviewer
Why a synchronous standby specifically?

@you
Because an async replica can be behind when the primary dies. Failing over to it would lose payments we'd already acknowledged — the one thing the requirements forbid. A synchronous standby costs a little write latency on every commit, and in payments that's a trade I'd take every time.

@note · Playbook 10.4
Designing for scale that was never stated is a specific way to lose points, and this prompt is the trap for it. Saying "this is a correctness problem" out loud earns the time to go deep on what actually matters.

## API and data model · 5 min · The most important table is the idempotency table

@you
Five endpoints:

- `POST /v1/payments` with a **mandatory `Idempotency-Key` header** and `{order_id, amount, currency, payment_method_token, capture}` → `201`.
- `POST /v1/payments/{id}/capture {amount}`.
- `POST /v1/payments/{id}/refund` — also with an `Idempotency-Key` — `{amount, reason}` → `201`.
- `GET /v1/payments/{id}`.
- `POST /v1/webhooks/psp` — inbound from the processor, signed.

Note the body carries a `payment_method_token`, not a card number. Card details go from the browser **directly to the processor's hosted fields**, which return a token. Our servers never see a card number, which removes almost our entire codebase from PCI audit scope.

@you · at the whiteboard
Six tables:

| Table | Key | The point |
|---|---|---|
| `idempotency_keys` | PK `(merchant_id, key)` | `request_hash`, `response_body`, `status` — **the most important table in the system** |
| `payments` | PK `payment_id` | `state`: `PENDING → AUTHORIZED → CAPTURED → SETTLED`, or `FAILED`, `REFUNDED` |
| `ledger_entries` | PK `entry_id` | `transaction_id`, `account_id`, `DEBIT \| CREDIT`, `amount_minor_units` — **immutable, append-only** |
| `accounts` | PK `account_id` | `customer \| merchant \| fees \| psp_clearing`; balance **derived** from the ledger |
| `outbox` | PK `id` | events committed with the payment |
| `psp_events` | PK `psp_event_id` | dedupe for inbound webhooks |

Two things I'd state unprompted. **Amounts are integers in minor units**, never floats — `0.1 + 0.2 != 0.3` is a real bug that costs real money. Currency is an explicit column, and we never do arithmetic across currencies. And **ledger entries are never updated** — a correction is a new compensating entry.

@interviewer
Why double-entry? It feels like accounting ceremony.

@you
It's an **invariant you can check**. Every transaction writes entries that sum to zero — debit one account, credit another. If the sum across the ledger isn't zero, we have a bug, and we find it in seconds with a query instead of in a quarterly audit. Balances are derived by summing entries — cached and periodically recomputed — never a mutable field that can drift from the history.

@note · Playbook 10.1, phase 3
"The most important table in the system" is a claim worth making because it forces you to defend it — which the next phase does. Integers in minor units and append-only entries are the two details that signal domain experience.

## High-level design · 10 min · Commit first, then talk to the processor

@you · drawing
Let me trace a charge.

1. Checkout sends `POST /payments` with its `Idempotency-Key` through the **API gateway** to the **payment service**.
2. **Claim the key**: `INSERT` into `idempotency_keys` on `(merchant_id, key)`. If it already exists and the payment completed, return the **stored response** and do nothing else.
3. For a new key, **one ACID transaction**: insert the payment as `PENDING`, its balanced ledger entries, and an **outbox row**. Commit — all or nothing.
4. An **outbox publisher** drains unpublished rows to Kafka `payment.events`.
5. A **PSP worker** consumes the event and calls the processor to authorize — with a timeout, backoff with jitter, and a **circuit breaker** — passing **our idempotency key** to the PSP.
6. The PSP reports the outcome to our **webhook receiver**, which verifies the signature, dedupes on `psp_event_id`, and moves the payment's state.

Checkout sees `PENDING` immediately and learns the outcome by polling the payment or through a push — usually within a second or two.

@you
And separately, every day, **reconciliation**: fetch the processor's settlement file and compare it line by line against our ledger. Discrepancies go to an exceptions queue for a human.

@interviewer
Why the outbox? Just write to the database and publish to Kafka.

@you
That's a **dual write**, and either half can fail independently. If the commit succeeds and the publish fails, we have a payment nobody will ever process. If we publish first and the commit fails, we charge for a payment that doesn't exist. The outbox puts the event **inside the same transaction** as the payment, so there's one atomic write, and a separate publisher drains it at-least-once. Which means every consumer downstream has to be idempotent — and they are, because the key travels with the event.

@interviewer
Webhooks — can you trust them?

@you
They're unreliable, untrusted input. **Verify the HMAC signature**, or anyone on the internet can mark a payment as succeeded. **Dedupe on the processor's event ID**, because they retry. And **tolerate out-of-order arrival**: the payment state is a state machine that ignores transitions moving backwards, so a late `authorized` webhook can't undo `captured`.

@interviewer
Authorize versus capture — why split them?

@you
Authorization places a hold on the customer's funds without moving them; capture moves them. It lets the marketplace confirm stock or ship before taking money, which is the industry norm. The detail people forget: **authorizations expire**, typically after about seven days. So we need a scheduled job that captures or voids before expiry — otherwise orders that ship late quietly never get paid.

@note · Playbook 10.1, phase 4
Commit-then-call is the ordering that makes everything else safe, so trace it step by step. The outbox answer should name both failure orders of the dual write, not just one.

## Deep dive · 15 min · Idempotency, the timeout, and CP

@you
There's really one hard part with three faces: preventing double charges. Idempotency on our side, the processor timeout, and what happens during a partition. I'd take them in that order, then sagas if there's time. Or would you rather start with reconciliation and the ledger?

@interviewer
Start with idempotency.

@you
The client sends a key; the server claims it **with a unique-constrained insert before doing any work**. A retry finds the existing row and returns the stored response without re-charging.

The unique constraint is what makes this **concurrency-safe**. A naive "check if the key exists, then proceed" races — two retries arriving in the same millisecond both see nothing and both charge. With an insert, they race on the constraint and **exactly one wins**. The loser gets a conflict and either returns the stored response or, if the first is still in flight, a `409` telling the client to retry shortly.

One more check: **hash the request body** and store it with the key. The same key with a *different* amount is a client bug, and it should return an error — never silently replay the first payment's response for a second, different request.

@interviewer
You call the processor and get no response. What happened?

@you
There are three possibilities, and **I can't tell them apart**: the request never arrived; it arrived and succeeded but the response was lost; or it arrived and failed. Treating a timeout as a failure and retrying blindly is exactly how double charges happen — case two, charged twice.

So a timeout is **an unknown state, not a failure**. Two things make it safe. We pass **our idempotency key to the processor** — every major one supports it — so a retry is safe on their side too; they return the original result instead of charging again. And we resolve the unknown by **querying the processor for that key**, rather than guessing. Until we know, the payment stays `PENDING`.

@interviewer
The processor is down for ten minutes.

@you
The circuit breaker opens, so we stop hammering it. Where the product allows, payments are **queued as `PENDING`** rather than failed outright, and retried when the breaker closes. With a second processor we could fail over — but only for payments that **never reached the first one**. A payment that timed out against processor A must be resolved against A; sending it to B is a double charge waiting to happen. And reconciliation now spans two providers.

@interviewer
There's a network partition between your service and the database's primary. Do you keep taking payments?

@you
No. **Refusing the payment and returning an error is correct.** The customer retries; nothing is lost and nothing is charged twice. Accepting payments on both sides of a partition and reconciling later means double-charging real customers, with real regulatory exposure. This is the clearest case in system design where availability loses, and I'm comfortable saying so.

@interviewer
An order involves inventory, payment and shipping. Two-phase commit across them?

@you
I'd use a **saga** instead. 2PC would hold locks across network boundaries in three services, and a coordinator crash strands all of them holding locks. A saga runs local transactions with **compensating actions** — if shipping can't be booked, refund the charge and release the inventory.

The trade, which I want to name rather than hide: we give up isolation. There are observable intermediate states where money has been taken and nothing has shipped. In exchange: no distributed locks and far better availability. Each step is idempotent, so a saga that retries a step after a crash doesn't double it.

@interviewer
A chargeback arrives sixty days later.

@you
It's a **new transaction** with new ledger entries reversing the original — not an edit. The original payment and its history stay intact, so an auditor can see both what happened and what was reversed. That's exactly why the ledger is append-only.

@you
And reconciliation, because I think it's mandatory rather than optional. Distributed systems drift — webhooks get lost, retries land twice, the processor has its own bugs. The daily comparison against the settlement file is **the control that catches what the code missed.** Every discrepancy goes to a human, and the target count of unreconciled entries is zero.

@note · Playbook 10.1, phase 5
The timeout answer — "an unknown state, not a failure" — is the single sentence this prompt is built around. Following it with "retry against the same processor" shows you've traced the failure to its end rather than stopping at the slogan.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
I'd avoid sharding as long as possible — 10k/sec doesn't need it. At 10x, 200k ledger writes a second with synchronous replication does outgrow one primary, and then:

1. **Shard by `merchant_id`**, so a transaction's entries stay in one shard and in one ACID transaction. The idempotency key is already `(merchant_id, key)`, so the claim lands on the same shard as the payment.
2. The trap: every payment also moves money into **platform accounts** — fees, clearing — which would make every transaction cross-shard. So each shard holds its **own sub-accounts** for those, and the platform balance is their sum. Genuine cross-shard transfers become sagas.
3. **Giant merchants** get dedicated shards.
4. **CDC instead of outbox polling**, so ~32 shards aren't constantly polled.
5. **Streaming reconciliation**, because finding a discrepancy a day late over billions of entries is too late.

@interviewer
Payouts to sellers?

@you
A scheduled batch sums each merchant's **settled** balance, writes ledger entries moving funds from the platform account to the merchant's account, then initiates transfers through the same idempotent, retry-safe path as a charge. Payouts are where a small error becomes a large one — an extra zero leaves the building — so they get their own reconciliation and limits that require a human above a threshold.

@interviewer
How would you test that this is actually correct?

@you
Three ways. **Property-based tests** asserting the ledger sums to zero after arbitrary sequences of charges, captures, refunds and chargebacks. **Chaos tests** that kill the service between the processor call and the state update, and check that nothing is lost or doubled. And a **replay harness** over real historical webhook sequences, including duplicates and reorderings.

@you
What I'd monitor: **authorization success rate by processor and card type**, because a sudden drop is a processor issue before it's a support ticket; idempotency-key conflict rate; **outbox lag**; webhook processing lag; payments stuck in `PENDING` past a threshold; and the **count of unreconciled entries, which should be zero** — anything else pages someone.

@you
To close: this isn't a scale design. It's one Postgres primary with a synchronous standby, an idempotency key claimed by a unique insert, a double-entry ledger that's append-only and checkable, and an outbox so committing and publishing can't disagree. The processor is treated as unreliable — timeouts are unknown states resolved by querying — and reconciliation catches whatever the code didn't. When in doubt, it fails closed, because a failed payment can be retried and a double charge can't be taken back.

@note · Playbook 10.5
The last sentence justifies the CP choice with an asymmetry a non-engineer would understand. Testing strategy — properties, chaos, replay — is rarely volunteered and is exactly the operational maturity a payments interviewer wants to see.
