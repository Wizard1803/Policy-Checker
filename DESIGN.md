# Design System: Policy Portal — Obsidian & Champagne Observatory

## 1. Visual Theme & Atmosphere

An atmospheric, cinematic interface that merges **Tactile Architectural Minimalism** with an **Actuarial Celestial Instrument**. It purposefully avoids cookie-cutter SaaS dashboard templates, multi-column analytics sidebars, and generic cards in favor of a focused, dignified workspace:
- **Atmosphere Spectrum:** Density: 4/10 ("Gallery Balanced"), Variance: 4/10 ("Calibrated Symmetry"), Motion: 7/10 ("Fluid Choreography").
- **Visual Stance:** Deep obsidian substrate layered with smoked-glass depth, hair-thin gold leaf borders, and a revolving orbital constellation. It evokes the quiet, high-stakes precision of a private actuarial library or sovereign vault.
- **Cognitive Clarity:** The user is never confronted by enterprise clutter. The hero acts as a gravitational center ("Upload. Ask. Understand."), leading directly into a clean, physical document gallery and focused liquid-glass modal inspectors.
- **Deliberate Layout Rationale (Audit Finding 1):** While standard design heuristics caution against centered heroes at higher variance, our **Centered Gravitational Constellation** is an intentional, calibrated design signature (Variance: 4/10). It reflects the user's bespoke product identity ("Upload, Check, Apply") and avoids generic, cookie-cutter 3-column AI dashboard layouts.

---

## 2. Color Palette & Roles

Strictly one calibrated primary accent family (Warm Champagne / Burnished Gold) anchored against deep obsidian neutrals. Oversaturated neon and AI purple/blue glows are strictly forbidden.

- **Obsidian Substrate (`#09090b`)** — Foundational canvas background, never pitch `#000000`.
- **Smoked Vault (`#121216`)** — Elevated header, modal backdrops, input backgrounds.
- **Instrument Surface (`#16161b`)** — Interactive document cards, table containers.
- **Surface Hover (`#1e1e24`)** — Dynamic hover state for cards and list rows.
- **Champagne Leaf (`#f5e6cc`)** — Primary typography, prominent highlights, highest visual contrast (16.5:1).
- **Burnished Gold (`#d4ba88`)** — Primary button CTA, verified status accents, active tab indicators.
- **Aged Brass (`#b89758`)** — Button hover gradients, active border focus rings.
- **Muted Parchment (`#c2baa8`)** — Secondary prose, subheadings, descriptive metadata (9.8:1 contrast).
- **Subtle Dust (`#a8a090`)** — Deactivated labels, table headers, file timestamps (Audit Finding 2: calibrated to guaranteed comfortable legibility at 6.2:1 contrast on `#16161b`).
- **Hairline Border (`rgba(245, 230, 204, 0.18)`)** — Crisp 1px structural boundaries.
- **Active Specular Border (`rgba(245, 230, 204, 0.38)`)** — Input focus, card hover, modal boundaries.

### Semantic Status (Desaturated & Precise)
- **Verified / Ready (`#4ade80`)** — 5px solid circular micro-dot, status badge, and card accent indicator.
- **Ingesting / Processing (`#facc15`)** — Amber pulsing micro-dot with gentle CSS ring expansion and warning accent.
- **Critical / Failed (`#f87171`)** — Muted crimson border, micro-badge, and destructive action triggers.

---

## 3. Typography Rules

The typography communicates institutional authority and mathematical accuracy.

- **Display & Hero (`Outfit`, 600–800):** Track-tight (`letter-spacing: -0.025em`), architectural scale, soft specular gradient (pure white blending into champagne). Never screaming or oversized. Headings declare `text-wrap: balance` to prevent orphan words (Audit Finding 16).
- **Body & Prose (`Plus Jakarta Sans`, 400–600):** Clear editorial weight, generous leading (`1.6`), max line-length 65ch for analysis prose. Prose blocks declare `text-wrap: pretty`.
- **Data & Citations (`JetBrains Mono`, 400–600):** Reserved for statutory citations, page numbers, policy clause IDs (`§4.2`), table indices, timestamps, and file sizes. Badges and counters mandate `font-variant-numeric: tabular-nums` (Audit Finding 10).
- **Typographic Craft & Punctuation (Audit Finding 9):**
  - Use curly quotes `&ldquo;`/`&rdquo;` (`“`/`”`) and `&lsquo;`/`&rsquo;` (`‘`/`’`), never straight typewriter quotes (`"` or `'`).
  - All loading and pending states must terminate with an ellipsis character `…` (`&hellip;`), never bare periods (`...`). (e.g., `Processing…`, `Analyzing…`, `Deleting…`).
  - File format and unit lists require non-breaking spaces (`&nbsp;`): e.g., `"Supports PDF,&nbsp;DOCX,&nbsp;TXT"`.
- **Banned Fonts:** `Inter` is banned for high-craft branding; generic serif fonts (`Times New Roman`, `Georgia`) are banned.

---

## 4. Component Stylings

### Hero Constellation (The Revolving Orbit)
- **Geometry:** A continuous 360° orbital trajectory encircling the hero title.
- **Guideline Ring (Audit Finding 7):** A delicate, semi-transparent hairline circular orbit track (`border: 1px dashed rgba(245, 230, 204, 0.14)`) grounding the orbital movement in physical space.
- **Orbital Nodes:** 8 floating geometric glass nodes (`backdrop-filter: blur(16px)`, `background: rgba(22, 22, 27, 0.65)`, `border: 1px solid rgba(245, 230, 204, 0.18)`).
- **Node Dimensions & CLS (Audit Finding 15):** Every SVG icon inside nodes explicitly declares `width="20" height="20"` to prevent Cumulative Layout Shift (CLS).
- **Node Hover:** Counter-rotates smoothly to stay upright, with subtle champagne luminance (`box-shadow: 0 0 16px rgba(245, 230, 204, 0.15)`).
- **Hero Title Micro-Interaction (Audit Finding 7):** The main display title ("Upload, Check, Apply") utilizes a hardware-accelerated linear gradient text fill with an 8–12s subtle infinite shimmer loop (`background-position` pass), providing continuous tactile life.

### Primary CTA Button ("Upload Document")
- **Shape:** Pill button (`border-radius: 40px`), padding `12px 24px`.
- **Finish:** Dual-layer champagne gradient (`linear-gradient(180deg, #f5e6cc, #d4ba88)`), dark text (`#09090b`), top inner hairline highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.4)`).
- **Tactile State:** `-2px` translate on hover with a warm burnished glow; `+1px` translate on `:active` with instant tactile feedback.
- **Accessibility:** Explicit `aria-label="Upload PDF Document"` and guaranteed minimum touch target area of at least 44×44px.

### Document Cards
- **Structure:** Elevated graphite fill (`#16161b`), 1px hairline border (`rgba(245, 230, 204, 0.18)`), `border-radius: 12px`.
- **Inner Depth:** Top inset hairline highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.05)`).
- **Card Differentiation & Monotony Breaking (Audit Finding 6):**
  - Top specular border illumination (`border-top: 1px solid rgba(245, 230, 204, 0.28)`).
  - Left-edge semantic status accent strip (`border-left: 3px solid var(--status-color)`) distinguishing Ready (`#4ade80`), Processing (`#facc15`), and Failed (`#f87171`) documents without creating visual clutter.
- **Hover Micro-motion:** Smooth `-3px` lift, top border illumination to `#d4ba88`, and soft ambient drop shadow (`0 14px 36px rgba(0, 0, 0, 0.6)`).
- **Waterfall Reveal (Audit Finding 11):** Document cards mount via a staggered cascade delay (`animation-delay: calc(var(--card-index) * 40ms)`) rather than jarring instant pop-in.
- **Button Hierarchy & Touch Targets (Audit Finding 3 & 4):**
  - *Primary:* "Check Policy" (champagne gold, high contrast).
  - *Secondary:* "Tables" and "Rename" (smoked glass with subtle border).
  - *Destructive:* "Delete" (muted crimson border and text).
  - *Touch Target Rule:* All interactive elements and compact action buttons guarantee at least 44×44px effective touch target area.
  - *A11y Labeling:* Explicit `aria-label` attributes on all icon-only and compact buttons (e.g., `aria-label="Rename document"`, `aria-label="Delete document"`).

### Liquid-Glass Modals
- **Backdrop:** Deep dark glass (`rgba(9, 9, 11, 0.85)` with `backdrop-filter: blur(20px)`).
- **Card:** `#131317` with subtle specular top border (`inset 0 1px 0 rgba(255,255,255,0.08)`).
- **Close Button:** 44×44px touch target, `:focus-visible` dual-ring outline, `aria-label="Close modal"`.
- **Modal Ergonomics & Focus Management (Audit Finding 5):**
  - ESC key dismisses active modal.
  - Clicking the backdrop dismisses modal.
  - Focus is automatically trapped within active modal dialog and restored to trigger on dismissal.
- **Query Input Ergonomics (Audit Finding 13):**
  - Textarea provides explicit `name="policy-question"`, `autocomplete="off"`, and `spellcheck="false"`.
  - Placeholder terminates with ellipsis: `"e.g., Is this policy applicable for individuals over 60 years old with pre-existing conditions?…"`.
- **Quick Inquiry Chips (Audit Finding 12):**
  - Rendered as accessible `<button type="button" class="prompt-chip">` elements (never bare `<span>` or `<div>`).
  - Full keyboard accessibility (Tab focusable, activatable via Enter and Space).
  - Single-click autopopulates question textarea and focuses input.
- **Analysis Results Area:**
  - Rich Markdown formatting with verified statutory quotations.
  - Dedicated results header bar with statutory findings indicator.
  - Copy-to-clipboard button (`#copyPolicyResult`) with immediate visual confirmation ("Copied!").

### Table Inspector Modal
- **Headers:** Sticky uppercase table headers (`font-size: 11px`, `letter-spacing: 0.06em`, `background: rgba(245, 230, 204, 0.08)`).
- **Zebra Striping:** Alternating subtle row fills (`rgba(255, 255, 255, 0.015)`).
- **Data Alignment:** Numbers and caps right-aligned in `JetBrains Mono` with `font-variant-numeric: tabular-nums`.
- **Document Title Balance (Audit Finding 16):** Document header declares `text-wrap: balance` to prevent awkward title wrapping.

### Empty States & Loading Skeletons
- **Composed Empty State (Audit Finding 14):**
  - When zero files are uploaded, display a bespoke architectural empty state rather than a plain placeholder.
  - Features a central SVG astrolabe/document icon, "Your Observatory is Empty" heading, muted parchment instructional guidance, and a direct "Upload Document" button.
  - Enclosed in a subtle champagne dashed border (`1px dashed rgba(245, 230, 204, 0.22)`).
- **Skeletal Shimmer Loaders (Audit Finding 17):**
  - Long-running async states (>300ms) replace generic circular spinners with layout-matching skeletal shimmer blocks.
  - Policy analysis result container renders a 3-tier skeleton block (Answer, Reasoning, Key Extracts).
  - Table inspector renders a skeleton header bar and 4 striped skeleton rows.
  - Sweep animation: smooth 1.8s hardware-accelerated gradient (`rgba(245, 230, 204, 0.03)` to `rgba(245, 230, 204, 0.09)`).

### Navigation Bar & Footer Integrity
- **Navigation Bar (Audit Finding 19):** Top navigation links strictly represent existing active capabilities (Repository / Home, Upload, Check Policy, Tables). Never render dead links to unreleased future roadmap features.
- **Simplified Footer (Audit Finding 18):** In alignment with Density 4/10 ("Gallery Balanced"), the footer is kept clean and uncluttered: a single subtle copyright line and academic attribution link row ("Policy Checker • Parul University • Group 7IEP_G46"). Aspirational hashes or dense cockpit text are avoided in the primary viewport.

---

## 5. Layout Principles

- **Centered Gravitational Hero:** The focal point is the revolving constellation and clear hero messaging. Avoid cluttered left-hand sidebars or fake enterprise multi-column widgets.
- **Contained Stream:** Maximum container width `1200px`, centered with generous `48px` lateral breathing room.
- **Card Grid:** Clean responsive auto-fit grid (`minmax(300px, 1fr)`) that naturally reflows across screens without awkward empty gaps.
- **Mobile First Collapse (< 768px):** Orbit scales down gracefully via `clamp()`; cards stack vertically; touch targets remain at least 44px.

---

## 6. Motion Philosophy & Accessibility

- **Perpetual Orbital Choreography:** The central 8-node orbit rotates continuously at 28 seconds per revolution with smooth hardware-accelerated transforms (`transform: rotate() translate()`).
- **Spring-Feel Hover States:** Smooth cubic-bezier transitions (`cubic-bezier(0.16, 1, 0.3, 1)`) for card lift, button press, and modal appearance.
- **Pulsing Telemetry:** Active processing badges utilize an infinite subtle radial pulse (`opacity: 0.4` to `1.0`) to communicate background AI ingestion without cognitive distraction.
- **Hero Text Shimmer:** Infinite gentle metallic gradient pass (10s alternate ease-in-out).
- **Reduced Motion Compliance (Audit Finding 8):** Full accessibility fallback disabling all perpetual loops and animations for users requesting reduced motion:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .orbit,
    .orbit-wrap,
    .badge-pulse,
    .hero-shimmer,
    .skeleton-shimmer,
    .file-card {
      animation: none !important;
      transition: none !important;
      transform: none !important;
    }
  }
  ```

---

## 7. Anti-Patterns (Strictly Banned)

1. **NO Emojis anywhere** in UI, text, code, or documentation. Use precision SVG vector icons only.
2. **NO Generic 3-Column AI Dashboards:** Do not clutter the interface with fake telemetry charts, B2B sidebars, or mock activity feeds.
3. **NO AI Purple / Cyan Neon:** Never use saturated blues, violet glows, or sci-fi cybernetic gradients.
4. **NO Pure Black (`#000000`):** Use deep obsidian (`#09090b`) for nuanced depth.
5. **NO Generic Typography:** No unstyled browser defaults; display headers use `Outfit`, body uses `Plus Jakarta Sans`, data uses `JetBrains Mono`.
6. **NO AI Copywriting Clichés:** Ban words like "Next-Gen", "Elevate", "Unleash", "Seamless AI Synergy". Use direct, grounded language ("Upload. Ask. Understand.").
7. **NO Overlapping Content:** Ensure clean spatial boundaries between text, orbital nodes, and interactive buttons.
8. **NO Generic Circular Spinners in Primary Views (Audit Finding 17):** Use layout-matching skeletal shimmer loaders for content areas.
9. **NO Dead Navigation Links (Audit Finding 19):** Top navigation must never display unreleased or mocked roadmap destinations.
10. **NO Straight Quotes or Plain Period Ellipses (Audit Finding 9):** Enforce curly quotes and true ellipsis `…` character across all copy.

---

## 8. Audit Compliance Matrix

| # | Finding & Guideline | Source Rule | DESIGN.md Section & Implementation | Status |
|---|---|---|---|---|
| **1** | Centered Hero Layout Rationale | `/stitch-design-taste` §4 | §1 Visual Theme: Documented as deliberate signature exception | Addressed |
| **2** | Card Metadata Contrast | `/ui-ux-pro-max` §1 | §2 Color Palette: Bumped Subtle Dust to `#a8a090` (6.2:1 contrast) | Addressed |
| **3** | 44×44px Touch Targets | `/ui-ux-pro-max` §2 | §4 Component Stylings: Min touch target on all action buttons | Addressed |
| **4** | Missing `aria-label` Attributes | `/web-design-guidelines` A11y | §4 Component Stylings: Explicit `aria-label` on all icon/compact buttons | Addressed |
| **5** | Modal Escape & Focus Trapping | `/web-design-guidelines` Forms | §4 Modals: ESC key, backdrop click, focus trap spec | Addressed |
| **6** | 3-Equal-Card Monotony Breaking | `/stitch-design-taste` §6 | §4 Cards: Left-edge status accent strips & specular hairline | Addressed |
| **7** | Perpetual Hero Micro-Interaction | `/stitch-design-taste` §8 | §4 Hero Constellation: Ethereal dashed ring & 10s hero title shimmer | Addressed |
| **8** | `prefers-reduced-motion` | `/ui-ux-pro-max` §7 | §6 Motion Philosophy: Complete reduced motion media query spec | Addressed |
| **9** | Curly Quotes & `…` Ellipsis | `/web-design-guidelines` Typo | §3 Typography: Enforced `&ldquo;`/`&rdquo;`, `…` on loading states | Addressed |
| **10** | `tabular-nums` on Numeric Data | `/ui-ux-pro-max` §6 | §3 Typography: `font-variant-numeric: tabular-nums` on badges/data | Addressed |
| **11** | Staggered Waterfall Entrance | `/stitch-design-taste` §8 | §4 Cards: `animation-delay: calc(var(--card-index) * 40ms)` spec | Addressed |
| **12** | Semantic `<button>` Prompt Chips | `/ui-ux-pro-max` §8 | §4 Modals: `<button type="button" class="prompt-chip">` spec | Addressed |
| **13** | Input Form Attributes | `/web-design-guidelines` Forms | §4 Modals: `autocomplete="off"`, `name`, placeholder with `…` | Addressed |
| **14** | Composed Empty State | `/stitch-design-taste` §5 | §4 Empty States: Architectural illustration & centered upload CTA | Addressed |
| **15** | Explicit Asset Dimensions (CLS) | `/ui-ux-pro-max` §3 | §4 Hero Constellation: Explicit `width="20" height="20"` on SVG glyphs | Addressed |
| **16** | Headings `text-wrap: balance` | `/web-design-guidelines` Typo | §3 & §4 Headings: `text-wrap: balance` on titles | Addressed |
| **17** | Skeletal Shimmer Loaders | `/stitch-design-taste` §5 | §4 Skeletons: 3-tier analysis skeleton & table row shimmer | Addressed |
| **18** | Simplified Density 4/10 Footer | `/stitch-design-taste` §1 | §4 Navigation & Footer: Clean copyright & academic attribution | Addressed |
| **19** | Active Capabilities Navigation | `/ui-ux-pro-max` §9 | §4 Navigation: Only render links to active, working features | Addressed |
