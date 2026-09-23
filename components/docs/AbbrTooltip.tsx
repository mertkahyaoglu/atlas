"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * One tooltip for every `<abbr class="abbr">` that `lib/rehype-abbr.ts` marks,
 * driven by delegated listeners rather than a component per abbreviation.
 * Mouse hover and keyboard focus show it, and so does a tap, since touch has
 * no hover.
 *
 * It is `position: fixed` in a portal so a table's scroll container can't clip
 * it. While it is showing, the element's `title` is parked in a data attribute
 * so the browser's own tooltip doesn't appear on top of this one.
 */

const TOOLTIP_ID = "abbr-tooltip";
const GAP = 6;
const EDGE = 8;

interface Tip {
  target: HTMLElement;
  term: string;
  expansion: string;
  /** The page's section colour, which doesn't reach a portal on <body>. */
  accent: string;
}

const abbrFrom = (node: EventTarget | null) =>
  node instanceof Element ? node.closest<HTMLElement>("abbr.abbr") : null;

/** Centred above the abbreviation, below it when there's no room above, and inside the viewport either way. */
function place(el: HTMLElement, target: HTMLElement) {
  // Measure at the left edge: a fixed box near the right edge would wrap early.
  el.style.left = "0px";
  const anchor = target.getBoundingClientRect();
  const { width, height } = el.getBoundingClientRect();
  const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, EDGE), window.innerWidth - width - EDGE);
  const above = anchor.top - GAP - height;
  el.style.left = `${left}px`;
  el.style.top = `${above >= EDGE ? above : anchor.bottom + GAP}px`;
  el.style.visibility = "visible";
}

export function AbbrTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;

    const hide = () => {
      if (!current) return;
      if (current.dataset.title) current.setAttribute("title", current.dataset.title);
      delete current.dataset.title;
      current.removeAttribute("aria-describedby");
      current = null;
      setTip(null);
    };

    const show = (el: HTMLElement) => {
      if (el === current) return;
      hide();
      const expansion = el.getAttribute("title");
      if (!expansion) return;
      el.dataset.title = expansion;
      el.removeAttribute("title");
      el.setAttribute("aria-describedby", TOOLTIP_ID);
      current = el;
      setTip({
        target: el,
        term: el.dataset.term ?? el.textContent ?? "",
        expansion,
        accent: getComputedStyle(el).getPropertyValue("--accent").trim(),
      });
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const el = abbrFrom(event.target);
      if (el) show(el);
    };
    // Leaving with the mouse hides it, unless the keyboard put focus there.
    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !current) return;
      if (abbrFrom(event.target) !== current || current.contains(event.relatedTarget as Node | null)) return;
      if (!current.matches(":focus-visible")) hide();
    };
    // A tap shows it on an abbreviation and dismisses it anywhere else. Pointer
    // events rather than click, which iOS doesn't deliver for a plain element.
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      const el = abbrFrom(event.target);
      if (el) show(el);
      else hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const el = abbrFrom(event.target);
      if (el) show(el);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (abbrFrom(event.target) === current) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      hide();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!tip || !el) return;
    place(el, tip.target);

    // Follow the abbreviation when the page, or a dialog body, scrolls under it.
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => place(el, tip.target));
    };
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
    };
  }, [tip]);

  if (!tip) return null;

  // A modal <dialog> sits in the top layer, above anything portalled to <body>.
  const container = tip.target.closest("dialog[open]") ?? document.body;

  return createPortal(
    <div
      ref={box}
      id={TOOLTIP_ID}
      role="tooltip"
      className="abbr-tooltip"
      style={{ visibility: "hidden", ...(tip.accent && { "--accent": tip.accent }) } as React.CSSProperties}
    >
      <span className="abbr-tooltip__term">{tip.term}</span>
      {tip.expansion}
    </div>,
    container,
  );
}
