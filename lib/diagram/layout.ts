import dagre from "@dagrejs/dagre";
import { nodeKind, type NodeKind } from "./kinds";
import type { Direction, FlowEdge, FlowNode, Flowchart } from "./parse";

export interface Point {
  x: number;
  y: number;
}

export interface LaidOutNode extends FlowNode {
  kind: NodeKind;
  hot: boolean;
  scaled: boolean;
  /** Top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdge extends FlowEdge {
  points: Point[];
  /** Centre of the label, when the edge has one. */
  labelX?: number;
  labelY?: number;
}

export interface LaidOutGroup {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramLayout {
  direction: Direction;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  groups: LaidOutGroup[];
  width: number;
  height: number;
}

/**
 * Node and edge text is set in IBM Plex Mono, where every glyph is 0.6em wide,
 * so boxes are sized by counting characters rather than measuring the DOM.
 * That keeps layout synchronous and identical on server and client. These
 * numbers must match the `.flow-node` rules in globals.css.
 */
export const METRICS = {
  titleSize: 12,
  titleLine: 18,
  detailSize: 11,
  detailLine: 16,
  padX: 12,
  padY: 9,
  icon: 24,
  iconGap: 10,
  edgeLabelSize: 11,
  edgeLabelLine: 15,
  groupLabel: 28,
  margin: 16,
};

const textWidth = (text: string, fontSize: number) => [...text].length * fontSize * 0.6;

function nodeSize(node: FlowNode, kind: NodeKind) {
  const [title, ...details] = node.lines;
  const m = METRICS;
  const text = Math.max(textWidth(title, m.titleSize), ...details.map((line) => textWidth(line, m.detailSize)));
  // Pills get extra room so the rounded ends don't crowd the text.
  const pill = kind === "terminal" ? 12 : 0;
  const width = Math.ceil(text + m.icon + m.iconGap + m.padX * 2 + pill + 4);
  const height = Math.max(m.icon, m.titleLine + details.length * m.detailLine) + m.padY * 2 + 2;
  return { width: Math.max(width, 112), height };
}

function edgeLabelSize(label: string[]) {
  if (!label.length) return { width: 0, height: 0 };
  const m = METRICS;
  return {
    width: Math.ceil(Math.max(...label.map((line) => textWidth(line, m.edgeLabelSize))) + 14),
    height: label.length * m.edgeLabelLine + 6,
  };
}

export function layoutFlowchart(chart: Flowchart): DiagramLayout {
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  const horizontal = chart.direction === "LR" || chart.direction === "RL";
  g.setGraph({
    rankdir: chart.direction,
    nodesep: horizontal ? 24 : 32,
    ranksep: horizontal ? 64 : 56,
    edgesep: 18,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Only groups that end up containing a node are laid out.
  const parentOf = new Map(chart.groups.map((group) => [group.id, group.parent]));
  const used = new Set<string>();
  for (const node of chart.nodes) {
    for (let id = node.group; id && !used.has(id); id = parentOf.get(id)) used.add(id);
  }
  for (const group of chart.groups) {
    if (!used.has(group.id)) continue;
    g.setNode(group.id, { width: 0, height: 0 });
    if (group.parent) g.setParent(group.id, group.parent);
  }

  const kinds = new Map(chart.nodes.map((node) => [node.id, nodeKind(node)]));
  for (const node of chart.nodes) {
    g.setNode(node.id, nodeSize(node, kinds.get(node.id)!));
    if (node.group) g.setParent(node.id, node.group);
  }
  for (const edge of chart.edges) {
    g.setEdge(edge.source, edge.target, { ...edgeLabelSize(edge.label), labelpos: "c" }, edge.id);
  }

  dagre.layout(g);

  const nodes: LaidOutNode[] = chart.nodes.map((node) => {
    const box = g.node(node.id);
    return {
      ...node,
      kind: kinds.get(node.id)!,
      hot: node.classes.includes("hot"),
      scaled: node.classes.includes("scaled"),
      x: box.x! - box.width / 2,
      y: box.y! - box.height / 2,
      width: box.width,
      height: box.height,
    };
  });

  // Dagre leaves no room for a group's title, so the box grows upward into
  // the rank gap above it.
  const groups: LaidOutGroup[] = chart.groups
    .filter((group) => used.has(group.id))
    .map((group) => {
      const box = g.node(group.id);
      return {
        id: group.id,
        title: group.title,
        x: box.x! - box.width / 2,
        y: box.y! - box.height / 2 - METRICS.groupLabel / 2,
        width: box.width,
        height: box.height + METRICS.groupLabel / 2,
      };
    });

  const edges: LaidOutEdge[] = chart.edges.map((edge) => {
    const laid = g.edge({ v: edge.source, w: edge.target, name: edge.id });
    return {
      ...edge,
      points: laid.points ?? [],
      labelX: edge.label.length ? laid.x : undefined,
      labelY: edge.label.length ? laid.y : undefined,
    };
  });

  // Normalise so the drawing starts at the margin.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const box of [...nodes, ...groups]) {
    xs.push(box.x, box.x + box.width);
    ys.push(box.y, box.y + box.height);
  }
  for (const edge of edges) {
    for (const p of edge.points) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const dx = METRICS.margin - minX;
  const dy = METRICS.margin - minY;
  for (const box of [...nodes, ...groups]) {
    box.x += dx;
    box.y += dy;
  }
  for (const edge of edges) {
    edge.points = edge.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    if (edge.labelX !== undefined) edge.labelX += dx;
    if (edge.labelY !== undefined) edge.labelY += dy;
  }

  return {
    direction: chart.direction,
    nodes,
    edges,
    groups,
    width: Math.ceil(Math.max(...xs) - minX + METRICS.margin * 2),
    height: Math.ceil(Math.max(...ys) - minY + METRICS.margin * 2),
  };
}
