"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, Lightbulb, X } from "lucide-react";
import type { InterviewScript, ScriptPhase, ScriptTurn } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Markdown } from "../Markdown";

const SPEAKER: Record<ScriptTurn["speaker"], string> = {
  you: "You",
  interviewer: "Interviewer",
  note: "Why this works",
};

function Turn({ turn }: { turn: ScriptTurn }) {
  if (turn.speaker === "note") {
    return (
      <div className="script-note">
        <span className="script-note__label">
          <Lightbulb className="h-3.5 w-3.5" aria-hidden />
          {turn.cue ?? SPEAKER.note}
        </span>
        <div className="doc text-small text-inkMuted">
          <Markdown content={turn.body} />
        </div>
      </div>
    );
  }

  const interviewer = turn.speaker === "interviewer";
  return (
    <div className={cn("script-turn", interviewer && "script-turn--interviewer")}>
      <div className="script-turn__speaker">
        <span className={cn(interviewer ? "text-inkMuted" : "text-[color:var(--accent)]")}>
          {SPEAKER[turn.speaker]}
        </span>
        {turn.cue && <span className="text-inkFaint">{turn.cue}</span>}
      </div>
      <div className="doc text-small">
        <Markdown content={turn.body} />
      </div>
    </div>
  );
}

function Phase({ phase, index }: { phase: ScriptPhase; index: number }) {
  return (
    <section id={`script-phase-${index}`} className="scroll-mt-14">
      <header className="script-phase">
        <span className="script-phase__number">{index + 1}</span>
        <h3 className="text-h3 font-semibold text-ink">{phase.title}</h3>
        {phase.minutes && <span className="script-phase__time">{phase.minutes} min</span>}
        {phase.goal && <p className="basis-full text-small text-inkMuted">{phase.goal}</p>}
      </header>
      <div className="space-y-4">
        {phase.turns.map((turn, i) => (
          <Turn key={i} turn={turn} />
        ))}
      </div>
    </section>
  );
}

/**
 * The design read back as a 45-minute interview: what you'd say, where the
 * interviewer interrupts, and why each move scores. Portalled to <body> so the
 * page's `.doc` styles don't reach in, with a native modal <dialog> for the
 * focus trap, Escape and backdrop.
 */
export function ScriptDialog({
  title,
  script,
  onClose,
}: {
  title: string;
  script: InterviewScript;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [active, setActive] = useState(0);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // The phase rail follows the scroll: the last heading above the fold wins.
  function onScroll() {
    const container = body.current;
    if (!container) return;
    const top = container.getBoundingClientRect().top + 72;
    let current = 0;
    script.phases.forEach((_, i) => {
      const section = container.querySelector(`#script-phase-${i}`);
      if (section && section.getBoundingClientRect().top <= top) current = i;
    });
    setActive(current);
  }

  function jump(index: number) {
    body.current?.querySelector(`#script-phase-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => event.target === event.currentTarget && onClose()}
      className="flow-dialog script-dialog"
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex shrink-0 items-start gap-3 border-b border-rule px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <span className="font-mono text-micro uppercase tracking-wide text-[color:var(--accent)]">
              Interview script
            </span>
            <h2 id={titleId} className="mt-1.5 text-h3 font-semibold text-ink">
              {title}
            </h2>
            <p className="mt-1 text-tiny text-inkFaint">
              {script.minutes} minutes · {script.phases.length} phases · {script.turns} turns. One way this design
              sounds out loud, not a transcript to memorise.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-inkMuted transition-colors duration-fast hover:bg-raised hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {/* The rail and the chrome keep their height; only the transcript scrolls. */}
        <nav aria-label="Phases" className="flex shrink-0 gap-1 overflow-x-auto border-b border-rule px-6 py-2">
          {script.phases.map((phase, i) => (
            <button
              key={i}
              type="button"
              onClick={() => jump(i)}
              aria-current={i === active}
              className={cn(
                "flex shrink-0 items-baseline gap-1.5 rounded px-2.5 py-1 font-mono text-micro transition-colors duration-fast",
                i === active
                  ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                  : "text-inkMuted hover:bg-raised hover:text-ink",
              )}
            >
              {i + 1}. {phase.title}
              {phase.minutes && <span className="text-inkFaint">{phase.minutes}m</span>}
            </button>
          ))}
        </nav>

        <div ref={body} onScroll={onScroll} className="script-body min-h-0 space-y-10 overflow-y-auto px-6 py-6">
          {script.phases.map((phase, i) => (
            <Phase key={i} phase={phase} index={i} />
          ))}
        </div>

        <footer className="shrink-0 border-t border-rule px-6 py-3">
          <Link
            href="/docs/10-interview-playbook"
            onClick={onClose}
            className="group inline-flex items-center gap-2 text-small font-medium text-[color:var(--concept)]"
          >
            <span>The framework these phases follow</span>
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform duration-fast group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
