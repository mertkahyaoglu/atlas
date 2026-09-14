import { getDocsByGroup, toMeta } from "@/lib/content";
import { Sidebar } from "./Sidebar";

/**
 * Server component: reads the document index once and hands plain metadata to
 * the client sidebar, so no markdown body ever crosses the boundary.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const concepts = getDocsByGroup("concept").map(toMeta);
  const designs = getDocsByGroup("design").map(toMeta);

  return (
    <div className="min-h-screen">
      <Sidebar concepts={concepts} designs={designs} />
      <div className="lg:pl-sidebar">{children}</div>
    </div>
  );
}
