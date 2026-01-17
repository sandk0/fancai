# Accessibility и Performance для iOS-приложения fancai

**Дата:** 2026-01-17
**Scope:** VoiceOver, Dynamic Type, Performance Benchmarks, MetricKit
**Приоритет:** P2 (Future)
**Автор:** Claude Code

---

## 1. Accessibility

### 1.1 Приоритет функций

| Функция | Приоритет | Описание |
|---------|-----------|----------|
| Dynamic Type | P1 | Масштабирование шрифтов |
| VoiceOver | P2 | Экранный диктор |
| Reduce Motion | P2 | Отключение анимаций |
| Increase Contrast | P2 | Повышенный контраст |
| Bold Text | P2 | Жирный текст |

---

## 2. Dynamic Type

### 2.1 Базовая реализация

```swift
import SwiftUI

struct BookDetailView: View {
    let book: Book

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Используем системные стили — автомасштабирование
            Text(book.title)
                .font(.title)

            Text(book.author ?? "Неизвестный автор")
                .font(.headline)
                .foregroundStyle(.secondary)

            Text(book.description ?? "")
                .font(.body)
        }
    }
}
```

### 2.2 Кастомные шрифты с масштабированием

```swift
import SwiftUI

extension Font {
    /// Кастомный шрифт с поддержкой Dynamic Type
    static func customScaled(
        _ name: String,
        size: CGFloat,
        relativeTo textStyle: TextStyle = .body
    ) -> Font {
        .custom(name, size: size, relativeTo: textStyle)
    }

    // Шрифты для Reader
    static func readerFont(size: CGFloat) -> Font {
        .custom("Georgia", size: size, relativeTo: .body)
    }
}

// Использование
Text("Глава 1")
    .font(.customScaled("Lora-Bold", size: 24, relativeTo: .title))
```

### 2.3 Масштабирование изображений

```swift
import SwiftUI

struct ScaledImageView: View {
    @ScaledMetric(relativeTo: .body) private var imageSize: CGFloat = 44

    var body: some View {
        Image(systemName: "book.fill")
            .resizable()
            .frame(width: imageSize, height: imageSize)
    }
}
```

### 2.4 Адаптивные layouts

```swift
import SwiftUI

struct AdaptiveBookCard: View {
    let book: Book

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            // Вертикальный layout для больших размеров
            VStack(alignment: .leading, spacing: 12) {
                bookCover
                bookInfo
            }
        } else {
            // Горизонтальный layout для обычных размеров
            HStack(spacing: 16) {
                bookCover
                bookInfo
            }
        }
    }

    private var bookCover: some View {
        AsyncImage(url: book.coverURL) { image in
            image.resizable().aspectRatio(contentMode: .fit)
        } placeholder: {
            Color.gray.opacity(0.3)
        }
        .frame(width: dynamicTypeSize.isAccessibilitySize ? 120 : 80)
    }

    private var bookInfo: some View {
        VStack(alignment: .leading) {
            Text(book.title)
                .font(.headline)
            Text(book.author ?? "")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}
```

---

## 3. VoiceOver

### 3.1 Accessibility Labels и Hints

```swift
import SwiftUI

struct BookProgressView: View {
    let progress: Double // 0.0 - 1.0

    var body: some View {
        ProgressView(value: progress)
            .accessibilityLabel("Прогресс чтения")
            .accessibilityValue("\(Int(progress * 100)) процентов")
            .accessibilityHint("Показывает сколько книги прочитано")
    }
}

struct StarRatingView: View {
    let rating: Int

    var body: some View {
        HStack {
            ForEach(1...5, id: \.self) { star in
                Image(systemName: star <= rating ? "star.fill" : "star")
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Рейтинг \(rating) из 5 звёзд")
    }
}
```

### 3.2 Группировка элементов

```swift
import SwiftUI

struct BookListRow: View {
    let book: Book

    var body: some View {
        HStack {
            AsyncImage(url: book.coverURL) { image in
                image.resizable()
            } placeholder: {
                Color.gray
            }
            .frame(width: 60, height: 90)

            VStack(alignment: .leading) {
                Text(book.title)
                    .font(.headline)
                Text(book.author ?? "")
                    .font(.subheadline)
                Text("\(book.progressPercent)% прочитано")
                    .font(.caption)
            }
        }
        // Группируем все элементы для VoiceOver
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(book.title), автор \(book.author ?? "неизвестен")")
        .accessibilityValue("\(book.progressPercent) процентов прочитано")
        .accessibilityHint("Нажмите дважды чтобы открыть книгу")
        .accessibilityAddTraits(.isButton)
    }
}
```

### 3.3 Скрытие декоративных элементов

```swift
// Чисто декоративные изображения скрываем
Image("decorative_line")
    .accessibilityHidden(true)

// Или через свойство
Image(decorative: "background_pattern")
```

### 3.4 Traits для кнопок

```swift
struct ActionButton: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
        }
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

// Для заголовков секций
Text("Библиотека")
    .font(.title)
    .accessibilityAddTraits(.isHeader)
```

### 3.5 Уведомления об изменениях

```swift
import UIKit

// Уведомление о важном изменении
func announceChange(_ message: String) {
    UIAccessibility.post(
        notification: .announcement,
        argument: message
    )
}

// Использование
announceChange("Книга добавлена в библиотеку")
announceChange("Изображение сгенерировано")
```

---

## 4. Reduce Motion

```swift
import SwiftUI

struct AnimatedButton: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isPressed = false

    var body: some View {
        Button("Действие") {
            // action
        }
        .scaleEffect(isPressed ? 0.95 : 1.0)
        .animation(
            reduceMotion ? nil : .spring(),
            value: isPressed
        )
    }
}
```

---

## 5. Performance Benchmarks

### 5.1 Целевые метрики

| Метрика | Цель | Критично |
|---------|------|----------|
| **Cold Launch** | < 400ms | < 2s |
| **Warm Launch** | < 200ms | < 1s |
| **Memory (idle)** | < 50MB | < 100MB |
| **Memory (reading)** | < 100MB | < 200MB |
| **CPU (idle)** | < 5% | < 15% |
| **Crash-free sessions** | > 99.9% | > 99% |

### 5.2 Launch Time оптимизация

```swift
// AppDelegate — минимальные операции
class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // ✅ Только критичные операции
        FirebaseApp.configure()

        // ❌ НЕ делать здесь:
        // - Загрузка данных из сети
        // - Тяжёлые миграции
        // - Синхронизация

        return true
    }
}

// Ленивая инициализация
@main
struct FancaiApp: App {
    // Отложенная инициализация
    @State private var isReady = false

    var body: some Scene {
        WindowGroup {
            if isReady {
                ContentView()
            } else {
                LaunchScreen()
                    .task {
                        await prepareApp()
                        isReady = true
                    }
            }
        }
    }

    private func prepareApp() async {
        // Инициализация в фоне
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await ImageCache.shared.warmup() }
            group.addTask { await Database.shared.prepare() }
        }
    }
}
```

### 5.3 Memory оптимизация

```swift
import SwiftUI

// Ленивая загрузка в списках
struct BookLibraryView: View {
    let books: [Book]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150))]) {
                ForEach(books) { book in
                    BookCard(book: book)
                }
            }
        }
    }
}

// Кэширование с лимитами
actor ImageCache {
    static let shared = ImageCache()

    private let cache = NSCache<NSURL, UIImage>()

    init() {
        cache.countLimit = 100
        cache.totalCostLimit = 50_000_000 // 50MB
    }

    func image(for url: URL) -> UIImage? {
        cache.object(forKey: url as NSURL)
    }

    func store(_ image: UIImage, for url: URL) {
        let cost = image.pngData()?.count ?? 0
        cache.setObject(image, forKey: url as NSURL, cost: cost)
    }
}
```

---

## 6. MetricKit

### 6.1 Настройка

```swift
import MetricKit

// MARK: - MetricKit Subscriber

class MetricsManager: NSObject, MXMetricManagerSubscriber {
    static let shared = MetricsManager()

    private override init() {
        super.init()
        MXMetricManager.shared.add(self)
    }

    // Ежедневные метрики производительности
    func didReceive(_ payloads: [MXMetricPayload]) {
        for payload in payloads {
            processMetricPayload(payload)
        }
    }

    // Диагностика (crashes, hangs)
    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            processDiagnosticPayload(payload)
        }
    }

    private func processMetricPayload(_ payload: MXMetricPayload) {
        // Launch metrics
        if let launchMetrics = payload.applicationLaunchMetrics {
            let histogram = launchMetrics.histogrammedTimeToFirstDraw
            Logger.general.info("Launch time histogram: \(histogram)")
        }

        // Memory metrics
        if let memoryMetrics = payload.memoryMetrics {
            let peak = memoryMetrics.peakMemoryUsage
            Logger.general.info("Peak memory: \(peak)")
        }

        // CPU metrics
        if let cpuMetrics = payload.cpuMetrics {
            Logger.general.info("CPU time: \(cpuMetrics.cumulativeCPUTime)")
        }

        // Отправка на сервер аналитики
        Task {
            await sendMetricsToBackend(payload)
        }
    }

    private func processDiagnosticPayload(_ payload: MXDiagnosticPayload) {
        // Crash reports
        if let crashDiagnostics = payload.crashDiagnostics {
            for crash in crashDiagnostics {
                Logger.general.error("Crash: \(crash.callStackTree)")
            }
        }

        // Hang reports
        if let hangDiagnostics = payload.hangDiagnostics {
            for hang in hangDiagnostics {
                Logger.general.warning("Hang detected: \(hang.hangDuration)")
            }
        }
    }

    private func sendMetricsToBackend(_ payload: MXMetricPayload) async {
        // POST to analytics endpoint
    }
}
```

### 6.2 Signposts для кастомных метрик

```swift
import os

// MARK: - Performance Signposts

extension OSSignposter {
    static let imageGeneration = OSSignposter(subsystem: "ru.fancai.app", category: "AIGeneration")
    static let bookLoading = OSSignposter(subsystem: "ru.fancai.app", category: "BookLoading")
}

class AIService {
    private let signposter = OSSignposter.imageGeneration

    func generateImage(prompt: String) async throws -> UIImage {
        let signpostID = signposter.makeSignpostID()
        let state = signposter.beginInterval("generateImage", id: signpostID)

        defer {
            signposter.endInterval("generateImage", state)
        }

        // Generation logic
        return try await performGeneration(prompt: prompt)
    }
}

class BookLoader {
    private let signposter = OSSignposter.bookLoading

    func load(from url: URL) async throws -> Book {
        let state = signposter.beginInterval("loadBook")

        defer {
            signposter.endInterval("loadBook", state)
        }

        return try await parseBook(at: url)
    }
}
```

---

## 7. Xcode Organizer Metrics

### 7.1 Доступные метрики

| Категория | Метрики |
|-----------|---------|
| **Launches** | Time to First Draw, Resume Duration |
| **Memory** | Peak Memory, Suspended Memory |
| **Disk** | Disk Writes |
| **Battery** | Foreground/Background energy |
| **Hangs** | Hang Rate, Hang Duration |

### 7.2 Мониторинг

```
Xcode → Window → Organizer → Metrics
```

---

## 8. Instruments Profiling

| Инструмент | Использование |
|------------|---------------|
| **Time Profiler** | CPU usage, hotspots |
| **Allocations** | Memory allocations |
| **Leaks** | Memory leaks |
| **Network** | Network requests |
| **Core Animation** | UI rendering |
| **Energy Log** | Battery consumption |

---

## 9. Чеклист

### Accessibility

| Пункт | Статус |
|-------|--------|
| Dynamic Type поддерживается | ⬜ |
| VoiceOver labels для всех элементов | ⬜ |
| Группировка связанных элементов | ⬜ |
| Reduce Motion поддерживается | ⬜ |
| Контраст соответствует WCAG | ⬜ |
| Тестирование с VoiceOver | ⬜ |

### Performance

| Пункт | Статус |
|-------|--------|
| Launch time < 400ms | ⬜ |
| Memory < 100MB | ⬜ |
| MetricKit интегрирован | ⬜ |
| Signposts для критичных операций | ⬜ |
| Lazy loading в списках | ⬜ |
| Image caching настроен | ⬜ |

---

## Источники

- [Apple Accessibility](https://developer.apple.com/accessibility/)
- [Apple MetricKit](https://developer.apple.com/documentation/metrickit)
- [WWDC 2023 — Analyze hangs with Instruments](https://developer.apple.com/videos/play/wwdc2023/10248/)
- [Apple Human Interface Guidelines — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
