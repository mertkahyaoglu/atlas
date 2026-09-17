---
group: "tech"
order: 11
title: "CDN"
role: "Edge cache"
summary: "Caches near the user that cut latency, absorb read spikes, and shift most traffic off your origin."
tags: ["cdn", "caching", "reliability", "security"]
facts:
  - label: "Shape"
    value: "Caching proxies in points of presence, reached by anycast"
  - label: "Latency"
    value: "A few ms from the edge; a cross-continent round trip is ~150 ms"
  - label: "Origin load"
    value: "Cut by the hit ratio — 95% means one request in twenty reaches you"
  - label: "Cache key"
    value: "Host + path + the query parameters and headers you choose"
  - label: "Invalidation"
    value: "Versioned URLs, short TTLs; purge only for mistakes"
  - label: "Also does"
    value: "TLS termination, HTTP/3, DDoS absorption, WAF, signed URLs"
capabilities:
  - title: "The cache key decides everything"
    body: |-
      Getting it wrong is how you either fragment the cache — keying on a tracking parameter that changes per user — or serve the wrong thing, by failing to vary on `Accept-Language`.
  - title: "Cache-Control is the contract"
    body: |-
      `max-age` sets edge and browser lifetime, `s-maxage` sets it for shared caches only, `stale-while-revalidate` lets the edge serve a slightly stale copy while it refreshes behind the request, and `private`/`no-store` keeps personalised responses out entirely.

      `ETag` plus `If-None-Match` turns a refetch into a cheap 304.
  - title: "Versioned URLs beat purging"
    body: |-
      Purge APIs exist and take seconds to minutes to propagate globally. The robust approach is an immutable URL — `app.a81f3c.js`, `avatar/123/v7.jpg` — cached for a year and replaced by a new URL when the content changes.

      For genuinely dynamic content, a short TTL with `stale-while-revalidate` beats trying to purge precisely.
  - title: "Dynamic content is cacheable too"
    body: |-
      A response every user shares — a top-ten list, a public profile, the first page of a feed — can be cached at the edge for 5 to 30 seconds. At a million requests per minute that is an enormous cut in origin traffic for almost no staleness.
  - title: "Video is just segments"
    body: |-
      HLS and DASH cut a stream into a few seconds of video per file plus a manifest. The segments are static and cache perfectly, which is why a CDN is not an optimisation for streaming but the delivery mechanism itself.
useWhen:
  - "There are static assets, images or video, or users spread geographically — this part takes one sentence"
  - "**Absorbing a read spike**: ticket on-sales, a viral post, a live event"
  - "**The celebrity problem**: one object requested by millions is the ideal CDN case"
  - "**Shaving a global p99**: \"under 200 ms worldwide\" from a single-region origin is an edge-caching problem"
avoidWhen:
  - "The response is per-user — split the page instead: cached shell, personalised fragment"
  - "The data must be correct to the second"
  - "It is a write path; an edge cache does nothing for writes"
probes:
  - question: "What is the hit ratio, and what does the origin still see?"
    answer: "Multiply it out: 10M requests/min at a 95% hit ratio still leaves 500k/min reaching you. Size the origin for the miss traffic."
  - question: "How do you invalidate?"
    answer: "Versioned URLs for assets, short TTLs with stale-while-revalidate for dynamic content, purge only for mistakes and takedowns."
  - question: "Every response embeds the viewer's name. Now what?"
    answer: "Nothing is shared, so nothing caches. Split the page: cached shell at the edge, personalised fragment fetched separately."
  - question: "You purged everything, or a new region came online."
    answer: "Every edge misses at once. Origin shield and request collapsing turn that thundering herd into one origin fetch."
  - question: "How is a paid video protected?"
    answer: "Signed URLs with short expiry and token auth at the edge, so the link is not simply public."
  - question: "What are you *not* caching?"
    answer: "Writes, anything user-specific, anything that must be correct to the second. Saying that is as strong as saying what you cache."
---

# CDN

## How it works

A CDN is a fleet of caching proxies in points of presence around the world.
Anycast routing sends a user to a nearby one; if that edge has the content it
serves it in a few milliseconds, and if not it fetches from your origin, stores it,
and serves everyone else from the copy.

```mermaid
flowchart TB
    U1([User · Tokyo]) --> E1["Edge PoP<br/>hit: few ms"]
    U2([User · Berlin]) --> E2["Edge PoP<br/>miss"]
    E1 -. "hit" .-> U1
    E2 -- "miss" --> Shield["Origin shield<br/>collapses simultaneous misses"]
    Shield --> Origin["Origin<br/>your servers · object storage"]
    Origin -- "Cache-Control<br/>max-age · s-maxage · SWR" --> Shield
    Shield --> E2

    classDef hot stroke:#e8a33d,stroke-width:2px
    class Shield hot
```

Two things follow. **Latency** drops because distance drops — a round trip to
another continent costs 150 ms no matter how fast your servers are. And **origin
load** drops by whatever the hit ratio is.

The **origin shield** is the part people forget: a designated mid-tier cache that
all edges fetch through, so a viral object causes one origin fetch rather than
hundreds of simultaneous misses.

## Where it fits in a design

Put it in the diagram whenever there are assets or geography, then reach for it
deliberately when the hard part is a read spike, a celebrity key, or a global
latency budget.

> The edge is what stands between a hundred thousand simultaneous readers and
> your database. That is a capacity argument, not a polish one.
