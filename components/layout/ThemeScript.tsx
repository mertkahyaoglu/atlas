/**
 * Applies the stored theme and the collapse preferences (sidebar, sections,
 * parts) before first paint.
 * Without this, the dark default flashes light and anything collapsed flashes
 * open on every reload. Kept as a raw string because it must run
 * synchronously in <head>, ahead of React hydration.
 */
const script = `
(function () {
  try {
    var stored = localStorage.getItem('atlas-ui');
    var state = stored ? JSON.parse(stored).state : {};
    document.documentElement.classList.toggle('dark', state.theme !== 'light');
    document.documentElement.classList.toggle('sidebar-collapsed', state.sidebarCollapsed === true);
    (state.collapsedSections || []).forEach(function (id) {
      // A part (a course inside a section) hides through a CSS variable its body
      // reads, since part names aren't known to the stylesheet. See Sidebar.
      if (/^part-[a-z0-9-]+$/.test(id)) {
        document.documentElement.style.setProperty('--collapsed-' + id, 'none');
      } else {
        document.documentElement.classList.add('section-collapsed-' + id);
      }
    });
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
