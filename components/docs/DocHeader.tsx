import { Clock } from "lucide-react";
import type { DocMeta, InterviewScript } from "@/lib/types";
import { GroupBadge } from "@/components/ui/GroupBadge";
import { CompleteButton } from "./CompleteButton";
import { DocTags } from "./DocTags";
import { ScriptButton } from "./script/ScriptButton";

/**
 * `showHardPart` is off when the page renders the design panels, which show
 * the fuller version of the same text. `script` is present only for designs
 * that have one written.
 */
export function DocHeader({
  doc,
  showHardPart = true,
  script,
}: {
  doc: DocMeta;
  showHardPart?: boolean;
  script?: InterviewScript;
}) {
  return (
    <header className="mb-14">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <GroupBadge group={doc.group} />
        <span className="flex items-center gap-1.5 font-mono text-micro text-inkFaint">
          <Clock className="h-3 w-3" aria-hidden />
          {doc.readingMinutes} min
        </span>
        {doc.tags.length > 0 && <DocTags tags={doc.tags} />}
        <span className="ml-auto flex items-center gap-2">
          {script && <ScriptButton title={doc.title} script={script} />}
          <CompleteButton slug={doc.slug} />
        </span>
      </div>

      <h1 className="text-h1 font-semibold text-ink sm:text-display">{doc.title}</h1>
      <p className="mt-4 max-w-reading text-lead text-inkMuted">{doc.summary}</p>

      {showHardPart && doc.hardPart && (
        <div className="mt-6 max-w-reading border-l-2 border-[color:var(--accent)] bg-[color:var(--accent-soft)] py-3 pl-4 pr-4">
          <p className="text-small text-ink">
            <span className="font-semibold">What they&rsquo;re really testing: </span>
            {doc.hardPart}
          </p>
        </div>
      )}
    </header>
  );
}
