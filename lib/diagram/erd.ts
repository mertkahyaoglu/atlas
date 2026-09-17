import { parseSpec } from "@/lib/blocks";
import type { LaidOutGroup, Point } from "./layout";

/**
 * Schema diagrams, from ```erd fences. The same line format as ```api
 * (see lib/blocks.ts), with one row per table and its columns underneath:
 *
 *   # Group · note                          a group of tables, boxed together
 *   messages || what it's for || Cassandra  a table, its note and (optionally) its store
 *   + message_id || bigint || PK            a column: name || type || keys
 *   + attachment_id || bigint || null → attachments
 *   + UNIQUE (conversation_id, client_msg_id)
 *
 * Keys are any of `PK` (primary or partition key), `SK` (sort key, with `DESC`
 * for newest first), `null` (nullable) and `→ table` or `→ table.column` (a
 * foreign key; `->` works too). A reference without a column points at the
 * table's first PK column. Lines starting with UNIQUE, INDEX or CHECK are
 * table constraints.
 */

export interface ErdReference {
  table: string;
  column?: string;
}

export interface ErdColumn {
  name: string;
  type: string;
  pk: boolean;
  sk: boolean;
  desc: boolean;
  nullable: boolean;
  ref?: ErdReference;
}

export interface ErdTable {
  name: string;
  note: string;
  /** The store or structure holding it, e.g. `Redis hash`; shown in the header. */
  kind: string;
  columns: ErdColumn[];
  constraints: string[];
}

export interface ErdGroup {
  title?: string;
  note?: string;
  tables: ErdTable[];
}

export const CONSTRAINT = /^(UNIQUE|INDEX|CHECK)\b/;
const REFERENCE = /(?:→|->)\s*(\w+)(?:\.(\w+))?/;

export function parseErd(source: string): ErdGroup[] {
  return parseSpec(source).groups.map((group) => ({
    title: group.title,
    note: group.note,
    tables: group.rows.map((row) => {
      const [name = "", note = "", kind = ""] = row.fields;
      const table: ErdTable = { name, note, kind, columns: [], constraints: [] };

      for (const detail of row.details) {
        const line = detail.trim();
        if (CONSTRAINT.test(line) && !line.includes("||")) {
          table.constraints.push(line);
          continue;
        }
        const [columnName = "", type = "", keys = ""] = line.split("||").map((field) => field.trim());
        const ref = REFERENCE.exec(keys);
        table.columns.push({
          name: columnName,
          type,
          pk: /\bPK\b/.test(keys),
          sk: /\bSK\b/.test(keys),
          desc: /\bDESC\b/.test(keys),
          nullable: /\bnull\b/i.test(keys),
          ref: ref ? { table: ref[1], column: ref[2] } : undefined,
        });
      }
      return table;
    }),
  }));
}

/**
 * Everything is set in IBM Plex Mono, where every glyph is 0.6em wide, so
 * tables are sized by counting characters, as flowchart nodes are. These
 * numbers must match the `.erd-*` rules in globals.css.
 */
export const ERD_METRICS = {
  /** Table name bar, including its bottom border. */
  header: 36,
  headerSize: 13,
  icon: 14,
  iconGap: 8,
  kindSize: 11,
  row: 24,
  nameSize: 12,
  typeSize: 11,
  badge: 20,
  /** Flex gap between a column's name and its badges. */
  rowGap: 6,
  /** Least room before a column's type, or a header's store. */
  typeGap: 16,
  padX: 12,
  /** Constraint and note sections: border and padding, plus a line height. */
  sectionChrome: 14,
  sectionLine: 17,
  sectionSize: 11,
  /** The note's accent rule and the gap after it. */
  noteIndent: 10,
  minWidth: 220,
  tableGap: 24,
  /** Spacing between parallel connector lanes. */
  lane: 14,
  groupPad: 14,
  groupLabel: 30,
  groupTitleSize: 10.5,
  /** The group title is upper case with 0.05em tracking. */
  groupTitleTracking: 0.05,
  /** Between groups stacked in one column, and between columns. */
  groupStackGap: 24,
  groupGap: 72,
  margin: 16,
  /** Groups spread over as many columns as fit this width; the frame scales anything wider. */
  maxWidth: 840,
};

export interface LaidOutTable extends ErdTable {
  /** The layout column it sits in. */
  column: number;
  /** Top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  constraintLines: string[];
  noteLines: string[];
}

export interface LaidOutRelation {
  id: string;
  source: string;
  sourceColumn: string;
  target: string;
  /** Missing when the target table has no PK column to point at. */
  targetColumn?: string;
  points: Point[];
}

export interface LaidOutErdGroup extends LaidOutGroup {
  /** Title indent, lining it up with the tables rather than the lanes beside them. */
  inset: number;
}

export interface ErdLayout {
  tables: LaidOutTable[];
  relations: LaidOutRelation[];
  groups: LaidOutErdGroup[];
  width: number;
  height: number;
}

const textWidth = (text: string, fontSize: number) => [...text].length * fontSize * 0.6;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Displayed type: a trailing `?` marks a nullable column. */
export const columnType = (column: ErdColumn) => (column.nullable ? `${column.type}?` : column.type);

/** Greedy word wrap; continuation lines start with `indent`. */
function wrap(text: string, max: number, indent = ""): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) {
      line = word;
    } else if ([...`${line} ${word}`].length <= max) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = indent + word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function tableWidth(table: ErdTable) {
  const m = ERD_METRICS;
  const kind = table.kind ? m.typeGap + textWidth(table.kind, m.kindSize) : 0;
  const header = m.padX * 2 + m.icon + m.iconGap + textWidth(table.name, m.headerSize) + kind;
  const rows = table.columns.map((column) => {
    const badges = Number(column.pk) + Number(column.sk) + Number(Boolean(column.ref));
    return (
      m.padX * 2 +
      textWidth(column.name, m.nameSize) +
      badges * (m.rowGap + m.badge) +
      m.typeGap +
      textWidth(columnType(column), m.typeSize)
    );
  });
  return Math.max(m.minWidth, header, ...rows);
}

function groupTitle(group: ErdGroup) {
  return [group.title, group.note].filter(Boolean).join(" · ");
}

/**
 * The narrowest column that fits every table and group title in it. Titles
 * start at the tables' left edge and keep 12px clear of the box's right edge.
 */
function columnWidth(groups: ErdGroup[]) {
  const m = ERD_METRICS;
  const titles = groups.map(
    (group) => [...groupTitle(group)].length * m.groupTitleSize * (0.6 + m.groupTitleTracking) + 12 - m.groupPad,
  );
  return Math.ceil(Math.max(...groups.flatMap((group) => group.tables.map(tableWidth)), ...titles));
}

/** Wraps a table's constraints and note to the column width, which fixes its height. */
function sizeTable(table: ErdTable, width: number) {
  const m = ERD_METRICS;
  // A pixel of slack, so rounding in the browser never pushes a full line over.
  const perLine = (room: number) => Math.floor((room - 1) / (m.sectionSize * 0.6));
  const constraintLines = table.constraints.flatMap((line) => wrap(line, perLine(width - m.padX * 2), "  "));
  const noteLines = table.note ? wrap(table.note, perLine(width - m.padX * 2 - m.noteIndent)) : [];
  const section = (lines: string[]) => (lines.length ? m.sectionChrome + lines.length * m.sectionLine : 0);
  const height = 2 + m.header + table.columns.length * m.row + section(constraintLines) + section(noteLines);
  return { constraintLines, noteLines, height };
}

function groupHeight(group: ErdGroup, width: number) {
  const m = ERD_METRICS;
  const tables = group.tables.map((table) => sizeTable(table, width).height);
  return m.groupLabel + sum(tables) + (tables.length - 1) * m.tableGap + m.groupPad;
}

/** Row centre, measured from the table's top edge. */
function rowCentre(table: ErdTable, column?: string) {
  const m = ERD_METRICS;
  const index = column === undefined ? -1 : table.columns.findIndex((c) => c.name === column);
  return index < 0 ? 1 + m.header / 2 : 1 + m.header + index * m.row + m.row / 2;
}

/**
 * Splits groups, kept whole and in order, into `count` columns so the tallest
 * column is as short as possible. There are only ever a handful of groups.
 */
function partition(groups: ErdGroup[], count: number): ErdGroup[][] {
  const m = ERD_METRICS;
  const heights = groups.map((group) => groupHeight(group, columnWidth([group])));
  const columnHeight = (start: number, end: number) =>
    sum(heights.slice(start, end)) + (end - start - 1) * m.groupStackGap;

  let best: { columns: ErdGroup[][]; tallest: number } | undefined;
  const walk = (start: number, left: number, splits: number[]) => {
    if (left === 1) {
      const bounds = [...splits, start, groups.length];
      const ranges = bounds.slice(0, -1).map((from, i) => [from, bounds[i + 1]] as const);
      const tallest = Math.max(...ranges.map(([from, to]) => columnHeight(from, to)));
      if (!best || tallest < best.tallest) {
        best = { columns: ranges.map(([from, to]) => groups.slice(from, to)), tallest };
      }
      return;
    }
    for (let end = start + 1; end <= groups.length - (left - 1); end++) walk(end, left - 1, [...splits, start]);
  };
  walk(0, count, []);
  return best!.columns;
}

type Side = "left" | "right";

interface Route {
  relation: Omit<LaidOutRelation, "points">;
  from: Side;
  to: Side;
  sourceY: number;
  targetY: number;
  /** The gap the connector runs through: boundary k is left of column k. */
  boundary: number;
}

/**
 * Groups stack in columns, as many columns as fit ERD_METRICS.maxWidth. A
 * foreign key is drawn from its column's row to the referenced row as three
 * straight runs: out to a vertical lane, along it, and in to the target. Keys
 * referencing the same column share a lane, so they merge into one bus
 * instead of running side by side.
 */
export function layoutErd(parsed: ErdGroup[]): ErdLayout {
  const groups = parsed.filter((group) => group.tables.length > 0);
  if (!groups.length) throw new Error("no tables");
  const names = groups.flatMap((group) => group.tables.map((table) => table.name));
  if (new Set(names).size !== names.length) throw new Error("two tables share a name");

  let narrowest: ErdLayout | undefined;
  for (let count = groups.length; count >= 1; count--) {
    const layout = place(partition(groups, count));
    if (layout.width <= ERD_METRICS.maxWidth) return layout;
    if (!narrowest || layout.width < narrowest.width) narrowest = layout;
  }
  return narrowest!;
}

function place(columns: ErdGroup[][]): ErdLayout {
  const m = ERD_METRICS;
  const last = columns.length - 1;

  // Vertical placement first: rows are what the connectors attach to.
  const widths = columns.map(columnWidth);
  const tables: LaidOutTable[] = [];
  const boxes: (Omit<LaidOutGroup, "x" | "width"> & { column: number })[] = [];
  columns.forEach((groups, column) => {
    let y = m.margin;
    for (const group of groups) {
      const top = y;
      y += m.groupLabel;
      group.tables.forEach((table, i) => {
        const size = sizeTable(table, widths[column]);
        tables.push({ ...table, ...size, column, x: 0, y, width: widths[column] });
        y += size.height + (i < group.tables.length - 1 ? m.tableGap : 0);
      });
      y += m.groupPad;
      boxes.push({ id: `group-${boxes.length}`, title: groupTitle(group), column, y: top, height: y - top });
      y += m.groupStackGap;
    }
  });
  const laid = new Map(tables.map((table) => [table.name, table]));

  // Route every foreign key through a boundary between (or beside) columns.
  const routes: Route[] = [];
  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.ref) continue;
      const target = laid.get(column.ref.table);
      if (!target) throw new Error(`${table.name}.${column.name} references unknown table "${column.ref.table}"`);
      if (column.ref.column && !target.columns.some((c) => c.name === column.ref!.column)) {
        throw new Error(`${table.name}.${column.name} references unknown column "${column.ref.table}.${column.ref.column}"`);
      }
      const targetColumn = column.ref.column ?? target.columns.find((c) => c.pk)?.name;

      let from: Side;
      let to: Side;
      let boundary: number;
      if (table.column === target.column) {
        // Within a column, loop around its outer side.
        from = to = table.column === 0 ? "left" : "right";
        boundary = from === "left" ? table.column : table.column + 1;
      } else if (table.column < target.column) {
        [from, to, boundary] = ["right", "left", target.column];
      } else {
        [from, to, boundary] = ["left", "right", target.column + 1];
      }

      routes.push({
        relation: {
          id: `${table.name}.${column.name}->${target.name}.${targetColumn ?? ""}`,
          source: table.name,
          sourceColumn: column.name,
          target: target.name,
          targetColumn,
        },
        from,
        to,
        sourceY: table.y + rowCentre(table, column.name),
        targetY: target.y + rowCentre(target, targetColumn),
        boundary,
      });
    }
  }

  // One lane per referenced column in each boundary. Shorter spans sit nearer
  // the column they point into, so a lane rarely crosses another's runs.
  const slotOf = new Map<Route, number>();
  const laneCounts = columns.map(() => 0).concat(0);
  for (let boundary = 0; boundary <= columns.length; boundary++) {
    const spans = new Map<string, { top: number; bottom: number; routes: Route[] }>();
    for (const route of routes) {
      if (route.boundary !== boundary) continue;
      const key = `${route.relation.target}.${route.relation.targetColumn ?? ""}`;
      const span = spans.get(key) ?? { top: Infinity, bottom: -Infinity, routes: [] };
      span.top = Math.min(span.top, route.sourceY, route.targetY);
      span.bottom = Math.max(span.bottom, route.sourceY, route.targetY);
      span.routes.push(route);
      spans.set(key, span);
    }
    const sorted = [...spans.values()].sort((a, b) => a.bottom - a.top - (b.bottom - b.top));
    const count = sorted.length;
    laneCounts[boundary] = count;
    if (boundary === 0 || boundary === columns.length) {
      // Outer lanes count outward from the tables.
      sorted.forEach((span, slot) => span.routes.forEach((route) => slotOf.set(route, slot)));
    } else {
      // Inner lanes: slots count from the left for keys into the left column,
      // from the right for keys into the right one.
      const intoLeft = sorted.filter((span) => span.routes[0].to === "right");
      const intoRight = sorted.filter((span) => span.routes[0].to === "left");
      intoLeft.forEach((span, slot) => span.routes.forEach((route) => slotOf.set(route, slot)));
      intoRight.forEach((span, slot) => span.routes.forEach((route) => slotOf.set(route, count - 1 - slot)));
    }
  }

  // Horizontal placement: outer lanes widen the outer boxes, inner lanes
  // widen the gap between columns.
  const padLeft = (column: number) => (column === 0 ? m.lane * (laneCounts[0] + 1) : m.groupPad);
  const padRight = (column: number) => (column === last ? m.lane * (laneCounts[last + 1] + 1) : m.groupPad);
  const columnX: number[] = [];
  let x = m.margin;
  columns.forEach((_, column) => {
    if (column > 0) x += Math.max(m.groupGap, laneCounts[column] * m.lane + 24);
    columnX.push(x + padLeft(column));
    x += padLeft(column) + widths[column] + padRight(column);
  });
  for (const table of tables) table.x = columnX[table.column];

  const laneX = (route: Route) => {
    const slot = slotOf.get(route)!;
    const { boundary } = route;
    if (boundary === 0) return columnX[0] - m.lane * (slot + 1);
    if (boundary === columns.length) return columnX[last] + widths[last] + m.lane * (slot + 1);
    const centre = (columnX[boundary - 1] + widths[boundary - 1] + columnX[boundary]) / 2;
    return centre + (slot - (laneCounts[boundary] - 1) / 2) * m.lane;
  };

  const relations: LaidOutRelation[] = routes.map((route) => {
    const source = laid.get(route.relation.source)!;
    const target = laid.get(route.relation.target)!;
    const startX = route.from === "left" ? source.x : source.x + source.width;
    const endX = route.to === "left" ? target.x : target.x + target.width;
    const lane = laneX(route);
    const points =
      route.from !== route.to && Math.abs(route.sourceY - route.targetY) < 1
        ? [{ x: startX, y: route.sourceY }, { x: endX, y: route.targetY }]
        : [
            { x: startX, y: route.sourceY },
            { x: lane, y: route.sourceY },
            { x: lane, y: route.targetY },
            { x: endX, y: route.targetY },
          ];
    return { ...route.relation, points };
  });

  const groups: LaidOutErdGroup[] = boxes.map(({ column, ...box }) => ({
    ...box,
    x: columnX[column] - padLeft(column),
    width: padLeft(column) + widths[column] + padRight(column),
    inset: padLeft(column),
  }));

  return {
    tables,
    relations,
    groups,
    width: Math.ceil(x + m.margin),
    height: Math.ceil(Math.max(...groups.map((group) => group.y + group.height)) + m.margin),
  };
}
