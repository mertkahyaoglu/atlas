/**
 * A visualisation is a list of frames, and a frame is a *complete* snapshot of
 * the drawing: every node it should contain, at the position it should be in.
 * Nodes keep their id across frames, so stepping forward rewrites positions and
 * the CSS transition in globals.css turns each jump into a move. Nothing here
 * describes animation — the player and the stylesheet do.
 */

export type VizTone = "neutral" | "blue" | "green" | "amber" | "red" | "violet" | "teal" | "pink";

export type VizShape =
  /** A value that lives somewhere: a bucket, a node, a table row. */
  | "box"
  /** An array cell: fixed width, value centred, index above. */
  | "cell"
  /** An array cell with nothing in it yet. */
  | "slot"
  /** A value in flight — a key being hashed, an element being swapped. */
  | "chip"
  /** A step that is work rather than data: a hash, a comparison. */
  | "op"
  /** Free-standing text: column captions, annotations. */
  | "note"
  /** A cursor parked under a cell: `i`, `j`, `head`. */
  | "marker";

export type VizState = "active" | "dimmed" | "pulsing";

export type VizSide = "l" | "r" | "t" | "b";

export interface VizNode {
  id: string;
  shape: VizShape;
  x: number;
  y: number;
  width?: number;
  height?: number;
  title: string;
  /** Secondary text: a value, a count, a computed result. */
  detail?: string;
  /** Rendered outside the box, to its left — an array index. */
  index?: string;
  tone?: VizTone;
  state?: VizState;
}

export interface VizEdge {
  id: string;
  source: string;
  target: string;
  sourceSide?: VizSide;
  targetSide?: VizSide;
  label?: string;
  state?: Exclude<VizState, "pulsing">;
}

export interface VizStat {
  label: string;
  value: string;
}

export interface VizFrame {
  /** Two or three words for the step rail. */
  label: string;
  /** What just happened, and why it matters. Shown under the canvas. */
  caption: string;
  nodes: VizNode[];
  edges?: VizEdge[];
  /** 1-based lines of `code.source` highlighted while this frame shows. */
  codeLines?: number[];
  stats?: VizStat[];
}

export interface Viz {
  /** Natural size of the drawing. The canvas fits this box, never enlarging past 100%. */
  width: number;
  height: number;
  legend?: { tone: VizTone; label: string }[];
  code?: { language: string; source: string };
  frames: VizFrame[];
}
