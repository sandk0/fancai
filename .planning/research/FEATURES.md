# Feature Research: Mobile/PWA Reader (v1.1)

**Domain:** Мобильный EPUB-ридер / PWA
**Researched:** 2026-03-09
**Confidence:** MEDIUM-HIGH

## Текущее состояние кодовой базы

Уже реализовано в v1.0:
- Свайп-навигация (`useSwipeNavigation.ts`, 507 строк) -- пороговая, не follow-finger
- Тап-навигация (`useTouchNavigation.ts`, 535 строк) -- зоны 25%/50%/25%
- iOS-специфичные тап-зоны (`IOSTapZones.tsx`, 440 строк) -- оверлей поверх iframe
- Визуальный оверлей свайпа (`SwipeOverlay.tsx`) -- индикаторы + Motion
- Service Worker (`sw.ts`, 878 строк) -- Workbox injectManifest, полный стек кэширования
- PWA манифест (`manifest.json`) -- standalone, file_handlers, share_target
- iOS-утилиты (`iosSupport.ts`, 486 строк) -- детекция, install prompt, background sync fallback
- IndexedDB кэширование глав (`chapterCache.ts`) -- offline-first
- Background Sync (`criticalSyncPlugin`) -- очереди для прогресса и сессий
- Safe area insets -- применяются в `EpubReader.tsx` через `env()`
- Wake Lock API -- `useWakeLock` хук
- Темы чтения -- light/dark/sepia/night/outdoor
- Настройки шрифта/размера -- Zustand persist

## Feature Landscape

### Table Stakes (Пользователь ожидает это)

Фичи, без которых мобильный ридер ощущается как сломанный.

| Feature | Почему ожидается | Сложность | Зависимости в коде | Заметки |
|---------|-----------------|-----------|-------------------|---------|
| **Плавные свайпы (follow-finger)** | Все нативные ридеры (Apple Books, Google Play Books, Moon+, ReadEra) имеют перелистывание, следующее за пальцем. Текущие "пороговые" свайпы ощущаются дёргаными и устаревшими. | HIGH | `useSwipeNavigation.ts`, `SwipeOverlay.tsx`, epub.js `rendition.manager` | epub.js рендерит в iframe -- нужно двигать весь iframe или CSS transform на контейнере. Основная сложность: предрендер следующей/предыдущей страницы для визуального feedback пока палец движется. Readium Web НЕ решил эту задачу для reflowable EPUB. |
| **Фикс быстрого пролистывания** | Баг: быстрые свайпы подряд ломают навигацию (isNavigatingRef блокируется, epub.js display() не успевает). Пользователи интуитивно листают быстро. | MEDIUM | `useSwipeNavigation.ts`, `IOSTapZones.tsx`, `useEpubNavigation` | Нужна очередь навигации или debounce с гарантией выполнения последнего запроса. Не отбрасывать -- откладывать. |
| **Стабильные тап-зоны** | Текущие 25%/50%/25% зоны работают, но 8% на iOS (IOSTapZones) -- слишком узко. Пользователь промахивается мимо зоны навигации. | LOW | `useTouchNavigation.ts`, `IOSTapZones.tsx` | Сделать зоны настраиваемыми в настройках (15-30%). Конкурентные ридеры дают выбор: 3-zone, 5-zone, или edge-only. |
| **Адаптивный мобильный UI** | Шапка/футер ридера должны правильно скрываться, кнопки достаточно крупные для пальца (44x44pt iOS, 48x48dp Android). Текущий UI не оптимизирован под мобильные. | MEDIUM | `ReaderUI.tsx`, `ReaderOverlays.tsx`, все компоненты header/settings | Минимальный размер тап-таргета 44px. Автоскрытие UI при чтении. Жест тапа по центру для показа/скрытия. |
| **Корректные safe area insets** | Уже частично реализованы, но `safe-area-inset-bottom` не обновляется при появлении клавиатуры на iOS. Контент обрезается или перекрывается. | LOW | `EpubReader.tsx`, CSS `env()` | Использовать `keyboard-inset-*` CSS environment variables там, где актуально (поиск, заметки). Тестировать на iPhone с нотчем/Dynamic Island. |
| **Анимация перехода между страницами (slide)** | Базовый slide-анимация (не curl) при перелистывании -- стандарт в Apple Books (Fast Fade), Google Play Books, Kindle. Без неё ощущение мгновенной "телепортации". | MEDIUM | `useSwipeNavigation.ts`, `SwipeOverlay.tsx`, CSS transitions | CSS transform + transition на контейнере epub.js. Slide -- самый простой и универсальный эффект. Fade тоже приемлем. |
| **Offline чтение загруженных книг** | Книга уже загружена в IndexedDB (chapterCache). Но при offline: API-вызовы для описаний/сущностей падают, UI показывает ошибки. Чтение без сети должно работать gracefully. | MEDIUM | `chapterCache.ts`, `useChapterManagement`, Service Worker | Нужно: (1) кэшировать EPUB-файл целиком в IndexedDB, (2) graceful degradation для AI-фич при offline, (3) показывать offline-badge вместо ошибок. |

### Differentiators (Конкурентное преимущество)

Фичи, которые выделяют fancai среди конкурентов. Не обязательны, но ценны.

| Feature | Ценностное предложение | Сложность | Зависимости в коде | Заметки |
|---------|----------------------|-----------|-------------------|---------|
| **PWA Install Prompt (Android + iOS banner)** | beforeinstallprompt на Android + кастомный iOS-баннер уже подготовлены (`iosSupport.ts`), но install prompt UI не реализован. Повышает retention установленных PWA на ~2-3x vs браузерный режим. | LOW | `iosSupport.ts`, `shouldShowIOSInstallPrompt()` | Android: перехватить beforeinstallprompt, показать красивый баннер. iOS: показать пошаговую инструкцию (Share -> Add to Home Screen). Код iOS-части уже есть, нужен UI-компонент. |
| **Curl-анимация перелистывания** | Имитация бумажной страницы (как в Apple Books "Curl"). Создаёт ощущение "настоящей" книги. Единственный web-ридер с этим -- StPageFlip, но он для fixed-layout. | HIGH | Новый компонент, Canvas или CSS 3D transforms | Сложно: нужен shader или Canvas для realistic curl. StPageFlip -- только для фиксированных страниц, не для reflowable EPUB. Для reflowable контента нужно рендерить страницу в canvas, потом анимировать. Рекомендация: отложить, начать с slide. |
| **Умный парсинг описаний (NLP sentence boundary)** | Текущие описания иногда обрезаются не по границе предложения -- выглядит неаккуратно. Sentence boundary detection улучшит качество выделений. | MEDIUM | `useDescriptionHighlighting.ts`, `preprocessDescription()`, бэкенд extraction | Библиотеки: **wink-nlp** (650K tokens/sec, sentence boundary detection + tokenization), **compromise** (lighter, менее точный). Или серверная сторона: Python NLTK/spaCy для SBD при извлечении. Рекомендация: SBD на бэкенде при extraction (Python), не тянуть NLP в браузер. |
| **Pinch-to-zoom для размера шрифта** | Kobo реализовал: pinch gesture -> мгновенное изменение размера шрифта с preview. Интуитивнее, чем лезть в настройки. | MEDIUM | `useReaderStore` (fontSize), rendition themes, новый хук | Нужен хук `usePinchZoom`: отслеживать два пальца, вычислять scale, маппить на fontSize. Конфликт: `touch-action: pan-x pan-y` отключает pinch-zoom, нужно менять на `touch-action: manipulation` или обрабатывать вручную. iOS Safari: сложности с pinch в iframe. |
| **Long press для выделения текста** | Нативное поведение Safari/Chrome, но epub.js в iframe перехватывает. Нужно гарантировать, что long press всегда открывает selection UI с кнопками "Выделить", "Скопировать", "Заметка". | LOW | `useTextSelection.ts`, selection popup компонент | Проверить что native selection не блокируется touch-action или event handlers. Selection UI уже есть -- убедиться что работает на мобильных. |
| **Настраиваемые зоны навигации** | Дать пользователю выбрать layout тап-зон: 3-zone (left/center/right), edge-only, или zones-off (только свайпы). Power users хотят контроль. | LOW | `IOSTapZones.tsx`, `useTouchNavigation.ts`, `useReaderStore` | Добавить в настройки: выбор layout (3 варианта) + slider для ширины зон. Хранить в Zustand persist. |
| **Background книг для offline** | Дать пользователю явно "скачать книгу для offline" -- прогресс-бар, книга сохраняется в IndexedDB целиком вместе с обложкой и метаданными. | MEDIUM | `chapterCache.ts`, новый сервис `offlineBookStorage`, UI в библиотеке | Отличие от текущего кэширования (только прочитанные главы): полная загрузка EPUB + метаданные. Показать badge "Доступно offline" в библиотеке. |
| **Immersive режим (fullscreen)** | При чтении спрятать status bar и навигацию браузера. Fullscreen API + PWA standalone. Максимизирует площадь чтения. | LOW | `EpubReader.tsx`, Fullscreen API | `document.documentElement.requestFullscreen()`. В PWA standalone уже нет browser chrome, но в браузере -- полезно. Кнопка "Полный экран" в тулбаре. |

### Anti-Features (Кажутся полезными, но проблематичны)

Фичи, которые привлекательны на первый взгляд, но создают больше проблем, чем решают.

| Feature | Почему привлекает | Почему проблематично | Альтернатива |
|---------|------------------|---------------------|-------------|
| **3D Page Curl для reflowable EPUB** | Красиво, как Apple Books | epub.js reflowable контент не рендерится в canvas. Нужно screenshot каждой страницы, что убивает производительность. Apple Books -- нативное приложение с Metal/CoreAnimation. Web не может это повторить с приемлемым FPS. StPageFlip работает только с fixed-layout. | Slide-анимация (CSS transform). Быстрая, плавная, работает везде. Apple Books сам предлагает "Fast Fade" как дефолт, curl -- legacy опция. |
| **Озвучка текста (TTS)** | "Аудиокнига из любой книги" | Лучше обслуживается средствами ОС (VoiceOver/TalkBack, системный TTS). Web Speech API нестабилен: разные голоса на разных ОС, нет контроля качества, Russian TTS слабый. Уже в OUT OF SCOPE проекта. | Направить пользователя к системному TTS: выделить текст -> "Произнести" в iOS, или VoiceOver. |
| **Pinch-to-zoom на контенте (zoom in на текст)** | "Как в браузере" | В ридере font-size -- правильный инструмент для читаемости. Zoom создаёт горизонтальный скролл, ломает пагинацию epub.js, путает пользователя. FullStory показывают: pinch-to-zoom -- сигнал фрустрации, а не фичи. | Pinch-to-zoom маппить на font-size (как Kobo), НЕ на viewport zoom. Или просто кнопки A+/A- в настройках (уже есть). |
| **Офлайн AI-фичи** | "Описания и сущности без интернета" | LLM (Gemini 3 Flash) требует API-вызов. Локальные модели слишком тяжёлые для мобильного браузера. WebLLM/WebGPU -- экспериментальные, не работают на iOS. | Кэшировать результаты AI в IndexedDB: если глава уже обработана, описания/сущности доступны offline. Не генерировать новые offline, показывать "Будет доступно при подключении". |
| **Реалтайм колаборативные аннотации** | "Читать вместе" | Проблема: чтение -- уединённое занятие (зафиксировано в PROJECT.md Out of Scope). WebSocket для real-time синхронизации, конфликты аннотаций, модерация. Огромный scope creep. | Экспорт/импорт аннотаций (JSON/Markdown). "Поделиться цитатой" через Web Share API. |
| **Кастомные жесты (три пальца и т.д.)** | "Жесты как ярлыки" | Нарушает accessibility (W3C рекомендует single-tap). Пользователи не запоминают жесты. Конфликтует с системными жестами iOS/Android. | Простые 1-2 finger жесты: tap (навигация), swipe (перелистывание), pinch (font-size). Всё остальное -- через меню. |
| **Множественные режимы отображения (scroll, spread)** | Kindle и Google Play Books поддерживают scroll mode | epub.js 0.3.93 -- непредсказуемое поведение в scroll mode, особенно CFI tracking и пагинация. Тестировать два режима одновременно -- двойная работа по QA. Текущий paginated mode -- стабильный. | Оставить paginated mode (default). Если scroll mode понадобится -- в отдельном milestone после стабилизации текущего. |

## Feature Dependencies

```
[Follow-finger свайпы]
    |--requires--> [Фикс быстрого пролистывания]
    |--requires--> [Предрендер следующей/предыдущей страницы]
    |--enhances--> [Slide-анимация переходов]

[Slide-анимация переходов]
    |--requires--> [Follow-finger свайпы] (визуально бессмысленна без follow-finger)

[Curl-анимация]
    |--requires--> [Slide-анимация] (итерация поверх)
    |--requires--> [Canvas-рендер страницы] (не существует)
    |--conflicts--> [epub.js reflowable layout] (нужен screenshot)

[PWA Install Prompt]
    |--independent-- (может реализоваться параллельно)

[Offline чтение]
    |--requires--> [Кэширование EPUB в IndexedDB] (частично есть)
    |--enhances--> [Background книг для offline]

[Pinch-to-zoom (font-size)]
    |--conflicts--> [touch-action: pan-x pan-y] (нужно менять CSS)
    |--requires--> [Follow-finger свайпы] (иначе конфликт жестов)

[Адаптивный мобильный UI]
    |--independent-- (может реализоваться параллельно)
    |--enhances--> [Настраиваемые зоны навигации]

[NLP sentence boundary]
    |--independent-- (бэкенд, параллельно)
    |--enhances--> [Описания в useDescriptionHighlighting]

[Immersive режим]
    |--independent-- (Fullscreen API)
```

### Заметки о зависимостях

- **Follow-finger свайпы ТРЕБУЮТ фикса быстрого пролистывания:** Бессмысленно делать плавные свайпы, если быстрые свайпы ломают навигацию. Фикс навигации -- prerequisite.
- **Slide-анимация без follow-finger -- уродство:** Анимация slide при пороговом свайпе выглядит как "дёрнуло и слетело". Follow-finger + slide работают в связке.
- **Pinch-to-zoom конфликтует с touch-action:** Текущий `touch-action: pan-x pan-y` явно отключает pinch. Нужно переключить на `manipulation` или отлавливать pinch вручную, что усложняет обработку жестов.
- **NLP SBD -- независим:** Может идти параллельно на бэкенде, без блокировки фронтенда.

## MVP Definition

### Первая волна (P1 -- запуск)

Минимум для того, чтобы мобильная версия ощущалась как "настоящий ридер".

- [ ] **Фикс быстрого пролистывания** -- навигационная очередь, гарантия стабильности
- [ ] **Follow-finger свайпы** -- палец двигает страницу, как в Apple Books/Google Play Books
- [ ] **Slide-анимация перехода** -- CSS transition при завершении свайпа
- [ ] **Адаптивный мобильный UI** -- автоскрытие header/footer, 44px тап-таргеты
- [ ] **Корректные safe area insets** -- фикс keyboard handling

### Вторая волна (P2 -- после стабилизации)

- [ ] **PWA Install Prompt** -- UI баннеры для Android/iOS
- [ ] **Offline чтение graceful degradation** -- AI-фичи молча отключаются при offline
- [ ] **NLP sentence boundary** -- SBD на бэкенде при extraction
- [ ] **Настраиваемые зоны навигации** -- UI в настройках
- [ ] **Фикс обрезки описаний (CFI -> DOM)** -- корректные границы выделений

### Третья волна (P3 -- полировка)

- [ ] **Pinch-to-zoom для font-size** -- Kobo-стиль
- [ ] **Background книг для offline** -- явная загрузка всей книги
- [ ] **Immersive fullscreen режим** -- кнопка в тулбаре
- [ ] **Long press UX** -- гарантия работы native selection в iframe

## Feature Prioritization Matrix

| Feature | Ценность | Стоимость | Приоритет | Обоснование |
|---------|---------|-----------|-----------|-------------|
| Фикс быстрого пролистывания | HIGH | LOW | **P1** | Баг, блокирующий UX. Без фикса follow-finger бессмысленен. |
| Follow-finger свайпы | HIGH | HIGH | **P1** | Ключевой table stakes. Определяет "ощущение" от ридера. |
| Slide-анимация | HIGH | MEDIUM | **P1** | Визуальная связка с follow-finger. Без неё -- "дёрганье". |
| Адаптивный мобильный UI | HIGH | MEDIUM | **P1** | Кнопки 44px, автоскрытие UI. Базовая мобильная юзабилити. |
| Safe area insets фикс | MEDIUM | LOW | **P1** | Мелкий фикс, но видимый баг на iPhone. |
| PWA Install Prompt | MEDIUM | LOW | **P2** | Код почти готов (`iosSupport.ts`), нужен UI-компонент. |
| Offline graceful degradation | MEDIUM | MEDIUM | **P2** | Важно для PWA, но v1.0 работает без offline. |
| NLP sentence boundary | MEDIUM | MEDIUM | **P2** | Улучшает качество описаний, но не блокирует чтение. |
| Настраиваемые зоны | LOW | LOW | **P2** | Power user фича, быстрая реализация. |
| Фикс обрезки описаний | MEDIUM | MEDIUM | **P2** | CFI -> DOM маппинг, улучшает качество выделений. |
| Pinch-to-zoom font-size | LOW | MEDIUM | **P3** | Nice-to-have, конфликт с touch-action. |
| Background книг для offline | LOW | MEDIUM | **P3** | Full offline -- сложнее, чем кажется. |
| Immersive fullscreen | LOW | LOW | **P3** | Простой Fullscreen API вызов, но низкий impact. |
| Long press UX | LOW | LOW | **P3** | Может уже работать, нужна проверка. |

## Анализ конкурентов

| Feature | Apple Books | Google Play Books | Kindle | Flow (PWA) | Thorium Web | fancai (текущее) |
|---------|------------|-------------------|--------|-----------|-------------|-----------------|
| Follow-finger свайп | Да (нативный) | Да (нативный) | Да (нативный) | Нет | Нет | Нет (пороговый) |
| Slide-анимация | Да (Fast Fade/Curl/Scroll) | Да (slide) | Да (slide) | Нет | Нет | Нет |
| Tap zones навигация | Да (настраиваемые) | Да (фиксированные) | Да (настраиваемые) | Нет | Нет | Да (фиксированные) |
| Offline чтение | Да (полный) | Да (загрузка) | Да (загрузка) | Да (IndexedDB) | Нет | Частично (кэш глав) |
| PWA install | N/A (нативный) | N/A (нативный) | N/A (нативный) | Да | Нет | Нет (manifest есть) |
| Pinch-to-zoom text | Нет | Нет | Нет | Нет | Нет | Нет |
| Sentence boundary | Да (нативный парсер) | Да | Да | Нет | Нет | Нет |
| AI-описания | Нет | Нет | X-Ray (похоже) | Нет | Нет | **Да** (уникальная фича) |
| Entity Wiki | Нет | Нет | X-Ray (похоже) | Нет | Нет | **Да** (уникальная фича) |

**Ключевой вывод:** Нативные ридеры (Apple Books, Google Play Books, Kindle) имеют follow-finger свайпы и slide-анимации по умолчанию. Ни один web-based EPUB-ридер (Flow, Thorium Web, Readium) не реализовал follow-finger для reflowable EPUB. Это одновременно и table stakes (пользователь ожидает), и differentiator среди web-ридеров.

## Техническая оценка ключевых фич

### Follow-finger свайпы: подход к реализации

**Проблема:** epub.js рендерит контент в iframe. Нельзя просто двигать iframe -- нужно показать "следующую страницу" за текущей при перетаскивании.

**Возможные подходы:**

1. **CSS transform на контейнере iframe** (рекомендация)
   - touchmove -> translate контейнера на deltaX
   - Параллельно предрендерить скрытый snapshot следующей страницы
   - При отпускании: анимировать transition к целевой позиции или вернуть обратно
   - Сложность: как получить snapshot? epub.js `rendition.next()` перерисовывает, нельзя держать две страницы одновременно.

2. **Двойной iframe (pre-render)**
   - Два iframe: текущая страница + следующая (скрытая)
   - При свайпе: двигать оба, показывая следующую из-под текущей
   - Сложность: двойное потребление памяти, синхронизация состояния

3. **Screenshot + Canvas**
   - Сделать html2canvas текущей страницы, двигать canvas
   - При завершении свайпа: подменить canvas на реальный контент
   - Сложность: производительность html2canvas, задержка при создании screenshot

**Рекомендация:** Подход #1 (CSS transform) -- самый лёгкий. Показывать "пустую" следующую страницу (или размытый preview) при свайпе, основной контент появляется после `rendition.next()`. Это compromise, но работает в 90% ридеров -- Google Play Books Web использует именно такой подход.

### NLP Sentence Boundary: бэкенд vs фронтенд

| Аспект | Фронтенд (wink-nlp) | Бэкенд (Python spaCy/NLTK) |
|--------|--------------------|-----------------------------|
| Производительность | 650K tokens/sec (wink-nlp), но bundle +200KB | Не влияет на bundle |
| Русский язык | wink-nlp -- только English. compromise -- только English. | spaCy ru_core_news_sm -- полная поддержка русского |
| Точность | Средняя для English, нет для Russian | Высокая для Russian |
| Место в pipeline | При highlighting (каждый рендер) | При extraction (один раз) |

**Рекомендация:** Однозначно бэкенд. Python spaCy с русской моделью при extraction. Результат сохраняется в БД, фронтенд получает уже корректные границы предложений. Не тянуть NLP в браузер -- это мёртвый код v1.0 повторённый.

## Источники

- [epub.js page flip animation discussion, Issue #510](https://github.com/futurepress/epub.js/issues/510) -- MEDIUM confidence
- [epub.js Tips and Tricks Wiki](https://github.com/futurepress/epub.js/wiki/Tips-and-Tricks-(v0.3)) -- HIGH confidence (official)
- [Readium page transition discussion](https://github.com/readium/mobile/discussions/21) -- MEDIUM confidence
- [PWA on iOS 2025: Real Capabilities vs. Hard Limitations](https://ravi6997.medium.com/pwas-on-ios-in-2025-why-your-web-app-might-beat-native-0b1c35acf845) -- MEDIUM confidence
- [PWA iOS Limitations and Safari Support: Complete Guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) -- MEDIUM confidence
- [Safe-area-inset-bottom does not update for keyboard](https://webventures.rejh.nl/blog/2025/safe-area-inset-bottom-does-not-update/) -- HIGH confidence (documented bug)
- [PWA Best Practices for 2026](https://wirefuture.com/post/progressive-web-apps-pwa-best-practices-for-2026) -- MEDIUM confidence
- [Kobo font size gestures](https://goodereader.com/blog/kobo-ereader-news/kobo-e-readers-can-now-change-font-size-with-gestures) -- HIGH confidence
- [Mobile UX: Tap Targets & Touch Zones](https://edesignify.com/blogs/tap-targets-and-touch-zones-mobile-ux-that-works) -- MEDIUM confidence
- [Mobile App UX: Designing for Thumb Zones and Gestures](https://elaris.software/blog/mobile-ux-thumb-zones-2025/) -- MEDIUM confidence
- [winkNLP (sentence boundary detection JS)](https://winkjs.org/wink-nlp/) -- HIGH confidence (official)
- [Flow EPUB reader PWA (open source)](https://github.com/pacexy/flow) -- HIGH confidence (source code)
- [Thorium Web reader](https://github.com/edrlab/thorium-web) -- HIGH confidence (source code)
- [StPageFlip (page curl JS library)](https://nodlik.github.io/StPageFlip/) -- MEDIUM confidence
- [Apple Books page turn documentation](https://support.apple.com/en-mn/guide/iphone/iphc1af7c57/ios) -- HIGH confidence (official)
- [env() CSS function (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env) -- HIGH confidence (official)
- [touch-action CSS property (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action) -- HIGH confidence (official)

---
*Feature research for: fancai v1.1 Mobile/PWA Reader*
*Researched: 2026-03-09*
