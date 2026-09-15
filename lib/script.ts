import type { InterviewScript, ScriptPhase, ScriptSpeaker, ScriptTurn } from "./types";

/**
 * A worked interview script, authored as one markdown file per design in
 * `content/scripts/`. Phases are the six in Module 10.1; every line is spoken
 * by one of three voices:
 *
 *   ## Clarify · 5 min · Requirements and explicit scope cuts
 *
 *   @you
 *   …what the candidate says, as markdown…
 *
 *   @interviewer · pushing on scope
 *   …their question…
 *
 *   @note
 *   …a coaching aside, not spoken by anyone…
 *
 * A heading's fields are ` · ` separated: title, then a `N min` budget and a
 * one-line goal in either order. A speaker marker takes an optional ` · cue`.
 * The file still reads top to bottom in a plain markdown viewer.
 */

const PHASE = /^##\s+(.+?)\s*$/;
const TURN = /^@(you|interviewer|note)\b\s*(?:·\s*(.+?))?\s*$/;
const MINUTES = /^(\d+)\s*min$/;

function phaseFrom(heading: string): ScriptPhase {
  const [title, ...rest] = heading.split(" · ").map((field) => field.trim());
  const minutes = rest.find((field) => MINUTES.test(field));
  return {
    title,
    minutes: minutes ? Number(MINUTES.exec(minutes)![1]) : undefined,
    goal: rest.find((field) => !MINUTES.test(field)),
    turns: [],
  };
}

export function parseScript(source: string): InterviewScript {
  const phases: ScriptPhase[] = [];
  let turn: (ScriptTurn & { lines: string[] }) | null = null;
  let inFence = false;

  const closeTurn = () => {
    if (turn) {
      const body = turn.lines.join("\n").trim();
      if (body) phases[phases.length - 1]?.turns.push({ speaker: turn.speaker, cue: turn.cue, body });
    }
    turn = null;
  };

  for (const line of source.split("\n")) {
    // Markers inside fenced blocks are sample text, not structure.
    if (/^\s*```/.test(line)) inFence = !inFence;

    const marker = inFence ? null : TURN.exec(line.trim());
    const heading = inFence || marker ? null : PHASE.exec(line);

    if (heading) {
      closeTurn();
      phases.push(phaseFrom(heading[1]));
    } else if (marker) {
      closeTurn();
      turn = { speaker: marker[1] as ScriptSpeaker, cue: marker[2], body: "", lines: [] };
    } else if (turn) {
      turn.lines.push(line);
    }
    // Anything before the first marker (a title, an intro) is prose the
    // dialog doesn't show, so it's dropped rather than mis-attributed.
  }
  closeTurn();

  const spoken = phases.flatMap((phase) => phase.turns).filter((t) => t.speaker !== "note");
  return {
    phases: phases.filter((phase) => phase.turns.length > 0),
    minutes: phases.reduce((total, phase) => total + (phase.minutes ?? 0), 0),
    turns: spoken.length,
  };
}
