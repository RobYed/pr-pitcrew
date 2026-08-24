# The logo

The mark is a commit that fans out into three lines of code, each one a different colour: the pull
request arrives, three specialists take a line each, all at once. That is the pit crew, drawn in the
one notation every reader here already knows - a commit graph - rather than in anything with a
chequered flag on it.

| File | What it is |
| --- | --- |
| [`logo.svg`](logo.svg) | The full lockup, for light backgrounds. Used in the README. |
| [`logo-dark.svg`](logo-dark.svg) | The same lockup with a palette for dark backgrounds. |
| [`mark.svg`](mark.svg) | The mark alone, square, in colours that carry on either background. |

The README picks between the two lockups with `<picture>` and `prefers-color-scheme`, which is what
GitHub honours; anything that ignores it falls back to `logo.svg`.

## Colours

| | Light | Dark |
| --- | --- | --- |
| Wordmark | `#0F172A` | `#E6EDF3` |
| Tagline | `#64748B` | `#8B949E` |
| Commit and lanes | `#475569` | `#8B949E` |
| Bug line | `#0EA5E9` | `#38BDF8` |
| Security line | `#6366F1` | `#818CF8` |
| Acceptance line | `#A855F7` | `#C084FC` |

The three line colours are in the order the tagline names them, top to bottom.

## Type

The wordmark is Space Grotesk Bold, the tagline JetBrains Mono Medium, both under the SIL Open Font
Licence 1.1. Neither file asks for a font: every glyph is a path, so the logo renders the same
wherever it is opened, including in a `<img>` on GitHub, where webfonts do not load.

That also means the files are not editable as text. Redrawing the wordmark means setting it again in
those fonts and converting it back to outlines.
