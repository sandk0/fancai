# Исследование стека: Mobile/PWA Reader

**Область:** Плавные свайпы follow-finger, качественное PWA, мобильные анимации для EPUB-ридера
**Исследовано:** 2026-03-09
**Уверенность:** ВЫСОКАЯ

## Контекст: Что уже есть

Прежде чем рекомендовать дополнения -- критически важно понимать текущее состояние:

| Категория | Уже на месте | Статус |
|-----------|-------------|--------|
| Анимации | `motion` 12.31.0 (40 файлов импортируют) | Глубоко интегрирован, spring-анимации используются повсюду |
| Touch-навигация | `useSwipeNavigation.ts` + `useTouchNavigation.ts` | Кастомная реализация на raw touch events, привязка через `rendition.hooks.content.register()` к iframe document |
| iOS tap zones | `IOSTapZones.tsx` + `TapZone.tsx` + `TapFeedback.tsx` | Отдельная система для iOS -- overlay поверх iframe |
| iOS fixes | `useEpubIOSFixes.ts` | Блокировка epub.js snap/gestures, fix layout divisor |
| PWA Service Worker | `sw.ts` (878 строк) + Workbox 7.4 | Полноценный: precaching, runtime caching, background sync, push notifications, navigation preload |
| PWA Plugin | `vite-plugin-pwa` 1.2.0 (injectManifest) | Настроен, dev mode включен |
| Manifest | `manifest.json` | Полный: shortcuts, file_handlers, share_target, launch_handler |
| iOS Support | `iosSupport.ts` (486 строк) | Platform detection, persistence, install prompt, background sync fallback |
| Swipe overlay | `SwipeOverlay.tsx` + `SwipeIndicator.tsx` | motion/react для spring-анимаций индикаторов |

**Ключевой вывод:** PWA-инфраструктура уже зрелая. Service worker, манифест, Workbox -- всё настроено и работает. Основной пробел -- качество свайпов: текущая реализация на raw `touchstart/touchmove/touchend` не дает настоящего "follow-finger" UX, анимация перехода страницы идет ПОСЛЕ завершения жеста (через `setTimeout` 200-300ms), а не ВО ВРЕМЯ движения пальца.

---

## Рекомендуемые дополнения стека

### 1. НЕ добавлять @use-gesture/react

| Решение | Обоснование | Уверенность |
|---------|-------------|-------------|
| **Отклонено** | Не решает ключевую проблему (iframe) и дублирует motion | ВЫСОКАЯ |

**Почему не нужен:**

1. **Проблема iframe:** epub.js рендерит контент в `<iframe>` с blob: URL. Touch events не всплывают из iframe в parent document. `@use-gesture/react` привязывает хендлеры к React-элементам в parent -- он физически не получит events из iframe. Проект уже решает это через `rendition.hooks.content.register()` для прямой привязки к iframe document. @use-gesture не имеет API для привязки к произвольному document/element внутри iframe.

2. **motion уже делает то же:** `motion` v12 (уже установлен) имеет `onPan`, `onPanStart`, `onPanEnd`, `drag` gesture support, spring physics. Добавлять @use-gesture = дублирование.

3. **Устаревший:** Последний релиз v10.3.1 -- 2+ года назад. Не обновлялся для React 19.

4. **@use-gesture/vanilla** (10.3.1) теоретически позволяет привязку к DOM-элементу, но: (a) не протестирован с iframe document, (b) не поддерживается активно, (c) проект и без того справляется с raw events.

**Вместо этого:** Улучшить существующую реализацию в `useSwipeNavigation.ts` -- она уже корректно привязана к iframe document через content hooks.

### 2. Нет новых npm-зависимостей для жестов и анимаций

| Технология | Версия | Назначение | Почему хватает текущего стека | Уверенность |
|------------|--------|------------|-------------------------------|-------------|
| motion | 12.31.0 (уже есть) | Spring-анимации, page transitions | 40 файлов уже используют. `useSpring`, `useMotionValue`, `AnimatePresence` -- все инструменты для follow-finger. Обновить до ~12.35.x для последних bugfixes. | ВЫСОКАЯ |

**Действие:** Обновить motion до последней 12.x:

```bash
cd frontend && npm install motion@^12.35.0
```

**Что дает обновление до 12.35.x:**
- 12.34.0: `useScroll` с hardware accelerated animations
- 12.34.3: fix velocity transfer для spring анимаций (критично для follow-finger)
- 12.33.2: улучшенная детекция detached elements

**Источник:** [Motion Changelog](https://motion.dev/changelog), [npm motion](https://www.npmjs.com/package/motion) -- 12.35.1 подтверждена

---

## Архитектура follow-finger свайпов (без новых зависимостей)

Ключевое изменение -- НЕ в библиотеках, а в архитектуре анимации:

### Текущая архитектура (проблемная):

```
iframe touchstart → записать startX
iframe touchmove  → обновить offset в React state (setState)
iframe touchend   → навигация через rendition.next()/prev()
                    → setTimeout(300ms) → сбросить overlay
```

**Проблема:** `setState` на каждый touchmove -- React re-render каждые ~16ms. Overlay двигается, но СТРАНИЦА не двигается -- она переключается мгновенно в конце.

### Целевая архитектура (follow-finger):

```
iframe touchstart → создать MotionValue(0)
iframe touchmove  → motionValue.set(deltaX) -- БЕЗ setState
                    → CSS transform на container/overlay
iframe touchend   → velocity > threshold?
                    ДА: spring анимация до +-width → onComplete → rendition.next()/prev()
                    НЕТ: spring анимация до 0 (snap back)
```

**Ключевые технологии из motion (уже есть):**

| API | Назначение | Как использовать |
|-----|-----------|------------------|
| `useMotionValue(0)` | Отслеживание offset БЕЗ re-render | Обновлять из touchmove handler |
| `useTransform(x, [input], [output])` | Производные значения (opacity, scale) | Fade previous page по мере свайпа |
| `animate(motionValue, target, { type: 'spring' })` | Императивная spring-анимация | Завершение свайпа с физикой |
| `useMotionValueEvent(x, 'change', cb)` | Подписка на изменения | Отладка, boundary detection |

**Паттерн интеграции с iframe:**

```typescript
// В useSwipeNavigation.ts -- заменить setState на MotionValue
const offsetX = useMotionValue(0);

// touchmove handler (привязан к iframe document):
const handleTouchMove = (e: TouchEvent) => {
  const deltaX = e.touches[0].clientX - startX;
  offsetX.set(deltaX); // Нет setState, нет re-render
};

// touchend handler:
const handleTouchEnd = async (e: TouchEvent) => {
  const velocity = calculateVelocity();
  if (Math.abs(velocity) > VELOCITY_THRESHOLD || Math.abs(offsetX.get()) > WIDTH * 0.3) {
    // Свайп принят: spring к следующей странице
    const target = offsetX.get() > 0 ? viewportWidth : -viewportWidth;
    await animate(offsetX, target, {
      type: 'spring',
      stiffness: 300,
      damping: 30,
      velocity: velocity * 1000, // передаем скорость жеста
    });
    await onNavigate(target > 0 ? 'prev' : 'next');
    offsetX.set(0); // мгновенный сброс после навигации
  } else {
    // Свайп отменен: spring назад
    animate(offsetX, 0, {
      type: 'spring',
      stiffness: 400,
      damping: 35,
    });
  }
};
```

---

## PWA: Что доработать (без новых зависимостей)

PWA-стек уже полноценный. Доработки -- конфигурация и настройка, не новые библиотеки.

### 2.1 Manifest: улучшения для мобильной читалки

| Что изменить | Текущее | Рекомендуемое | Зачем |
|-------------|---------|---------------|-------|
| `display` | `standalone` | `standalone` (оставить) | Правильно для ридера. `fullscreen` убирает статус-бар -- плохо для iOS. |
| `orientation` | `portrait-primary` | Убрать или `any` | Многие читают landscape на планшетах. Не ограничивать. |
| `theme_color` | `#FFFFFF` | Динамический через meta tag | Должен меняться с темой (light/dark/sepia). Manifest фиксирован, но meta tag можно менять. |
| `icons` | 192px + 512px | Добавить 72px, 128px, 384px | iOS и Android запрашивают разные размеры для splash screen и home screen. |
| `screenshots` | Нет | Добавить 2-3 скриншота | Chrome показывает "richer install UI" со скриншотами (Chromium 118+). |

### 2.2 Service Worker: уже настроен правильно

Текущая конфигурация Workbox в `sw.ts` покрывает:
- Precaching static assets
- Runtime caching с правильными стратегиями (CacheFirst для шрифтов, StaleWhileRevalidate для API)
- Background sync для reading progress + image generation
- Navigation preload
- Push notifications с типизированными payload-ами
- Offline fallback
- iOS visibility/online fallback (через `iosSupport.ts`)

**Единственная доработка:** добавить кэширование EPUB-файлов для полного offline-чтения:

```typescript
// В sw.ts -- добавить route для скачанных книг
registerRoute(
  ({ url }) => url.pathname.match(/\/api\/v1\/books\/[^/]+\/download/) !== null,
  new CacheFirst({
    cacheName: 'epub-files-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 20, // Макс 20 книг offline
        maxAgeSeconds: 60 * 60 * 24 * 90, // 90 дней
      }),
    ],
  })
);
```

### 2.3 iOS-специфичные доработки

| Область | Текущее состояние | Что доработать |
|---------|-------------------|----------------|
| Safe area | `env(safe-area-inset-*)` используется в IOSTapZones | Проверить на всех страницах (library, settings) |
| Status bar | Нет `apple-mobile-web-app-status-bar-style` meta | Добавить `black-translucent` для edge-to-edge |
| Splash screens | Нет `apple-touch-startup-image` | Добавить для мгновенного запуска (без белого экрана) |
| Overscroll | `overscroll-behavior: none` в CSS | Убедиться что работает в standalone mode |
| 300ms delay | Не адресовано | `touch-action: manipulation` на интерактивных элементах |

---

## Существующий стек: обновления

| Технология | Текущая | Целевая | Зачем обновлять | Уверенность |
|------------|---------|---------|-----------------|-------------|
| motion | 12.31.0 | ~12.35.x | Bugfix velocity в spring анимациях (критично для follow-finger), hardware-accelerated scroll | ВЫСОКАЯ |
| vite-plugin-pwa | 1.2.0 | Оставить | Работает стабильно с injectManifest, нет breaking changes | ВЫСОКАЯ |
| workbox-* | 7.4.0 | Оставить | Последняя стабильная 7.x серия, активно поддерживается | ВЫСОКАЯ |

---

## Что НЕ добавлять

| Избегать | Почему | Использовать вместо |
|----------|--------|---------------------|
| `@use-gesture/react` | Не работает с iframe epub.js; дублирует motion; заброшен (2+ года без релиза) | Существующие raw touch events + motion MotionValue |
| `@use-gesture/vanilla` | Теоретически привязывается к DOM, но не тестирован с iframe, заброшен | Raw touch events через `rendition.hooks.content.register()` |
| `react-spring` | Дублирует motion (уже 40 файлов). Два animation runtime = больше bundle, больше когнитивной нагрузки | motion (уже интегрирован) |
| `hammer.js` | Заброшен с 2016 года, не поддерживает Pointer Events, не работает с iframe | Raw touch events |
| `swipeable-react` / `react-swipeable` | Работает только с React elements, не с iframe content | Raw touch events в iframe |
| `workbox-window` для update prompt | Уже есть `PWAUpdatePrompt.tsx` с кастомной логикой | Текущая реализация |
| Нативный `Pointer Events` вместо `Touch Events` | epub.js iframe на iOS не forwarding pointer events. Touch events работают через content hook. Переход на Pointer Events = регрессия на iOS. | Touch Events (текущий подход) |

---

## Паттерны по сценариям

**Для follow-finger свайпов:**
- Использовать `useMotionValue` + `useTransform` из motion (не setState)
- Touch events привязывать через `rendition.hooks.content.register()` к iframe document
- Spring анимация через `animate()` из motion
- Velocity передавать из жеста в spring для естественного ощущения

**Для page transition анимации:**
- Двухслойная архитектура: текущая страница (iframe) + overlay/next page preview
- CSS `will-change: transform` на анимируемых контейнерах
- `transform: translateX()` для GPU-ускорения (не `left`/`right`)

**Для iOS PWA:**
- IOSTapZones overlay остается (iframe touch events не работают на iOS в standalone)
- Свайпы на iOS -- через центральную зону IOSTapZones (уже реализовано)
- `touch-action: pan-x pan-y` (не `manipulation` -- он включает pinch-zoom)

**Для offline чтения:**
- EPUB файлы кэшировать через CacheFirst + ExpirationPlugin
- IndexedDB (Dexie) для глав и метаданных -- уже реализовано
- Background sync для прогресса -- уже реализовано

---

## Матрица совместимости версий

| Пакет | Совместим с | Примечания |
|-------|-------------|------------|
| motion 12.35.x | React 19, TypeScript 5.7, Vite 7 | Полная совместимость, tree-shakeable |
| vite-plugin-pwa 1.2.0 | Vite 7.x, Workbox 7.x | Стабилен, injectManifest mode |
| workbox 7.4.0 | Chrome 80+, Safari 15.4+, Firefox 85+ | Background Sync только Chrome; iOS fallback через visibility events |
| epub.js 0.3.93 | Все браузеры, но iOS requires spread('none') fix | Наш useEpubIOSFixes.ts решает известные проблемы |

---

## Сводка по установке

### Единственная npm-команда:

```bash
cd frontend && npm install motion@^12.35.0
```

**Это все.** Никаких новых зависимостей. Вся работа -- рефакторинг существующего кода:

1. `useSwipeNavigation.ts` -- переписать на MotionValue вместо useState
2. `SwipeOverlay.tsx` -- привязать transform к MotionValue
3. `IOSTapZones.tsx` -- добавить swipe velocity tracking
4. `manifest.json` -- orientation, screenshots, дополнительные иконки
5. `sw.ts` -- добавить route для EPUB files cache
6. HTML meta tags -- apple-mobile-web-app-status-bar-style, splash screens

---

## Источники

- [Motion Changelog](https://motion.dev/changelog) -- версии 12.33-12.35, bugfixes для spring velocity (ВЫСОКАЯ уверенность)
- [Motion React Gestures](https://motion.dev/docs/react-gestures) -- pan, drag, gesture API (ВЫСОКАЯ уверенность)
- [Motion React Drag](https://motion.dev/docs/react-drag) -- drag animation guide (ВЫСОКАЯ уверенность)
- [npm motion 12.35.1](https://www.npmjs.com/package/motion) -- версия подтверждена (ВЫСОКАЯ уверенность)
- [npm @use-gesture/react 10.3.1](https://www.npmjs.com/package/@use-gesture/react) -- последний релиз 2+ года назад (ВЫСОКАЯ уверенность)
- [GitHub pmndrs/use-gesture](https://github.com/pmndrs/use-gesture) -- документация по vanilla variant (СРЕДНЯЯ уверенность)
- [epub.js Tips and Tricks v0.3](https://github.com/futurepress/epub.js/wiki/Tips-and-Tricks-(v0.3)) -- swipe implementation patterns (ВЫСОКАЯ уверенность)
- [epub.js Issue #34 -- Page transition animation](https://github.com/futurepress/epub.js/issues/34) -- community approach (СРЕДНЯЯ уверенность)
- [Vite PWA injectManifest Guide](https://vite-pwa-org.netlify.app/guide/inject-manifest) -- конфигурация (ВЫСОКАЯ уверенность)
- [Workbox Background Sync Issue #2516](https://github.com/GoogleChrome/workbox/issues/2516) -- iOS fallback (ВЫСОКАЯ уверенность)
- [PWA iOS Limitations](https://brainhub.eu/library/pwa-on-ios) -- обзор ограничений iOS 2025 (СРЕДНЯЯ уверенность)
- [PWA iOS Complete Guide](https://www.mobiloud.com/blog/progressive-web-apps-ios) -- 2026 обзор (СРЕДНЯЯ уверенность)
- [Apple Safe Area CSS](https://gist.github.com/cvan/6c022ff9b14cf8840e9d28730f75fc14) -- env(safe-area-inset) patterns (ВЫСОКАЯ уверенность)
- [CSS-Tricks Simple Swipe](https://css-tricks.com/simple-swipe-with-vanilla-javascript/) -- vanilla swipe pattern (СРЕДНЯЯ уверенность)
- [Motion useSpring](https://www.framer.com/motion/use-spring/) -- spring physics API (ВЫСОКАЯ уверенность)

---
*Исследование стека для: Mobile/PWA Reader v1.1*
*Исследовано: 2026-03-09*
