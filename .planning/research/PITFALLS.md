# Pitfalls Research: Mobile/PWA для EPUB-ридера на epub.js

**Domain:** Mobile-first PWA EPUB ридер (добавление Mobile/PWA в существующий web-ридер)
**Researched:** 2026-03-09
**Confidence:** HIGH (основано на анализе текущего кода + известные баги + документация + community issues)

---

## Critical Pitfalls

### Pitfall 1: epub.js rendition.display() race condition при быстром листании

**What goes wrong:**
При быстром свайпе пользователь вызывает `rendition.next()` или `rendition.display()` несколько раз подряд, пока предыдущий вызов ещё не завершён. epub.js ставит вызовы в очередь (rendering queue), но при достаточной скорости:
- Промежуточные страницы "пролистываются" без рендеринга
- Накапливается сдвиг scrollLeft (известный баг: "быстрые свайпы смещают страницу вправо")
- Аннотации/хайлайты рендерятся для неправильной страницы
- `relocated` event срабатывает для промежуточной позиции, портя прогресс чтения

**Why it happens:**
В текущем `useEpubNavigation.ts` на мобильных используется `directScroll()` с `stage.scrollTo({ behavior: 'smooth' })`. Когда новый свайп начинается до завершения `waitForScrollEnd()`, предыдущий smooth scroll ещё не закончился -- `scrollLeft` оказывается в промежуточном положении, и новый scroll рассчитывается от неверной базы. Кроме того, `isNavigatingRef` в `useSwipeNavigation.ts` блокирует только одновременные свайпы, но не предотвращает вызов `directScroll` из очередного touchend, если предыдущий scroll ещё анимируется.

**How to avoid:**
1. **Navigation mutex с instant cancel:** Перед новым scroll -- мгновенно завершить предыдущий через `stage.scrollTo({ left: targetPosition, behavior: 'instant' })`, затем начать новый
2. **Абсолютные позиции вместо относительных:** Вычислять `newScroll = pageIndex * scrollUnit` вместо `currentScroll + scrollUnit` -- устраняет накопление ошибок
3. **Debounce + queue:** Если больше N свайпов за 300ms -- пропустить промежуточные, перейти сразу к финальной позиции
4. **Отделить visual feedback от navigation:** Свайп-анимация (follow-finger) через CSS transform на overlay, фактическая навигация -- только после touchend

**Warning signs:**
- Страница смещается на дробное количество "страниц" при быстром листании
- `scrollLeft` не кратен `scrollUnit` после навигации
- Progress сохраняется с мерцающими значениями

**Phase to address:**
Фаза 1 (Свайп-навигация) -- это самый первый pitfall, который нужно решить, т.к. влияет на базовый UX

---

### Pitfall 2: epub.js iframe + touch events -- потеря событий и двойная навигация

**What goes wrong:**
epub.js рендерит контент внутри iframe. Touch-события внутри iframe не всплывают к родительскому документу. Текущий код решает это через `rendition.hooks.content.register()` для привязки обработчиков напрямую к iframe document. Однако при добавлении follow-finger свайпа возникают конфликты:
- `useSwipeNavigation` и `useTouchNavigation` оба привязывают обработчики к iframe doc
- На iOS один хук обрабатывает событие, затем второй тоже получает его (двойная навигация)
- `touchmove` с `{ passive: false }` для `preventDefault()` конфликтует с CSS `touch-action: manipulation`
- При смене главы iframe пересоздаётся, но старые обработчики могут не очиститься (memory leak через `__swipeNavCleanup` и `__touchNavCleanup`)

**Why it happens:**
Архитектурно два хука (`useSwipeNavigation` для свайпов, `useTouchNavigation` для тапов) привязывают свои обработчики к одному iframe document через один и тот же механизм (`hooks.content.register`). При этом `useTouchNavigation` на iOS отключается (`isIOS()` check), но на Android оба хука активны одновременно если `navigationMode === 'swipe'`. Кроме того, fallback через `rendition.on('touchstart/touchend')` добавляет третий слой обработчиков.

**How to avoid:**
1. **Единый gesture controller:** Один хук, который получает все touch events и решает, что это -- tap, swipe или long-press. Не два отдельных хука с перекрывающейся ответственностью
2. **Gesture state machine:** idle -> touching -> swiping/tapping/selecting -- чёткие переходы
3. **Убрать fallback rendition.on():** Он создаёт дублирующий слой. Если direct binding работает -- fallback не нужен
4. **Event listeners cleanup:** Вместо `doc.__swipeNavCleanup` -- использовать AbortController для группового удаления

**Warning signs:**
- Двойное перелистывание на один свайп
- Тап в зоне навигации срабатывает дважды
- После долгого чтения замедление UI (утечка обработчиков)

**Phase to address:**
Фаза 1 (Свайп-навигация) -- рефакторинг gesture handling в единый контроллер

---

### Pitfall 3: iOS Safari PWA standalone -- потеря навигации и сессии

**What goes wrong:**
В standalone mode на iOS нет URL-бара, кнопки "назад" и функции "pull-to-refresh". Если пользователь:
- Открывает книгу и нажимает системный жест swipe-from-left-edge -- iOS закрывает PWA вместо "назад"
- Минимизирует приложение -- текущий `useRenditionHealthGuard` делает `window.location.reload()`, что теряет все UI состояния (открытый drawer, модал, поисковая панель)
- Возвращается из другого приложения после >0ms (mobile threshold) -- каждый раз полная перезагрузка

**Why it happens:**
1. **Нет кнопки "назад":** В standalone mode системной навигации нет. Текущая реализация полагается на `navigate('/')` в header, но нет edge-swipe back gesture
2. **Агрессивный reload:** `MIN_BACKGROUND_TIME_FOR_RELOAD = 0` для mobile -- даже переключение на уведомление и обратно за 1 секунду вызывает перезагрузку. Это оправдано для epub.js heap corruption, но разрушает UX
3. **bfcache break:** `event.persisted` -> reload уничтожает бесплатную мгновенную навигацию назад

**How to avoid:**
1. **In-app back navigation:** Кастомный edge-swipe-from-left для `history.back()` или явная кнопка "Назад" во всех экранах
2. **Градуированный reload:** Не reload при возврате < 5 секунд. Для 5-60 сек -- проверить здоровье rendition. Для >60 сек -- reload. Текущий подход "reload всегда" слишком агрессивен
3. **Persist UI state:** Перед reload сохранять в sessionStorage: открытые модалы, drawer состояние, search query. После reload -- восстанавливать
4. **Status bar meta:** `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` + `env(safe-area-inset-top)` padding -- уже частично реализовано

**Warning signs:**
- Пользователи жалуются на "долгую загрузку" при каждом возврате в приложение
- Edge swipe закрывает PWA полностью вместо навигации назад
- iOS status bar overlaps content в standalone mode

**Phase to address:**
Фаза 3 (PWA improvements) -- но грубый fix для reload агрессивности можно внести в Фазу 1

---

### Pitfall 4: iOS Safari 100vh/dvh + виртуальная клавиатура + safe-area

**What goes wrong:**
Комбинация нескольких iOS viewport проблем:
- `100vh` включает скрытую часть Safari UI -> контент обрезается снизу (в standalone mode менее критично, но в browser mode -- проблема)
- Виртуальная клавиатура (при поиске в книге, заметках) "поднимает" viewport, но `env(safe-area-inset-bottom)` не обновляется
- `env(safe-area-inset-bottom)` = 34px в PWA standalone, 0px в Safari browser -> разный layout
- Dynamic Island / notch: `env(safe-area-inset-top)` варьируется от 20px до 59px в зависимости от устройства

**Why it happens:**
Текущий код использует `100dvh` (globals.css line 551-553), что правильно для основной проблемы. Но:
- `paddingTop: 'calc(70px + env(safe-area-inset-top))'` (EpubReader.tsx line 502) жёстко привязан к высоте header
- При открытии клавиатуры viewport уменьшается, epub.js рендерит контент для нового размера, triggering `resized` event -> position restoration -> потенциальная потеря места чтения
- `env(safe-area-inset-*)` не обновляется при повороте экрана в реальном времени -- нужен resize observer

**How to avoid:**
1. **VisualViewport API:** `window.visualViewport` отслеживает реальный видимый viewport, включая клавиатуру. Использовать вместо `window.innerHeight`
2. **Keyboard-aware layout:** При открытии клавиатуры -- не менять размер reader, а поднять search panel поверх
3. **Freeze rendition resize при клавиатуре:** Заблокировать `useResizeHandler` пока клавиатура открыта, чтобы epub.js не перерисовывал страницу
4. **Тестирование на реальных устройствах:** iPhone SE (без notch), iPhone 14 Pro (Dynamic Island), iPad -- три разных safe-area конфигурации

**Warning signs:**
- Reader header уходит за Dynamic Island
- При открытии search -- содержимое "прыгает"
- Нижняя панель навигации обрезается на устройствах с home indicator

**Phase to address:**
Фаза 2 (Layout/Viewport) -- требует системного подхода к viewport management

---

### Pitfall 5: Service Worker обновления "застревают" -- пользователь видит старую версию

**What goes wrong:**
После деплоя новой версии:
- Старый SW контролирует все вкладки до тех пор, пока ВСЕ вкладки не закроются
- `skipWaiting()` активирует новый SW, но старые precached assets всё ещё в кеше
- На iOS PWA standalone -- нет способа "обновить" кроме как закрыть-открыть приложение
- Если новый SW ломает fetch для старого index.html -- белый экран
- Workbox `StaleWhileRevalidate` для API-данных может показать stale entity data после обновления модели

**Why it happens:**
Текущая реализация (sw.ts) использует Workbox precache + разные стратегии. `SKIP_WAITING` message handler существует. `PWAUpdatePrompt.tsx` есть. Но:
- iOS standalone mode не показывает "reload" prompt как в браузере
- Если пользователь не закрывает PWA неделями -- он на старой версии неделями
- `navigation-cache` с NetworkFirst может закешировать старый index.html при таймауте
- Нет force-update механизма для критических обновлений

**How to avoid:**
1. **Version check на старте:** При каждом app resume -- проверить `/api/v1/version` endpoint. Если version mismatch -- показать mandatory update prompt
2. **Periodic SW update check:** `navigator.serviceWorker.getRegistration().then(r => r.update())` раз в час (уже может быть в VitePWA config, но нужно проверить)
3. **Graceful cache migration:** При активации нового SW -- удалять все runtime кеши (`api-cache`, `generated-images-cache`), оставлять только precache
4. **Никогда не кешировать index.html надолго:** Navigation cache с NetworkFirst 5s timeout опасен -- при медленном интернете пользователь получит старый HTML

**Warning signs:**
- Пользователи сообщают о баге, который уже исправлен
- "Пустой белый экран" после деплоя
- Console errors: "Failed to load module script" (хэш файла изменился)

**Phase to address:**
Фаза 3 (PWA improvements) -- критически важно для итеративной разработки

---

### Pitfall 6: Блокировка навигации после операций (известный баг)

**What goes wrong:**
После отмены генерации изображения навигация блокируется -- пользователь не может листать страницы. Это существующий баг, который усугубится при добавлении follow-finger свайпов.

**Why it happens:**
Цепочка зависимостей:
1. `cancelGeneration()` в `useImageModal` обновляет state
2. State-change вызывает re-render
3. `useSwipeNavigation` зависит от `!isModalOpen` -- при race condition между закрытием модала и обновлением enabled-флага, `isNavigatingRef.current` может остаться `true`
4. Все последующие свайпы блокируются условием `if (isNavigatingRef.current) return` (useSwipeNavigation.ts line 230)

**How to avoid:**
1. **Timeout safety для isNavigatingRef:** Автоматический сброс через 3 секунды -- если навигация не завершилась, что-то пошло не так
2. **Cleanup в useEffect return:** При unmount/re-mount хука -- принудительно `isNavigatingRef.current = false`
3. **Отвязать isModalOpen от navigation enabled:** Модал может быть открыт поверх reader без блокировки свайпов
4. **Navigation state в Zustand:** Вместо ref использовать observable state для лучшей отладки

**Warning signs:**
- Свайпы/тапы перестают работать после закрытия модала
- `isNavigatingRef.current === true` в console логах
- Только page reload "чинит" навигацию

**Phase to address:**
Фаза 1 (Свайп-навигация) -- исправить в рамках рефакторинга gesture controller

---

### Pitfall 7: CFI-DOM рассинхронизация при DOM-манипуляциях

**What goes wrong:**
CFI (Content Fragment Identifier) -- путь к позиции в EPUB. Текущие хуки `useDescriptionHighlighting`, `useAnnotationRendering`, `useEntityNameHighlighting` все манипулируют DOM внутри iframe (оборачивают текст в span). Это:
- Сдвигает CFI-пути для текстовых нод, расположенных ПОСЛЕ обёрнутого текста
- `rendition.getRange(cfi)` возвращает null для CFI, вычисленных ДО DOM-модификации
- При навигации к закладке -- позиция "уезжает" на несколько строк
- Множественные хуки вызываются в неопределённом порядке -- порядок DOM-модификаций не гарантирован

**Why it happens:**
epub.js CFI привязан к позиции в XHTML-дереве (element index + text offset). Когда `useAnnotationRendering.wrapRangeWithSpan()` разбивает текстовый узел на три (before + span + after), позиции всех последующих текстовых узлов смещаются. Уже есть `resolveRangeFallback()` (useAnnotationRendering.ts line 81), но это хрупкий workaround.

**How to avoid:**
1. **Фиксированный порядок рендеринга:** descriptions -> annotations -> entities. Каждый следующий хук учитывает обёртки предыдущего
2. **Debounce все DOM-модификации:** Текущие 200ms debounce в `useAnnotationRendering` -- правильно, но `useDescriptionHighlighting` может быть без debounce
3. **CFI resolution ПОСЛЕ всех DOM-модификаций:** Не сохранять CFI и не навигировать в момент DOM-манипуляций
4. **Snapshot-restore:** Перед навигацией к закладке -- очистить все DOM-обёртки, навигировать, затем заново наложить

**Warning signs:**
- Закладки "прыгают" при навигации к ним
- Описания выделяются со сдвигом на несколько слов
- `resolveRangeFallback()` вызывается для >50% закладок (метрика)

**Phase to address:**
Фаза 4 (Описания/CFI) -- существующий баг "обрезка выделений", корневая причина

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `window.location.reload()` для PWA resume | Надёжное восстановление epub.js state | UX деградация: потеря UI state, медленный resume | Только как fallback для >60 сек background |
| `doc.__swipeNavCleanup` custom property | Быстрый cleanup без рефакторинга | Memory leak при частой смене глав, нестандартный паттерн | Никогда -- заменить на AbortController |
| Два отдельных хука для touch (swipe + tap) | Разделение ответственности | Дублирование обработчиков, конфликты событий, сложная отладка | Никогда при переходе на follow-finger |
| `isIOS()` проверки разбросаны по 10+ файлам | Быстрые iOS-специфичные фиксы | Хрупкая условная логика, трудно тестировать, забытые code paths | MVP, затем рефакторить в platform adapter |
| `directScroll()` с smooth animation | Плавная прокрутка | Race condition при быстром свайпе, нестабильный scrollLeft | Только с navigation mutex |
| 6 fallback-методов в `getMeasuredScrollUnit` | Работает на всех устройствах | Трудно отладить, когда метод выбирается неправильно | OK -- но нужен logging какой метод сработал (уже есть) |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| epub.js iframe + touch events | Привязать обработчики к parent div | Привязать напрямую к iframe document через `rendition.hooks.content.register()` |
| epub.js + CSS transform animation | Анимировать iframe container напрямую | Использовать CSS transform на overlay div поверх iframe, не трогая сам iframe |
| epub.js + Service Worker | SW не контролирует blob: URLs в iframe | epub.js iframe не имеет src атрибута -- SW не перехватывает запросы внутри iframe (issue #962) |
| Workbox precache + Vite hashed assets | Кешировать index.html с длинным TTL | NetworkFirst для index.html, CacheFirst только для hashed assets |
| iOS Safari + passive event listeners | Забыть `{ passive: false }` для touchmove | Явно указать `{ passive: false }` чтобы `preventDefault()` работал для горизонтального свайпа |
| IndexedDB + PWA background/foreground | Писать в IndexedDB при background transition | Проверять `document.visibilityState === 'visible'` перед записью (уже реализовано в chapterCache.ts) |
| epub.js + VisualViewport API | Использовать `window.innerHeight` для layout | `window.visualViewport.height` учитывает виртуальную клавиатуру |
| iOS standalone + swipe-from-edge | Полагаться на browser back button | Реализовать in-app back navigation, iOS swipe-from-edge может закрыть PWA |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| DOM manipulation в каждом рендер-цикле iframe | Мерцание хайлайтов, медленная навигация | Кешировать DOM-обёртки, применять diff вместо full cleanup+rebuild | > 20 аннотаций на страницу |
| IndexedDB хранение целых книг (EPUB файлов) | iOS Safari 500MB лимит, WAL file growth bug | Хранить только descriptions + metadata, книги загружать с сервера | > 5 книг по 10MB+ |
| Smooth scroll animation для каждой страницы | Dropped frames при быстром листании | `behavior: 'instant'` для быстрых свайпов, smooth только для одиночных | Серия свайпов > 2 за секунду |
| TreeWalker на всём document body | Задержка > 100ms на длинных главах | TreeWalker только по range.commonAncestorContainer | Главы > 10000 слов |
| `rendition.getContents()` в каждом обработчике | GC pressure, аллокации на каждый touch event | Закешировать contents ref, обновлять только при 'rendered' event | > 30 touch events/sec |
| `env(safe-area-inset-*)` в CSS calc | Forced style recalculation при resize | Предвычислить значения через CSS custom properties | Частые resize (rotation, keyboard) |
| Multiple content.register() hooks per chapter | O(N) обработчиков на N переходов без cleanup | Cleanup в return function каждого useEffect, verify через doc cleanup markers | > 20 глав за сессию |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Кеширование auth endpoints в SW | Утечка токенов в Cache Storage | Уже исключены (`!url.pathname.startsWith('/api/v1/auth/')`) -- поддерживать |
| Кеширование прогресса чтения в API cache | Утечка истории чтения другим пользователям на shared устройстве | Уже исключены (`!url.pathname.includes('/progress')`) -- но проверить LOGOUT cache clear |
| SW cache не очищается при logout | Следующий пользователь видит книги предыдущего | `LOGOUT` message handler в sw.ts очищает `api-cache` и `generated-images-cache` -- но не `book-covers` |
| Push subscription не отвязывается при logout | Push уведомления идут старому пользователю | При logout: `subscription.unsubscribe()` + удалить на сервере |
| IndexedDB данные доступны после logout | Кеш глав с описаниями остаётся | При logout вызывать `chapterCache.clearAll(userId)` |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Reload при каждом resume из background | 2-5 сек загрузки каждый раз при возврате в приложение | Градуированная стратегия: < 5 сек -- ничего, 5-60 сек -- health check, > 60 сек -- reload |
| Отсутствие visual feedback при свайпе | Пользователь не уверен, сработал ли свайп | Follow-finger с пиком следующей/предыдущей страницы |
| Нет кнопки "назад" в standalone mode | На iOS нет способа вернуться, edge swipe может закрыть PWA | Явная кнопка "назад" в reader header (уже есть) + back gesture handler |
| Клавиатура сдвигает reader content | Потеря позиции чтения при открытии search | Freeze epub.js resize при активной клавиатуре, показать search поверх |
| Медленная initial загрузка PWA offline | Пустой белый экран на slow 3G | Skeleton loader из precache + NetworkFirst для data |
| Install prompt недоступен на iOS | iOS не поддерживает `beforeinstallprompt` | Кастомный баннер с инструкцией "Share -> Add to Home Screen" (уже в iosSupport.ts) |
| Notifications на русском, fallback на английском | Push notification text не локализован | Локализовать push payload на серверной стороне перед отправкой |

## "Looks Done But Isn't" Checklist

- [ ] **Follow-finger свайп:** Часто забывают rubber-band эффект на границах глав (начало/конец книги) -- проверить edge cases
- [ ] **Safe area:** Тестировали на iPhone с notch, но забыли iPhone SE (без notch) и iPad (landscape) -- проверить все 3 конфигурации
- [ ] **Offline mode:** Страницы библиотеки кешируются, но upload книги offline не обработан -- проверить graceful degradation
- [ ] **SW update:** Работает в Chrome DevTools, но не тестировали в iOS standalone -- проверить real PWA update flow
- [ ] **Touch-action:** Установлен на контейнере, но iframe body тоже нуждается в `touch-action` -- проверить что CSS injection в `useContentHooks.ts` покрывает все случаи
- [ ] **Orientation change:** Работает в portrait, но при повороте в landscape и обратно -- позиция и layout сбиваются -- проверить `useResizeHandler`
- [ ] **Background sync:** Работает на Android Chrome, но iOS не поддерживает Background Sync API -- проверить `setupIOSSync()` fallback
- [ ] **Long-press vs selection:** Follow-finger свайп может конфликтовать с text selection -- проверить что long-press всё ещё открывает selection
- [ ] **Быстрый двойной тап:** Не должен вызывать zoom (touch-action: manipulation) И не должен перелистывать дважды -- проверить debounce
- [ ] **Memory при чтении длинных книг:** 50+ глав -> проверить что обработчики событий cleanup при каждой смене главы, нет ли leak

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Race condition при быстром листании | MEDIUM | Рефакторинг `directScroll` на mutex-based подход, ~2-3 дня работы |
| Двойная навигация от двух хуков | LOW | Объединить в один gesture controller, ~1-2 дня |
| Потеря навигации в standalone | LOW | Добавить back gesture + fix reload strategy, ~1 день |
| 100vh/keyboard viewport issues | MEDIUM | Интеграция VisualViewport API + freeze resize, ~2 дня |
| SW update застревает | LOW | Version check endpoint + periodic update + force reload, ~1 день |
| Блокировка навигации после отмены | LOW | Timeout safety + cleanup ref, ~0.5 дня |
| CFI-DOM рассинхронизация | HIGH | Архитектурное изменение порядка DOM-манипуляций, ~3-5 дней |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Race condition при быстром листании | Phase 1: Свайп-навигация | Тест: 10 быстрых свайпов подряд, scrollLeft кратен scrollUnit |
| Touch event конфликты | Phase 1: Свайп-навигация | Тест: одновременно свайп и тап не вызывают двойную навигацию |
| iOS standalone навигация | Phase 3: PWA improvements | Тест: в iOS PWA standalone можно вернуться из reader в library без reload |
| Viewport/keyboard/safe-area | Phase 2: Layout fixes | Тест: открытие search не сдвигает reader content; safe-area корректна на 3 типах устройств |
| SW update flow | Phase 3: PWA improvements | Тест: деплой новой версии -> PWA обновляется в течение 1 часа или при следующем открытии |
| Блокировка навигации | Phase 1: Свайп-навигация | Тест: отмена генерации изображения -> свайпы продолжают работать |
| CFI-DOM рассинхронизация | Phase 4: Описания/CFI | Тест: навигация к закладке приводит к correct visible position; описания совпадают с текстом |
| IndexedDB memory/quota | Phase 3: PWA improvements | Тест: 10 книг по 50 глав -> хранилище < 200MB, нет "QuotaExceededError" |

## Специфичные для fancai интеграционные pitfalls

### epub.js + AI-генерация изображений + свайп
Генерация изображений -- асинхронная операция (Celery backend). При follow-finger свайпе пользователь может быстро пролистать несколько страниц. Если описание с генерируемым изображением оказывается на промежуточной странице:
- `useChapterManagement` обновляет `currentChapter`
- `useDescriptionHighlighting` пытается отрендерить описания для новой страницы
- Но страница ещё "пролетает" мимо
- **Решение:** Не применять DOM-манипуляции пока swipe animation не завершена

### Entity highlighting + touch events
`useEntityNameHighlighting` добавляет click handlers на имена сущностей внутри iframe. Follow-finger свайп начинается с touchstart на entity span -> конфликт:
- Тап по entity должен открыть popup
- Свайп от entity должен навигировать
- **Решение:** В gesture controller: если движение > 10px -> это свайп, не показывать popup

### useRenditionHealthGuard + follow-finger animation
При быстром resume из background текущий guard вызывает `window.location.reload()`. Если в этот момент идёт follow-finger animation (палец на экране) -> crash или потеря touch tracking.
- **Решение:** Не вызывать reload если `swipeState.phase !== 'idle'`

## Sources

- [epub.js Wiki: Tips and Tricks](https://github.com/futurepress/epub.js/wiki/Tips-and-Tricks-(v0.3))
- [epub.js Issue #962: SW + iframe](https://github.com/futurepress/epub.js/issues/962)
- [epub.js Issue #904: Mobile Safari text selection](https://github.com/futurepress/epub.js/issues/904)
- [epubjs-tips by johnfactotum](https://github.com/johnfactotum/epubjs-tips)
- [Workbox: Handling SW updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)
- [VitePWA: Auto update guide](https://vite-pwa-org.netlify.app/guide/auto-update.html)
- [PWA iOS Limitations Guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [PWA on iOS 2025: Capabilities vs Limitations](https://brainhub.eu/library/pwa-on-ios)
- [iOS PWA Compatibility (firt.dev)](https://firt.dev/notes/pwa-ios/)
- [PWA-POLICE: PWA bugs and workarounds](https://github.com/PWA-POLICE/pwa-bugs)
- [MDN: CSS and JavaScript animation performance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/CSS_JavaScript_animation_performance)
- [WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [WebKit Bug: IndexedDB massive storage usage iOS](https://bugs.webkit.org/show_bug.cgi?id=178204)
- [100vh in Safari on iOS](https://www.bram.us/2020/05/06/100vh-in-safari-on-ios/)
- [Rich Harris: Service Workers things I wish I'd known](https://gist.github.com/Rich-Harris/fd6c3c73e6e707e312d7c5d7d0f3b2f9)
- [RxDB: IndexedDB Max Storage Limit](https://rxdb.info/articles/indexeddb-max-storage-limit.html)
- Анализ текущего кода fancai (HIGH confidence -- прямой доступ к исходникам)

---
*Pitfalls research for: Mobile/PWA EPUB ридер на epub.js (fancai v1.1)*
*Researched: 2026-03-09*
