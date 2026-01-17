# Спецификация AI-функций для iOS приложения fancai

**Дата:** 2026-01-17
**Scope:** Детальная реализация AI-функций для iOS (iOS 18+, SwiftUI)
**Автор:** Claude Code

## Executive Summary

Исследование охватывает 10 ключевых AI-функций для iOS приложения fancai: типы описаний с настройками, карточки сущностей с графом отношений, highlight в EPUB, стили генерации, UX генерации изображений, просмотр и галерея изображений, офлайн-режим, обработка книги через Dynamic Island, и управление спойлерами.

---

## 1. Типы описаний

### 1.1 Поддерживаемые типы

На основе существующей модели `DescriptionType` в бэкенде:

| Тип | Приоритет | Обязательность | Описание |
|-----|-----------|----------------|----------|
| **CHARACTER** | 60 | Обязательный | Персонажи: внешность, одежда, эмоции |
| **LOCATION** | 75 | Отключаемый | Локации: интерьеры, экстерьеры, природа |
| **ATMOSPHERE** | 45 | Отключаемый | Атмосфера: время суток, погода, настроение |
| **OBJECT** | 40 | Отключаемый | Объекты: оружие, артефакты, транспорт |
| **ACTION** | 30 | Отключаемый | Сцены: битвы, церемонии, события |

### 1.2 UI настроек типов

```
┌─────────────────────────────────────────────┐
│ Extraction Settings                         │
├─────────────────────────────────────────────┤
│                                             │
│ ✓ Characters (required)            [●────]  │
│   Extract character appearances             │
│                                             │
│ ○ Locations                        [Toggle] │
│   Places, buildings, landscapes             │
│                                             │
│ ○ Scenes                           [Toggle] │
│   Actions, battles, ceremonies              │
│                                             │
│ ○ Objects                          [Toggle] │
│   Weapons, artifacts, items                 │
│                                             │
│ ○ Atmosphere                       [Toggle] │
│   Weather, mood, lighting                   │
│                                             │
├─────────────────────────────────────────────┤
│ Affects new book processing only.           │
│ Re-process existing books to apply changes. │
└─────────────────────────────────────────────┘
```

**SwiftUI реализация:**

```swift
struct ExtractionSettingsView: View {
    @AppStorage("extractCharacters") var extractCharacters = true
    @AppStorage("extractLocations") var extractLocations = true
    @AppStorage("extractScenes") var extractScenes = false
    @AppStorage("extractObjects") var extractObjects = false
    @AppStorage("extractAtmosphere") var extractAtmosphere = false

    var body: some View {
        Form {
            Section("Description Types") {
                // Characters - always enabled, shown as info
                HStack {
                    Label("Characters", systemImage: "person.fill")
                    Spacer()
                    Text("Required")
                        .foregroundStyle(.secondary)
                }

                Toggle(isOn: $extractLocations) {
                    Label("Locations", systemImage: "map.fill")
                }

                Toggle(isOn: $extractScenes) {
                    Label("Scenes", systemImage: "theatermasks.fill")
                }

                Toggle(isOn: $extractObjects) {
                    Label("Objects", systemImage: "cube.fill")
                }

                Toggle(isOn: $extractAtmosphere) {
                    Label("Atmosphere", systemImage: "cloud.sun.fill")
                }
            }

            Section {
                Text("Changes apply to new book processing only.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Extraction")
    }
}
```

---

## 2. Карточки сущностей

### 2.1 Референс: Kindle X-Ray

Amazon X-Ray предоставляет:
- Список персонажей/мест с кратким описанием
- Количество упоминаний в книге
- Навигацию к упоминаниям
- Минималистичный интерфейс без графики (в обновлённой версии)

**Наше улучшение:** Добавляем AI-генерированные портреты и визуальные описания.

### 2.2 Структура карточки персонажа

```
┌─────────────────────────────────────────────┐
│ ┌───────┐                                   │
│ │       │  Том Меррилин                     │
│ │ 🖼️    │  Gleeman, storyteller             │
│ │Portrait│                                   │
│ └───────┘  📍 45 appearances                │
│                                             │
├─────────────────────────────────────────────┤
│ DESCRIPTIONS                          See All│
├─────────────────────────────────────────────┤
│ Ch.4: "Высокий худощавый человек с         │
│ седеющими усами и хитрыми глазами..."      │
│                                             │
│ Ch.12: "На нём был плащ из разноцветных   │
│ лоскутов, развевающийся на ветру..."       │
│                                             │
├─────────────────────────────────────────────┤
│ IMAGES                                     4 │
├─────────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐                │
│ │    │ │    │ │    │ │ +  │                │
│ └────┘ └────┘ └────┘ └────┘                │
│                                             │
├─────────────────────────────────────────────┤
│ RELATIONSHIPS                               │
├─────────────────────────────────────────────┤
│ 🔗 Рэнд ал'Тор (appears together: 23x)     │
│ 🔗 Морейн (appears together: 15x)          │
└─────────────────────────────────────────────┘
```

### 2.3 SwiftUI реализация карточки

```swift
struct EntityCardView: View {
    let entity: CharacterEntity
    @State private var showAllDescriptions = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header with portrait
                HStack(alignment: .top, spacing: 16) {
                    EntityPortraitView(entity: entity)
                        .frame(width: 100, height: 100)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(entity.name)
                            .font(.title2.bold())

                        if let role = entity.role {
                            Text(role)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Label("\(entity.appearanceCount) appearances",
                              systemImage: "bookmark.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding()

                // Descriptions section
                DescriptionsSectionView(
                    descriptions: entity.descriptions,
                    showAll: $showAllDescriptions
                )

                // Images gallery
                ImagesGallerySection(images: entity.images)

                // Relationships
                RelationshipsSectionView(relationships: entity.relationships)
            }
        }
        .navigationTitle(entity.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
```

### 2.4 Граф отношений между персонажами

**Технология:** Используем [SwiftGraph](https://github.com/davecom/SwiftGraph) для структуры данных + кастомная SwiftUI визуализация.

```
┌─────────────────────────────────────────────┐
│     Character Relationships                 │
├─────────────────────────────────────────────┤
│                                             │
│         ┌─────┐                             │
│      ┌──┤Морейн├──┐                         │
│      │  └─────┘  │                          │
│      │           │                          │
│   ┌──▼──┐     ┌──▼──┐                       │
│   │Рэнд │─────│ Лан  │                      │
│   └──┬──┘     └─────┘                       │
│      │                                      │
│   ┌──▼──┐     ┌─────┐                       │
│   │ Мэт ├─────┤Перрин│                      │
│   └──┬──┘     └─────┘                       │
│      │                                      │
│   ┌──▼────┐                                 │
│   │Том    │                                 │
│   └───────┘                                 │
│                                             │
│ [Zoom] [Reset] [Filter by chapter range]   │
└─────────────────────────────────────────────┘
```

**SwiftUI реализация графа:**

```swift
struct RelationshipGraphView: View {
    let characters: [CharacterEntity]
    let relationships: [Relationship]

    @State private var scale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @GestureState private var gestureScale: CGFloat = 1.0

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Draw edges
                ForEach(relationships) { relationship in
                    RelationshipEdgeView(
                        from: position(for: relationship.fromId),
                        to: position(for: relationship.toId),
                        strength: relationship.strength
                    )
                }

                // Draw nodes
                ForEach(characters) { character in
                    CharacterNodeView(character: character)
                        .position(position(for: character.id))
                        .onTapGesture {
                            // Navigate to character card
                        }
                }
            }
            .scaleEffect(scale * gestureScale)
            .offset(offset)
            .gesture(
                MagnificationGesture()
                    .updating($gestureScale) { value, state, _ in
                        state = value
                    }
                    .onEnded { value in
                        scale *= value
                    }
            )
            .gesture(
                DragGesture()
                    .onChanged { value in
                        offset = value.translation
                    }
            )
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Reset") {
                    withAnimation {
                        scale = 1.0
                        offset = .zero
                    }
                }
            }
        }
    }
}
```

### 2.5 UI/UX Best Practices для карточек

На основе [исследования Card UI Design 2025](https://bricxlabs.com/blogs/card-ui-design-examples):

1. **Три секции:** Header (портрет + имя), Body (описания), Footer (действия)
2. **Скруглённые углы:** 12-16pt для iOS
3. **Shadows:** Subtle shadow для глубины
4. **Haptic feedback:** При открытии карточки - `.impact(.light)`
5. **Анимация:** Spring animation при появлении

---

## 3. Highlight описаний в тексте

### 3.1 Текущая веб-реализация

Существующий код `useDescriptionHighlighting.ts` использует 9 стратегий поиска текста:
- S1: First 40 chars (fastest)
- S2: Skip 10, take 10-50
- S5: First 5 words
- S4: Full match (short texts)
- S3: Skip 20, take 20-60
- S7: Middle section
- S9: First sentence
- S8: LCS fuzzy (slowest)

### 3.2 iOS реализация с Readium

Для iOS используем [Readium Swift Toolkit](https://github.com/readium/swift-toolkit):

```swift
// Highlight injection через Readium Decorator API
class DescriptionHighlighter: DecoratorGroup {
    let descriptions: [Description]
    let style: HighlightStyle

    func decorations(for locator: Locator) -> [Decoration] {
        descriptions
            .filter { isInCurrentPage($0, locator: locator) }
            .map { description in
                Decoration(
                    id: description.id,
                    locator: description.locator,
                    style: .highlight(
                        tint: style.backgroundColor,
                        isActive: false
                    )
                )
            }
    }
}
```

### 3.3 Настраиваемые стили highlight

```
┌─────────────────────────────────────────────┐
│ Highlight Style                             │
├─────────────────────────────────────────────┤
│                                             │
│ Color                                       │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐        │
│ │ 🔵 │ │ 🟢 │ │ 🟡 │ │ 🟣 │ │ 🔴 │        │
│ └────┘ └────┘ └────┘ └────┘ └────┘        │
│   ✓                                        │
│                                             │
│ Style                                       │
│ ○ Underline                                │
│ ● Background                               │
│ ○ Border                                   │
│                                             │
│ Opacity                          [●────] 40%│
│                                             │
│ Preview:                                    │
│ ┌─────────────────────────────────────────┐│
│ │"Высокий худощавый человек с седеющими   ││
│ │усами и хитрыми глазами..."              ││
│ └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

### 3.4 Tap на highlight -> показ карточки

```swift
// В EPUBNavigatorViewController
func navigator(_ navigator: Navigator,
               didTapOnDecoration decoration: Decoration) {
    guard let descriptionId = decoration.id else { return }

    // Haptic feedback
    let generator = UIImpactFeedbackGenerator(style: .light)
    generator.impactOccurred()

    // Show entity card
    let card = EntityCardView(entityId: descriptionId)
    presentSheet(card)
}
```

---

## 4. Стили генерации

### 4.1 Поддерживаемые стили

На основе [исследования AI image generation 2025](https://mpost.io/top-10-mobile-ai-art-generator-apps-in-2026-for-android-and-ios/):

| Стиль | Prompt Modifier | Описание |
|-------|-----------------|----------|
| **Realistic** | photorealistic, 8k, detailed | Фотореалистичные изображения |
| **Digital Art** | digital art, vibrant colors | Современное цифровое искусство |
| **Anime** | anime style, manga art | Аниме/манга стиль |
| **Watercolor** | watercolor painting, soft edges | Акварель |
| **Oil Painting** | oil painting, classical art | Масляная живопись |
| **Sketch** | pencil sketch, line art | Карандашный набросок |
| **Fantasy** | fantasy illustration, magical | Фэнтези арт |
| **Noir** | noir style, high contrast, shadows | Нуар стиль |

### 4.2 Передача стиля в промпт

Существующий код `ImagenPromptEngineer` уже поддерживает стили:

```python
# Из imagen_generator.py
GENRE_STYLES = {
    "fantasy": "fantasy art, magical atmosphere, ethereal lighting",
    "detective": "noir style, dramatic shadows, moody atmosphere",
    "romance": "soft warm lighting, romantic mood, gentle colors",
    # ...
}

# Добавим новые стили для iOS
USER_STYLES = {
    "realistic": "photorealistic, 8k resolution, detailed textures, natural lighting",
    "digital_art": "digital art style, vibrant saturated colors, clean lines",
    "anime": "anime style, cel shading, large expressive eyes, manga aesthetic",
    "watercolor": "watercolor painting, soft edges, flowing colors, paper texture",
    "oil_painting": "oil painting, visible brushstrokes, classical art style, rich colors",
    "sketch": "pencil sketch, line art, crosshatching, grayscale",
    "fantasy": "fantasy illustration, magical atmosphere, ethereal glow",
    "noir": "film noir style, high contrast, dramatic shadows, black and white"
}
```

### 4.3 UI выбора стиля

**ВАЖНО:** Стиль выбирается ДО генерации и НЕ может быть изменён после!

```
┌─────────────────────────────────────────────┐
│ Choose Style                                │
├─────────────────────────────────────────────┤
│                                             │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│ │          │ │          │ │          │     │
│ │ Realistic│ │Digital   │ │  Anime   │     │
│ │    ✓     │ │  Art     │ │          │     │
│ └──────────┘ └──────────┘ └──────────┘     │
│                                             │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│ │          │ │          │ │          │     │
│ │Watercolor│ │   Oil    │ │  Sketch  │     │
│ │          │ │ Painting │ │          │     │
│ └──────────┘ └──────────┘ └──────────┘     │
│                                             │
│ ┌──────────┐ ┌──────────┐                  │
│ │          │ │          │                  │
│ │ Fantasy  │ │   Noir   │                  │
│ │          │ │          │                  │
│ └──────────┘ └──────────┘                  │
│                                             │
│ ℹ️ Style cannot be changed after generation │
│                                             │
│          [ Generate Image ]                 │
└─────────────────────────────────────────────┘
```

```swift
struct StyleSelectionView: View {
    @Binding var selectedStyle: ImageStyle
    let onGenerate: () -> Void

    let styles: [ImageStyle] = ImageStyle.allCases
    let columns = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        VStack(spacing: 20) {
            Text("Choose Style")
                .font(.headline)

            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(styles) { style in
                    StyleTileView(
                        style: style,
                        isSelected: selectedStyle == style
                    )
                    .onTapGesture {
                        withAnimation(.spring(response: 0.3)) {
                            selectedStyle = style
                        }
                        // Haptic
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    }
                }
            }

            // Warning
            Label("Style cannot be changed after generation",
                  systemImage: "info.circle")
                .font(.caption)
                .foregroundStyle(.secondary)

            // Generate button
            Button(action: onGenerate) {
                Text("Generate Image")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding()
    }
}
```

---

## 5. Процесс генерации

### 5.1 UX Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  [Tap description]  ──►  [Entity Card]  ──►  [Choose Style]     │
│                               │                    │             │
│                               ▼                    ▼             │
│                     [View existing images]  [Generate Button]    │
│                                                    │             │
│                                                    ▼             │
│                               ┌────────────────────────────┐     │
│                               │     Generating...          │     │
│                               │     ████████░░░░ 65%       │     │
│                               │     ~15 sec remaining      │     │
│                               └────────────────────────────┘     │
│                                                    │             │
│                                    ┌───────────────┴───────┐     │
│                                    ▼                       ▼     │
│                              [Success!]              [Error]     │
│                            Haptic + Sound          Show reason   │
│                                    │                       │     │
│                                    ▼                       ▼     │
│                           [View Image]          [Retry] [Cancel] │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 Индикатор генерации

```swift
struct GenerationProgressView: View {
    @ObservedObject var viewModel: GenerationViewModel

    var body: some View {
        VStack(spacing: 16) {
            // Animated illustration
            LottieView(animation: .generating)
                .frame(width: 120, height: 120)

            Text("Generating...")
                .font(.headline)

            // Progress bar
            ProgressView(value: viewModel.progress)
                .progressViewStyle(.linear)
                .frame(width: 200)

            // Time estimate
            if let remaining = viewModel.estimatedTimeRemaining {
                Text("~\(remaining) sec remaining")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            // Cancel button
            Button("Cancel") {
                viewModel.cancel()
            }
            .buttonStyle(.bordered)
        }
        .padding(32)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
    }
}
```

### 5.3 Haptic и Sound feedback

На основе [iOS Haptic Guide 2025](https://dev.to/maxnxi/haptic-feedback-in-ios-a-comprehensive-guide-39fb):

```swift
class GenerationFeedbackManager {
    private let notificationGenerator = UINotificationFeedbackGenerator()

    func prepareForCompletion() {
        notificationGenerator.prepare()
    }

    func generationCompleted(success: Bool) {
        if success {
            // Success haptic
            notificationGenerator.notificationOccurred(.success)

            // Success sound
            AudioServicesPlaySystemSound(1407) // Tweet sound
        } else {
            // Error haptic
            notificationGenerator.notificationOccurred(.error)

            // Error sound
            AudioServicesPlaySystemSound(1521) // Peek sound
        }
    }

    func progressUpdate() {
        // Subtle haptic on progress milestones (25%, 50%, 75%)
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred(intensity: 0.5)
    }
}
```

### 5.4 Обработка ошибок

На основе существующего кода `retry.py` и [исследования content moderation](https://getstream.io/chat/docs/ios-swift/image_moderation/):

| Ошибка | Причина | UI Action |
|--------|---------|-----------|
| **Rate Limit** | Слишком много запросов | "Please wait X seconds before retry" + auto-retry |
| **NSFW Block** | Контент заблокирован модерацией | "Content moderated. Try different description" |
| **Network Error** | Нет соединения | "No internet. Check connection" + retry button |
| **Timeout** | Превышено время ожидания | "Request timed out" + retry button |
| **Server Error** | Ошибка сервера | "Server error. Please try later" |

```swift
struct GenerationErrorView: View {
    let error: GenerationError
    let onRetry: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: error.icon)
                .font(.largeTitle)
                .foregroundStyle(.red)

            Text(error.title)
                .font(.headline)

            Text(error.message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            HStack(spacing: 12) {
                Button("Cancel", action: onCancel)
                    .buttonStyle(.bordered)

                if error.isRetryable {
                    Button("Retry", action: onRetry)
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding()
    }
}

enum GenerationError {
    case rateLimit(retryAfter: Int)
    case nsfwBlocked
    case networkError
    case timeout
    case serverError

    var isRetryable: Bool {
        switch self {
        case .nsfwBlocked: return false
        default: return true
        }
    }

    var icon: String {
        switch self {
        case .rateLimit: return "clock.badge.exclamationmark"
        case .nsfwBlocked: return "exclamationmark.shield"
        case .networkError: return "wifi.slash"
        case .timeout: return "clock.arrow.circlepath"
        case .serverError: return "server.rack"
        }
    }
}
```

### 5.5 Регенерация и лимиты

```swift
struct RegenerationView: View {
    let currentImage: GeneratedImage
    let regenerationsRemaining: Int
    let maxRegenerations = 3

    var body: some View {
        VStack {
            Text("Regenerations: \(regenerationsRemaining)/\(maxRegenerations)")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button {
                // Regenerate with same style
            } label: {
                Label("Regenerate", systemImage: "arrow.clockwise")
            }
            .disabled(regenerationsRemaining == 0)
        }
    }
}
```

---

## 6. Просмотр изображений

### 6.1 В Reader: Tap -> Карточка

При нажатии на highlight открывается sheet с карточкой:

```swift
.sheet(item: $selectedDescription) { description in
    EntityCardSheet(
        description: description,
        image: imageStore.image(for: description.id)
    )
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
}
```

### 6.2 Fullscreen режим

На основе [Zoomable library](https://github.com/ryohey/Zoomable):

```swift
struct FullscreenImageView: View {
    let image: GeneratedImage
    @State private var scale: CGFloat = 1.0
    @GestureState private var gestureScale: CGFloat = 1.0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        GeometryReader { geometry in
            AsyncImage(url: image.url) { phase in
                if let uiImage = phase.image {
                    uiImage
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .scaleEffect(scale * gestureScale)
                        .gesture(
                            MagnificationGesture()
                                .updating($gestureScale) { value, state, _ in
                                    state = value
                                }
                                .onEnded { value in
                                    scale = min(max(scale * value, 1), 4)
                                }
                        )
                        .gesture(
                            TapGesture(count: 2)
                                .onEnded {
                                    withAnimation(.spring()) {
                                        scale = scale > 1 ? 1 : 2
                                    }
                                }
                        )
                }
            }
        }
        .background(.black)
        .ignoresSafeArea()
        .overlay(alignment: .topTrailing) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title)
                    .foregroundStyle(.white.opacity(0.7))
            }
            .padding()
        }
        // Support landscape for images
        .supportedOrientations([.portrait, .landscapeLeft, .landscapeRight])
    }
}
```

### 6.3 Pinch-to-zoom

Используем `MagnificationGesture` для iOS 17+ (исправлен баг с фиксацией в углу):

```swift
.gesture(
    MagnificationGesture()
        .updating($gestureScale) { currentState, gestureState, _ in
            gestureState = currentState
        }
        .onEnded { value in
            // Clamp scale between 1x and 4x
            scale = min(max(scale * value, 1.0), 4.0)
        }
)
```

### 6.4 Landscape на iPhone

```swift
// В FullscreenImageView
.onAppear {
    // Allow rotation to landscape for this view
    AppDelegate.orientationLock = .allButUpsideDown
}
.onDisappear {
    // Lock back to portrait
    AppDelegate.orientationLock = .portrait
}
```

### 6.5 Действия с изображением

```
┌─────────────────────────────────────────────┐
│                                             │
│              [Generated Image]              │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  ♡ Favorite    💾 Save    📤 Share         │
│                                             │
└─────────────────────────────────────────────┘
```

```swift
struct ImageActionsView: View {
    let image: GeneratedImage
    @State private var isFavorite: Bool
    @State private var showShareSheet = false

    var body: some View {
        HStack(spacing: 32) {
            // Favorite
            Button {
                withAnimation(.spring(response: 0.3)) {
                    isFavorite.toggle()
                }
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } label: {
                VStack {
                    Image(systemName: isFavorite ? "heart.fill" : "heart")
                        .foregroundStyle(isFavorite ? .red : .primary)
                    Text("Favorite")
                        .font(.caption)
                }
            }

            // Save to Photos
            Button {
                saveToPhotos()
            } label: {
                VStack {
                    Image(systemName: "square.and.arrow.down")
                    Text("Save")
                        .font(.caption)
                }
            }

            // Share
            Button {
                showShareSheet = true
            } label: {
                VStack {
                    Image(systemName: "square.and.arrow.up")
                    Text("Share")
                        .font(.caption)
                }
            }
        }
        .sheet(isPresented: $showShareSheet) {
            ShareSheet(items: [image.uiImage])
        }
    }

    private func saveToPhotos() {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            if status == .authorized {
                UIImageWriteToSavedPhotosAlbum(image.uiImage, nil, nil, nil)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            }
        }
    }
}
```

---

## 7. Галерея изображений

### 7.1 Структура галереи

```
┌─────────────────────────────────────────────┐
│ Gallery                              [Filter]│
├─────────────────────────────────────────────┤
│ [All] [Characters] [Locations] [★ Favorites]│
├─────────────────────────────────────────────┤
│                                             │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐                │
│ │    │ │    │ │    │ │    │                │
│ │    │ │    │ │    │ │    │                │
│ └────┘ └────┘ └────┘ └────┘                │
│                                             │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐                │
│ │    │ │    │ │    │ │    │                │
│ │    │ │    │ │    │ │    │                │
│ └────┘ └────┘ └────┘ └────┘                │
│                                             │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐                │
│ │    │ │    │ │    │ │    │                │
│ │    │ │    │ │    │ │    │                │
│ └────┘ └────┘ └────┘ └────┘                │
│                                             │
│           [Load More...]                    │
└─────────────────────────────────────────────┘
```

### 7.2 SwiftUI реализация

```swift
struct GalleryView: View {
    @StateObject private var viewModel = GalleryViewModel()
    @State private var selectedFilter: GalleryFilter = .all
    @State private var searchText = ""

    let columns = [
        GridItem(.flexible(), spacing: 2),
        GridItem(.flexible(), spacing: 2),
        GridItem(.flexible(), spacing: 2)
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Filter tabs
                FilterTabsView(selected: $selectedFilter)

                // Grid
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 2) {
                        ForEach(viewModel.filteredImages) { image in
                            GalleryThumbnail(image: image)
                                .aspectRatio(1, contentMode: .fill)
                                .onTapGesture {
                                    viewModel.selectedImage = image
                                }
                        }
                    }

                    // Pagination
                    if viewModel.hasMorePages {
                        ProgressView()
                            .onAppear {
                                viewModel.loadNextPage()
                            }
                    }
                }
            }
            .navigationTitle("Gallery")
            .searchable(text: $searchText, prompt: "Search by book or character")
            .sheet(item: $viewModel.selectedImage) { image in
                FullscreenImageView(image: image)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        ForEach(viewModel.books) { book in
                            Button(book.title) {
                                viewModel.filterByBook(book)
                            }
                        }
                    } label: {
                        Label("Filter", systemImage: "line.3.horizontal.decrease.circle")
                    }
                }
            }
        }
    }
}

enum GalleryFilter: String, CaseIterable {
    case all = "All"
    case characters = "Characters"
    case locations = "Locations"
    case scenes = "Scenes"
    case favorites = "Favorites"
}
```

### 7.3 Изображения НЕ удаляются с книгой

```swift
// В BookService
func deleteBook(_ book: Book) async throws {
    // 1. Delete book data
    try await bookRepository.delete(book)

    // 2. Delete chapters and descriptions
    try await chapterRepository.deleteForBook(book.id)
    try await descriptionRepository.deleteForBook(book.id)

    // 3. DO NOT delete images - they are preserved!
    // Images belong to user's gallery, not to the book

    // 4. Mark images as orphaned (optional)
    try await imageRepository.markOrphaned(forBookId: book.id)
}
```

Предупреждение при удалении книги:

```swift
.confirmationDialog("Delete Book", isPresented: $showDeleteConfirmation) {
    Button("Delete Book Only", role: .destructive) {
        deleteBook(keepImages: true)
    }
    Button("Delete Book and Images", role: .destructive) {
        deleteBook(keepImages: false)
    }
    Button("Cancel", role: .cancel) {}
} message: {
    Text("Generated images will be kept in your gallery.")
}
```

---

## 8. Офлайн-режим

### 8.1 Доступность функций

На основе [iOS Offline Mode Best Practices](https://www.avidclan.com/blog/how-to-build-offline-capable-ios-apps-a-complete-guide-to-developing-apps-that-work-without-internet/):

| Функция | Офлайн | Онлайн |
|---------|--------|--------|
| Чтение книги | ✅ Полностью | ✅ |
| Просмотр кэшированных изображений | ✅ | ✅ |
| Генерация изображений | ❌ | ✅ |
| Обработка книги | ❌ | ✅ |
| Синхронизация прогресса | ❌ (queued) | ✅ |

### 8.2 UI индикация офлайн-режима

Вместо блокировки функций - показываем индикатор:

```swift
struct OfflineBannerView: View {
    @ObservedObject var networkMonitor: NetworkMonitor

    var body: some View {
        if !networkMonitor.isConnected {
            HStack {
                Image(systemName: "wifi.slash")
                Text("Offline - Some features unavailable")
                Spacer()
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(.orange.opacity(0.2))
            .foregroundStyle(.orange)
        }
    }
}

// На кнопке генерации
Button {
    if networkMonitor.isConnected {
        startGeneration()
    } else {
        showOfflineAlert = true
    }
} label: {
    Label("Generate", systemImage: "wand.and.stars")
}
.disabled(!networkMonitor.isConnected)
.opacity(networkMonitor.isConnected ? 1 : 0.5)
```

### 8.3 Network Monitor

```swift
import Network

@MainActor
class NetworkMonitor: ObservableObject {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "NetworkMonitor")

    @Published var isConnected = true
    @Published var connectionType: ConnectionType = .unknown

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isConnected = path.status == .satisfied
                self?.connectionType = self?.getConnectionType(path) ?? .unknown
            }
        }
        monitor.start(queue: queue)
    }

    enum ConnectionType {
        case wifi, cellular, ethernet, unknown
    }
}
```

---

## 9. Обработка книги (парсинг)

### 9.1 Ручной запуск

**Принцип:** Обработка запускается ТОЛЬКО вручную, не автоматически после загрузки.

### 9.2 UI кнопки запуска

**Вариант A: Floating Action Button**

```
┌─────────────────────────────────────────────┐
│ Book Title                                  │
│ by Author Name                              │
├─────────────────────────────────────────────┤
│                                             │
│     📖 This book hasn't been processed.    │
│     Tap ✨ to extract descriptions.         │
│                                             │
│                                             │
│                                      [✨]   │
│                                       ▲     │
│                              Process Book   │
└─────────────────────────────────────────────┘
```

**Вариант B: Contextual Button (рекомендуется)**

```
┌─────────────────────────────────────────────┐
│ Book Title                           [•••]  │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ 📖 Ready to process                     │ │
│ │                                         │ │
│ │ Extract visual descriptions from this   │ │
│ │ book to generate AI illustrations.      │ │
│ │                                         │ │
│ │ Estimated time: ~2-5 minutes            │ │
│ │                                         │ │
│ │       [ ✨ Start Processing ]           │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ Chapter 1: The Beginning                    │
│ Lorem ipsum dolor sit amet...               │
└─────────────────────────────────────────────┘
```

```swift
struct ProcessBookBannerView: View {
    let book: Book
    let onProcess: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "book.fill")
                    .font(.title2)
                Text("Ready to process")
                    .font(.headline)
            }

            Text("Extract visual descriptions from this book to generate AI illustrations.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Text("Estimated time: ~2-5 minutes")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button(action: onProcess) {
                Label("Start Processing", systemImage: "wand.and.stars")
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding()
    }
}
```

### 9.3 Dynamic Island / Live Activities

На основе [Apple Live Activities Guide](https://developer.apple.com/design/human-interface-guidelines/live-activities):

```swift
// BookProcessingAttributes.swift
import ActivityKit

struct BookProcessingAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var progress: Double
        var currentChapter: String
        var chaptersProcessed: Int
        var totalChapters: Int
        var estimatedTimeRemaining: Int?
    }

    var bookTitle: String
    var bookId: String
}

// Start Live Activity
func startProcessingActivity(for book: Book) async throws {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

    let attributes = BookProcessingAttributes(
        bookTitle: book.title,
        bookId: book.id
    )

    let initialState = BookProcessingAttributes.ContentState(
        progress: 0,
        currentChapter: "Starting...",
        chaptersProcessed: 0,
        totalChapters: book.chapterCount,
        estimatedTimeRemaining: book.chapterCount * 15 // ~15s per chapter
    )

    let activity = try Activity.request(
        attributes: attributes,
        content: .init(state: initialState, staleDate: nil),
        pushType: .token
    )

    // Store activity ID for updates
    ProcessingManager.shared.currentActivity = activity
}
```

**Dynamic Island Compact View:**

```swift
struct BookProcessingDynamicIsland: View {
    let context: ActivityViewContext<BookProcessingAttributes>

    var body: some View {
        // Minimal (collapsed)
        DynamicIslandExpandedRegion(.leading) {
            Image(systemName: "book.fill")
        }

        DynamicIslandExpandedRegion(.trailing) {
            Text("\(Int(context.state.progress * 100))%")
                .font(.caption2)
        }

        // Expanded
        DynamicIslandExpandedRegion(.center) {
            VStack(spacing: 4) {
                Text("Processing: \(context.attributes.bookTitle)")
                    .font(.caption)
                    .lineLimit(1)

                ProgressView(value: context.state.progress)

                Text("Chapter \(context.state.chaptersProcessed)/\(context.state.totalChapters)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)
        }
    }
}
```

### 9.4 Блокировка Reader во время обработки

```swift
struct ReaderView: View {
    @ObservedObject var processingManager: ProcessingManager
    let book: Book

    var body: some View {
        ZStack {
            EPUBReaderView(book: book)

            // Overlay during processing
            if processingManager.isProcessing(book.id) {
                ProcessingOverlayView(
                    progress: processingManager.progress,
                    onCancel: { processingManager.cancel() }
                )
            }
        }
    }
}

struct ProcessingOverlayView: View {
    let progress: ProcessingProgress
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.7)

            VStack(spacing: 20) {
                ProgressView(value: progress.percentage)
                    .progressViewStyle(.circular)
                    .scaleEffect(2)

                Text("Processing book...")
                    .font(.headline)
                    .foregroundStyle(.white)

                Text("Chapter \(progress.currentChapter) of \(progress.totalChapters)")
                    .foregroundStyle(.white.opacity(0.7))

                Button("Cancel", action: onCancel)
                    .buttonStyle(.bordered)
                    .tint(.white)
            }
        }
        .ignoresSafeArea()
    }
}
```

---

## 10. Спойлеры

### 10.1 Политика: Изображения НЕ скрываются

**Решение:** Изображения из непрочитанных глав НЕ скрываются автоматически.

**Причина:**
- Пользователь явно запрашивает генерацию
- Сложность определения "прочитанности" главы
- UX frustration от скрытого контента

### 10.2 Предупреждение при входе в галерею

```swift
struct GalleryView: View {
    @State private var showSpoilerWarning = true
    @AppStorage("hideSpoilerWarning") var hideSpoilerWarning = false

    var body: some View {
        NavigationStack {
            galleryContent
        }
        .alert("Spoiler Warning", isPresented: $showSpoilerWarning) {
            Button("Show Gallery") {
                showSpoilerWarning = false
            }
            Button("Don't show again") {
                hideSpoilerWarning = true
                showSpoilerWarning = false
            }
            Button("Go Back", role: .cancel) {
                dismiss()
            }
        } message: {
            Text("The gallery may contain images from chapters you haven't read yet. Continue?")
        }
        .onAppear {
            if !hideSpoilerWarning {
                showSpoilerWarning = true
            }
        }
    }
}
```

### 10.3 Альтернатива: Spoiler Tags (опционально в будущем)

```
┌─────────────────────────────────────────────┐
│ Gallery Settings                            │
├─────────────────────────────────────────────┤
│                                             │
│ Spoiler Protection                          │
│ ○ Off - Show all images                    │
│ ● Blur unread - Blur images from unread    │
│   chapters                                  │
│                                             │
│ Current reading position:                   │
│ Chapter 12 of 45                           │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Recommendations

### Приоритет реализации

| # | Функция | Приоритет | Сложность |
|---|---------|-----------|-----------|
| 1 | Карточки персонажей (без графа) | P0 | Средняя |
| 2 | Highlight в EPUB | P0 | Высокая |
| 3 | Генерация с индикатором | P0 | Средняя |
| 4 | Галерея изображений | P0 | Низкая |
| 5 | Стили генерации | P1 | Низкая |
| 6 | Fullscreen просмотр + zoom | P1 | Средняя |
| 7 | Dynamic Island для обработки | P1 | Средняя |
| 8 | Граф отношений | P2 | Высокая |
| 9 | Настройки типов описаний | P2 | Низкая |
| 10 | Офлайн-режим индикация | P2 | Низкая |

### Технические зависимости

1. **Readium Swift Toolkit** - для EPUB рендеринга и highlighting
2. **SwiftGraph** - для графа отношений (если реализуем)
3. **Lottie** - для анимаций загрузки
4. **ActivityKit** - для Dynamic Island

---

## Sources

- [Kindle X-Ray Redesign](https://goodereader.com/blog/e-book-news/amazon-redesigns-x-ray-on-kindle-for-ios)
- [Card UI Design 2025](https://bricxlabs.com/blogs/card-ui-design-examples)
- [iOS Live Activities Guide](https://developer.apple.com/design/human-interface-guidelines/live-activities)
- [Dynamic Island Best Practices](https://canopas.com/integrating-live-activity-and-dynamic-island-in-i-os-a-complete-guide)
- [SwiftUI Pinch to Zoom](https://www.hackingwithswift.com/quick-start/swiftui/how-to-handle-pinch-to-zoom-for-views)
- [Zoomable Library](https://github.com/ryohey/Zoomable)
- [iOS Haptic Feedback Guide](https://dev.to/maxnxi/haptic-feedback-in-ios-a-comprehensive-guide-39fb)
- [Readium Swift Toolkit](https://github.com/readium/swift-toolkit)
- [FolioReaderKit](https://github.com/FolioReader/FolioReaderKit)
- [AI Image Generation Apps 2026](https://mpost.io/top-10-mobile-ai-art-generator-apps-in-2026-for-android-and-ios/)
- [SwiftGraph](https://github.com/davecom/SwiftGraph)
- [iOS Offline Mode Patterns](https://www.avidclan.com/blog/how-to-build-offline-capable-ios-apps-a-complete-guide-to-developing-apps-that-work-without-internet/)
- [iOS Content Moderation](https://getstream.io/chat/docs/ios-swift/image_moderation/)
