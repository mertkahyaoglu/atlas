"use client";

import type { ComponentType, CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  Archive,
  ArrowRight,
  Cylinder,
  Database,
  Globe,
  Layers,
  MonitorSmartphone,
  Network,
  Server,
  ShieldCheck,
  Split,
  Waypoints,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { FLAGS, KINDS, type NodeKind } from "@/lib/diagram/kinds";
import type { LaidOutNode } from "@/lib/diagram/layout";
import type { Direction } from "@/lib/diagram/parse";
import { cn } from "@/lib/utils";
import { useDiagram } from "./DiagramContext";

export type DiagramNodeData = {
  node: LaidOutNode;
  /** Another node is focused and this one isn't connected to it. */
  dimmed: boolean;
  /** This node is hovered, focused or open in the dialog. */
  active: boolean;
};
export type DiagramNode = Node<DiagramNodeData, NodeKind>;
export type ClusterNodeData = {
  title: string;
  /** Title indent from the left edge, when it should line up with what the group holds. */
  inset?: number;
};
export type ClusterNode = Node<ClusterNodeData, "cluster">;

/** Edges are drawn from layout points, but React Flow still needs a handle at each end. */
const HANDLE_SIDES: Record<Direction, [target: Position, source: Position]> = {
  TB: [Position.Top, Position.Bottom],
  BT: [Position.Bottom, Position.Top],
  LR: [Position.Left, Position.Right],
  RL: [Position.Right, Position.Left],
};

const HANDLE_POINT: Record<Position, (width: number, height: number) => { x: number; y: number }> = {
  [Position.Top]: (w) => ({ x: w / 2, y: 0 }),
  [Position.Bottom]: (w, h) => ({ x: w / 2, y: h }),
  [Position.Left]: (_, h) => ({ x: 0, y: h / 2 }),
  [Position.Right]: (w, h) => ({ x: w, y: h / 2 }),
};

/**
 * Handle positions declared up front. React Flow otherwise only draws an edge
 * once it has measured both nodes' handles in the DOM, which never happens
 * while a diagram sits in a hidden tab or a page that isn't painting.
 */
export function nodeHandles(direction: Direction, width: number, height: number): NonNullable<Node["handles"]> {
  const [target, source] = HANDLE_SIDES[direction];
  return [
    { type: "target", position: target, width: 1, height: 1, ...HANDLE_POINT[target](width, height) },
    { type: "source", position: source, width: 1, height: 1, ...HANDLE_POINT[source](width, height) },
  ];
}

interface NodeCardProps {
  data: DiagramNodeData;
  icon: LucideIcon;
  variant?: "card" | "pill" | "decision";
}

/** The shared body of every node type: tone, icon, title, detail lines and badges. */
export function NodeCard({ data, icon: Icon, variant = "card" }: NodeCardProps) {
  const { node, dimmed, active } = data;
  const { direction, openNode, hoverNode } = useDiagram();
  const [target, source] = HANDLE_SIDES[direction];
  const [title, ...details] = node.lines;
  const info = KINDS[node.kind];

  return (
    <>
      <Handle type="target" position={target} isConnectable={false} className="flow-handle" />
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${info.label}: ${node.lines.join(", ")}`}
        onClick={() => openNode(node.id)}
        // Mouse hover comes from React Flow's node handlers in FlowCanvas.
        onFocus={() => hoverNode(node.id)}
        onBlur={() => hoverNode(null)}
        style={{ "--tone": info.tone } as CSSProperties}
        className={cn(
          "flow-node",
          `flow-node--${variant}`,
          node.kind === "service" || node.kind === "decision" || node.kind === "store" ? "is-neutral" : "is-toned",
          node.hot && "is-hot",
          node.scaled && "is-scaled",
          dimmed && "is-dimmed",
          active && "is-active",
        )}
      >
        <span className="flow-node__icon" aria-hidden>
          <Icon strokeWidth={1.75} />
        </span>
        <span className="flow-node__text">
          <span className="flow-node__title">{title}</span>
          {details.map((line, i) => (
            <span key={i} className="flow-node__detail">
              {line}
            </span>
          ))}
        </span>
        {node.hot && <span className="flow-node__badge">{FLAGS.hot.label}</span>}
        {(node.role || node.tradeoff) && <span className="flow-node__notes" aria-hidden />}
      </button>
      <Handle type="source" position={source} isConnectable={false} className="flow-handle" />
    </>
  );
}

type Props = NodeProps<DiagramNode>;

/** Unclassed nodes keep a hint of the shape the author drew. */
export function ServiceNode({ data }: Props) {
  const icon = data.node.shape === "hexagon" ? Workflow : data.node.shape === "circle" ? Waypoints : Server;
  return <NodeCard data={data} icon={icon} />;
}

export function StoreNode({ data }: Props) {
  return <NodeCard data={data} icon={Cylinder} />;
}

export function DatabaseNode({ data }: Props) {
  return <NodeCard data={data} icon={Database} />;
}

export function CacheNode({ data }: Props) {
  return <NodeCard data={data} icon={Zap} />;
}

export function BlobNode({ data }: Props) {
  return <NodeCard data={data} icon={Archive} />;
}

export function QueueNode({ data }: Props) {
  return <NodeCard data={data} icon={Layers} />;
}

export function ExternalNode({ data }: Props) {
  return <NodeCard data={data} icon={Globe} />;
}

export function GatewayNode({ data }: Props) {
  return <NodeCard data={data} icon={ShieldCheck} />;
}

export function LoadBalancerNode({ data }: Props) {
  return <NodeCard data={data} icon={Network} />;
}

/** Clients, requests and responses: where a flow enters or leaves the system. */
export function TerminalNode({ data }: Props) {
  const client = /client|user|browser|device|app\b/i.test(data.node.lines[0]);
  return <NodeCard data={data} icon={client ? MonitorSmartphone : ArrowRight} variant="pill" />;
}

export function DecisionNode({ data }: Props) {
  return <NodeCard data={data} icon={Split} variant="decision" />;
}

/** A subgraph: a labelled region drawn behind its nodes. */
export function ClusterNodeView({ data }: NodeProps<ClusterNode>) {
  const [name, ...note] = data.title.split(" · ");
  return (
    <div className="flow-cluster">
      <span className="flow-cluster__title" style={data.inset === undefined ? undefined : { left: data.inset }}>
        {name}
        {note.length > 0 && <span className="flow-cluster__note"> · {note.join(" · ")}</span>}
      </span>
    </div>
  );
}

export const nodeTypes = {
  service: ServiceNode,
  store: StoreNode,
  database: DatabaseNode,
  cache: CacheNode,
  blob: BlobNode,
  queue: QueueNode,
  external: ExternalNode,
  gateway: GatewayNode,
  loadBalancer: LoadBalancerNode,
  terminal: TerminalNode,
  decision: DecisionNode,
  cluster: ClusterNodeView,
} satisfies Record<NodeKind | "cluster", ComponentType<Props> | ComponentType<NodeProps<ClusterNode>>>;
