import { defaultConfig } from "../components";
import type { PlaygroundEdge, PlaygroundNode, Workload } from "../types";

export interface ScalePreset {
  id: string;
  label: string;
  note: string;
  workload: Workload;
}

/** Matches the tabs on the Chat / Slack design page. */
export const CHAT_PRESETS: ScalePreset[] = [
  { id: "today", label: "Today", note: "200 msg/s · 20k sockets", workload: { rps: 200, connections: 20_000, fanout: 3 } },
  { id: "10x", label: "10×", note: "2k msg/s · 200k sockets", workload: { rps: 2_000, connections: 200_000, fanout: 3 } },
  { id: "100x", label: "100×", note: "20k msg/s · 2M sockets", workload: { rps: 20_000, connections: 2_000_000, fanout: 3 } },
  { id: "doc", label: "Doc scale", note: "1.2M msg/s · 50M sockets", workload: { rps: 1_200_000, connections: 50_000_000, fanout: 3 } },
];

function node(id: string, kind: PlaygroundNode["data"]["kind"], name: string, x: number, y: number, config: Record<string, number> = {}): PlaygroundNode {
  return { id, type: "component", position: { x, y }, data: { kind, name, config: { ...defaultConfig(kind), ...config } } };
}
function edge(source: string, target: string): PlaygroundEdge {
  return { id: `${source}->${target}`, source, target, type: "traffic" };
}

/** Holds at "Today", breaks at 10×: the first job is to fix it. */
export const CHAT_STARTER: { nodes: PlaygroundNode[]; edges: PlaygroundEdge[] } = {
  nodes: [
    node("clients", "client", "Clients", 0, 140),
    node("lb", "loadBalancer", "L4 load balancer", 220, 140, { instances: 1, connections: 100_000 }),
    node("ws", "wsGateway", "WS gateway", 460, 140, { instances: 2 }),
    node("chat", "service", "Chat service", 720, 140, { instances: 2 }),
    node("registry", "cache", "Connection registry · Redis", 980, 20, { hitRatio: 0 }),
    node("messages", "database", "Messages · Cassandra", 980, 140, { capacity: 3_000 }),
    node("pubsub", "queue", "Pub/sub", 980, 260, { instances: 1, capacity: 2_000 }),
  ],
  edges: [
    edge("clients", "lb"),
    edge("lb", "ws"),
    edge("ws", "chat"),
    edge("chat", "registry"),
    edge("chat", "messages"),
    edge("chat", "pubsub"),
  ],
};
