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
concepts:
  - "**Distance is latency** — a cross-continent round trip costs 150 ms no matter how fast your servers are"
  - "**The cache key decides everything** — key on a per-user tracking parameter and you cache nothing"
  - "**`Cache-Control` is the contract** — `max-age`, `s-maxage` for shared caches, `stale-while-revalidate`, `private`"
  - "**Versioned URLs beat purging** — `app.a81f3c.js` cached for a year, replaced rather than invalidated"
  - "**Origin shield** — one mid-tier cache all edges fetch through, so a viral object causes one origin fetch"
  - "**Dynamic content caches too** — 5–30 seconds on a shared response is an enormous cut at a million requests a minute"
  - "**Video is just segments** — HLS and DASH files are static, which is why the CDN *is* the delivery mechanism"
  - "**Personalisation kills sharing** — split the page into a cached shell and a personalised fragment"
  - "**It is also the security edge** — TLS, DDoS absorption, WAF and signed URLs for private media"
---

# CDN

## Use cases

### Static assets, cached for a year

Versioned filenames make invalidation a non-problem: the URL changes when the
content does, so the edge can hold the old one forever and no purge has to
propagate. This is the uncontroversial case, and it takes one sentence in an
interview.

```mermaid
flowchart TB
    U1([User · Tokyo]) --> E1["Edge PoP<br/>hit · few ms"]
    U2([User · Berlin]) --> E2["Edge PoP<br/>miss"]
    E2 --> Shield["Origin shield<br/>collapses simultaneous misses"]
    Shield --> Origin["Origin<br/>app.a81f3c.js · max-age 1 year"]
    Origin --> Shield --> E2
    Deploy(["New build → app.9d2e77.js"]) -. "new URL, no purge" .-> Origin

    classDef hot stroke:#e8a33d,stroke-width:2px
    class Shield hot
```

### Absorbing a read spike

A ticket on-sale or a viral post is a hundred thousand readers wanting the same
bytes. Cached at the edge for even ten seconds, the origin sees one request per
PoP per window instead of the flood — which is a capacity argument, not a polish
one.

```mermaid
flowchart TB
    Crowd([100k readers · same object]) --> Edges["Edge PoPs<br/>s-maxage 10s"]
    Edges -- "1 request per PoP per window" --> Shield["Origin shield<br/>request collapsing"]
    Shield -- "1 request" --> Origin["Origin"]
    Origin --> DB[("Database<br/>never sees the crowd")]
    Edges -. "stale-while-revalidate:<br/>serve the old copy while refreshing" .-> Crowd

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB db
    class Edges hot
```

### Delivering video

HLS and DASH cut a stream into a manifest plus a few seconds of video per file.
Those segment files are static and immutable, so they cache perfectly — the CDN
is not an optimisation here, it is how the video reaches anyone.

```mermaid
flowchart TB
    Player([Player]) -- "1 · master.m3u8" --> Edge["Edge PoP"]
    Edge -- "2 · rendition manifest" --> Player
    Player -- "3 · seg_0042.ts · 4s of video" --> Edge
    Edge -. "miss → origin, once per segment" .-> Origin[("Object storage<br/>segments + manifests")]
    Player -. "bandwidth drops<br/>→ switch rendition, same edge" .-> Edge

    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Origin blob
    class Edge hot
```

### Caching a page that is partly personal

If every response embeds the viewer's name, nothing is shared and nothing caches.
Split it: the shell is one cached object for everyone, and the personal fragment
is a separate, uncached call the client makes after paint.

```mermaid
flowchart TB
    Browser([Browser]) -- "1 · GET /product/42" --> Edge["Edge<br/>cached shell · s-maxage 60"]
    Edge --> Browser
    Browser -- "2 · GET /me/header<br/>private, no-store" --> Origin["Origin"]
    Origin --> Browser
    Edge -. "one object serves every viewer" .-> Edge
    Origin -. "small, per-user, uncacheable" .-> Origin

    classDef hot stroke:#e8a33d,stroke-width:2px
    class Edge hot
```
