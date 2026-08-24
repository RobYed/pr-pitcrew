# The logo

The mark is a commit that fans out into three lines of code: the pull request arrives, three
specialists take a line each, all at once. That is the pit crew, drawn in the one notation every
reader here already knows - a commit graph - rather than in anything with a chequered flag on it.

It is drawn in the [Dey AI Solutions](https://deyai.solutions) design system, which is also why the
footer of the main README carries that logo.

| File | What it is |
| --- | --- |
| [`logo.svg`](logo.svg) | The full lockup, for light backgrounds. Used at the top of the README. |
| [`logo-dark.svg`](logo-dark.svg) | The same lockup with the palette for dark backgrounds. |
| [`mark.svg`](mark.svg) | The mark alone, square, in tones that carry on either background. |
| [`dey-ai-solutions_light-bg.svg`](dey-ai-solutions_light-bg.svg) | The Dey AI Solutions logo, light backgrounds. |
| [`dey-ai-solutions_dark-bg.svg`](dey-ai-solutions_dark-bg.svg) | The same, for dark backgrounds. |

Both lockups are picked between with `<picture>` and `prefers-color-scheme`, which is what GitHub
honours; anything that ignores it falls back to the light one.

## Colours

Every value is a design-system token. The accent is spent on the three lines and on nothing else,
because the system asks for it sparingly - the same discipline that makes `AI` the only orange in
the Dey AI Solutions wordmark.

| | Token | Light | Dark |
| --- | --- | --- | --- |
| Wordmark | `--ink-soft` / `--fg-strong` | `#38322e` | `#f3ede2` |
| Tagline | `--fg-dim` / `--fg-muted` | `#6f655a` | `#a59a8a` |
| Commit and lanes | `--fg-dim` / `--fg-muted` | `#6f655a` | `#a59a8a` |
| The three lines | `--accent-soft` / `--accent` | `#d9874a` | `#f1a83c` |

Which accent tone carries depends on what it has to hold up against: `--accent` reaches 8.7:1 on the
brand's dark but only 2:1 on white, so light backgrounds get `--accent-soft` instead. The three
lines are one colour, not three: they are told apart by where they sit and how long they are.

## Type

Space Grotesk Bold for the wordmark, which is the system's H1 weight and the weight the Dey AI
Solutions logo itself is set in. Manrope SemiBold for the tagline, which is the one place the system
allows SemiBold: small all-caps micro-labels. Both are under the SIL Open Font Licence 1.1.

Neither file asks for a font: every glyph is a path, so the logo renders the same wherever it is
opened, including in an `<img>` on GitHub, where webfonts do not load. That also means the files are
not editable as text. Redrawing the wordmark means setting it again in those fonts and converting it
back to outlines.

## The Dey AI Solutions logo

Copied unchanged from the brand's released set, in the two variants the guidelines name for coloured
backgrounds. Do not recolour, rotate or crowd them: the clear space around the logo is at least the
height of the `D`, and the wordmark is never set below 120 px wide. The name and the logo are a
trademark, and the repository's MIT licence does not cover them.
