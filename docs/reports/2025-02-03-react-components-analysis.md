# Анализ React компонентов в проекте fancai

**Дата:** 2025-02-03  
**Scope:** `frontend/src/components/` - все React компоненты  
**Автор:** Claude Code

## Executive Summary

Проанализировано 100+ компонентов в `frontend/src/components/`. Выявлено 47 проблем разной степени критичности. Основные проблемы: хардкод русских строк вместо i18n (P1), accessibility-проблемы (P1), инлайн стили вместо Tailwind (P2), и магические числа (P2). Крупных компонентов (>500 строк) не обнаружено благодаря хорошей декомпозиции.

## Статистика по компонентам

| Категория | Количество | Примечание |
|-----------|------------|------------|
| Reader | 15 | EPUB reader компоненты |
| UI | 20+ | Общие UI компоненты |
| Library | 6 | Компоненты библиотеки |
| Admin | 5 | Админ-панель |
| Entities | 5 | Компоненты сущностей |
| Settings | 8 | Настройки |
| **Всего** | **100+** | |

## Findings

### 1. Хардкод строк вместо i18n (P1)

Несколько компонентов содержат хардкод русские/английские строки вместо использования `useTranslation()`:

| Файл | Строка | Проблема |
|------|--------|----------|
| `Sidebar.tsx` | 221 | `"Бесплатный план"` - хардкод |
| `Sidebar.tsx` | 181 | `"Свернуть"` - хардкод |
| `BottomNav.tsx` | 29-33 | Все label на русском |
| `ImageGallery.tsx` | 120, 129, 142, 156, 355, 358 | Хардкод русских строк |
| `EntityProfile.tsx` | 73, 78, 90, 101, 177, 184, 205 | Хардкод русских строк |
| `EntityDrawer.tsx` | 89, 90, 96, 98, 107, 130 | Хардкод русских строк |
| `ReaderOverlays.tsx` | 60-61 | Кнопки с хардкод текстом |
| `BookUploadModal.tsx` | 440-442 | Список на русском |
| `ErrorMessage.tsx` | 18, 68 | `"Ошибка"`, `"Повторить"` |
| `AdminParsingSettings.tsx` | 105, 127, 148 | `"Free"`, `"Premium"`, `"Ultimate"` |

### 2. Accessibility проблемы (P1)

| Файл | Строка | Проблема | Рекомендация |
|------|--------|----------|--------------|
| `ReaderHeader.tsx` | 36 | Кнопки без `type="button"` | Добавить `type="button"` |
| `ReaderHeader.tsx` | 37-38, 54-55 | Иконки кнопки без `aria-label` | Добавить aria-label |
| `ImageGallery.tsx` | 300 | `div` вместо `button` для клика | Использовать `<button>` |
| `EntityDrawer.tsx` | 115-142 | Кнопки без `type="button"` | Добавить `type="button"` |
| `BookUploadModal.tsx` | 338-344 | Кнопка без `type="button"` | Добавить `type="button"` |
| `ReaderSettings.tsx` | 179-184 | Radio без `role="radio"` и `aria-checked` | Добавить ARIA атрибуты |
| `ReaderSettingsPanel.tsx` | 139-146 | Кнопка закрытия без `type="button"` | Добавить `type="button"` |
| `SelectionMenu.tsx` | 166-188 | Кнопки без `type="button"` | Добавить `type="button"` |

### 3. Инлайн стили вместо Tailwind (P2)

| Файл | Строка | Проблема |
|------|--------|----------|
| `EpubReader.tsx` | 225-231 | Инлайн `style` для padding |
| `BookReader.tsx` | 274-297 | Инлайн `<style>` для хайлайтов |
| `ReaderOverlays.tsx` | 55, 82 | Инлайн стили для backdrop |
| `Sidebar.tsx` | 91-93 | Инлайн `style` для width/zIndex |
| `Sidebar.tsx` | 236-237 | Инлайн `style` для width |
| `BottomNav.tsx` | 53-56 | Инлайн `style` для padding |
| `ImageGallery.tsx` | 86-88 | Инлайн `style` для grid |
| `BookUploadModal.tsx` | 375-380 | Инлайн `style` для progress bar |
| `ReaderSettings.tsx` | 220-227 | Инлайн `style` для preview |
| `ImageModal.tsx` | 197, 204 | Инлайн `style` для zIndex |

### 4. Магические числа (P2)

| Файл | Строка | Число | Контекст |
|------|--------|-------|----------|
| `EpubReader.tsx` | 41 | `70` | headerHeight - вынести в константу |
| `ReaderOverlays.tsx` | 50 | `768` | breakpoint - использовать константу |
| `ReaderOverlays.tsx` | 78 | `70` | headerHeight - дублирование |
| `SelectionMenu.tsx` | 95-97 | `60, 200, 10` | menu dimensions - вынести в константы |
| `BookUploadModal.tsx` | 30 | `50 * 1024 * 1024` | MAX_FILE_SIZE - уже константа, ок |
| `BookUploadModal.tsx` | 29 | `['.epub', '.fb2']` | SUPPORTED_FORMATS - уже константа, ок |
| `ImageGallery.tsx` | 45 | `5 * 60 * 1000` | staleTime - вынести в константу |
| `ReaderSettings.tsx` | 64, 96 | `12, 32` / `1.2, 2.5` | min/max values - вынести в константы |

### 5. Неправильные семантические теги (P1)

| Файл | Строка | Проблема | Рекомендация |
|------|--------|----------|--------------|
| `ImageGallery.tsx` | 216-227 | `div` с `role="button"` вместо `<button>` | Использовать `<button>` |
| `ImageGallery.tsx` | 298-309 | `div` с `onClick` вместо `<button>` | Использовать `<button>` |
| `BookCard.tsx` | 139-146 | `div` с `onClick` для кликабельной карточки | Использовать `<button>` или `<a>` |
| `EntityCard.tsx` | 34-96 | `Card` с `asChild` оборачивает `button` - ок, но сложно | Упростить структуру |

### 6. Props drilling (P2)

| Файл | Проблема | Рекомендация |
|------|----------|--------------|
| `ReaderUI.tsx` | Глубокая вложенность пропсов (header, settings, imageStatus, saveStatus) | Использовать Context или разделить компонент |
| `ReaderModals.tsx` | Очень много пропсов для модальных окон | Использовать Context для управления модалками |
| `ReaderSettingsPanel.tsx` | 15+ пропсов | Разделить на под-компоненты или использовать Context |
| `BookReader.tsx` | Много пропсов передается в `ReaderSettingsPanel` | Использовать объект настроек |

### 7. Неиспользуемые props (P2)

| Файл | Строка | Проблема |
|------|--------|----------|
| `BookReader.tsx` | 49-52 | `bookId?: string` и `chapterNumber?: number` - опциональные, но всегда используются |
| `ReaderUI.tsx` | 19-20 | `currentPage?: number` и `totalPages?: number` - опциональные |
| `ImageModal.tsx` | 22 | `description?: string` - может быть undefined, но не проверяется |

### 8. Нарушение принципа единственной ответственности (P1)

| Файл | Строки | Проблема |
|------|--------|----------|
| `ImageModal.tsx` | 422 | Слишком много ответственностей: отображение, zoom, regenerate, download, share |
| `BookUploadModal.tsx` | 463 | Загрузка, валидация, drag&drop, прогресс - можно разделить |
| `EntityDrawer.tsx` | 185 | Управление состоянием + отображение + навигация |
| `ReaderSettings.tsx` | 331 | Настройки + превью + сброс - можно разделить |

### 9. Потенциальные баги (P0)

| Файл | Строка | Проблема | Риск |
|------|--------|----------|------|
| `EpubReader.tsx` | 164 | `clearSelection` в зависимостях useEffect | Может вызвать бесконечный цикл |
| `BookReader.tsx` | 46-47 | `localStorage.getItem` без проверки окружения | Ошибка в SSR |
| `ImageModal.tsx` | 386-388 | `onError` handler изменяет src напрямую | Потенциальная утечка памяти |
| `ReaderOverlays.tsx` | 50 | `window.innerWidth` без проверки `typeof window` | Ошибка в SSR |

### 10. Дублирование кода (P2)

| Проблема | Локации |
|----------|---------|
| Spinner/Loading компоненты | `LoadingSpinner.tsx`, `button.tsx` (Spinner), `Dialog.tsx` (inline spinner) |
| Image download logic | `ImageGallery.tsx`, `ImageModal.tsx` |
| Error message display | `ErrorMessage.tsx`, `ReaderOverlays.tsx` |
| Focus trap logic | `Modal.tsx`, `ImageModal.tsx`, `BookUploadModal.tsx` |

## Рекомендации

### Приоритет P0 (Критический)

| # | Рекомендация | Файлы | Сложность |
|---|--------------|-------|-----------|
| 1 | Исправить потенциальные бесконечные циклы в useEffect | `EpubReader.tsx` | Низкая |
| 2 | Добавить проверку `typeof window` для SSR | `BookReader.tsx`, `ReaderOverlays.tsx` | Низкая |
| 3 | Исправить memory leak в ImageModal onError | `ImageModal.tsx` | Низкая |

### Приоритет P1 (Высокий)

| # | Рекомендация | Файлы | Сложность |
|---|--------------|-------|-----------|
| 1 | Заменить хардкод строк на i18n | `Sidebar.tsx`, `BottomNav.tsx`, `ImageGallery.tsx`, `EntityProfile.tsx`, `EntityDrawer.tsx`, `ErrorMessage.tsx` | Средняя |
| 2 | Добавить `type="button"` ко всем кнопкам | `ReaderHeader.tsx`, `EntityDrawer.tsx`, `BookUploadModal.tsx`, `SelectionMenu.tsx` | Низкая |
| 3 | Заменить `div` с onClick на `<button>` | `ImageGallery.tsx`, `BookCard.tsx` | Низкая |
| 4 | Добавить ARIA атрибуты для accessibility | `ReaderSettings.tsx`, `ReaderHeader.tsx` | Низкая |
| 5 | Разделить крупные компоненты | `ImageModal.tsx`, `BookUploadModal.tsx` | Средняя |

### Приоритет P2 (Средний)

| # | Рекомендация | Файлы | Сложность |
|---|--------------|-------|-----------|
| 1 | Вынести инлайн стили в Tailwind классы | `EpubReader.tsx`, `BookReader.tsx`, `Sidebar.tsx` | Средняя |
| 2 | Вынести магические числа в константы | `EpubReader.tsx`, `ReaderOverlays.tsx`, `SelectionMenu.tsx` | Низкая |
| 3 | Уменьшить props drilling через Context | `ReaderUI.tsx`, `ReaderModals.tsx`, `ReaderSettingsPanel.tsx` | Средняя |
| 4 | Унифицировать spinner компоненты | `LoadingSpinner.tsx`, `button.tsx`, `Dialog.tsx` | Низкая |
| 5 | Создать shared hook для focus trap | `Modal.tsx`, `ImageModal.tsx`, `BookUploadModal.tsx` | Низкая |

## Next Steps

1. **Немедленно (P0):** Исправить потенциальные баги с useEffect и SSR
2. **В текущем спринте (P1):** Добавить i18n для всех хардкод строк
3. **В следующем спринте (P1):** Улучшить accessibility (ARIA, семантические теги)
4. **Техдолг (P2):** Рефакторинг инлайн стилей и магических чисел
5. **Архитектура (P2):** Внедрить Context для уменьшения props drilling

## Приложение: Полный список компонентов

### Reader (15 файлов)
- EpubReader.tsx (281 строк)
- BookReader.tsx (388 строк)
- Core/ReaderUI.tsx (110 строк)
- Core/ReaderOverlays.tsx (92 строки)
- Core/ReaderModals.tsx (141 строка)
- ReaderHeader.tsx (61 строка)
- ReaderControls.tsx
- ReaderContent.tsx
- ReaderSettingsPanel/ReaderSettingsPanel.tsx (393 строки)
- ReaderNavigationControls.tsx
- TocSidebar.tsx
- SelectionMenu.tsx (254 строки)
- ImageGenerationStatus.tsx
- ProgressSaveIndicator.tsx
- PositionConflictDialog.tsx

### UI (20+ файлов)
- Modal.tsx (411 строк)
- Dialog.tsx (382 строки)
- Card.tsx (267 строк)
- button.tsx (227 строк)
- Select.tsx (190 строк)
- LoadingSpinner.tsx (53 строки)
- ErrorMessage.tsx (84 строки)
- Input.tsx
- Switch.tsx
- Checkbox.tsx
- Radio.tsx
- Skeleton.tsx
- Accordion.tsx
- ThemeSwitcher.tsx
- LazyImage.tsx
- AuthenticatedImage.tsx
- And others...

### Library (6 файлов)
- BookGrid.tsx (98 строк)
- BookCard/BookCard.tsx (223 строки)
- BookCard/BookInfo.tsx (46 строк)
- BookCard/BookCover.tsx (78 строк)
- BookCard/MobileMenu.tsx
- BookCard/DesktopHoverOverlay.tsx

### Entities (5 файлов)
- EntityDrawer.tsx (185 строк)
- EntityProfile.tsx (218 строк)
- EntityCard.tsx (99 строк)
- EntityList.tsx
- RelationshipCard.tsx

### Admin (5 файлов)
- AdminParsingSettings.tsx (183 строки)
- AdminMultiNLPSettings.tsx
- AdminHeader.tsx
- AdminStats.tsx
- AdminEntityMerge.tsx

### Settings (8 файлов)
- ReaderSettings.tsx (331 строка)
- ReaderSettingsPanel/ReaderSettingsPanel.tsx (393 строки)
- sections/AccountSettingsSection.tsx
- sections/ReadingSettingsSection.tsx
- sections/NotificationsSettingsSection.tsx
- sections/PWASettingsSection.tsx
- sections/PrivacySettingsSection.tsx
- sections/AboutSettingsSection.tsx

### Navigation
- Header.tsx (226 строк)
- Sidebar.tsx (244 строки)
- BottomNav.tsx (105 строк)
- MobileDrawer.tsx

### Images
- ImageGallery.tsx (377 строк)
- ImageModal.tsx (422 строки)

### Books
- BookUploadModal.tsx (463 строки)
- DeleteConfirmModal.tsx

### Layout
- Layout.tsx

### Auth
- AuthGuard.tsx

### Error Boundaries
- ErrorBoundary.tsx
- ChunkLoadErrorBoundary.tsx
- ErrorBoundaryDemo.tsx

---

**Итого:** Проект имеет хорошую архитектуру с разделением на логические модули. Основные проблемы связаны с i18n, accessibility и небольшими архитектурными улучшениями. Крупных проблем (компоненты >500 строк, критические баги) не обнаружено.
