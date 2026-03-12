---
phase: 19.2
type: research
created: 2026-03-12
trigger: "Все 4 UAT-бага воспроизводятся на Pixel 9 после выполнения фазы 19.2"
---

# Исследование: почему фиксы 19.2 не работают на реальном устройстве

## Симптомы (Pixel 9, Chrome + PWA)

1. **BUG-1 (Touch to Search):** selectstart listener не подавляет Chrome Touch to Search
2. **BUG-5 (iframe coords):** тапы не попадают по интерактивным элементам
3. **BUG-4 (annotation timing):** аннотация появляется на ~0.5с, потом ИСЧЕЗАЕТ
4. **BUG-4 (delete):** при удалении аннотация пропадает на ~0.5с, потом ВОЗВРАЩАЕТСЯ
5. Баги универсальные (Chrome browser + PWA, вероятно и iOS)

## Корневая причина: ResizeObserver cascade

### Цепочка событий

```
1. DOM span wrapping (добавление/удаление аннотации) меняет размеры контента
2. ResizeObserver в contents.js детектирует изменение (или polling fallback 350ms)
3. resizeCheck() → emit CONTENTS.RESIZE
4. IframeView: expand() + layout.format(contents) — полный CSS re-apply
5. DefaultViewManager.resize() → this.clear() — УНИЧТОЖАЕТ ВСЕ VIEWS
6. Rendition.onResized() → this.display(cfi) — полная пересоздание DOM
7. Кастомные span-аннотации ПОТЕРЯНЫ (DOM пересоздан с нуля)
```

### Дополнительная причина: конфликт highlighting-систем

- `useDescriptionHighlighting` (100ms debounce): TreeWalker НЕ пропускает `.user-annotation` spans
- `useEntityNameHighlighting` (150ms debounce): та же проблема
- `normalize()` при cleanup сливает text nodes, ломая структуру аннотаций
- CSS конфликт: `useContentHooks` padding vs `layout.format()` padding — оба с !important

### Почему built-in annotations выживают

Built-in система (`rendition.annotations`) использует:
1. SVG overlay (marks-pane) — отдельный от DOM контента
2. `hooks.render` для re-injection при каждом re-render
3. `hooks.unloaded` для cleanup при уничтожении view

## Исследованные альтернативы

### intity/epub-js fork (v0.3.96)
- **Вердикт: НЕ подходит**
- 1118 коммитов впереди, серьёзный рефакторинг
- Аннотации через SVG overlay (мы отвергли — нет text-color/bold)
- Touch to Search и iframe coords не затронуты
- Нет TypeScript типов, 39 звёзд, breaking API changes
- Lifecycle чище, но проблему DOM wipe не решает для span wrapping

### foliate-js
- **Вердикт: НЕ мигрировать сейчас**
- SVG overlayer решает annotation persistence, но без text-color/bold
- Тоже использует iframes — touch/coordinate проблемы останутся
- API нестабильный ("Expect it to break"), нет TypeScript
- Миграция 31 файл, 8750 строк, 4-6 недель
- Readest (18.7k stars) — production пример foliate-js + React

### Readium ts-toolkit
- TypeScript-first, институциональная поддержка
- Слишком сложная архитектура для наших нужд
- 132 звезды, спарсе документация

## Рекомендуемый план фиксов (Phase 19.3)

### 1. Защита DOM-структуры аннотаций
- Добавить `.user-annotation` в skip-filter TreeWalker'ов в useDescriptionHighlighting и useEntityNameHighlighting
- Предотвращает разрушение annotation spans другими highlighting-системами

### 2. Стабилизация resize cascade
- Временно disconnect ResizeObserver перед применением аннотаций
- Или: фиксировать `_size` в contents перед мутацией → resizeCheck() не видит изменений
- Устранить CSS конфликт padding между useContentHooks и layout.format()

### 3. Re-apply через hooks.render
- Зарегистрировать аннотации через `rendition.hooks.render` (как built-in система)
- Аннотации переприменяются при каждом view re-render

### 4. Правильный порядок highlighting
- Аннотации применяются ПОСЛЕ description/entity highlighting (debounce 200ms+)
- Или: "all highlighting done" signal координирует порядок

### 5. Chrome Touch to Search
- `-webkit-user-select: none` на iframe body (из Chrome docs)
- `role="button"` или ARIA widget role на элементах

## Источники

- epub.js source: contents.js (ResizeObserver), iframe.js (resize handlers), rendition.js (afterDisplayed)
- epub.js issues: #1164, #909, #952, #970, #1384
- epubjs-tips: redrawAnnotations workaround
- Hypothesis: migrated from DOM injection to SVG overlay (issues #1136, #1144)
- Chrome Touch to Search: developer.chrome.com/blog/tap-to-search
- intity/epub-js: github.com/intity/epub-js (v0.3.96)
- foliate-js: github.com/johnfactotum/foliate-js
- Readium ts-toolkit: github.com/readium/ts-toolkit
- Readest: github.com/readest/readest (production foliate-js + React)
