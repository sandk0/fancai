---
phase: 12-viewport-ios
verified: 2026-03-09T14:10:00Z
status: human_needed
score: 7/8 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 6/8
  gaps_closed:
    - "CSS-переменная --keyboard-height обновляется в реальном времени при показе/скрытии клавиатуры"
    - "ProgressIndicator учитывает высоту клавиатуры и safe area bottom"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Проверить SearchPanel при скрытом header (immersive mode) на iPhone"
    expected: "SearchPanel позиционирован прямо под notch, без зазора 70px"
    why_human: "Визуальное позиционирование, зависит от реального устройства с notch"
  - test: "Проверить standalone подсказку при первом открытии книги в PWA mode"
    expected: "Подсказка 'тапните по центру для меню' появляется через 1.5с, исчезает через 4с или по тапу"
    why_human: "Требует добавление на Home Screen на реальном iOS устройстве"
  - test: "Проверить поведение клавиатуры на iOS"
    expected: "ProgressIndicator поднимается при появлении клавиатуры"
    why_human: "VisualViewport API для клавиатуры работает только на реальном iOS Safari"
  - test: "Все функции ридера работают в standalone mode"
    expected: "Навигация, поиск, настройки, entity drawer доступны и функциональны"
    why_human: "Требует полный end-to-end проход на реальном iOS устройстве в PWA standalone"
---

# Phase 12: Viewport и iOS -- Verification Report

**Phase Goal:** Ридер корректно отображается на всех мобильных устройствах с учетом safe areas, клавиатуры и особенностей PWA standalone mode
**Verified:** 2026-03-09T14:10:00Z
**Status:** human_needed
**Re-verification:** Yes -- after gap closure (commit 050db72)

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                       | Status      | Evidence                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | useVisualViewportHandler корректно отслеживает появление/скрытие iOS клавиатуры и возвращает keyboardHeight | VERIFIED    | Хук создан (89 строк), 6 тестов (183 строки), порог 150px, VisualViewport API resize/scroll listeners                                       |
| 2   | CSS-переменная --keyboard-height обновляется в реальном времени при показе/скрытии клавиатуры               | VERIFIED    | Хук импортирован (EpubReader.tsx:33) и вызван (строка 84). setProperty('--keyboard-height') в строке 65 хука. Commit 050db72 исправил gap. |
| 3   | SearchPanel позиционируется правильно и при видимом header, и при скрытом (immersive mode)                  | VERIFIED    | isHeaderVisible prop (строка 14), тернарный top (строки 129-131), prop передан из EpubReader (строка 651)                                   |
| 4   | ProgressIndicator учитывает высоту клавиатуры и safe area bottom                                            | VERIFIED    | var(--keyboard-height, 0px) в bottom calc (строка 39) + transition 0.15s (строка 40). Хук теперь подключен -- переменная обновляется.       |
| 5   | IOSTapZones не дублирует safe area padding с epub-viewer                                                    | VERIFIED    | IOSTapZones не рендерится -- gesture controller полностью заменил его (EpubReader:302, нет JSX-использования)                                |
| 6   | В PWA standalone mode центральный тап показывает header с кнопкой 'назад'                                   | VERIFIED    | autoHide.toggleUI -> gesture controller onToggleUI (строка 321), header содержит onBack (строка 606)                                        |
| 7   | В standalone mode при первом открытии книги показывается визуальная подсказка о центральном тапе            | VERIFIED    | useAutoHideUI: isStandalone() + localStorage persistence (строки 49-56), EpubReader: AnimatePresence overlay (строки 655-673)               |
| 8   | Все функции ридера (навигация, поиск, настройки, entity drawer) работают в standalone mode                  | NEEDS HUMAN | Кодовая база не ограничивает функциональность по standalone mode; isStandalone() используется только для подсказки. Требует e2e-проверку.   |

**Score:** 7/8 truths verified (1 needs human verification)

### Required Artifacts

| Artifact                                                               | Expected                                           | Status   | Details                                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `frontend/src/hooks/shared/useVisualViewportHandler.ts`                | Хук отслеживания виртуальной клавиатуры iOS        | VERIFIED | 89 строк, exports ViewportState + useVisualViewportHandler, импортирован и вызван в EpubReader.tsx:84  |
| `frontend/src/hooks/shared/__tests__/useVisualViewportHandler.test.ts` | Тесты для useVisualViewportHandler                 | VERIFIED | 183 строки, 6 тестов                                                                                   |
| `frontend/src/styles/globals.css`                                      | CSS-переменная --keyboard-height в :root           | VERIFIED | Строка 243: `--keyboard-height: 0px;` в :root                                                          |
| `frontend/src/hooks/reader/useAutoHideUI.ts`                           | Standalone-aware auto-hide с onboarding подсказкой | VERIFIED | 110 строк, showStandaloneHint + dismissStandaloneHint + localStorage                                   |
| `frontend/src/components/Reader/EpubReader.tsx`                        | Standalone подсказка + useVisualViewportHandler     | VERIFIED | AnimatePresence overlay строки 655-673, useVisualViewportHandler вызван строка 84                       |
| `frontend/src/components/Reader/SearchPanel.tsx`                       | Динамический top (isHeaderVisible prop)            | VERIFIED | isHeaderVisible prop строка 14, динамический top строки 129-131                                        |
| `frontend/src/components/Reader/ProgressIndicator.tsx`                 | bottom с --keyboard-height + transition            | VERIFIED | bottom calc строка 39, transition строка 40                                                             |

### Key Link Verification

| From                        | To                             | Via                              | Status | Details                                                   |
| --------------------------- | ------------------------------ | -------------------------------- | ------ | --------------------------------------------------------- |
| useVisualViewportHandler.ts | document.documentElement.style | setProperty('--keyboard-height') | WIRED  | Строка 65: `setProperty('--keyboard-height', ...)`        |
| useVisualViewportHandler.ts | EpubReader.tsx                 | import + вызов хука              | WIRED  | Строка 33: import, строка 84: `useVisualViewportHandler()` -- **gap закрыт commit 050db72** |
| SearchPanel.tsx              | isHeaderVisible prop           | Динамический top                 | WIRED  | Строка 129: тернарный оператор на isHeaderVisible         |
| ProgressIndicator.tsx        | --keyboard-height CSS variable | bottom offset                    | WIRED  | Строка 39: `var(--keyboard-height, 0px)` в calc()         |
| EpubReader.tsx               | SearchPanel                    | isHeaderVisible prop             | WIRED  | Строка 651: `isHeaderVisible={autoHide.isHeaderVisible}`  |
| useAutoHideUI.ts             | isStandalone()                 | import из iosSupport.ts          | WIRED  | Строка 2: import, строка 50: вызов                        |
| EpubReader.tsx               | useAutoHideUI                  | showStandaloneHint/dismissHint   | WIRED  | Строки 274, 284, 664: используются оба метода             |

### Requirements Coverage

| Requirement | Source Plan | Description                                                  | Status    | Evidence                                                                                                                                                     |
| ----------- | ---------- | ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VPT-01      | 12-01      | Корректный viewport на iOS (100dvh, env(safe-area-inset-\*)) | SATISFIED | safe area insets в SearchPanel (строки 129-131), ProgressIndicator (строка 39), epub-viewer (EpubReader строки 556-559); --keyboard-height в globals.css      |
| VPT-02      | 12-01      | Клавиатура не сдвигает контент (VisualViewport API)          | SATISFIED | useVisualViewportHandler создан и подключен (EpubReader:84), CSS-переменная обновляется, ProgressIndicator реагирует через var(--keyboard-height). Commit 050db72 исправил подключение хука. |
| VPT-03      | 12-02      | PWA standalone mode работает корректно                       | SATISFIED | isStandalone() + standalone подсказка + center-tap toggle UI + header back button                                                                             |

### Anti-Patterns Found

| File | Line | Pattern                   | Severity | Impact |
| ---- | ---- | ------------------------- | -------- | ------ |
| --   | --   | Нет anti-patterns найдено | --       | --     |

Все файлы чисты: нет TODO, FIXME, PLACEHOLDER, пустых реализаций, console.log-only handlers.

### Human Verification Required

### 1. SearchPanel позиционирование в immersive mode

**Test:** Открыть книгу на iPhone, скрыть header (immersive mode), открыть поиск
**Expected:** SearchPanel расположен прямо под notch/Dynamic Island, без лишнего зазора 70px сверху
**Why human:** Визуальное позиционирование с env(safe-area-inset-top) на реальном устройстве с notch

### 2. Standalone подсказка при первом открытии

**Test:** Добавить приложение на Home Screen (PWA), открыть книгу впервые
**Expected:** Через 1.5с появляется подсказка "тапните по центру для меню", исчезает через 4с или по тапу, не появляется при повторном открытии
**Why human:** Требует PWA standalone mode на реальном iOS устройстве

### 3. Клавиатура и ProgressIndicator

**Test:** Открыть поиск в книге, начать набирать текст -- проверить ProgressIndicator
**Expected:** ProgressIndicator поднимается над клавиатурой при её появлении
**Why human:** VisualViewport API для клавиатуры работает только на реальном iOS Safari

### 4. Полнота функций в standalone mode

**Test:** В PWA standalone mode протестировать навигацию, поиск, настройки, entity drawer
**Expected:** Все функции доступны и работают как в обычном браузере
**Why human:** Требует полный end-to-end проход на реальном iOS устройстве

### Gap Closure Summary

Предыдущая верификация (2026-03-09T12:35:00Z) выявила одну root cause проблему: `useVisualViewportHandler` был создан и протестирован (89 строк, 6 тестов), но не импортирован и не вызван ни в одном компоненте. CSS-переменная `--keyboard-height` оставалась 0px.

**Commit 050db72** (`fix(12-01): connect useVisualViewportHandler in EpubReader`) добавил:
- Строка 33: `import { useVisualViewportHandler } from '@/hooks/shared/useVisualViewportHandler';`
- Строка 84: `useVisualViewportHandler();`

Оба gap-а закрыты. Хук теперь активен при рендере EpubReader и обновляет CSS-переменную `--keyboard-height` через side-effect. ProgressIndicator автоматически реагирует через `var(--keyboard-height, 0px)` в bottom calc.

Регрессий не обнаружено -- все 6 ранее прошедших truth-ов по-прежнему VERIFIED.

---

_Verified: 2026-03-09T14:10:00Z_
_Verifier: Claude (gsd-verifier)_
