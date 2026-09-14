/**
 * Applies the stored theme before first paint. Without this, the dark default
 * flashes light on every navigation-less reload. Kept as a raw string because
 * it must run synchronously in <head>, ahead of React hydration.
 */
const script = `
(function () {
  try {
    var stored = localStorage.getItem('atlas-ui');
    var theme = stored ? JSON.parse(stored).state.theme : 'dark';
    document.documentElement.classList.toggle('dark', theme !== 'light');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
