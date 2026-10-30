# Cloud console visual language

The console is a calm, technical workspace for explicit AI-client permissions
and future local KiCad device access. It should feel precise and reliable, not
like an animated marketing template.

## Visual foundations

- **Canvas:** deep ink `#0a0e15`; layered slate surfaces `#121a25` and
  `#192330`. Boundaries are subtle, with comfortable whitespace.
- **Accents:** ice blue `#afcfff` for navigation and primary actions,
  mint `#86dfbd` for genuinely available states, and warm amber
  `#f2cc91` for unavailable/pending actions.
- **Type:** local system/Inter fallback stack; distinct display headings,
  calm readable descriptions, precise labels. No third-party font requests.
- **Iconography:** first-party SVG paths in `src/ui-icons.tsx`; the brand
  symbol evokes two connected electronic traces. Decorative icons are hidden
  from assistive technology, while text describes the actual state.
- **Components:** a consistent header, sidebar, card, form, consent,
  status and security-note system shared across Cloud pages. OAuth request
  parameters and security controls are not changed for visual polish.

## User experience rules

1. Never describe device pairing or physical KiCad access as enabled when
   the runtime has not enabled it. The architecture graphic explicitly
   distinguishes account access from unavailable local connectivity.
2. Keep separate project authorization prominent. Signing in alone must
   never imply permission to a local project.
3. Design for keyboard access: a skip link, focus-visible outlines, semantic
   headings, clear buttons and reduced-motion support.
4. Use responsive layouts rather than shrinking desktop content: 1060,
   750 and 560 px breakpoints. Avoid horizontal scrolling on content.
5. Prefer static server-rendered HTML and first-party CSS/SVG. Do not add
   browser scripting, externally hosted assets, font dependencies or
   visual animation to core security workflows.

## Acceptance

- `npm run check` with isolated PostgreSQL and the existing
  authorization/regression tests.
- `node scripts/ui-visual-smoke.mjs`: six Cloud screens at desktop,
  tablet and mobile widths, including overflow, navigation and forms.
- Additional local browser review across seven pages and six widths,
  including 320 px phones; 42 combinations checked without overflow.
- The real-passkey owner-review UI is developed separately in draft PR #64;
  its isolated pages must adopt the shared visual language only after that
  acceptance flow can be reviewed without weakening its trust boundaries.
