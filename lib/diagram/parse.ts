/**
 * A parser for the subset of Mermaid flowchart syntax the content uses, so
 * architecture diagrams stay authored as ```mermaid fences but render with
 * React Flow. Supported:
 *
 *   flowchart TB | LR               header (graph works too)
 *   A["Title<br/>detail"]           nodes: [ ] ( ) ([ ]) [( )] (( )) {{ }} { }
 *   A --> B & C --> D               chains and `&` fan-out
 *   A -- "label" --> B              labelled edges, also -. "label" .-> and A -->|label| B
 *   A -.-> B, A -.- B, A ==> B      dotted, arrowless and thick edges
 *   A ~~~ B                         an invisible link that only shapes the layout
 *   subgraph ID ["Title"] … end     groups; a node belongs to the first group it appears in
 *   class A,B db                    classes, which pick a node's kind (see kinds.ts)
 *   click A href "/docs/x" "Role: …<br/>Trade-off: …"
 *
 * `classDef`, `style`, `linkStyle` and per-group `direction` are accepted and
 * ignored: colour comes from the node kind, not the chart.
 */

export type Direction = "TB" | "BT" | "LR" | "RL";
export type NodeShape = "rect" | "round" | "stadium" | "cylinder" | "hexagon" | "diamond" | "circle";
export type EdgeLine = "solid" | "dotted" | "thick" | "invisible";

export interface FlowNode {
  id: string;
  /** The label split on `<br/>`: the first line is the title, the rest are details. */
  lines: string[];
  shape: NodeShape;
  classes: string[];
  group?: string;
  /** From a `click` line: the concept module this node links to. */
  href?: string;
  role?: string;
  tradeoff?: string;
  /** Tooltip text that isn't a `Role:` or `Trade-off:` line. */
  note?: string;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string[];
  line: EdgeLine;
  arrow: boolean;
}

export interface FlowGroup {
  id: string;
  title: string;
  parent?: string;
}

export interface Flowchart {
  direction: Direction;
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups: FlowGroup[];
}

const HEADER = /^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)$/;

/** Longer openers first, so `([` isn't read as `(`. */
const SHAPES: [open: string, close: string, shape: NodeShape][] = [
  ["([", "])", "stadium"],
  ["[(", ")]", "cylinder"],
  ["((", "))", "circle"],
  ["{{", "}}", "hexagon"],
  ["[[", "]]", "rect"],
  ["[", "]", "rect"],
  ["(", ")", "round"],
  ["{", "}", "diamond"],
];

const LABELLED_EDGE = /^(--|==|-\.)\s*"([^"]*)"\s*(-->|---|==>|===|\.->|\.-)/;
const EDGE = /^(-\.->|-\.-|-->|---|==>|===|~~~)(?:\s*\|([^|]*)\|)?/;

export function splitLabel(text: string): string[] {
  return text
    .split(/<br\s*\/?>/i)
    .map((line) => line.trim())
    .filter(Boolean);
}

function firstLine(source: string) {
  return source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("%%"));
}

/** Only flowcharts go to React Flow; sequence and ER diagrams stay with Mermaid. */
export function isFlowchart(source: string): boolean {
  return HEADER.test(firstLine(source) ?? "");
}

export function parseFlowchart(source: string): Flowchart {
  const header = HEADER.exec(firstLine(source) ?? "");
  if (!header) throw new Error("Expected a `flowchart TB` or `flowchart LR` header");
  const direction = (header[1] === "TD" ? "TB" : header[1]) as Direction;

  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const groups: FlowGroup[] = [];
  const open: { group: FlowGroup; members: string[] }[] = [];
  const classes: [ids: string[], names: string[]][] = [];
  const clicks: [id: string, href: string | undefined, tooltip: string | undefined][] = [];

  function touch(id: string) {
    let node = nodes.get(id);
    if (!node) {
      node = { id, lines: [id], shape: "rect", classes: [] };
      nodes.set(id, node);
    }
    open[open.length - 1]?.members.push(id);
    return node;
  }

  function parseStatement(text: string, lineNo: number) {
    let pos = 0;
    const fail = (message: string): never => {
      throw new Error(`Line ${lineNo}: ${message} in "${text}"`);
    };
    const skipSpace = () => {
      while (pos < text.length && /\s/.test(text[pos])) pos++;
    };

    function readNode(): string {
      skipSpace();
      const id = /^\w+/.exec(text.slice(pos))?.[0] ?? fail("expected a node id");
      pos += id.length;
      const node = touch(id);

      const shape = SHAPES.find(([opener]) => text.startsWith(opener, pos));
      if (shape) {
        const [opener, closer, kind] = shape;
        pos += opener.length;
        let label: string;
        if (text[pos] === '"') {
          const end = text.indexOf('"', pos + 1);
          if (end < 0) fail("unclosed quote");
          label = text.slice(pos + 1, end);
          pos = end + 1;
          skipSpace();
          if (!text.startsWith(closer, pos)) fail(`expected "${closer}"`);
        } else {
          const end = text.indexOf(closer, pos);
          if (end < 0) fail(`expected "${closer}"`);
          label = text.slice(pos, end);
          pos = end;
        }
        pos += closer.length;
        const lines = splitLabel(label);
        node.lines = lines.length ? lines : [id];
        node.shape = kind;
      }

      const inlineClass = /^:::(\w+)/.exec(text.slice(pos));
      if (inlineClass) {
        node.classes.push(inlineClass[1]);
        pos += inlineClass[0].length;
      }
      return id;
    }

    function readNodes(): string[] {
      const ids = [readNode()];
      skipSpace();
      while (text[pos] === "&") {
        pos++;
        ids.push(readNode());
        skipSpace();
      }
      return ids;
    }

    function readEdge() {
      skipSpace();
      const rest = text.slice(pos);
      const labelled = LABELLED_EDGE.exec(rest);
      const plain = labelled ? null : EDGE.exec(rest);
      if (!labelled && !plain) fail("expected an edge like -->");
      pos += (labelled ?? plain)![0].length;
      const operator = labelled ? labelled[1] + labelled[3] : plain![1];
      return {
        label: splitLabel(labelled ? labelled[2] : (plain![2] ?? "")),
        line: (operator === "~~~"
          ? "invisible"
          : operator.includes(".")
            ? "dotted"
            : operator.includes("=")
              ? "thick"
              : "solid") as EdgeLine,
        arrow: operator.endsWith(">"),
      };
    }

    let sources = readNodes();
    while (pos < text.length) {
      const edge = readEdge();
      const targets = readNodes();
      for (const source of sources) {
        for (const target of targets) {
          edges.push({ id: `e${edges.length}`, source, target, ...edge });
        }
      }
      sources = targets;
    }
  }

  source.split("\n").forEach((raw, index) => {
    const line = raw.trim().replace(/;$/, "");
    const lineNo = index + 1;
    if (!line || line.startsWith("%%") || HEADER.test(line)) return;

    if (/^subgraph\b/.test(line)) {
      const rest = line.slice("subgraph".length).trim();
      const withTitle = /^(\w+)\s*\[\s*"?(.*?)"?\s*\]$/.exec(rest);
      const quoted = /^"(.*)"$/.exec(rest);
      const id = withTitle?.[1] ?? (/^\w+$/.test(rest) ? rest : `group${groups.length}`);
      const title = withTitle?.[2] ?? quoted?.[1] ?? rest;
      const group: FlowGroup = { id, title, parent: open[open.length - 1]?.group.id };
      groups.push(group);
      open.push({ group, members: [] });
      return;
    }

    if (line === "end") {
      const closed = open.pop();
      if (!closed) throw new Error(`Line ${lineNo}: "end" without a subgraph`);
      // Inner groups close first, so a node lands in the innermost group it
      // appears in; after that, the first group to claim it keeps it.
      for (const id of closed.members) {
        const node = nodes.get(id);
        if (node && !node.group) node.group = closed.group.id;
      }
      return;
    }

    if (/^(direction|classDef|style|linkStyle)\s/.test(line)) return;

    const classLine = /^class\s+([\w\s,]+?)\s+([\w,]+)$/.exec(line);
    if (classLine) {
      classes.push([classLine[1].split(",").map((id) => id.trim()), classLine[2].split(",")]);
      return;
    }

    const click = /^click\s+(\w+)\s+(href\s+)?"([^"]*)"(?:\s+"([^"]*)")?/.exec(line);
    if (click) {
      const [, id, hrefKeyword, first, second] = click;
      const isLink = Boolean(hrefKeyword) || second !== undefined || /^(\/|https?:)/.test(first);
      clicks.push(isLink ? [id, first, second] : [id, undefined, first]);
      return;
    }

    parseStatement(line, lineNo);
  });

  if (open.length) throw new Error(`Subgraph "${open[open.length - 1].group.id}" is missing its "end"`);

  for (const [ids, names] of classes) {
    for (const id of ids) nodes.get(id)?.classes.push(...names);
  }

  for (const [id, href, tooltip] of clicks) {
    const node = nodes.get(id);
    if (!node) continue;
    node.href = href;
    const notes: string[] = [];
    // Tooltips read "Role: decouples …"; standing alone in the dialog, the
    // text needs its own capital.
    const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
    for (const part of splitLabel(tooltip ?? "")) {
      const tagged = /^(Role|Trade-?off):\s*(.*)$/i.exec(part);
      if (!tagged) notes.push(part);
      else if (/^role/i.test(tagged[1])) node.role = sentence(tagged[2]);
      else node.tradeoff = sentence(tagged[2]);
    }
    if (notes.length) node.note = notes.join(" ");
  }

  // An edge may point at a subgraph id. Layout can't connect to a group, so
  // such edges attach to the group's first node instead.
  const groupIds = new Set(groups.map((group) => group.id));
  for (const id of groupIds) nodes.delete(id);
  const memberOf = (groupId: string): string | undefined => {
    const node = [...nodes.values()].find((n) => n.group === groupId);
    if (node) return node.id;
    for (const child of groups.filter((g) => g.parent === groupId)) {
      const found = memberOf(child.id);
      if (found) return found;
    }
    return undefined;
  };
  const resolve = (id: string) => (groupIds.has(id) ? memberOf(id) : id);
  const resolvedEdges = edges.flatMap((edge) => {
    const source = resolve(edge.source);
    const target = resolve(edge.target);
    return source && target ? [{ ...edge, source, target }] : [];
  });

  return { direction, nodes: [...nodes.values()], edges: resolvedEdges, groups };
}
