# DKDS brand

The visual identity shared by dkds.org and scan.dkds.org. Both builds read these files; neither
keeps a copy.

| File | Content |
|---|---|
| `tokens.css` | Colours, type families, motion and radii as CSS custom properties |
| `mark.svg` | The mark, drawn by Vince Lubbers: a shield on a grid of 16 by 16 cells, in `currentColor`, with the path commands M, H, V, L and Z only |
| `icons.svg` | The interface icons of both sites, from Lucide, as symbols `i-<name>` (`LICENSE-Lucide.txt`) |
| `fonts/` | The typefaces, self-hosted: WOFF2 files of the Latin and Latin Extended subsets, `fonts.css` with their `@font-face` rules, and their licences |
| `lib/icons.mjs` | For the builds: the mark and the icons as symbols, the favicons (SVG, which follows the browser's light or dark theme, PNG, and ICO for browsers that request /favicon.ico), the Apple touch icon and the icons of a web application manifest, rasterised from `mark.svg` so that every cell covers whole pixels |
| `lib/png.mjs` | PNG encoding, for the icons and the test images of scan.dkds.org |

Type: Roboto (text), Roboto Slab (headings), Roboto Mono (buttons and machine output). Roboto and
Roboto Mono are licensed under the SIL Open Font License 1.1, Roboto Slab under the Apache License
2.0; the files come from Fontsource 5.3.0. Both sites serve them from their own origin, so that
loading a page contacts no third party.
