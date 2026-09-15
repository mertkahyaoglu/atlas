"use client";

import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import type { InterviewScript } from "@/lib/types";
import { ScriptDialog } from "./ScriptDialog";

/** Opens the worked interview script. The dialog mounts only once asked for. */
export function ScriptButton({ title, script }: { title: string; script: InterviewScript }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Read this design as a 45-minute interview"
        className="inline-flex items-center gap-1.5 rounded border border-rule px-2.5 py-1 font-mono text-micro text-inkMuted transition-colors duration-fast hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
      >
        <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
        Script
      </button>
      {open && <ScriptDialog title={title} script={script} onClose={() => setOpen(false)} />}
    </>
  );
}
