# Промпт для Google Stitch: iOS-приложение fancai

> **Для генеративного AI-сервиса создания мобильных дизайнов**

---

## 🎯 ОБЩЕЕ ОПИСАНИЕ ПРОЕКТА

### Название приложения
**fancai** (фанкай) — приложение для чтения книг с AI-генерацией иллюстраций

### Платформа
- **iPhone** (iOS 17+, оптимизация под iOS 18/26)
- **iPad** (Universal App)

### Язык интерфейса
- Русский (основной)
- Английский (дополнительный)

### Концепция
Премиальное приложение для чтения электронных книг (EPUB/FB2) с уникальной функцией: AI автоматически извлекает описания персонажей, локаций и сцен из текста и генерирует по ним изображения с сохранением визуальной консистентности на протяжении всей книги.

### Целевая аудитория
- Любители художественной литературы 18-45 лет
- Читатели фэнтези, романов, фантастики
- Визуально-ориентированные пользователи
- Технически продвинутые пользователи, ценящие AI-инновации

---

## 🎨 ДИЗАЙН-СИСТЕМА

### Цветовая палитра

#### Light Theme
```
Primary:        #6366F1 (Indigo 500 — AI, магия, технологии)
Primary Variant: #4338CA (Indigo 700)
Secondary:      #F59E0B (Amber 500 — тепло, книги)
Background:     #FFFFFF
Surface:        #F9FAFB (Gray 50)
On Primary:     #FFFFFF
On Background:  #111827 (Gray 900)
On Surface:     #374151 (Gray 700)
Error:          #EF4444 (Red 500)
Success:        #10B981 (Emerald 500)
```

#### Dark Theme
```
Primary:        #818CF8 (Indigo 400)
Primary Variant: #6366F1 (Indigo 500)
Secondary:      #FBBF24 (Amber 400)
Background:     #0F172A (Slate 900)
Surface:        #1E293B (Slate 800)
On Primary:     #FFFFFF
On Background:  #F1F5F9 (Slate 100)
On Surface:     #CBD5E1 (Slate 300)
Error:          #F87171 (Red 400)
Success:        #34D399 (Emerald 400)
```

#### Sepia Theme (Reader)
```
Background:     #F4ECD8
Surface:        #EDE5D0
Text:           #5B4636
Accent:         #8B7355
```

### Типографика

#### Шрифты
- **Заголовки:** SF Pro Display (Bold, Semibold)
- **Основной текст:** SF Pro Text (Regular, Medium)
- **Reader шрифты (пользовательский выбор):**
  - Georgia (по умолчанию для чтения)
  - New York (Apple serif)
  - Palatino
  - SF Pro
  - Literata (Google Fonts)

#### Размеры
```
Display Large:   34pt / Bold
Title 1:         28pt / Bold
Title 2:         22pt / Bold
Title 3:         20pt / Semibold
Headline:        17pt / Semibold
Body:            17pt / Regular
Callout:         16pt / Regular
Subheadline:     15pt / Regular
Footnote:        13pt / Regular
Caption 1:       12pt / Regular
Caption 2:       11pt / Regular
```

### Отступы и сетка
```
Base unit:       4pt
Padding XS:      8pt
Padding S:       12pt
Padding M:       16pt
Padding L:       24pt
Padding XL:      32pt
Corner Radius S: 8pt
Corner Radius M: 12pt
Corner Radius L: 16pt
Corner Radius XL: 24pt
```

### Иконки
- **Система:** SF Symbols (Apple native)
- **Стиль:** Filled или Outlined в зависимости от выделенности
- **Размеры:** 20pt (inline), 24pt (toolbar), 28pt (tabs), 44pt (buttons)

### iOS 18/26 Liquid Glass Design
- Использовать материалы с полупрозрачностью (`.ultraThinMaterial`, `.regularMaterial`)
- Размытие фона (Gaussian blur) для модальных окон
- Плавные анимации с пружинными эффектами
- Адаптивные цвета, реагирующие на контент

---

## 📱 ПОЛНЫЙ СПИСОК ЭКРАНОВ

### 1. Onboarding Flow (4 экрана)

#### 1.1 Welcome Screen
- Логотип fancai (анимированный)
- Tagline: "Читайте книги. Оживляйте героев."
- Индикатор страниц (PageControl)
- Кнопка "Пропустить" (опционально)

#### 1.2 Feature: Reading
- Иллюстрация: книга с текстом
- Заголовок: "Читайте любимые книги"
- Описание: "EPUB и FB2 форматы с настройкой шрифтов и тем"

#### 1.3 Feature: AI Generation
- Иллюстрация: sparkles + портрет персонажа
- Заголовок: "AI-иллюстрации"
- Описание: "Визуализируйте персонажей и локации одним касанием"

#### 1.4 Get Started
- Крупная кнопка "Начать"
- Переход к авторизации

---

### 2. Authentication (5 экранов)

#### 2.1 Login Screen
- Логотип fancai (меньше, чем в onboarding)
- **Sign in with Apple** (крупная чёрная кнопка, нативный стиль)
- **Sign in with Google** (белая кнопка с лого Google)
- Разделитель "или"
- Поля: Email, Password
- Кнопка "Войти"
- Ссылки: "Забыли пароль?", "Создать аккаунт"

#### 2.2 Registration Screen
- Поля: Имя, Email, Password, Confirm Password
- Чекбокс согласия с условиями
- Кнопка "Зарегистрироваться"
- Ссылка: "Уже есть аккаунт?"

#### 2.3 Forgot Password
- Поле Email
- Кнопка "Отправить ссылку"
- Иллюстрация с конвертом

#### 2.4 Email Verification (опционально)
- Иллюстрация: конверт с галочкой
- Текст: "Проверьте почту"
- Кнопка "Открыть почту"
- Ссылка: "Отправить повторно"

#### 2.5 Complete Profile (после первого входа)
- Загрузка аватара (с камеры или галереи)
- Поле имени
- Выбор возрастной группы (до 18 / 18+)
- Кнопка "Готово"

---

### 3. Main Tab Bar (5 вкладок)

```
┌──────────────────────────────────────┐
│                                      │
│           [Content Area]             │
│                                      │
├──────────────────────────────────────┤
│  📚      🖼️      📖      📊      ⚙️   │
│ Library Gallery  Reader  Stats  Settings
└──────────────────────────────────────┘
```

#### Tab Icons (SF Symbols)
- Library: `books.vertical.fill`
- Gallery: `photo.on.rectangle.angled`
- Reader: `book.fill` (текущая книга)
- Stats: `chart.bar.fill`
- Settings: `gearshape.fill`

---

### 4. Library (Библиотека) — 6 экранов

#### 4.1 Library Main (Grid View)
- **Navigation Bar:**
  - Title: "Библиотека"
  - Trailing: Grid/List toggle, Add button (+)
- **Search Bar** (iOS native, collapsible)
- **Filter Chips:** Все, Читаю, Прочитано, Отложено
- **Books Grid:** 3 колонки на iPhone, 5-6 на iPad
  - Обложка книги (aspect ratio 2:3)
  - Название (1 строка, truncate)
  - Автор (1 строка, secondary color)
  - Progress bar (если начата)
- **Empty State:** Иллюстрация + "Добавьте первую книгу" + кнопка

#### 4.2 Library List View
- Обложка (миниатюра 60x90pt)
- Название, Автор
- Прогресс (%)
- Дата последнего чтения
- Chevron для перехода

#### 4.3 Add Book Sheet
- Модальный sheet (.medium height)
- Опции:
  - "Файлы" (Files.app)
  - "iCloud Drive"
  - "Dropbox"
  - "Google Drive"
  - "OPDS-каталог"

#### 4.4 Book Detail Page
- Hero: Обложка (крупная, 200pt height)
- Название (Title 1)
- Автор (с иконкой person)
- Рейтинг (звёзды, если есть оценки)
- **Кнопки действий (горизонтальный ряд):**
  - "Читать" (Primary, filled)
  - "AI ✨" (Secondary, outlined) — запуск обработки
  - "..." (More menu)
- **Секции (в ScrollView):**
  - Аннотация (expandable)
  - Метаданные (издательство, год, ISBN)
  - Прогресс чтения (bar + stats)
  - AI-сущности (если обработана)
  - Похожие книги (горизонтальный scroll)
- **Bottom Action Sheet (при нажатии "..."):**
  - Добавить в коллекцию
  - Поделиться
  - Редактировать метаданные
  - Удалить

#### 4.5 Collections View
- Список коллекций (как папки)
- Иконка + Название + Количество книг
- Кнопка создания коллекции (+)

#### 4.6 Collection Detail
- Grid/List книг в коллекции
- Редактирование (название, описание, обложка)
- Toggle: Публичная / Приватная

---

### 5. Reader (Чтение) — 8 экранов/состояний

#### 5.1 Reader Main (Book Open)
- **Полноэкранный текст книги**
- Шрифт, размер, межстрочный интервал по настройкам
- Tap-зоны: левый край (назад), центр (меню), правый край (вперёд)
- Status bar скрыт или полупрозрачный
- **AI Highlights:** Описания персонажей/локаций подсвечены (настраиваемый цвет)

#### 5.2 Reader Overlay Menu (при тап по центру)
- Появляется с анимацией slide + fade
- **Top Bar:**
  - Back button (← к библиотеке)
  - Название книги (truncated)
  - Bookmark toggle
  - Search button
  - Settings button (Aa)
- **Bottom Bar:**
  - Page indicator: "Стр. 42 из 320"
  - Progress slider
  - Time remaining: "~15 мин до конца главы"
  - Chapter picker button

#### 5.3 Reader Settings Sheet
- Sheet от нижнего края (.medium)
- **Секция "Шрифт":**
  - Picker шрифта (horizontal scroll: Georgia, Palatino, SF Pro...)
  - Slider размера (Aa с превью)
- **Секция "Тема":**
  - Segmented Control: Light / Dark / Sepia / System
  - Color swatches для preview
- **Секция "Интервалы":**
  - Slider межстрочного интервала (1.0 — 2.0)
  - Slider полей (узкие / средние / широкие)
- **Секция "Навигация":**
  - Toggle: Tap-зоны / Swipe-жесты
  - Picker анимации: Curl / Slide / Fade
  - Toggle: Звук перелистывания
- Кнопка "Сбросить настройки"

#### 5.4 Table of Contents (TOC)
- Sheet (.large) или full screen modal
- Иерархический список глав
- Текущая глава выделена (Primary color)
- Progress indicator для каждой главы
- Поиск по оглавлению

#### 5.5 Search in Book
- Full-screen modal
- Search bar (autofocus)
- Results list:
  - Контекст (фрагмент текста с подсветкой query)
  - Глава / Страница
- Tap → переход к месту

#### 5.6 Bookmarks List
- Sheet или modal
- Список закладок:
  - Preview текста
  - Дата создания
  - Глава
  - Swipe-to-delete

#### 5.7 Highlights & Notes
- Список выделений:
  - Цветовая метка (желтый, зеленый, синий, розовый)
  - Выделенный текст
  - Заметка пользователя (если есть)
  - Глава / Дата
- Фильтр по цвету
- Export button

#### 5.8 Text Selection Popover
- При долгом нажатии на слово → выделение
- Popover меню:
  - Copy
  - Highlight (с выбором цвета)
  - Add Note
  - Search in Book
  - Define (словарь)
  - Share Quote

---

### 6. AI Features — 7 экранов

#### 6.1 Book Processing Progress
- Modal или inline на Book Detail
- Circular progress indicator
- "Обработка книги..." / "Глава 5 из 24"
- Estimated time remaining
- Cancel button

#### 6.2 Dynamic Island & Live Activity
- **Dynamic Island (compact):** Иконка книги + прогресс %
- **Dynamic Island (expanded):** Название + прогресс bar + время
- **Lock Screen Live Activity:** Обложка + название + прогресс

#### 6.3 Entities List (Post-processing)
- На Book Detail page или отдельный экран
- Tabs: Персонажи / Локации / Объекты / Сцены
- Grid или List карточек сущностей:
  - Миниатюра (если есть изображение) или placeholder
  - Имя/Название
  - Count: "3 описания"
  - Badge: "Сгенерировано" (если есть изображения)

#### 6.4 Entity Detail Card
- Modal sheet (.large)
- **Header:**
  - Изображение (если сгенерировано) или placeholder
  - Имя/Название (Title 1)
  - Тип: "Персонаж" / "Локация"
- **Секция "Описания из книги":**
  - Список цитат (expandable)
  - Глава + страница для каждой
  - Tap на описание → подсветить в reader
- **Секция "Изображения":**
  - Горизонтальный scroll сгенерированных изображений
  - Кнопка "Сгенерировать" (Primary, prominent)
- **Action buttons:**
  - Share Entity
  - Add to Favorites

#### 6.5 Image Generation Sheet
- Modal sheet
- Preview описания (read-only)
- **Style Picker (horizontal scroll):**
  - Realistic (по умолчанию)
  - Digital Art
  - Anime
  - Watercolor
  - Oil Painting
  - Sketch
  - Fantasy Art
- **Reference Image (если есть предыдущие):**
  - Toggle: "Сохранить стиль персонажа"
  - Preview reference
- Кнопка "Сгенерировать" (large, Primary)
- Лимит: "Осталось 42 генерации"

#### 6.6 Generation Progress
- Fullscreen modal или overlay
- Animated sparkles / loading animation
- "Создаём изображение..."
- Progress indicator
- Cancel option

#### 6.7 Image Viewer (Fullscreen)
- Fullscreen modal
- Pinch-to-zoom
- Swipe between images (если несколько)
- **Bottom Actions:**
  - Favorite (heart toggle)
  - Save to Photos
  - Share
  - Info (prompt, date, style)
  - Regenerate
- Close button (X) top-right

---

### 7. Gallery — 3 экрана

#### 7.1 Gallery Main
- Navigation tabs: Все / Персонажи / Локации / Избранное
- Masonry grid или Pinterest-style layout
- Фильтр по книге (picker)
- Search по описанию

#### 7.2 Gallery Image Detail
- Тот же Image Viewer (6.7)
- Additional info: Книга, Сущность, Стиль

#### 7.3 Gallery Empty State
- Иллюстрация с sparkles
- "Ещё нет изображений"
- "Обработайте книгу и сгенерируйте первую иллюстрацию"
- CTA button → к библиотеке

---

### 8. Statistics — 4 экрана

#### 8.1 Stats Dashboard
- **Hero Card:** Время чтения сегодня (крупно)
- **Stats Grid (2x2):**
  - Книг прочитано
  - Страниц прочитано
  - Текущий streak
  - Изображений создано
- **Weekly Chart:** Bar chart времени чтения по дням (как GitHub contributions)
- **Monthly Progress:** к годовой цели
- **Recent Books:** горизонтальный scroll

#### 8.2 Reading History
- Список прочитанных книг
- Обложка + Название + Дата завершения + Время чтения
- Фильтры по году/месяцу

#### 8.3 Goals Setting
- Daily Goal: Picker (15 / 30 / 45 / 60 мин)
- Books Goal: "[X] книг в год"
- Notifications: Toggle + Time picker

#### 8.4 Achievements
- Grid достижений (3 колонки)
- Иконка (цветная если получено, серая если нет)
- Название
- Progress bar (если частично)
- Modal с полным описанием при тап

---

### 9. Settings — 8 экранов

#### 9.1 Settings Main
- Grouped List (iOS style)
- **Секция "Аккаунт":**
  - Профиль (avatar + name + chevron)
  - Подписка
  - Связанные аккаунты
- **Секция "Чтение":**
  - Шрифт и тема по умолчанию
  - Навигация
  - Звуки
- **Секция "AI-генерация":**
  - Стиль по умолчанию
  - Категории описаний
- **Секция "Уведомления":**
  - Push-уведомления
  - Напоминания
- **Секция "Хранилище":**
  - Использование (с графиком)
  - Очистить кэш
- **Секция "О приложении":**
  - Версия
  - FAQ
  - Политика конфиденциальности
  - Условия использования
- **Danger Zone:**
  - Удалить аккаунт (red text)

#### 9.2 Profile View
- Avatar (editable)
- Name (editable)
- Email (read-only)
- Public profile toggle
- Age setting
- Stats summary

#### 9.3 Subscription Status
- Current plan card (Free / Pro)
- Usage meters:
  - Книги обработано: X / 3
  - Генерации: X / 100
  - Офлайн-книги: X / 10
- CTA: "Перейти на Pro" (если Free)
- Manage subscription button (если Pro)

#### 9.4 Paywall
- Full-screen modal
- Hero: "fancai Pro"
- Animated features list:
  - ✓ 300 генераций в месяц
  - ✓ 10 книг в обработке
  - ✓ 100 офлайн-книг
  - ✓ Все стили генерации
  - ✓ Приоритетная поддержка
- Price: "699 ₽ / месяц"
- Subscribe button (large)
- Restore purchases link
- Terms & Privacy links

#### 9.5 Notifications Settings
- Push toggle
- Types toggles:
  - Книга обработана
  - Изображение готово
  - Напоминания о чтении
  - Streak под угрозой
- Reminder time picker

#### 9.6 Storage Management
- Pie chart: Книги / Изображения / Кэш
- Details list:
  - Книги: X.X GB
  - Изображения: X.X GB
  - Кэш: X.X MB
- Clear cache button
- Auto-cleanup toggle

#### 9.7 Delete Account
- Warning screen (red accent)
- Consequences list
- Export data button
- Confirmation text field ("DELETE")
- Delete button (destructive)

#### 9.8 About
- App logo
- Version number
- Build number
- Developer info
- Links: Website, Twitter, Support email

---

### 10. Quote Sharing — 2 экрана

#### 10.1 Quote Card Editor
- Full-screen modal
- **Preview Card:**
  - Quote text (styled)
  - Book title + Author
  - Book cover (small)
  - fancai logo
- **Customization:**
  - Background: Color picker / Gradient / Image
  - Font: Picker
  - Layout: Picker (centered / left / card)
- Share button

#### 10.2 Image Share Editor
- Similar to Quote
- Generated image preview
- Watermark toggle
- Format: Square / Story (9:16)
- Share button

---

### 11. System Features — 4 компонента

#### 11.1 Widgets (Home Screen)
- **Small (2x2):**
  - Current book cover
  - Progress bar
- **Medium (4x2):**
  - Cover + Title + Author
  - Progress + Time remaining
  - "Continue Reading" label
- **Large (4x4):**
  - Cover
  - Title + Author
  - Progress
  - Stats: Today's reading, Streak

#### 11.2 Lock Screen Widgets
- **Inline:** Streak icon + number
- **Circular:** Progress ring + book icon
- **Rectangular:** Cover + progress

#### 11.3 Quick Actions (App Icon)
- Continue Reading
- Add Book

#### 11.4 What's New Screen
- Page-based modal
- New features with illustrations
- "Got it" button

---

## 📐 IPAD АДАПТАЦИЯ

### Layout
- **Portrait:** Sidebar (collapsible) + Main content
- **Landscape:** Permanent sidebar + Main content + Detail panel

### Reader on iPad
- **Portrait:** Single column
- **Landscape:** 2 columns (configurable)
- Side panel for TOC/Bookmarks/Notes

### Split View
- Support for multitasking
- Minimum width: 320pt

---

## ♿ ACCESSIBILITY

- Support Dynamic Type (all text scales)
- VoiceOver labels for all interactive elements
- Minimum touch target: 44x44pt
- Sufficient color contrast (WCAG AA)
- Reduce Motion support (alternative animations)
- Bold Text support

---

## 🎬 ANIMATIONS

### Transitions
- Page navigation: `push/pop` with spring
- Modal presentation: `slide up` with fade
- Tab switching: `crossfade`

### Micro-interactions
- Button tap: `scale(0.95)` with haptic
- Bookmark toggle: `scale + rotate` animation
- Image generation: `sparkle burst` animation
- Progress completion: `confetti` or `pulse`
- Pull-to-refresh: custom book animation

### Loading States
- Skeleton screens (not spinners) for content
- Shimmer effect for loading cards
- Lottie animations for empty states

---

## 📏 SAFE AREAS

- Respect all iOS safe areas
- Bottom padding for home indicator
- Notch/Dynamic Island clearance
- Keyboard avoidance for inputs

---

## 🔢 DESIGN TOKENS SUMMARY

```
// Colors
--color-primary: #6366F1
--color-secondary: #F59E0B
--color-background: var(--system-background)
--color-surface: var(--system-surface)
--color-error: #EF4444

// Typography
--font-display: SF Pro Display
--font-body: SF Pro Text
--font-reader: Georgia

// Spacing
--space-xs: 4pt
--space-s: 8pt
--space-m: 16pt
--space-l: 24pt
--space-xl: 32pt

// Radius
--radius-s: 8pt
--radius-m: 12pt
--radius-l: 16pt
--radius-full: 9999pt

// Shadows (Light mode)
--shadow-s: 0 1pt 3pt rgba(0,0,0,0.1)
--shadow-m: 0 4pt 6pt rgba(0,0,0,0.1)
--shadow-l: 0 10pt 15pt rgba(0,0,0,0.1)
```

---

## ✅ CHECKLIST FOR DESIGN GENERATION

- [ ] All 50+ screens designed
- [ ] Light and Dark themes for every screen
- [ ] Sepia theme for Reader
- [ ] iPhone (6.7") and iPad (12.9") layouts
- [ ] All states: Empty, Loading, Error, Success
- [ ] Consistent use of SF Symbols
- [ ] Liquid Glass materials where appropriate
- [ ] Accessibility compliance
- [ ] Animation/transition specifications
- [ ] Design tokens documented
- [ ] iOS 18 HIG compliance

---

## 📎 REFERENCES

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [SF Symbols](https://developer.apple.com/sf-symbols/)
- iOS 18 Liquid Glass design language
- Competitors: Kindle, Apple Books, Bookmate, LitRes

---

**END OF PROMPT**
