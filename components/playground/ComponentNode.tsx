"use client";

import type { CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Archive,
  Cloud,
  Database,
  Globe,
  Layers,
  MonitorSmartphone,
  Network,
  Plug,
  Server,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { COMPONENTS } from "@/lib/playground/components";
import { fmt } from "@/lib/playground/sim";
import type { ComponentKind, PlaygroundNode } from "@/lib/playground/types";
import { cn } from "@/lib/utils";
import { useSim } from "./SimContext";

export const KIND_ICONS: Record<ComponentKind, LucideIcon> = {
  client: MonitorSmartphone,
  cdn: Globe,
  loadBalancer: Network,
  gateway: ShieldCheck,
  wsGateway: Plug,
  service: Server,
  cache: Zap,
  database: Database,
  queue: Layers,
  blob: Archive,
  external: Cloud,
};

/** 0 below 50% utilization, 100 at 100%: the red mixed into the card. */
function heat(utilization: number) {
  return Math.round(Math.max(0, Math.min(1, (utilization - 0.5) / 0.5)) * 100);
}

export function ComponentNode({ id, data, selected }: NodeProps<PlaygroundNode>) {
  const def = COMPONENTS[data.kind];
  const Icon = KIND_ICONS[data.kind];
  const sim = useSim();
  const stats = sim.nodes[id];
  const status = stats?.status ?? "idle";
  const utilization = stats?.utilization ?? 0;
  const neutral = data.kind === "service" || data.kind === "client";

  const detail = def.source
    ? stats
      ? `${fmt(stats.rpsOut)} rps out`
      : "traffic source"
    : stats && status !== "idle"
      ? `${fmt(stats.rpsIn)} / ${fmt(stats.rpsCapacity)} rps${stats.connectionsCapacity !== Infinity ? ` · ${fmt(stats.connectionsIn)} / ${fmt(stats.connectionsCapacity)} sockets` : ""}`
      : `${data.config.instances ?? 1} × ${fmt(data.config.capacity ?? 0)} rps`;

  return (
    <>
      <Handle type="target" position={Position.Left} className="pg-handle" isConnectable={!def.source} />
      <div
        style={{ "--tone": def.tone, "--heat": heat(utilization), "--util": Math.min(1, utilization) } as CSSProperties}
        className={cn(
          "flow-node pg-node",
          neutral ? "is-neutral" : "is-toned",
          `is-${status}`,
          selected && "is-active",
        )}
      >
        <span className="flow-node__icon" aria-hidden>
          <Icon strokeWidth={1.75} />
        </span>
        <span className="flow-node__text">
          <span className="flow-node__title">{data.name}</span>
          <span className="flow-node__detail">{detail}</span>
        </span>
        {!def.source && (
          <span className="pg-node__meter" aria-hidden>
            <span className="pg-node__meter-fill" />
          </span>
        )}
        {!def.source && status !== "idle" && (
          <span className={cn("pg-node__pct", `is-${status}`)}>{Math.round(utilization * 100)}%</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="pg-handle" />
    </>
  );
}

export const nodeTypes = { component: ComponentNode };
