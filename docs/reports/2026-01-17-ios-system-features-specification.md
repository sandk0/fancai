# Спецификация системных iOS-функций для fancai

**Дата:** 2026-01-17
**Scope:** Widgets, Dynamic Island, Quick Actions, Onboarding, What's New, App Store Rating, Deep Links
**Автор:** Claude Code

## Executive Summary

Данный отчёт охватывает пропущенные компоненты из оригинального промпта по iOS-разработке: виджеты (Home Screen и Lock Screen), Dynamic Island с Live Activities, Quick Actions, Onboarding, What's New, запрос оценки App Store и Deep Links. Для каждого компонента приведены современные практики (2025-2026), SwiftUI-реализация и рекомендации.

---

## 1. Виджеты (WidgetKit)

### 1.1 Типы виджетов для fancai

| Тип | Размер | Назначение |
|-----|--------|------------|
| **Home Screen Small** | 158x158 (@2x) | Текущая книга + прогресс |
| **Home Screen Medium** | 338x158 (@2x) | Текущая книга + статистика дня |
| **Home Screen Large** | 338x338 (@2x) | Библиотека с 4-6 обложками |
| **Lock Screen (accessoryCircular)** | 50x50 | Streak или прогресс книги |
| **Lock Screen (accessoryRectangular)** | 160x50 | Название книги + прогресс |

### 1.2 Архитектура виджетов

**Ключевые принципы:**
- Используем **App Groups** для обмена данными с основным приложением
- **TimelineProvider** для управления обновлениями
- Максимум **40-70 обновлений в день** (системное ограничение)
- iOS 17+: Интерактивные виджеты через **AppIntents**

### 1.3 SwiftUI реализация

```swift
import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Widget Entry

struct BookWidgetEntry: TimelineEntry {
    let date: Date
    let configuration: ConfigurationAppIntent
    let currentBook: BookData?
    let readingProgress: Double
    let streak: Int
    let todayMinutes: Int
}

struct BookData {
    let title: String
    let author: String
    let coverURL: URL?
    let progress: Double // 0.0 - 1.0
}

// MARK: - Timeline Provider

struct BookWidgetProvider: AppIntentTimelineProvider {
    typealias Entry = BookWidgetEntry
    typealias Intent = ConfigurationAppIntent

    func placeholder(in context: Context) -> BookWidgetEntry {
        BookWidgetEntry(
            date: .now,
            configuration: ConfigurationAppIntent(),
            currentBook: BookData(
                title: "Книга",
                author: "Автор",
                coverURL: nil,
                progress: 0.5
            ),
            readingProgress: 0.5,
            streak: 7,
            todayMinutes: 30
        )
    }

    func snapshot(for configuration: ConfigurationAppIntent, in context: Context) async -> BookWidgetEntry {
        await loadEntry(for: configuration)
    }

    func timeline(for configuration: ConfigurationAppIntent, in context: Context) async -> Timeline<BookWidgetEntry> {
        let entry = await loadEntry(for: configuration)

        // Обновляем каждый час или в полночь
        let nextUpdate = Calendar.current.date(byAdding: .hour, value: 1, to: .now) ?? .now
        return Timeline(entries: [entry], policy: .after(nextUpdate))
    }

    private func loadEntry(for configuration: ConfigurationAppIntent) async -> BookWidgetEntry {
        // Загрузка данных из App Group
        let sharedDefaults = UserDefaults(suiteName: "group.ru.fancai.app")

        let bookTitle = sharedDefaults?.string(forKey: "currentBookTitle") ?? "Нет книги"
        let bookAuthor = sharedDefaults?.string(forKey: "currentBookAuthor") ?? ""
        let progress = sharedDefaults?.double(forKey: "currentBookProgress") ?? 0
        let streak = sharedDefaults?.integer(forKey: "currentStreak") ?? 0
        let todayMinutes = sharedDefaults?.integer(forKey: "todayReadingMinutes") ?? 0

        return BookWidgetEntry(
            date: .now,
            configuration: configuration,
            currentBook: BookData(
                title: bookTitle,
                author: bookAuthor,
                coverURL: nil,
                progress: progress
            ),
            readingProgress: progress,
            streak: streak,
            todayMinutes: todayMinutes
        )
    }
}

// MARK: - Widget Views

struct SmallBookWidget: View {
    let entry: BookWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Обложка и название
            HStack(spacing: 8) {
                // Placeholder обложки
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.blue.opacity(0.3))
                    .frame(width: 40, height: 60)

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.currentBook?.title ?? "Нет книги")
                        .font(.caption.bold())
                        .lineLimit(2)

                    Text(entry.currentBook?.author ?? "")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            // Прогресс
            ProgressView(value: entry.readingProgress)
                .tint(.accentColor)

            Text("\(Int(entry.readingProgress * 100))%")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding()
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct MediumBookWidget: View {
    let entry: BookWidgetEntry

    var body: some View {
        HStack(spacing: 16) {
            // Левая часть - книга
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.currentBook?.title ?? "Нет книги")
                    .font(.headline)
                    .lineLimit(2)

                Text(entry.currentBook?.author ?? "")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                ProgressView(value: entry.readingProgress)
                    .tint(.accentColor)
            }

            Divider()

            // Правая часть - статистика
            VStack(alignment: .leading, spacing: 8) {
                StatWidget(
                    icon: "flame.fill",
                    value: "\(entry.streak)",
                    label: "дней",
                    color: .orange
                )

                StatWidget(
                    icon: "clock.fill",
                    value: "\(entry.todayMinutes)",
                    label: "мин",
                    color: .blue
                )
            }
            .frame(width: 80)
        }
        .padding()
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct StatWidget: View {
    let icon: String
    let value: String
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .font(.caption)

            Text(value)
                .font(.caption.bold())

            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Lock Screen Widget

struct LockScreenBookWidget: View {
    let entry: BookWidgetEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: entry.readingProgress) {
                Image(systemName: "book.fill")
            }
            .gaugeStyle(.accessoryCircularCapacity)

        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.currentBook?.title ?? "Нет книги")
                    .font(.headline)
                    .lineLimit(1)

                Text("\(Int(entry.readingProgress * 100))% прочитано")
                    .font(.caption2)

                ProgressView(value: entry.readingProgress)
            }
            .privacySensitive(false)

        case .accessoryInline:
            Text("📖 \(entry.currentBook?.title ?? "Нет книги")")

        default:
            EmptyView()
        }
    }
}

// MARK: - Widget Bundle

@main
struct FancaiWidgetBundle: WidgetBundle {
    var body: some Widget {
        CurrentBookWidget()
        LockScreenWidget()
    }
}

struct CurrentBookWidget: Widget {
    let kind = "CurrentBookWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: ConfigurationAppIntent.self,
            provider: BookWidgetProvider()
        ) { entry in
            switch entry.configuration.widgetSize {
            case .small:
                SmallBookWidget(entry: entry)
            case .medium:
                MediumBookWidget(entry: entry)
            default:
                SmallBookWidget(entry: entry)
            }
        }
        .configurationDisplayName("Текущая книга")
        .description("Прогресс чтения текущей книги")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct LockScreenWidget: Widget {
    let kind = "LockScreenWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: ConfigurationAppIntent.self,
            provider: BookWidgetProvider()
        ) { entry in
            LockScreenBookWidget(entry: entry)
        }
        .configurationDisplayName("Прогресс чтения")
        .description("Прогресс на экране блокировки")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
```

### 1.4 Обновление виджетов из приложения

```swift
import WidgetKit

class WidgetUpdateService {
    static let shared = WidgetUpdateService()

    private let sharedDefaults = UserDefaults(suiteName: "group.ru.fancai.app")

    // Вызывать при изменении текущей книги
    func updateCurrentBook(_ book: Book) {
        sharedDefaults?.set(book.title, forKey: "currentBookTitle")
        sharedDefaults?.set(book.author, forKey: "currentBookAuthor")
        sharedDefaults?.set(book.readingProgress, forKey: "currentBookProgress")

        WidgetCenter.shared.reloadTimelines(ofKind: "CurrentBookWidget")
        WidgetCenter.shared.reloadTimelines(ofKind: "LockScreenWidget")
    }

    // Вызывать при обновлении статистики
    func updateReadingStats(streak: Int, todayMinutes: Int) {
        sharedDefaults?.set(streak, forKey: "currentStreak")
        sharedDefaults?.set(todayMinutes, forKey: "todayReadingMinutes")

        WidgetCenter.shared.reloadAllTimelines()
    }
}
```

---

## 2. Dynamic Island и Live Activities

### 2.1 Применение в fancai

| Функция | Применение |
|---------|------------|
| **Обработка книги** | Прогресс извлечения описаний |
| **Генерация изображения** | Статус генерации (опционально) |

**НЕ используем** для чтения книги — это отвлекает пользователя.

### 2.2 Настройка проекта

1. В `Info.plist` добавить: `NSSupportsLiveActivities = YES`
2. Создать Widget Extension с поддержкой Live Activities

### 2.3 SwiftUI реализация

```swift
import ActivityKit
import SwiftUI

// MARK: - Activity Attributes

struct BookProcessingAttributes: ActivityAttributes {
    // Статические данные (не меняются)
    public struct ContentState: Codable, Hashable {
        var currentChapter: Int
        var totalChapters: Int
        var progress: Double
        var status: ProcessingStatus
    }

    var bookTitle: String
    var bookAuthor: String
}

enum ProcessingStatus: String, Codable {
    case extracting = "Извлечение описаний"
    case processing = "Обработка"
    case completed = "Завершено"
    case failed = "Ошибка"
}

// MARK: - Live Activity Widget

struct BookProcessingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BookProcessingAttributes.self) { context in
            // Lock Screen view
            LockScreenLiveActivityView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded View
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "book.fill")
                        .font(.title2)
                        .foregroundStyle(.blue)
                }

                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(Int(context.state.progress * 100))%")
                        .font(.title2.bold())
                }

                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.bookTitle)
                        .font(.headline)
                        .lineLimit(1)
                }

                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        ProgressView(value: context.state.progress)
                            .tint(.blue)

                        HStack {
                            Text(context.state.status.rawValue)
                                .font(.caption)

                            Spacer()

                            Text("Глава \(context.state.currentChapter)/\(context.state.totalChapters)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal)
                }
            } compactLeading: {
                Image(systemName: "book.fill")
                    .foregroundStyle(.blue)
            } compactTrailing: {
                Text("\(Int(context.state.progress * 100))%")
                    .font(.caption.bold())
            } minimal: {
                ProgressView(value: context.state.progress)
                    .progressViewStyle(.circular)
                    .tint(.blue)
            }
        }
    }
}

struct LockScreenLiveActivityView: View {
    let context: ActivityViewContext<BookProcessingAttributes>

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "book.fill")
                    .font(.title3)
                    .foregroundStyle(.blue)

                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.bookTitle)
                        .font(.headline)
                        .lineLimit(1)

                    Text(context.attributes.bookAuthor)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text("\(Int(context.state.progress * 100))%")
                    .font(.title2.bold())
            }

            ProgressView(value: context.state.progress)
                .tint(.blue)

            HStack {
                Text(context.state.status.rawValue)
                    .font(.caption)

                Spacer()

                Text("Глава \(context.state.currentChapter) из \(context.state.totalChapters)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.ultraThinMaterial)
    }
}
```

### 2.4 Управление Live Activity

```swift
import ActivityKit

@Observable
class BookProcessingActivityManager {
    static let shared = BookProcessingActivityManager()

    private var currentActivity: Activity<BookProcessingAttributes>?

    // Запуск Live Activity
    func startProcessing(bookTitle: String, bookAuthor: String, totalChapters: Int) async throws {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            throw ProcessingError.activitiesNotEnabled
        }

        let attributes = BookProcessingAttributes(
            bookTitle: bookTitle,
            bookAuthor: bookAuthor
        )

        let initialState = BookProcessingAttributes.ContentState(
            currentChapter: 0,
            totalChapters: totalChapters,
            progress: 0,
            status: .extracting
        )

        let activity = try Activity.request(
            attributes: attributes,
            content: .init(state: initialState, staleDate: nil),
            pushType: nil
        )

        currentActivity = activity
    }

    // Обновление прогресса
    func updateProgress(currentChapter: Int, totalChapters: Int) async {
        let progress = Double(currentChapter) / Double(totalChapters)

        let state = BookProcessingAttributes.ContentState(
            currentChapter: currentChapter,
            totalChapters: totalChapters,
            progress: progress,
            status: .processing
        )

        await currentActivity?.update(
            ActivityContent(state: state, staleDate: nil)
        )
    }

    // Завершение
    func complete() async {
        let finalState = BookProcessingAttributes.ContentState(
            currentChapter: 0,
            totalChapters: 0,
            progress: 1.0,
            status: .completed
        )

        await currentActivity?.end(
            ActivityContent(state: finalState, staleDate: nil),
            dismissalPolicy: .after(.now + 60) // Показывать ещё минуту
        )

        currentActivity = nil
    }

    // Ошибка
    func fail(error: String) async {
        let errorState = BookProcessingAttributes.ContentState(
            currentChapter: 0,
            totalChapters: 0,
            progress: 0,
            status: .failed
        )

        await currentActivity?.end(
            ActivityContent(state: errorState, staleDate: nil),
            dismissalPolicy: .immediate
        )

        currentActivity = nil
    }
}

enum ProcessingError: Error {
    case activitiesNotEnabled
}
```

---

## 3. Quick Actions (App Icon)

### 3.1 Определённые Quick Actions

| Action | Icon | Действие |
|--------|------|----------|
| **Продолжить чтение** | `book.fill` | Открыть последнюю книгу |
| **Добавить книгу** | `plus.circle.fill` | Открыть импорт |

### 3.2 Реализация

**Info.plist:**

```xml
<key>UIApplicationShortcutItems</key>
<array>
    <dict>
        <key>UIApplicationShortcutItemType</key>
        <string>com.fancai.continueReading</string>
        <key>UIApplicationShortcutItemTitle</key>
        <string>Продолжить чтение</string>
        <key>UIApplicationShortcutItemIconType</key>
        <string>UIApplicationShortcutIconTypeBookmark</string>
    </dict>
    <dict>
        <key>UIApplicationShortcutItemType</key>
        <string>com.fancai.addBook</string>
        <key>UIApplicationShortcutItemTitle</key>
        <string>Добавить книгу</string>
        <key>UIApplicationShortcutItemIconType</key>
        <string>UIApplicationShortcutIconTypeAdd</string>
    </dict>
</array>
```

**SwiftUI обработка:**

```swift
@main
struct FancaiApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var navigationPath = NavigationPath()

    var body: some Scene {
        WindowGroup {
            ContentView(navigationPath: $navigationPath)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
    }

    private func handleDeepLink(_ url: URL) {
        // Обработка Deep Links
    }
}

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let config = UISceneConfiguration(
            name: nil,
            sessionRole: connectingSceneSession.role
        )
        config.delegateClass = SceneDelegate.self
        return config
    }
}

class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        handleShortcutItem(shortcutItem)
        completionHandler(true)
    }

    private func handleShortcutItem(_ shortcutItem: UIApplicationShortcutItem) {
        switch shortcutItem.type {
        case "com.fancai.continueReading":
            NotificationCenter.default.post(name: .continueReading, object: nil)

        case "com.fancai.addBook":
            NotificationCenter.default.post(name: .addBook, object: nil)

        default:
            break
        }
    }
}

extension Notification.Name {
    static let continueReading = Notification.Name("continueReading")
    static let addBook = Notification.Name("addBook")
}
```

---

## 4. Onboarding

### 4.1 Рекомендуемый подход

| Принцип | Реализация |
|---------|------------|
| **Краткость** | Максимум 3-4 экрана |
| **Опциональность** | Можно пропустить |
| **Progressive Disclosure** | Не показывать всё сразу |
| **Интерактивность** | Дать попробовать функции |
| **Отложенные разрешения** | Запрашивать в контексте |

### 4.2 SwiftUI реализация

```swift
import SwiftUI

enum OnboardingStep: Int, CaseIterable {
    case welcome = 0
    case features
    case setup
    case ready

    var title: String {
        switch self {
        case .welcome: return "Добро пожаловать в fancai"
        case .features: return "Оживите ваши книги"
        case .setup: return "Настройте под себя"
        case .ready: return "Всё готово!"
        }
    }

    var description: String {
        switch self {
        case .welcome:
            return "Читайте книги с AI-иллюстрациями, которые оживляют персонажей и сцены"
        case .features:
            return "AI автоматически находит описания и генерирует консистентные изображения персонажей"
        case .setup:
            return "Выберите тему и настройте цели чтения"
        case .ready:
            return "Добавьте первую книгу и начните читать!"
        }
    }

    var imageName: String {
        switch self {
        case .welcome: return "book.circle.fill"
        case .features: return "wand.and.stars"
        case .setup: return "gearshape.circle.fill"
        case .ready: return "checkmark.circle.fill"
        }
    }
}

struct OnboardingView: View {
    @AppStorage("hasCompletedOnboarding") private var hasCompleted = false
    @State private var currentStep: OnboardingStep = .welcome
    @State private var selectedTheme: AppTheme = .system

    var body: some View {
        VStack(spacing: 0) {
            // Progress indicator
            HStack(spacing: 8) {
                ForEach(OnboardingStep.allCases, id: \.rawValue) { step in
                    Capsule()
                        .fill(step.rawValue <= currentStep.rawValue ? Color.accentColor : Color.gray.opacity(0.3))
                        .frame(height: 4)
                }
            }
            .padding(.horizontal)
            .padding(.top)

            // Skip button
            HStack {
                Spacer()
                Button("Пропустить") {
                    completeOnboarding()
                }
                .foregroundStyle(.secondary)
            }
            .padding()

            // Content
            TabView(selection: $currentStep) {
                ForEach(OnboardingStep.allCases, id: \.rawValue) { step in
                    OnboardingStepView(
                        step: step,
                        selectedTheme: $selectedTheme
                    )
                    .tag(step)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(.easeInOut, value: currentStep)

            // Navigation buttons
            HStack(spacing: 16) {
                if currentStep != .welcome {
                    Button("Назад") {
                        withAnimation {
                            goBack()
                        }
                    }
                    .buttonStyle(.bordered)
                }

                Spacer()

                Button(currentStep == .ready ? "Начать" : "Далее") {
                    withAnimation {
                        goNext()
                    }
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
    }

    private func goNext() {
        if currentStep == .ready {
            completeOnboarding()
        } else if let nextStep = OnboardingStep(rawValue: currentStep.rawValue + 1) {
            currentStep = nextStep
        }
    }

    private func goBack() {
        if let prevStep = OnboardingStep(rawValue: currentStep.rawValue - 1) {
            currentStep = prevStep
        }
    }

    private func completeOnboarding() {
        hasCompleted = true
    }
}

struct OnboardingStepView: View {
    let step: OnboardingStep
    @Binding var selectedTheme: AppTheme

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Icon
            Image(systemName: step.imageName)
                .font(.system(size: 80))
                .foregroundStyle(.linearGradient(
                    colors: [.blue, .purple],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))

            // Title
            Text(step.title)
                .font(.title.bold())
                .multilineTextAlignment(.center)

            // Description
            Text(step.description)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            // Step-specific content
            if step == .setup {
                ThemePickerView(selectedTheme: $selectedTheme)
                    .padding(.top)
            }

            Spacer()
            Spacer()
        }
        .padding()
    }
}

struct ThemePickerView: View {
    @Binding var selectedTheme: AppTheme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Выберите тему")
                .font(.headline)

            HStack(spacing: 16) {
                ForEach(AppTheme.allCases, id: \.self) { theme in
                    ThemeOption(
                        theme: theme,
                        isSelected: selectedTheme == theme
                    )
                    .onTapGesture {
                        selectedTheme = theme
                    }
                }
            }
        }
    }
}

enum AppTheme: String, CaseIterable {
    case light = "Светлая"
    case dark = "Тёмная"
    case sepia = "Сепия"
    case system = "Системная"
}

struct ThemeOption: View {
    let theme: AppTheme
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
                .fill(backgroundColor)
                .frame(width: 60, height: 80)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 3)
                )

            Text(theme.rawValue)
                .font(.caption)
        }
    }

    var backgroundColor: Color {
        switch theme {
        case .light: return .white
        case .dark: return Color(white: 0.1)
        case .sepia: return Color(red: 0.96, green: 0.93, blue: 0.85)
        case .system: return Color.gray.opacity(0.3)
        }
    }
}
```

---

## 5. What's New

### 5.1 Реализация

```swift
import SwiftUI

struct WhatsNewView: View {
    @AppStorage("lastSeenVersion") private var lastSeenVersion = ""
    @Environment(\.dismiss) private var dismiss

    let currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""

    let features: [WhatsNewFeature] = [
        WhatsNewFeature(
            icon: "sparkles",
            title: "Новые стили генерации",
            description: "Добавлены стили Watercolor и Oil Painting для AI-иллюстраций"
        ),
        WhatsNewFeature(
            icon: "chart.bar.fill",
            title: "Улучшенная статистика",
            description: "Новые графики и детальная аналитика чтения"
        ),
        WhatsNewFeature(
            icon: "widget.small",
            title: "Виджеты для экрана блокировки",
            description: "Следите за прогрессом прямо с Lock Screen"
        )
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 8) {
                    Text("Что нового")
                        .font(.largeTitle.bold())

                    Text("Версия \(currentVersion)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top)

                // Features list
                ScrollView {
                    VStack(spacing: 20) {
                        ForEach(features) { feature in
                            HStack(alignment: .top, spacing: 16) {
                                Image(systemName: feature.icon)
                                    .font(.title2)
                                    .foregroundStyle(.blue)
                                    .frame(width: 40)

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(feature.title)
                                        .font(.headline)

                                    Text(feature.description)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }

                                Spacer()
                            }
                        }
                    }
                    .padding()
                }

                // Continue button
                Button("Продолжить") {
                    lastSeenVersion = currentVersion
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.bottom)
            }
        }
    }

    static func shouldShow(lastSeenVersion: String) -> Bool {
        let currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        return lastSeenVersion != currentVersion && !lastSeenVersion.isEmpty
    }
}

struct WhatsNewFeature: Identifiable {
    let id = UUID()
    let icon: String
    let title: String
    let description: String
}
```

---

## 6. App Store Rating

### 6.1 Когда запрашивать оценку

| ✅ Хорошие моменты | ❌ Плохие моменты |
|-------------------|------------------|
| После первой успешной генерации | На первом запуске |
| После завершения книги | Во время чтения |
| После 7+ дней использования | После ошибки |
| После достижения цели | В критический момент |

### 6.2 Реализация

```swift
import StoreKit
import SwiftUI

@Observable
class AppRatingManager {
    static let shared = AppRatingManager()

    private let userDefaults = UserDefaults.standard

    private var launchCount: Int {
        get { userDefaults.integer(forKey: "appLaunchCount") }
        set { userDefaults.set(newValue, forKey: "appLaunchCount") }
    }

    private var hasRequestedReview: Bool {
        get { userDefaults.bool(forKey: "hasRequestedReview") }
        set { userDefaults.set(newValue, forKey: "hasRequestedReview") }
    }

    private var lastReviewRequestDate: Date? {
        get { userDefaults.object(forKey: "lastReviewRequestDate") as? Date }
        set { userDefaults.set(newValue, forKey: "lastReviewRequestDate") }
    }

    private var successfulGenerations: Int {
        get { userDefaults.integer(forKey: "successfulGenerations") }
        set { userDefaults.set(newValue, forKey: "successfulGenerations") }
    }

    // Вызывать при каждом запуске
    func recordLaunch() {
        launchCount += 1
    }

    // Вызывать после успешной генерации
    func recordSuccessfulGeneration() {
        successfulGenerations += 1

        // Запросить оценку после первой успешной генерации
        // если пользователь использует приложение 7+ дней
        if successfulGenerations == 1 && launchCount >= 5 {
            requestReviewIfAppropriate()
        }
    }

    // Вызывать после завершения книги
    func recordBookCompleted() {
        requestReviewIfAppropriate()
    }

    func requestReviewIfAppropriate() {
        // Не запрашивать чаще раза в 4 месяца
        if let lastRequest = lastReviewRequestDate {
            let fourMonthsAgo = Calendar.current.date(byAdding: .month, value: -4, to: Date()) ?? Date.distantPast
            guard lastRequest < fourMonthsAgo else { return }
        }

        // Минимум 5 запусков
        guard launchCount >= 5 else { return }

        // Запрашиваем
        requestReview()
    }

    private func requestReview() {
        guard let scene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
            return
        }

        // iOS 18+: используем RequestReviewAction
        // iOS 17 и ниже: SKStoreReviewController
        if #available(iOS 18.0, *) {
            // SwiftUI environment action
            // Должен вызываться из View
        } else {
            SKStoreReviewController.requestReview(in: scene)
        }

        lastReviewRequestDate = Date()
    }
}

// SwiftUI View для iOS 18+
struct ReviewRequestView: View {
    @Environment(\.requestReview) private var requestReview

    var body: some View {
        EmptyView()
            .onAppear {
                requestReview()
            }
    }
}
```

---

## 7. Deep Links (Universal Links)

### 7.1 Поддерживаемые ссылки

| URL | Действие |
|-----|----------|
| `https://fancai.ru/collection/{slug}` | Открыть публичную коллекцию |
| `https://fancai.ru/book/{id}` | Открыть книгу (если есть) |

### 7.2 Настройка сервера

**apple-app-site-association** (без расширения):

```json
{
    "applinks": {
        "apps": [],
        "details": [
            {
                "appIDs": ["TEAM_ID.ru.fancai.app"],
                "paths": ["/collection/*", "/book/*"]
            }
        ]
    }
}
```

Файл должен быть доступен по адресу:
`https://fancai.ru/.well-known/apple-app-site-association`

### 7.3 Xcode настройка

1. **Signing & Capabilities** → Add **Associated Domains**
2. Добавить: `applinks:fancai.ru`

### 7.4 SwiftUI обработка

```swift
import SwiftUI

@main
struct FancaiApp: App {
    @StateObject private var navigationRouter = NavigationRouter()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(navigationRouter)
                .onOpenURL { url in
                    handleUniversalLink(url)
                }
        }
    }

    private func handleUniversalLink(_ url: URL) {
        guard let host = url.host, host == "fancai.ru" else { return }

        let pathComponents = url.pathComponents.filter { $0 != "/" }

        guard pathComponents.count >= 2 else { return }

        switch pathComponents[0] {
        case "collection":
            let slug = pathComponents[1]
            navigationRouter.navigateTo(.collection(slug: slug))

        case "book":
            let bookId = pathComponents[1]
            navigationRouter.navigateTo(.book(id: bookId))

        default:
            break
        }
    }
}

@MainActor
class NavigationRouter: ObservableObject {
    enum Destination: Hashable {
        case collection(slug: String)
        case book(id: String)
    }

    @Published var path = NavigationPath()
    @Published var pendingDestination: Destination?

    func navigateTo(_ destination: Destination) {
        // Если приложение ещё загружается, сохраняем для позже
        pendingDestination = destination

        // Добавляем в navigation path
        path.append(destination)
    }
}
```

---

## 8. Рекомендации по приоритетам

### 8.1 MVP (Phase 1)

| Компонент | Приоритет | Сложность |
|-----------|-----------|-----------|
| **Deep Links** | P0 | Средняя |
| **Onboarding** | P0 | Низкая |
| **Quick Actions** | P1 | Низкая |

### 8.2 Post-MVP (Phase 2-3)

| Компонент | Приоритет | Сложность |
|-----------|-----------|-----------|
| **Widgets (Home Screen)** | P1 | Средняя |
| **Widgets (Lock Screen)** | P2 | Низкая |
| **Dynamic Island** | P2 | Высокая |
| **What's New** | P2 | Низкая |
| **App Store Rating** | P2 | Низкая |

---

## Источники

- [Apple WidgetKit Documentation](https://developer.apple.com/documentation/widgetkit)
- [Apple ActivityKit Documentation](https://developer.apple.com/documentation/activitykit)
- [Apple Human Interface Guidelines - Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets)
- [Apple Human Interface Guidelines - Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities)
- [SKStoreReviewController Documentation](https://developer.apple.com/documentation/storekit/skstorereviewcontroller)
- [Universal Links Implementation Guide](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app)
- [WWDC 2024: Build widgets for the Smart Stack](https://developer.apple.com/videos/play/wwdc2024/10097/)
- [WWDC 2024: Bring your Live Activity to Apple Watch](https://developer.apple.com/videos/play/wwdc2024/10068/)
