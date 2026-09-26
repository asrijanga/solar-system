/**
 * Every world has its own page one level below the site root (`moon/`, docs/stories/SS-13.md), and
 * shared data (star catalogue, terrain tiles, each world's data) lives at the root. This resolves a
 * root-relative path from any world page: in development, on GitHub Pages under /solar-system/,
 * in local mode and in captures alike.
 */
export function siteUrl(path: string): string {
  return new URL(`../${path}`, location.href).href;
}
