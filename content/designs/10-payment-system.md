---
group: "design"
order: 10
title: "Payment System"
summary: "Charges, captures, refunds and payouts across an unreliable external processor, with a ledger that has to balance."
hardPart: "The one design where consistency beats availability, and where at-least-once plus idempotent stops being a slogan and becomes the mechanism preventing double charges."
tags: ["consistency", "idempotency", "saga", "outbox", "postgres"]
hardPartDetail: "This is the one design where you must choose consistency over availability, and where \"at-least-once + idempotent\" stops being a slogan and becomes the actual mechanism preventing double-charges. They also want to see you treat the external payment processor as unreliable and asynchronous."
concepts:
  - "ACID transactions"
  - "double-entry ledger"
  - "idempotency keys"
  - "sagas and compensating actions"
  - "transactional outbox"
  - "exactly-once *effects*"
  - "reconciliation"
  - "CP over AP"
  - "audit trails"
requirements:
  functional:
    - "Charge a customer for an order"
    - "Support authorize → capture (hold funds now, take them on shipment)"
    - "Refunds, partial refunds, and chargebacks"
    - "Payouts to sellers/merchants"
    - "Transaction history and receipts"
  nonFunctional:
    - "**Never double-charge.** Never lose a payment."
    - "Every money movement must be auditable and reconcilable"
    - "Strong consistency for balances; eventual consistency acceptable for reporting"
    - "Availability target is high but subordinate to correctness — failing closed is correct here"
    - "PCI-DSS: never store raw card numbers"
  outOfScope: "fraud scoring models, FX rate sourcing, tax calculation."
scale:
  numbers: |-
    Transactions:   10,000/sec peak
    Ledger entries: 2+ per transaction (double-entry) → 20,000 writes/sec
    Retention:      7+ years, immutable (regulatory)
  conclusion: "10k/sec is modest — this is *not* a scale problem. It is a correctness problem. Say that explicitly; candidates who launch into sharding strategies have misread the question."
tradeoffs:
  - title: "Idempotency is the core mechanism, not a nice-to-have"
    body: |-
      The client sends a key; the server claims it with a unique-constrained INSERT before doing any work. A retry finds the existing row and returns the stored response without re-charging. The unique constraint is what makes this concurrency-safe — two simultaneous retries race on the INSERT and exactly one wins. Also hash the request body and compare: the same key with a *different* amount is a client bug and should return an error, not silently replay.
  - title: "The timeout problem, stated properly"
    body: |-
      You call the PSP and get no response. Three possibilities: the request never arrived, it arrived and succeeded but the response was lost, or it arrived and failed. You cannot distinguish them. Treating a timeout as a failure and retrying blindly is how double-charges happen. The correct handling: pass your idempotency key to the PSP as well (every major processor supports this), so a retry is safe on their side too, and reconcile the unknown state by *querying* the PSP for that key rather than guessing.
  - title: "Double-entry ledger"
    body: |-
      Every transaction writes at least two entries that sum to zero — debit one account, credit another. This isn't accounting ceremony; it's an invariant you can *check*. If the sum of all ledger entries isn't zero, you have a bug, and you'll find it in seconds rather than discovering it in a quarterly audit. Balances are derived by summing entries (cached and periodically recomputed), never stored as a mutable field that can drift.
  - title: "Why CP, not AP"
    body: |-
      During a partition, refusing the payment and returning an error is correct. The user retries; nothing is lost. Accepting the payment on both sides of a partition and reconciling later means double-charging real customers and real regulatory exposure. This is the clearest case in all of system design where availability loses, and stating it confidently is exactly what they want to hear.
  - title: "Saga over 2PC"
    body: |-
      Two-phase commit across an inventory service, a payment service, and a shipping service would hold locks across network boundaries, and a coordinator crash strands everything. A saga runs local transactions with compensating actions — refund the charge, release the inventory. You give up isolation (there are observable intermediate states where money is taken but nothing has shipped) in exchange for availability and no distributed locking. Name the trade, don't hide it.
  - title: "Transactional outbox"
    body: |-
      You must update the database and publish an event. Doing both directly is a dual write: either can fail independently. The outbox writes the event row *inside the same transaction* as the payment, and a separate publisher drains it. Now there is one transaction, atomicity holds, and publishing is at-least-once — hence idempotent consumers downstream. This is the standard answer to "what if the DB write succeeds but Kafka fails?" and it applies well beyond payments.
  - title: "Authorize vs capture"
    body: |-
      Authorization places a hold on funds without moving them; capture moves them. Splitting the two lets you verify stock or ship before taking money, and it's the industry norm. Authorizations expire (typically ~7 days), so you need a job to capture or void before expiry — an easy detail to forget and a good one to mention.
  - title: "PCI scope reduction"
    body: |-
      Card details go from the browser directly to the PSP's hosted fields or SDK, which returns a token. Your servers only ever see the token. This removes almost your entire codebase from PCI-DSS audit scope. If you accept raw card numbers anywhere, every service that touches them is in scope, and that is enormously expensive.
  - title: "Reconciliation is mandatory"
    body: |-
      Every day, fetch the PSP's settlement report and compare it line by line against your ledger. Discrepancies go to an exceptions queue for human review. Distributed systems drift — webhooks get lost, retries land twice, the PSP has its own bugs. Reconciliation is the control that catches what the code missed, and mentioning it unprompted is a strong domain signal.
  - title: "Webhooks are unreliable input"
    body: |-
      Verify the HMAC signature (otherwise anyone can mark payments as succeeded). Dedupe on the processor's event ID. Tolerate out-of-order arrival: model payment state as a state machine that ignores transitions that would move backwards, so a late `authorized` webhook doesn't undo a `captured` state.
  - title: "Currency"
    body: |-
      Store minor units as integers with an explicit currency code. Never mix currencies in an arithmetic operation. For multi-currency, record the FX rate used *on the transaction itself* so the historical record is reproducible.
followUps:
  - question: "A chargeback arrives 60 days later."
    answer: "It's a new transaction with new ledger entries reversing the original, not an edit. The original payment row's history stays intact. This is why the ledger is append-only."
  - question: "How do you handle a PSP outage?"
    answer: "Circuit breaker opens; queue payments as PENDING rather than failing them outright where the product allows, and retry when the breaker closes. For multi-PSP setups, fail over to a secondary processor — but note that reconciliation now spans two providers."
  - question: "How do you shard this if you outgrow one database?"
    answer: "Partition by `merchant_id` or `account_id` so a transaction's entries stay within one shard and remain in a single ACID transaction. Cross-shard transfers become sagas. Avoid sharding as long as possible — 10k/sec doesn't need it."
  - question: "How do you test correctness?"
    answer: "Property-based tests asserting the ledger sums to zero after arbitrary operation sequences; chaos testing that kills the service between the PSP call and the state update; and a replay harness over historical webhook sequences including duplicates and reorderings."
  - question: "Payouts to merchants?"
    answer: "A scheduled batch that sums each merchant's settled balance, writes ledger entries moving funds from the platform account to the merchant account, then initiates transfers via the same idempotent, retry-safe path. Payouts are usually where a small error becomes a large one, so they get extra reconciliation."
  - question: "What do you monitor?"
    answer: "Authorization success rate by PSP and card type (a sudden drop means a processor issue), idempotency-key collision rate, outbox lag, webhook processing lag, and the count of unreconciled entries — which should be zero."
---
# 10 — Payment System

## API / Model

```api
POST /v1/payments || Idempotency-Key: <uuid> || 201 payment || the Idempotency-Key header is mandatory
+ {order_id, amount, currency, payment_method_token, capture: true|false}
POST /v1/payments/{id}/capture || {amount} || 200
POST /v1/payments/{id}/refund || Idempotency-Key: <uuid>  {amount, reason} || 201 refund
GET /v1/payments/{id} || || 200 payment
POST /v1/webhooks/psp || || 200 || inbound from the processor, signed
```

```schema
idempotency_keys || PK: (merchant_id, key) || request_hash, response_body, status, created_at || TTL 24h; the single most important table in the system
payments || PK: payment_id || order_id, amount, currency, state, psp_ref, created_at ||
+ states: PENDING → AUTHORIZED → CAPTURED → SETTLED
+                ↘ FAILED    ↘ REFUNDED / PARTIALLY_REFUNDED
ledger_entries || PK: entry_id || transaction_id, account_id, direction (DEBIT|CREDIT), amount_minor_units (INTEGER, never float), currency, created_at || immutable and append-only; Σ debits = Σ credits per transaction_id
accounts || PK: account_id || type (customer|merchant|fees|psp_clearing) || balance is derived from the ledger, cached with periodic reconciliation
outbox || PK: id || aggregate_id, event_type, payload, published (bool) ||
psp_events || PK: psp_event_id || || dedupe of inbound webhooks
```

Two details worth stating unprompted: **amounts are integers in minor units** (cents), never floats — `0.1 + 0.2 != 0.3` is a real bug that costs real money. And **ledger entries are immutable**; a correction is a new compensating entry, never an UPDATE.

---

## High-level architecture

```mermaid
flowchart TB
    Checkout([Checkout]) -- "POST /payments<br/>Idempotency-Key" --> GW[API Gateway]
    Checkout -. "card details go DIRECTLY to PSP<br/>your servers NEVER see a PAN" .-> PSP

    subgraph PAY ["Payment Service"]
        direction TB
        Idem{"1 · IDEMPOTENCY CHECK<br/>INSERT on (merchant, key)<br/>unique constraint IS the lock"}
        Found["key found + completed<br/>→ return STORED response<br/>do NOT re-execute"]
        Txn["2 · SINGLE ACID TRANSACTION<br/>INSERT payment (PENDING)<br/>INSERT balanced ledger entries<br/>INSERT outbox row<br/>COMMIT — all or nothing"]
        Idem -- "seen" --> Found
        Idem -- "new · claimed" --> Txn
    end
    GW --> Idem

    Txn --> DB[("Primary DB · Postgres<br/>ACID · CP · synchronous replication<br/>ledger is APPEND-ONLY<br/>Σ debits = Σ credits")]
    Txn --> Outbox["Outbox publisher<br/>polls unpublished rows → Kafka<br/>solves the DUAL WRITE problem"]
    Outbox --> Events{{"Kafka · payment.events"}}
    Events --> Downstream["Downstream consumers<br/>fulfilment · receipts · warehouse"]
    Events --> Worker["PSP worker · authorize / capture<br/>timeout + backoff + jitter<br/>circuit breaker per PSP<br/>passes OUR idempotency key to the PSP"]
    Worker -.- Timeout["TIMEOUT = UNKNOWN STATE, not failure<br/>resolve by QUERYING the PSP for the key"]

    Worker --> PSP[("PSP · Stripe / Adyen / bank")]
    PSP --> Hook["Webhook receiver<br/>verify HMAC signature<br/>dedupe on psp_event_id<br/>tolerate out-of-order arrival"]
    Hook --> DB
    DB --> Recon["Daily reconciliation<br/>PSP settlement file ⟷ our ledger<br/>discrepancies → exceptions queue<br/>this is NOT optional"]

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB,PSP store
    class Idem hot

    click DB href "/docs/02-data-storage" "Role: writes the payment and its ledger entries in one ACID transaction, replicated synchronously.<br/>Trade-off: picks consistency over availability, so writes stop rather than risk money."
    click Events href "/docs/05-async-messaging-and-event-driven" "Role: publishes payment events for fulfilment and receipts, fed by the outbox.<br/>Trade-off: at-least-once delivery, so every consumer must dedupe."
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
  [Client / Checkout]
          │  card details go DIRECTLY to PSP's hosted field / SDK
          │  ────────────────────────────────────────────────────┐
          │  (your servers NEVER see a PAN — PCI scope reduction) │
          ▼                                                        ▼
  ┌───────────────────┐                                  ┌──────────────────┐
  │   API GATEWAY      │                                  │  PSP (Stripe /   │
  │   authn, rate limit│                                  │  Adyen / bank)   │
  └─────────┬─────────┘                                  └────────┬─────────┘
             │ POST /payments + Idempotency-Key                    ▲
             ▼                                                      │
  ┌──────────────────────────────────────────────────┐             │
  │            PAYMENT SERVICE                        │             │
  │                                                    │             │
  │  ┌──────────────────────────────────────────┐    │             │
  │  │ 1. IDEMPOTENCY CHECK                      │    │             │
  │  │    SELECT ... WHERE (merchant, key)       │    │             │
  │  │     ├─ FOUND + completed → return stored  │    │             │
  │  │     │   response. DO NOT re-execute.      │    │             │
  │  │     ├─ FOUND + in-flight  → 409 / wait    │    │             │
  │  │     └─ NOT FOUND → INSERT (claim it), go  │    │             │
  │  │    ⚠ the INSERT is the lock. Unique       │    │             │
  │  │      constraint = concurrency safety.     │    │             │
  │  └──────────────────────────────────────────┘    │             │
  │                     ▼                              │             │
  │  ┌──────────────────────────────────────────┐    │             │
  │  │ 2. SINGLE ACID TRANSACTION                │    │             │
  │  │    · INSERT payment (state=PENDING)       │    │             │
  │  │    · INSERT ledger entries (balanced)     │    │             │
  │  │    · INSERT outbox row                    │    │             │
  │  │    COMMIT  ← all or nothing                │    │             │
  │  └──────────────────────────────────────────┘    │             │
  └───────────────────────┬──────────────────────────┘             │
                           │                                        │
         ┌─────────────────┴──────────────────┐                    │
         ▼                                     ▼                    │
  ┌──────────────┐                  ┌───────────────────────┐      │
  │  PRIMARY DB   │                  │  OUTBOX PUBLISHER      │      │
  │  (Postgres,   │                  │  polls unpublished →   │      │
  │   ACID, CP)   │                  │  Kafka → mark sent     │      │
  │  synchronous  │                  │  ← solves the DUAL     │      │
  │  replication  │                  │    WRITE problem       │      │
  └──────────────┘                  └───────────┬───────────┘      │
                                                  ▼                  │
                                    ┌──────────────────────────┐    │
                                    │  Kafka: payment.events    │    │
                                    └────┬──────────┬──────────┘    │
                                          │          │                │
                     ┌────────────────────┘          └────────────┐  │
                     ▼                                             ▼  │
        ┌──────────────────────────┐              ┌──────────────────┴──┐
        │  PSP WORKER               │              │ downstream consumers │
        │  (authorize / capture)    │──────────────│ · order fulfilment   │
        │                            │  call PSP    │ · receipts/email     │
        │  · timeout + retry w/      │◄─────────────│ · analytics/warehouse│
        │    exponential backoff     │  async ack   └─────────────────────┘
        │    + JITTER                │
        │  · circuit breaker per PSP │
        │  · pass OUR idempotency    │
        │    key to the PSP too      │
        └────────────┬───────────────┘
                      │
                      │  ⚠ TIMEOUT = UNKNOWN STATE, not failure.
                      │    Never assume "no response" = "didn't charge".
                      │    Resolve by querying PSP for the key.
                      ▼
        ┌──────────────────────────────────────┐
        │  PSP WEBHOOK RECEIVER                 │
        │  · verify HMAC signature              │
        │  · dedupe on psp_event_id             │
        │  · out-of-order tolerant (state       │
        │    machine ignores backward moves)    │
        │  · advance payment state, write ledger│
        └────────────┬─────────────────────────┘
                      ▼
        ┌──────────────────────────────────────┐
        │  RECONCILIATION (daily batch)         │
        │  PSP settlement file  ⟷  our ledger   │
        │  → discrepancies to an exceptions     │
        │    queue for human review             │
        │  ⚠ This is not optional. Distributed  │
        │    systems drift; reconciliation is   │
        │    how you find out.                  │
        └──────────────────────────────────────┘

  ═══ SAGA: multi-step order with compensation ═══

   Reserve inventory ──ok──► Charge payment ──ok──► Ship
          │                        │                  │
          │                        │           FAIL ──┘
          │                   compensate: REFUND
          └── compensate: RELEASE inventory

   Each step idempotent and retryable. No 2PC across services.
```

</details>

---
