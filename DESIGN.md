# Design System: Axiom Wiki

## 1. Visual Theme & Atmosphere
A restrained, "Cockpit Dense" (8/10) interface designed for technical power users. The atmosphere is utilitarian yet premium — like a declassified blueprint or a high-end architecture studio's internal tool. It favors information density and clarity over decorative whitespace, using a "Zinc-950" base with high-contrast "Cyan-500" accents to guide the eye through complex data structures.

## 2. Color Palette & Roles
- **Deep Space** (#09090B) — Primary background surface (Zinc-950)
- **Terminal Surface** (#18181B) — Container and card fill (Zinc-900)
- **Ghost White** (#F4F4F5) — Primary text, high readability (Zinc-100)
- **Muted Graphite** (#71717A) — Secondary text, metadata, dim labels (Zinc-500)
- **Cyber Cyan** (#06B6D4) — Primary accent for CTAs, active states, and success indicators (Cyan-500)
- **Hazard Amber** (#F59E0B) — Warning states, staleness indicators (Amber-500)
- **Structural Border** (rgba(39,39,42,0.5)) — 1px structural lines (Zinc-800)

## 3. Typography Rules
- **Display:** Geist — Track-tight, bold weight-driven hierarchy.
- **Body:** Satoshi — Relaxed leading, 65ch max-width for long-form wiki content.
- **Mono:** JetBrains Mono — For code blocks, metadata, timestamps, and all high-density numbers.
- **Banned:** Inter (too generic), any serif fonts (unsuitable for technical dashboards).

## 4. Component Stylings
* **Buttons:** Flat, no outer glow. Tactile -1px Y-translate on active state. Cyan fill for primary, ghost/border for secondary.
* **Cards:** Sharp corners (0.25rem) to maintain the "blueprint" aesthetic. No shadows; elevation communicated through subtle background shifts (Zinc-900 to Zinc-800).
* **Inputs:** Label above, mono-font for input text. Cyber Cyan focus ring (2px).
* **Loaders:** Skeletal shimmer matching exact layout dimensions. No generic circular spinners.
* **Empty States:** Composed composition with ASCII-inspired illustrations indicating how to populate data.

## 5. Layout Principles
Grid-first responsive architecture. Cockpit-style density with collapsible sidebars. Strict single-column collapse below 768px. Max-width containment (1400px) for centered layouts. No overlapping elements — every component occupies its own clean spatial zone.

## 6. Motion & Interaction
Spring physics (`stiffness: 100, damping: 20`) for all interactive elements. Staggered cascade reveals for list items. Perpetual micro-loops (subtle pulse) on active background tasks (like indexing). Hardware-accelerated transforms only.

## 7. Anti-Patterns (Banned)
- No emojis (use Lucide icons or ASCII if needed).
- No `Inter` font.
- No neon/outer glow shadows.
- No pure black (#000000).
- No 3-column equal card layouts (use asymmetric grids).
- No AI copywriting clichés ("Elevate", "Seamless", "Next-Gen").
- No filler UI text ("Scroll to explore").
