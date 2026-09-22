import type { VizNode, VizState, VizTone } from "./types";

/**
 * Geometry shared by the array-shaped visualisations. Cell width and height
 * match the padding and type sizes in globals.css: change one, change both.
 */

export const CELL_W = 96;
export const CELL_H = 36;
export const CELL_GAP = 8;
export const ROW_X = 24;

export interface RowGeometry {
  x0?: number;
  width?: number;
  gap?: number;
}

export function cellX(i: number, geo: RowGeometry = {}): number {
  return (geo.x0 ?? ROW_X) + i * ((geo.width ?? CELL_W) + (geo.gap ?? CELL_GAP));
}

/** Total width of a row of `count` cells, including the outer margins. */
export function rowWidth(count: number, geo: RowGeometry = {}): number {
  return cellX(count - 1, geo) + (geo.width ?? CELL_W) + (geo.x0 ?? ROW_X);
}

interface RowOptions extends RowGeometry {
  y: number;
  idPrefix?: string;
  /** Index labels above each cell. On by default — an array is its indices. */
  showIndex?: boolean;
  decorate?: (i: number) => { tone?: VizTone; state?: VizState; detail?: string };
}

export function arrayRow(values: (string | number)[], options: RowOptions): VizNode[] {
  const { y, idPrefix = "cell", showIndex = true, decorate } = options;
  return values.map((value, i) => ({
    id: `${idPrefix}:${i}`,
    shape: "cell" as const,
    x: cellX(i, options),
    y,
    width: options.width ?? CELL_W,
    height: CELL_H,
    index: showIndex ? String(i) : undefined,
    title: String(value),
    ...decorate?.(i),
  }));
}

/** A named cursor under a cell: `↑ lo`, `↑ right`, `↑ mid`. */
export function pointer(
  name: string,
  index: number,
  tone: VizTone,
  y: number,
  geo: RowGeometry = {},
): VizNode {
  return {
    id: `marker:${name}`,
    shape: "marker",
    x: cellX(index, geo),
    y,
    width: geo.width ?? CELL_W,
    height: 22,
    title: `↑ ${name}`,
    tone,
  };
}

/** A readout box: the running state the code is keeping. */
export function opBox(
  id: string,
  x: number,
  y: number,
  width: number,
  title: string,
  detail: string,
  tone: VizTone = "violet",
): VizNode {
  return { id, shape: "op", x, y, width, height: 52, title, detail, tone, state: "active" };
}

export function note(id: string, x: number, y: number, title: string, width = 240): VizNode {
  return { id, shape: "note", x, y, width, height: 16, title };
}
