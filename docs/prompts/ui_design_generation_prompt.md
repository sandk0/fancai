# Промпт для Генерации UI Дизайна (Entity Cards System)

Ниже приведены подробные описания (промпты) для генерации макетов интерфейса с помощью нейросетей (Midjourney, DALL-E 3, Stable Diffusion) или для постановки задачи UI-дизайнеру.

---

## Общий Стиль (Global Style Guidelines)
**Context:** Modern Mobile Reading App (iOS/Android).
**Aesthetic:** Premium Dark Mode, Glassmorphism, Clean Typography (Serif for Content, Sans-Serif for UI).
**Color Palette:** Deep Slate Background (#0F172A), Vivid Accent Colors (derived from book cover), White Text with varying opacity.
**Key Elements:** Soft shadows, frosted glass blur, smooth rounded corners (Apple Human Interface Guidelines).

---

## Сцена 1: In-Reader Contextual View (Контекстная Шторка)
Этот экран показывает, как выглядит карточка персонажа, открытая прямо поверх текста книги.

**Prompt:**
> Professional UI design of a mobile ebook reader app screen. Dark mode. The background shows blurred text of a fantasy novel. In the foreground, a modern semi-transparent bottom sheet (drawer) rises from the bottom, covering 40% of the screen.
>
> **Bottom Sheet Content:**
> *   **Header:** A high-quality circular avatar of a fantasy warrior (Geralt-like) on the left. Next to it, the name "Geralt of Rivia" in elegant Serif font.
> *   **Snapshot Text:** Below the name, a short 2-line description: "A witcher, searching for his destiny."
> *   **Spoiler Protection:** A third line of text is dynamically blurred out (Gaussian blur effect) to hide future spoilers.
> *   **Action:** A sleek "Open Full Profile" button with a chevron icon on the right.
> *   **Style:** Frosted glass effect (background blur) on the sheet, white text, premium minimal icons. High resolution, Dribbble trending style.

---

## Сцена 2: Full Entity Profile (Полное Досье)
Экран полного профиля персонажа с защитой от спойлеров.

**Prompt:**
> Mobile app UI design, full screen "Character Profile" page. Dark thematic background.
>
> **Header (Hero Section):**
> *   Top half is a cinematic portrait of a fantasy sorceress.
> *   The image has a subtle "frost" overlay at the bottom where the text begins.
>
> **Content (Scrollable Area):**
> *   **Bio Section:** A block of text titled "Biography". The first paragraph is clear white text. The second paragraph is heavily redacted looks like a CIA classified document with black bars covering the text lines (Redacted style), symbolizing locked spoiler information.
> *   **Relationships:** A horizontal scroll list of circular avatars (other characters). One avatar is fully visible, another is a dark silhouette with a "locked" padlock icon overlay.
> *   **Visuals:** Elegant typography, glowing accent lines, "Locked" badge in gold color on the redacted section. UX UI, Figma, 4k.

---

## Сцена 3: Entity Gallery (Каст Книги)
Сетка всех персонажей книги, демонстрирующая состояние "Открыт" и "Неизвестен".

**Prompt:**
> Mobile app UI grid layout representing a "Cast of Characters" gallery. Dark mode.
>
> **The Grid:**
> *   **Card 1 (Unlocked):** A fully visible card with a colorful portrait of a Bard, name "Jaskier" below it. High detail.
> *   **Card 2 (Locked/Unknown):** A card showing a mysterious dark silhouette of a knight against a glowing rim light background. No facial details. The name shows "???" or "Unknown Knight".
> *   **Card 3 (Dead/Spoiler):** A character portrait that is desaturated (black and white) with a subtle "Skull" icon or "Deceased" label in red, indicating a plot event.
>
> **UI Elements:**
> *   Floating filter chips at the top: "All", "Met", "Locations".
> *   Modern, clean aesthetics, slight inner glow on the locked cards to make them look intriguing, not just empty. Gamified collection interface.

---

## Инструкция по использованию
1.  Скопируйте английский текст промпта.
2.  Вставьте в инструмент генерации (Midjourney v6 is recommended).
3.  Для вариативности добавляйте: `--ar 9:16` (для мобильных пропорций).
