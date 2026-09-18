# Playground — POC plan

A page where the reader builds a system on a canvas, sets the scale it has to
survive, and watches whether it holds. Hot components turn red, edges animate
faster as traffic grows, and every component can be opened and tuned.

## Simulation model

**Steady-state first.** `simulate(graph, workload)` is a pure function: given
the current graph and sliders it computes the load on every node and edge and
a verdict. It re-runs on every change; the animations visualise the numbers.

It is shaped so a tick loop can wrap it later: per-node processing is a
function of (inflow, config) → (processed, outflow, shed). A tick loop is that
same function run repeatedly with a queue depth carried between ticks.

- Traffic has two dimensions: **rps** (requests per second) and **connections**
  (concurrent sockets). Clients inject both. Connections pass through load
  balancers and CDNs and stop at the first component that terminates them
  (gateways, services).
- Each node's capacity is `instances × capacity per instance`. Utilization is
  `load / capacity`; status is `ok < 0.7`, `warm < 0.9`, `hot < 1`,
  `overloaded ≥ 1`.
- An overloaded node processes at capacity and sheds the rest, so downstream
  nodes see less. ("The DB is fine only because the gateway is dropping.")
- A node's outflow splits evenly across its outgoing edges. Caches pass
  `1 − hit ratio` downstream; queues multiply by the workload's fan-out
  (one message → N deliveries).
- Cycles: back-edges found by DFS are ignored for propagation.
- Verdict: green when nothing is overloaded and structural checks pass
  (a client exists, a durable store is reachable, sockets have somewhere to
  terminate).

## Files

```
app/playground/page.tsx             route
components/playground/
  PlaygroundCanvas.tsx              React Flow canvas: drop, connect, select
  Palette.tsx                       draggable component catalogue
  ComponentNode.tsx                 node card with heat + utilization bar
  TrafficEdge.tsx                   edge whose dash speed follows its rps
  ConfigDialog.tsx                  click a node → tune it
  WorkloadPanel.tsx                 scenario presets + sliders + verdict
lib/playground/
  types.ts                          graph, config, workload, sim result
  components.ts                     catalogue: kinds, defaults, fields
  sim.ts                            steady-state engine (pure, testable)
  scenarios/chat.ts                 presets and starter graph
store/usePlaygroundStore.ts         nodes/edges/workload, persisted
```

## Build order

1. Route, canvas, palette drag-and-drop, connect/delete, persistence.
2. Catalogue + sim engine.
3. Workload panel + verdict.
4. Edge speed and node heat animations.
5. Config dialog.
6. Chat starter graph and presets.

## Later

Tick loop with queues filling over time · latency modelling · failure
injection · tech presets (Redis, Kafka, Cassandra…) that set defaults and link
to the tech pages · more scenarios · auto layout via dagre · share links.
