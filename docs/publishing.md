# Publishing a deck

## Static handout and `llms.txt`

A Slidev build is a single-page app: without JavaScript its `index.html`
contains nothing but the title. Search engines render JavaScript for the root
URL at best, and AI crawlers (GPTBot, ClaudeBot, CCBot, …) render none, so
the code on your slides never reaches them. Every `slidev build` on this
theme therefore also writes, next to the app:

| File | Contents |
| --- | --- |
| `handout/index.html`, `handout/<section>.html` | One page per source file (`src:` lesson), with every slide's title, prose, and highlighted code, each linking back to the live slide. A single-file deck gets one page. |
| `llms.txt`, `llms-full.txt` | The [llmstxt.org](https://llmstxt.org) convention that coding agents and AI crawlers look for: an index, and the full Markdown of the deck with complete code snippets (folded imports expanded). |
| `sitemap.xml` | Only when the deck's public URL is known. |
| `robots.txt` | Only when that URL is the root of its host and `public/` ships none. |

Configure it in the headmatter:

```yaml
themeConfig:
  siteUrl: https://example.github.io/my-deck/
  handout:
    notes: false   # leave presenter notes out (default: included)
  # handout: false # disable the static content entirely
```

`siteUrl` makes the links, the sitemap, and `llms.txt` absolute.

### `robots.txt` on a sub-path

Crawlers read `robots.txt` at the host root alone. A deck served from a
sub-path (a GitHub project page, a folder of your blog) therefore gets no
file. Add this line to the host's own `robots.txt` instead, as the build
reminds you:

```
Sitemap: <siteUrl>sitemap.xml
```

### What the pages contain

The handout and `llms-full.txt` form one outline: the deck, then each
section, then each slide, with a slide's own headings placed below its title.
The handout pages carry a description, a canonical URL, Open Graph tags, and
the deck's `lang` from the headmatter (`en` when unset).

Theme markup is translated, not dropped:

- a `DrawnAnnotation` with a `label` becomes a quoted note about the code it
  points at;
- an `InlineCompilerError` becomes its diagnostic, and the other code
  decorations become the note they would leave;
- Magic Move blocks become their steps;
- `<<< @/file#region` snippet imports are inlined;
- folded imports are printed in full, and the answer above a `// Solution`
  comment is left out.

### The app's own `index.html`

The built `index.html` (and the `404.html` copied from it) points at the
static content too, so a crawler that renders no JavaScript finds it from the
root URL:

- `rel="alternate"` links to the handout and `llms-full.txt`;
- a plain-text `<meta name="description">` taken from the headmatter `info`;
- a short visible paragraph linking to the same files, hidden as soon as the
  app has mounted;
- with `siteUrl` set, the canonical URL and a `rel="sitemap"` link.

## Deep links on GitHub Pages

GitHub Pages has no single-page-app rewrite, so a history-mode deep link such
as `/my-deck/12` is answered by the copied `404.html` with a 404 status.
Build with Slidev's hash router instead:

```bash
slidev build --base /my-deck/ --router-mode hash
```

Links then look like `/my-deck/#/12` and always resolve. Old `/my-deck/12`
links (and `presenter/…`, `overview`, `notes`, `print`, `export`) are
forwarded to their hash equivalent, so links shared before the switch keep
working.

## Analytics

Decks can count pageviews with [GoatCounter](https://www.goatcounter.com),
which sets no cookies and stores no personal data, so it needs no consent
banner. Give the headmatter the endpoint of your GoatCounter site, or just
its code:

```yaml
themeConfig:
  analytics:
    goatcounter: https://mysite.goatcounter.com/count   # or: mysite
```

What is counted:

- one pageview per slide, recorded as `<base>/<slide number>` with the
  slide's title, so the dashboard's path list doubles as a per-slide drop-off
  curve;
- handout pages, under their own URL.

What is not counted: clicks within a slide, the presenter and overview views,
notes, print, export, `slidev dev`, and screenshots.

Every deck on one host can share one GoatCounter site, since paths carry the
deck's base. Add `#toggle-goatcounter` to a deck's URL to stop counting your
own visits in that browser.
