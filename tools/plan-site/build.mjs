// Renders the plan documents to a static site in _site/ for GitHub Pages.
// Replaced by the app's own build once SS-1 exists; see README "SS-7".
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked, Renderer } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outDir = join(root, '_site');

// Source path (repo-relative) -> output file. Links between these are rewritten.
const pages = [
  { src: 'README.md', out: 'index.html', nav: 'Plan' },
  { src: 'docs/world-catalogue.md', out: 'world-catalogue.html', nav: 'World catalogue' },
];
const outFor = new Map(pages.map((p) => [p.src, p.out]));

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

function render(page) {
  const markdown = readFileSync(join(root, page.src), 'utf8');
  const toc = [];
  const seen = new Map();
  const marked = new Marked({ gfm: true });

  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        let id = slugify(html);
        const n = seen.get(id) ?? 0;
        seen.set(id, n + 1);
        if (n > 0) id = `${id}-${n}`;
        if (depth === 2) toc.push({ id, html });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
      },
      code({ text, lang }) {
        if (lang === 'mermaid') return `<pre class="mermaid">${escapeHtml(text)}</pre>\n`;
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        return `<pre><code${cls}>${escapeHtml(text)}</code></pre>\n`;
      },
      table(token) {
        // Wrap so wide tables scroll inside the column instead of the page.
        return `<div class="table-wrap">${Renderer.prototype.table.call(this, token)}</div>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        let target = href;
        if (!/^[a-z]+:|^#/i.test(href)) {
          const [path, hash] = href.split('#');
          const resolved = posix.normalize(posix.join(posix.dirname(page.src), path));
          const out = outFor.get(resolved);
          if (out) target = out + (hash ? `#${hash}` : '');
        }
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        const ext = /^https?:/i.test(target) ? ' rel="noopener"' : '';
        return `<a href="${escapeHtml(target)}"${t}${ext}>${text}</a>`;
      },
    },
  });

  const body = marked.parse(markdown);
  const title = (markdown.match(/^# (.+)$/m)?.[1] ?? page.nav).trim();
  return { body, title, toc };
}

const template = readFileSync(join(here, 'template.html'), 'utf8');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const page of pages) {
  const { body, title, toc } = render(page);
  const nav = pages
    .map((p) => {
      const current = p === page ? ' aria-current="page"' : '';
      return `<a href="${p.out}"${current}>${escapeHtml(p.nav)}</a>`;
    })
    .join('');
  const tocHtml = toc.length
    ? `<nav class="toc" aria-label="Contents"><p>Contents</p><ol>${toc
        .map((h) => `<li><a href="#${h.id}">${h.html}</a></li>`)
        .join('')}</ol></nav>`
    : '';
  const html = template
    .replaceAll('{{title}}', escapeHtml(title.replace(/<[^>]+>/g, '')))
    .replace('{{nav}}', nav)
    .replace('{{layoutClass}}', toc.length ? ' has-toc' : '')
    .replace('{{toc}}', tocHtml)
    .replace('{{body}}', body);
  writeFileSync(join(outDir, page.out), html);
  console.log(`${page.src} -> _site/${page.out}`);
}

// Diagrams render client-side from a pinned, self-hosted copy of mermaid.
mkdirSync(join(outDir, 'vendor'));
copyFileSync(join(here, 'node_modules/mermaid/dist/mermaid.min.js'), join(outDir, 'vendor/mermaid.min.js'));

// Serve files as-is; no Jekyll processing on Pages.
writeFileSync(join(outDir, '.nojekyll'), '');
