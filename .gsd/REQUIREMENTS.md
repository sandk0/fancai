# Requirements

## Active

### CLN-01 — Удалён dead code: useTouchNavigation.ts, IOSTapZones.tsx, useFollowFingerSwipe.ts (~38KB)

- Status: active
- Class: core-capability
- Source: inferred
- Primary Slice: none yet
- Note: Файлы были реинтегрированы в gesture controller (M002/v1.1). useFollowFingerSwipe используется в useGestureController. Требование требует пересмотра — возможно перевод в out_of_scope.

Удалён dead code: useTouchNavigation.ts, IOSTapZones.tsx, useFollowFingerSwipe.ts (~38KB)

## Validated

### NAV-01 — Свайпы перелистывают страницу плавно без дублирования анимации (двухфазная: animate -> navigate -> reset)

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Свайпы перелистывают страницу плавно без дублирования анимации (двухфазная: animate -> navigate -> reset)

### NAV-02 — Свайп-анимация работает как Apple Books slide -- 60fps, spring с микро-bounce, follow-finger tracking

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Свайп-анимация работает как Apple Books slide -- 60fps, spring с микро-bounce, follow-finger tracking

### NAV-03 — Пользователь может свайпом перейти к следующей/предыдущей главе на границах текущей главы

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Пользователь может свайпом перейти к следующей/предыдущей главе на границах текущей главы

### NAV-04 — Тапы по боковым зонам перелистывают страницу мгновенно (instant scroll) без дёрганой анимации

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Тапы по боковым зонам перелистывают страницу мгновенно (instant scroll) без дёрганой анимации

### HDR-01 — Шапка ридера помещается на экран от 320px (iPhone SE) -- overflow menu для второстепенных кнопок

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Шапка ридера помещается на экран от 320px (iPhone SE) -- overflow menu для второстепенных кнопок

### HDR-02 — Поле поиска и кнопка закрытия полностью видны на любом экране, крестик не обрезается

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Поле поиска и кнопка закрытия полностью видны на любом экране, крестик не обрезается

### PNL-01 — Панели настроек, оглавления и заметок отображают всё содержимое (Vaul snap points, полная высота)

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Панели настроек, оглавления и заметок отображают всё содержимое (Vaul snap points, полная высота)

### PNL-02 — Клавиатура не открывается автоматически при открытии оглавления

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Клавиатура не открывается автоматически при открытии оглавления

### SEL-01 — Пользователь может выделить текст long-press и drag без перехвата gesture controller

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Пользователь может выделить текст long-press и drag без перехвата gesture controller

### SEL-02 — Пользователь может создать заметку/выделение из выделенного текста

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Пользователь может создать заметку/выделение из выделенного текста

### ENT-01 — Popup описания показывает кнопку генерации изображения и полное содержимое

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Popup описания показывает кнопку генерации изображения и полное содержимое

### ENT-02 — Тапы на выделенные описания и сущности у краёв экрана не перехватываются навигацией

- Status: validated
- Class: core-capability
- Source: inferred
- Primary Slice: none yet

Тапы на выделенные описания и сущности у краёв экрана не перехватываются навигацией

## Deferred

## Out of Scope
