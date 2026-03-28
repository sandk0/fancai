# Design Critique — fancai

**Date:** 2026-03-23
**Perspective:** Design Director review
**Scope:** Full application — pages, reader, entity system, auth flows

---

## Anti-Patterns Verdict

**Verdict: MIXED — not outright slop, but AI fingerprints visible**

Core product (Reader + Entity System) looks **human-designed** — thoughtful gestures, spoiler system, immersive reading flow. But landing/marketing pages and 404 — **template AI output**.

| AI Tell                                    | Where                                                                     | Severity                       |
| ------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------ |
| Gradient text on headings                  | `GuestHero.tsx:43` (amber→orange), `NotFoundPage.tsx:57` (primary→purple) | **High**                       |
| Icon-in-rounded-box + heading + text cards | `GuestHero.tsx:127-146` — 3 identical feature cards                       | **High**                       |
| Inter as UI font                           | `globals.css:64` — most "AI-default" font of 2024-2025                    | **Medium**                     |
| Centered-everything layout                 | Login, Register, 404, GuestHero — all centered                            | **Medium**                     |
| Hardcoded rainbow link colors              | `NotFoundPage.tsx:28-43` — blue/purple/green for quickLinks               | **Medium**                     |
| `hover:scale-105` on cards                 | `NotFoundPage.tsx:99` — typical AI hover effect                           | **Low**                        |
| backdrop-blur on 35 files                  | Pervasive glassmorphism                                                   | **Low** (justified by context) |
| `shadow-lg shadow-primary/30` glow         | `GuestHero.tsx:69` — CTA with colored shadow                              | **Low**                        |

**Application core (Reader + Entities) — PASS.** Marketing layer — FAIL.

---

## Overall Impression

**Gut reaction:** This is an app with excellent _engineering_ design and mediocre _visual_ design at the landing level. The reader is immersive, gestures are thoughtful, the spoiler system is elegant. But step outside the reader — and you see standard Tailwind UI + Inter + gradients.

**The single biggest opportunity:** The app tries to be _two things at once_: a utilitarian reading tool (where it succeeds) and a beautiful product showcase (where it's generic). Need to decide: either book-service minimalism (Kindle-like) or editorial identity (Literal.club, Bookshop.org). Currently — neither.

---

## What's Working

### 1. Immersive Reader UX

The Reader is best-in-class for a web reader. Auto-hide chrome, gesture navigation, haptic feedback, spring-physics animations, follow-finger page turns. Controls _disappear_ when reading and _appear_ when needed. This is a designer's decision, not an engineer's — and it shows.

### 2. Spoiler System

CFI-based progressive revelation — **unique design idea**. Unrevealed characters are visible but blurred, with "?" badge. This isn't "just blocking" — the user _knows_ characters exist ahead, creating anticipation. Brilliant.

### 3. Theme System Depth

5 full themes (not just light/dark) with semantic tokens, entity-specific colors, relationship colors. CSS variables threaded through the entire system. This allows each theme to feel _cohesive_, not just "inverted".

---

## Priority Issues

### P1. Landing/Marketing Pages — AI Template Aesthetic

**What:** GuestHero + GuestFeatures + NotFoundPage — template AI output from 2024-2025. Gradient text, centered layout, 3 identical feature cards with icon-in-circle, rainbow hardcoded link colors, `hover:scale-105`.

**Why it matters:** First impression. A new user sees GuestHero _before_ they see the Reader. If the landing looks like "yet another AI project" — registration conversion suffers. Especially for a book-lover audience that values _craft_.

**Fix:**

- Remove gradient text → solid color with accent font weight
- Remove icon-in-rounded-box → inline icons or unique composition
- Replace 3 identical cards → asymmetric layout (one large, two small, or timeline/steps instead of grid)
- Add personality: show a real reader screenshot instead of abstract features
- NotFoundPage: replace rainbow colors → semantic tokens, remove gradient 404 text

**Command:** `/bolder` for GuestHero, `/arrange` for layout, `/typeset` for typography

---

### P2. Inter Font — Generic Identity

**What:** `--font-sans: 'Inter'` as the only UI font. Inter is a workhorse, but for a reading app with Crimson Text as serif — it's a mismatch. Inter is neutral and corporate. Crimson Text is editorial and bookish. Between them — a design gap.

**Why it matters:** Typography is 90% of identity for a reading app. The user looks at text all day. The font determines whether the app feels like a "tool" or an "experience". Inter = tool. For an "AI book encyclopedia" feature, something with more character is needed.

**Fix:**

- For UI (buttons, labels, navigation): **Outfit** or **Plus Jakarta Sans** (humanist, friendlier than Inter, excellent Cyrillic)
- For feature text (descriptions, entity profiles): already have Crimson Text — use more actively
- For headings on marketing pages: consider **Playfair Display** or **Golos Text** for Russian-language character
- Create type pairing guide: display + body + UI

**Command:** `/typeset`

---

### P3. Entity System — Flat Visual Hierarchy

**What:** EntityList displays all entities equally. Main character with importance=10 is visually identical to a random object with importance=1. Type is distinguished only by a small colored border-left (2px) and icon. Relationships use the same ❤️ for 4 different types.

**Why it matters:** The entity system is the **main feature** of the application. If all characters look the same, the user doesn't get insight into the _structure_ of the book's world. For an encyclopedia, importance hierarchy is core UX. Without it — it's just an alphabetical list.

**Fix:**

- Surface importance: main characters (importance > 7) — larger avatars, bold names, star/badge
- Relationship icons: unique icon per type (❤️ romance, 🤝 ally, ⚔️ enemy, 🎓 mentor/student, 👪 kinship, 🏴 rival)
- Type-based visual weight: characters — full-color avatar, locations — map-like card, objects — outlined/minimal
- EntityList: group by importance or by type (with collapsible sections)

**Command:** `/colorize` + `/arrange`

---

### P4. SelectionMenu + HighlightTooltip — Missing Animation Polish

**What:** SelectionMenu appears _instantly_ (no fade/scale). HighlightTooltip too. Meanwhile Header/Footer use spring physics, modals use scale+fade. Inconsistency in feel.

**Why it matters:** Selection and highlighting are the _most frequent_ interaction after page swipe. Every time a user selects text or taps a highlight — they see "raw" appearance. This undermines the polished feel created by Reader chrome.

**Fix:**

- SelectionMenu: `initial={{ opacity: 0, scale: 0.95, y: 4 }}` → `animate={{ opacity: 1, scale: 1, y: 0 }}`, duration 0.15s
- HighlightTooltip: similar, but without scale (just fade)
- Unify easing: all popups/tooltips — `ease-out` 150ms
- Delete confirmation: add long-press or confirm dialog (prevent accidental deletion)

**Command:** `/animate`

---

### P5. Centered-Everything Disease

**What:** LoginPage, RegisterPage, GuestHero, NotFoundPage, empty states — all center-aligned. This creates monotony. When _every_ page is centered — nothing feels designed, everything feels "default".

**Why it matters:** Asymmetry creates visual interest and hierarchy. Centering works for _one_ element (modal, dialog). For entire pages — it's laziness. Frontend-design skill explicitly says: "DON'T: Center everything—left-aligned text with asymmetric layouts feels more designed."

**Fix:**

- LoginPage: split-screen layout (illustration left, form right) or left-aligned form with right-side decoration
- NotFoundPage: left-aligned 404 with right-side book illustration
- Empty states: left-aligned text with right-side illustration/icon
- GuestHero: hero image/screenshot right, text block left (classic editorial split)

**Command:** `/arrange`

---

## Minor Observations

1. **BookCard hover overlay** mixes frosted glass (`bg-white/20`) and solid buttons (`bg-primary`, `bg-destructive`) — need unified style
2. **Progress indicators** — 3 different patterns (linear bar, circular SVG, percentage badge). Choose 2 max.
3. **TocSidebar mobile snap points** [0.5, 0.95] — 50% is too much for "quick peek". Better [0.3, 0.85]
4. **EntityBottomSheet snap points** [0.3, 0.6] — 30% is ~200px, enough for peek with avatar+name+button, but may be cramped on Pixel-sized screens
5. **Section headings inconsistency** — `fluid-h2`, `text-lg font-semibold`, `text-xl font-semibold` for the same hierarchy level on different pages
6. **RecapPanel** (recap "Previously in the book") — written but unused in UI. Potentially the best retention feature — show when returning to reading
7. **Bookmark delete** — no confirmation. One tap and highlight is deleted. Dangerous on touch devices.
8. **Entity "?" badge** for spoiler-locked — too subtle. Lock icon or labeled badge ("Spoiler") would be clearer
9. **Color picker in SelectionMenu** — background and text color pickers are visually identical. Need labels.

---

## Questions to Consider

> **"What if the landing page showed the real reader in action instead of abstract feature cards?"**
> Video or interactive reader preview with entity popups — more convincing sales pitch than 3 icons with descriptions.

> **"Does the 404 page need this much content?"**
> Search box + 3 quick links + CTA button + help text. More content than the login page. For 404, sufficient: message + one "Go home" button.

> **"What if the entity system visually looked like a real book encyclopedia?"**
> Serif typography, parchment-like backgrounds, marginalia-style notes. Currently — generic card UI. For "interactive book glossary" you can create an editorial feel.

> **"Why backdrop-blur on Header and BottomNav?"**
> These elements are _always_ above content. Blur is needed when you can see something useful _through_ the element. Header and BottomNav aren't transparent windows, they're navigation chrome. Blur here is decoration, not function.

> **"What if RecapPanel ('Previously in the book') showed when returning to reading after >24h?"**
> User returns to a book after a week — and sees a carousel of key characters at the current point. This is a killer retention feature.

---

## Key Insight

fancai has _two design languages_. Reader/Entity system speaks the language of thoughtful craft — spring physics, immersive gestures, spoiler-progressive reveal. Marketing/auth pages speak the language of AI-generated template — gradient text, centered everything, Inter + card grid. The task is to bring the second language to the level of the first. The Reader already proves the team _can_ design. Now extend that level across the entire product.

---

## Priority Actions

| #   | Issue                                           | Command                  | Impact                       |
| --- | ----------------------------------------------- | ------------------------ | ---------------------------- |
| P1  | Redesign GuestHero + NotFound — remove AI tells | `/bolder` + `/arrange`   | **High** — first impression  |
| P2  | Replace Inter → character font                  | `/typeset`               | **High** — brand identity    |
| P3  | Entity visual hierarchy by importance           | `/colorize` + `/arrange` | **High** — core feature      |
| P4  | Animate SelectionMenu + HighlightTooltip        | `/animate`               | **Medium** — polish          |
| P5  | Break centered-everything layout                | `/arrange`               | **Medium** — design maturity |
