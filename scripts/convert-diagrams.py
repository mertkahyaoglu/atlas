#!/usr/bin/env python3
"""Replace the ASCII architecture diagram in each design with a Mermaid chart.

The ASCII originals stay useful as plain-text reference, so they are kept
directly beneath the rendered diagram inside a collapsed <details> block.
"""
import importlib.util
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DESIGNS = ROOT / "content" / "designs"
DIAGRAM_DIR = pathlib.Path(__file__).resolve().parent / "diagrams"

HEADING = "## High-level architecture"


def load_diagrams() -> dict:
    """Diagrams are split across modules to keep each file readable."""
    merged: dict = {}
    for path in sorted(DIAGRAM_DIR.glob("designs-*.py")):
        spec = importlib.util.spec_from_file_location(path.stem, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        merged.update(module.DIAGRAMS)
    return merged


def convert(path: pathlib.Path, mermaid: str) -> bool:
    text = path.read_text(encoding="utf8")

    # Already converted: swap the chart body in place and leave the rest alone.
    if "```mermaid" in text:
        updated = re.sub(
            r"```mermaid\n.*?```",
            lambda _: f"```mermaid\n{mermaid}\n```",
            text,
            count=1,
            flags=re.DOTALL,
        )
        path.write_text(updated, encoding="utf8")
        return True

    start = text.find(HEADING)
    if start == -1:
        print(f"  ! no architecture heading in {path.name}", file=sys.stderr)
        return False

    # First fenced block after the heading is the ASCII diagram.
    match = re.search(r"```\n(.*?)```", text[start:], flags=re.DOTALL)
    if not match:
        print(f"  ! no fenced block after heading in {path.name}", file=sys.stderr)
        return False

    ascii_art = match.group(1).rstrip()
    replacement = (
        f"```mermaid\n{mermaid}\n```\n\n"
        "<details>\n<summary>Plain-text version of this diagram</summary>\n\n"
        f"```text\n{ascii_art}\n```\n\n</details>"
    )

    absolute_start = start + match.start()
    absolute_end = start + match.end()
    path.write_text(text[:absolute_start] + replacement + text[absolute_end:], encoding="utf8")
    return True


def main():
    diagrams = load_diagrams()
    converted = 0
    for slug, mermaid in diagrams.items():
        path = DESIGNS / f"{slug}.md"
        if not path.exists():
            print(f"  ! missing {path.name}", file=sys.stderr)
            continue
        if convert(path, mermaid):
            converted += 1
            print(f"  converted {path.name}")
    print(f"{converted} of {len(diagrams)} diagrams converted")


if __name__ == "__main__":
    main()
