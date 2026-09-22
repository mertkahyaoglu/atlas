import { getDocsByGroup, toMeta } from "@/lib/content";
import { Sidebar } from "./Sidebar";

/**
 * Server component: reads the document index once and hands plain metadata to
 * the client sidebar, so no markdown body ever crosses the boundary.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const concepts = getDocsByGroup("concept").map(toMeta);
  const tech = getDocsByGroup("tech").map(toMeta);
  const designs = getDocsByGroup("design").map(toMeta);
  const coding = getDocsByGroup("coding").map(toMeta);

  return (
    // clip, not hidden: hidden tooltips can't widen the page, and sticky still works.
    <div className="min-h-screen overflow-x-clip">
      <Sidebar concepts={concepts} tech={tech} designs={designs} coding={coding} />
      <div data-content className="transition-[padding] duration-200 lg:pl-sidebar">
        {children}
      </div>
    </div>
  );
}
