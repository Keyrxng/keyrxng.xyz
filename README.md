<div align="center">

# keyrxng.xyz

Personal site & writing hub. Built with Astro (first-time use — really enjoying the DX) plus a lightweight content & SEO tooling layer.

</div>

## Overview

Core goals:

- Fast, low-JS delivery (Astro islands only where needed)
- Clear content model for writing, work history, competencies & technologies
- Strong defaults for metadata, Open Graph, RSS & sitemap
- Authoring ergonomics: MDX, diagrams, glossary, semantic keyword insight
- Repeatable SEO & readability audit to keep quality from drifting

## Tech Stack

- Astro 5
- MDX (`@astrojs/mdx`)
- Sitemap (`@astrojs/sitemap`)
- RSS feed (`src/pages/rss.xml.js`)
- Custom OG image generation (Satori + Resvg)
- Mermaid diagrams component (`Mermaid.astro`)
- TypeScript everywhere (strict content typing via `src/content/config.ts`)
- Vitest for utility tests

## Features

- Content collections: writing, work, competencies, technologies (typed frontmatter)
- Dynamic per-post pages via `[slug].astro` for writing & work
- Glossary MDX page (`_glossary.mdx`) for shared terminology
- Open Graph & social card generation (Satori + Resvg)
- Auto sitemap + RSS
- Mermaid diagram rendering with custom theming (bigger font, dark theme, overflow-safe)
- SEO audit script with TF‑IDF & readability metrics (`scripts/seo-audit.ts`)
- Keyword extraction & duplicate title detection
- Styled OG & diagram components without heavyweight CSS frameworks (hand-authored design tokens in `public/*.css`)

## Performance & DX Notes

- Favor server-rendered + static output; hydrate only where interaction is essential
- Keep third-party scripts minimal (currently only Mermaid when diagrams are used)
- Design tokens in `public/tokens.css` for consistent spacing/color/typography
- Custom fonts: Noto Sans & Roboto variable fonts

## Content Model

Each collection enforces frontmatter fields, enabling consistent metadata & structured listings.

Patterns:

- Articles: title, summary, publishedAt, readingTime
- Work items: problem framing, impact narrative, tech stack
- Competencies / technologies: JSON or MDX descriptors consumed for taxonomy & filtering
- Glossary: curated shared vocabulary to reduce repetition & onboard readers faster

## SEO & Quality Tooling

`scripts/seo-audit.ts` crawls source content (Astro, MD, MDX, JSON):

- Extracts title, description, headings (H1–H3)
- Calculates word & sentence counts, Flesch Reading Ease, FK Grade
- Collects internal / external links; flags images missing alt
- Performs tokenization + stemming + stopword filtering
- Builds unigrams, bigrams, trigrams with weighted TF‑IDF (frontmatter & headings boosted)
- Detects: missing title/description/H1, duplicate titles, suboptimal length
- Emits JSON + companion markdown summary (`seo-report.json` / `.md`)

Run after a production build to audit what will actually ship:

```
pnpm build
pnpm seo:audit   # writes seo-report.json + md
```

Stdout variant:

```
pnpm seo:audit:stdout
```

## Development

Install & run locally:

```
pnpm install   # or npm / yarn
pnpm dev       # http://localhost:4321
```

Build & preview:

```
pnpm build
pnpm preview
```

Additional scripts:

```
pnpm test             # Vitest (TF‑IDF, normalization utilities)
pnpm astro check      # Type + Astro diagnostics
pnpm seo:audit        # Generate SEO / keyword report (needs dist or specify --root)
```

## Mermaid Diagrams

Use the `<Mermaid>` component in MDX to embed architecture / flow diagrams. The component loads Mermaid ESM client-side, applies a custom dark theme, enlarges typography for legibility, and preserves natural width (horizontal scroll when needed).

Example MDX snippet:

```mdx
<Mermaid chart={`graph TD\nA[Request] --> B[Astro]\nB --> C{Island}`}/>
```

## Open Graph Images

OG images are generated via Satori + Resvg (see integration code) to ensure consistent branding without hand-authoring each card. Titles & descriptors feed into the template.

## License / Content

Code: MIT. Written content & images: All rights reserved unless explicitly stated.

## Credits

Built with Astro — first experience and a positive one. Thanks to the Astro team & ecosystem.

---

Questions or suggestions? PR or email: keyrxng@proton.me

