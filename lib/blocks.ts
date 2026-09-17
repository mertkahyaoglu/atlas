/**
 * The small line format behind ```api and ```erd fences:
 *
 *   # Title · note      starts a group (the note is optional)
 *   a || b || c         a row; fields are separated by `||`
 *   + text              continues the row above, spacing after `+ ` preserved
 *   @flag               sets a block-wide option
 *
 * `||` is the separator because single pipes already appear inside the
 * content, e.g. `available | offered | on_trip`.
 */

export interface SpecRow {
  fields: string[];
  details: string[];
}

export interface SpecGroup {
  title?: string;
  note?: string;
  rows: SpecRow[];
}

export interface Spec {
  flags: Set<string>;
  groups: SpecGroup[];
}

export function parseSpec(source: string): Spec {
  const flags = new Set<string>();
  const groups: SpecGroup[] = [];
  let group: SpecGroup | undefined;

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("@")) {
      flags.add(line.slice(1));
      continue;
    }

    if (line.startsWith("# ")) {
      const [title, ...note] = line.slice(2).split(" · ");
      group = { title, note: note.join(" · ") || undefined, rows: [] };
      groups.push(group);
      continue;
    }

    if (!group) {
      group = { rows: [] };
      groups.push(group);
    }

    if (line.startsWith("+ ")) {
      // Keep the spacing so aligned continuation lines (state diagrams) stay aligned.
      group.rows[group.rows.length - 1]?.details.push(raw.replace(/^\s*\+ /, ""));
      continue;
    }

    group.rows.push({ fields: line.split("||").map((field) => field.trim()), details: [] });
  }

  return { flags, groups };
}
