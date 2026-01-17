# Спецификация синхронизации данных для fancai

**Дата:** 2026-01-17
**Scope:** Гибридная синхронизация CloudKit + Backend
**Автор:** Claude Code

---

## 1. Архитектура синхронизации

### 1.1 Гибридная модель

| Данные | Хранилище | Синхронизация |
|--------|-----------|---------------|
| **Файлы книг** | iCloud Drive | Автоматическая |
| **Кэш изображений** | iCloud Drive | Автоматическая |
| **Настройки Reader** | CloudKit (SwiftData) | Автоматическая |
| **Закладки и заметки** | CloudKit (SwiftData) | Автоматическая |
| **Позиция чтения** | CloudKit + Backend | Гибридная |
| **Профиль пользователя** | Backend | REST API |
| **Подписка и лимиты** | Backend | REST API |
| **Публичные коллекции** | Backend | REST API |
| **Статистика чтения** | Backend | REST API |
| **Достижения** | Backend | REST API |
| **Отзывы и рейтинги** | Backend | REST API |

### 1.2 Диаграмма архитектуры

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS App (fancai)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    SwiftData (Local)                        ││
│  │  ┌──────────────────┐  ┌──────────────────────────────────┐ ││
│  │  │ Books, Bookmarks │  │ Reading Position, Settings       │ ││
│  │  │ Notes, Highlights│  │ Theme Preferences                │ ││
│  │  └────────┬─────────┘  └─────────────┬────────────────────┘ ││
│  └───────────┼──────────────────────────┼──────────────────────┘│
│              │                          │                        │
│              ▼                          ▼                        │
│  ┌──────────────────────┐  ┌────────────────────────────────────┐
│  │   iCloud Drive       │  │   CloudKit Private Database        │
│  │   (File Storage)     │  │   (SwiftData Sync)                 │
│  │                      │  │                                    │
│  │   • EPUB/FB2 files   │  │   • Bookmarks                      │
│  │   • AI images cache  │  │   • Highlights                     │
│  │                      │  │   • Notes                          │
│  └──────────────────────┘  │   • Reading position               │
│                            │   • Reader settings                │
│                            └────────────────────────────────────┘
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   Backend Sync Layer                        ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ ││
│  │  │ Profile Sync │  │ Stats Sync   │  │ Subscription Sync  │ ││
│  │  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘ ││
│  └─────────┼─────────────────┼────────────────────┼────────────┘│
│            │                 │                    │              │
└────────────┼─────────────────┼────────────────────┼──────────────┘
             │                 │                    │
             ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend                             │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────────┐│
│  │ PostgreSQL  │  │ Redis       │  │ AI Services               ││
│  │             │  │ (Cache)     │  │ (Gemini, Imagen)          ││
│  └─────────────┘  └─────────────┘  └───────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. CloudKit + SwiftData синхронизация

### 2.1 Настройка Model Container

```swift
import SwiftData
import SwiftUI

@main
struct FancaiApp: App {
    var sharedModelContainer: ModelContainer = {
        // Схема для синхронизации
        let schema = Schema([
            Book.self,
            Bookmark.self,
            Highlight.self,
            Note.self,
            ReadingPosition.self,
            ReaderSettings.self
        ])

        // Конфигурация с CloudKit
        let modelConfiguration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false,
            cloudKitDatabase: .private("iCloud.ru.fancai.app")
        )

        do {
            return try ModelContainer(
                for: schema,
                configurations: [modelConfiguration]
            )
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(sharedModelContainer)
    }
}
```

### 2.2 Модели данных для CloudKit

```swift
import SwiftData
import Foundation

// MARK: - Book Model (CloudKit-compatible)

@Model
final class Book {
    // CloudKit: НЕ используем @Attribute(.unique) — не поддерживается
    var id: UUID
    var fileHash: String // Вместо unique constraint
    var title: String
    var author: String?
    var coverData: Data?
    var addedAt: Date

    // CloudKit: все свойства опциональные или с default value
    var lastOpenedAt: Date?
    var isFinished: Bool = false
    var format: String = "epub"

    // CloudKit: relationships должны быть опциональными
    @Relationship(deleteRule: .cascade)
    var bookmarks: [Bookmark]?

    @Relationship(deleteRule: .cascade)
    var highlights: [Highlight]?

    @Relationship(deleteRule: .cascade)
    var notes: [Note]?

    // CloudKit sync metadata
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        fileHash: String,
        title: String,
        author: String? = nil
    ) {
        self.id = id
        self.fileHash = fileHash
        self.title = title
        self.author = author
        self.addedAt = Date()
        self.updatedAt = Date()
    }
}

// MARK: - Bookmark Model

@Model
final class Bookmark {
    var id: UUID
    var cfi: String // EPUB CFI
    var preview: String?
    var createdAt: Date
    var updatedAt: Date

    @Relationship
    var book: Book?

    init(cfi: String, preview: String? = nil, book: Book? = nil) {
        self.id = UUID()
        self.cfi = cfi
        self.preview = preview
        self.book = book
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

// MARK: - Highlight Model

@Model
final class Highlight {
    var id: UUID
    var cfiStart: String
    var cfiEnd: String
    var text: String
    var color: String
    var createdAt: Date
    var updatedAt: Date

    @Relationship
    var book: Book?

    @Relationship(deleteRule: .cascade)
    var note: Note?

    init(
        cfiStart: String,
        cfiEnd: String,
        text: String,
        color: String = "yellow",
        book: Book? = nil
    ) {
        self.id = UUID()
        self.cfiStart = cfiStart
        self.cfiEnd = cfiEnd
        self.text = text
        self.color = color
        self.book = book
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

// MARK: - Note Model

@Model
final class Note {
    var id: UUID
    var content: String
    var createdAt: Date
    var updatedAt: Date

    @Relationship
    var book: Book?

    @Relationship
    var highlight: Highlight?

    init(content: String, book: Book? = nil, highlight: Highlight? = nil) {
        self.id = UUID()
        self.content = content
        self.book = book
        self.highlight = highlight
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

// MARK: - Reading Position Model

@Model
final class ReadingPosition {
    var id: UUID
    var bookHash: String // Reference to book
    var cfi: String
    var progress: Double // 0.0 - 1.0
    var chapter: Int?
    var page: Int?
    var deviceId: String
    var updatedAt: Date

    init(bookHash: String, cfi: String, progress: Double, deviceId: String) {
        self.id = UUID()
        self.bookHash = bookHash
        self.cfi = cfi
        self.progress = progress
        self.deviceId = deviceId
        self.updatedAt = Date()
    }
}

// MARK: - Reader Settings Model

@Model
final class ReaderSettings {
    var id: UUID
    var fontFamily: String
    var fontSize: Double
    var lineSpacing: Double
    var theme: String
    var margins: Double
    var updatedAt: Date

    init() {
        self.id = UUID()
        self.fontFamily = "Georgia"
        self.fontSize = 18
        self.lineSpacing = 1.5
        self.theme = "light"
        self.margins = 20
        self.updatedAt = Date()
    }
}
```

### 2.3 Ограничения CloudKit для SwiftData

| Ограничение | Описание | Решение |
|-------------|----------|---------|
| Нет `@Unique` | CloudKit не поддерживает unique constraints | Использовать manual deduplication |
| Опциональные relationships | Все связи должны быть Optional | Декларировать как `var relation: Model?` |
| Нет `Deny` delete rule | Запрет удаления не работает | Использовать `.nullify` или `.cascade` |
| Асинхронная синхронизация | Данные могут не сразу быть на других устройствах | Показывать статус синхронизации |

---

## 3. Conflict Resolution

### 3.1 Стратегии разрешения конфликтов

| Стратегия | Применение | Описание |
|-----------|------------|----------|
| **Last-Writer-Wins** | Настройки Reader | Последнее изменение побеждает |
| **Timestamp-based** | Позиция чтения | Выбор по `updatedAt` |
| **User Choice** | Критичные данные | Спросить пользователя |
| **Merge** | Закладки, выделения | Объединить оба набора |

### 3.2 Конфликт позиции чтения

```swift
import SwiftUI
import SwiftData

// MARK: - Reading Position Conflict Resolver

@Observable
class ReadingPositionSyncManager {
    let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    /// Проверка конфликта позиции чтения при открытии книги
    func checkPositionConflict(for bookHash: String) async -> PositionConflict? {
        // Получаем все позиции для этой книги с разных устройств
        let descriptor = FetchDescriptor<ReadingPosition>(
            predicate: #Predicate { $0.bookHash == bookHash }
        )

        do {
            let positions = try modelContext.fetch(descriptor)

            // Если позиций больше одной — потенциальный конфликт
            if positions.count > 1 {
                let sorted = positions.sorted { $0.updatedAt > $1.updatedAt }
                let newest = sorted[0]
                let current = sorted.first { $0.deviceId == currentDeviceId }

                // Конфликт есть если текущая позиция не самая новая
                // и разница существенна (> 5%)
                if let current = current,
                   current.id != newest.id,
                   abs(current.progress - newest.progress) > 0.05 {
                    return PositionConflict(
                        currentPosition: current,
                        newerPosition: newest,
                        bookHash: bookHash
                    )
                }
            }

            return nil
        } catch {
            return nil
        }
    }

    /// Применить выбранную позицию
    func apply(position: ReadingPosition, to bookHash: String) {
        // Удаляем все старые позиции для этой книги
        let descriptor = FetchDescriptor<ReadingPosition>(
            predicate: #Predicate { $0.bookHash == bookHash }
        )

        do {
            let oldPositions = try modelContext.fetch(descriptor)
            for old in oldPositions where old.id != position.id {
                modelContext.delete(old)
            }

            // Обновляем текущую позицию
            position.deviceId = currentDeviceId
            position.updatedAt = Date()

            try modelContext.save()
        } catch {
            // Handle error
        }
    }

    private var currentDeviceId: String {
        UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
    }
}

struct PositionConflict {
    let currentPosition: ReadingPosition
    let newerPosition: ReadingPosition
    let bookHash: String
}

// MARK: - Conflict Resolution UI

struct PositionConflictSheet: View {
    let conflict: PositionConflict
    let onChoose: (ReadingPosition) -> Void

    var body: some View {
        VStack(spacing: 24) {
            // Заголовок
            VStack(spacing: 8) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 48))
                    .foregroundStyle(.blue)

                Text("Разные позиции чтения")
                    .font(.title2.bold())

                Text("Обнаружено расхождение между устройствами")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Divider()

            // Варианты
            VStack(spacing: 16) {
                PositionOptionButton(
                    title: "Продолжить с текущего устройства",
                    progress: conflict.currentPosition.progress,
                    deviceLabel: "Это устройство",
                    date: conflict.currentPosition.updatedAt
                ) {
                    onChoose(conflict.currentPosition)
                }

                PositionOptionButton(
                    title: "Продолжить с другого устройства",
                    progress: conflict.newerPosition.progress,
                    deviceLabel: "Другое устройство",
                    date: conflict.newerPosition.updatedAt
                ) {
                    onChoose(conflict.newerPosition)
                }
            }
        }
        .padding()
    }
}

struct PositionOptionButton: View {
    let title: String
    let progress: Double
    let deviceLabel: String
    let date: Date
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)

                    Text("\(Int(progress * 100))% прочитано • \(deviceLabel)")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Text(date.formatted(.relative(presentation: .named)))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundStyle(.secondary)
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}
```

### 3.3 Deduplication (удаление дубликатов)

```swift
import SwiftData
import Foundation

// MARK: - Deduplication Service

class DeduplicationService {
    let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    /// Удаление дубликатов книг после синхронизации
    func deduplicateBooks() throws {
        let descriptor = FetchDescriptor<Book>(
            sortBy: [SortDescriptor(\Book.addedAt)]
        )
        let allBooks = try modelContext.fetch(descriptor)

        // Группируем по fileHash
        var booksByHash: [String: [Book]] = [:]
        for book in allBooks {
            booksByHash[book.fileHash, default: []].append(book)
        }

        // Находим дубликаты
        for (_, books) in booksByHash where books.count > 1 {
            // Оставляем самую новую (по updatedAt)
            let sorted = books.sorted { $0.updatedAt > $1.updatedAt }
            let toKeep = sorted[0]

            // Удаляем остальные, мержим данные
            for duplicate in sorted.dropFirst() {
                mergeBookData(from: duplicate, to: toKeep)
                modelContext.delete(duplicate)
            }
        }

        try modelContext.save()
    }

    /// Удаление дубликатов закладок
    func deduplicateBookmarks() throws {
        let descriptor = FetchDescriptor<Bookmark>()
        let allBookmarks = try modelContext.fetch(descriptor)

        // Группируем по book + cfi
        var bookmarksByCFI: [String: [Bookmark]] = [:]
        for bookmark in allBookmarks {
            let key = "\(bookmark.book?.id.uuidString ?? "")_\(bookmark.cfi)"
            bookmarksByCFI[key, default: []].append(bookmark)
        }

        // Удаляем дубликаты
        for (_, bookmarks) in bookmarksByCFI where bookmarks.count > 1 {
            let sorted = bookmarks.sorted { $0.updatedAt > $1.updatedAt }
            for duplicate in sorted.dropFirst() {
                modelContext.delete(duplicate)
            }
        }

        try modelContext.save()
    }

    private func mergeBookData(from source: Book, to target: Book) {
        // Merge bookmarks
        if let sourceBookmarks = source.bookmarks {
            var targetBookmarks = target.bookmarks ?? []
            for bookmark in sourceBookmarks {
                bookmark.book = target
                targetBookmarks.append(bookmark)
            }
            target.bookmarks = targetBookmarks
        }

        // Merge highlights
        if let sourceHighlights = source.highlights {
            var targetHighlights = target.highlights ?? []
            for highlight in sourceHighlights {
                highlight.book = target
                targetHighlights.append(highlight)
            }
            target.highlights = targetHighlights
        }

        // Take the most recent lastOpenedAt
        if let sourceLastOpened = source.lastOpenedAt {
            if let targetLastOpened = target.lastOpenedAt {
                target.lastOpenedAt = max(sourceLastOpened, targetLastOpened)
            } else {
                target.lastOpenedAt = sourceLastOpened
            }
        }

        // isFinished — если хотя бы одна прочитана
        target.isFinished = target.isFinished || source.isFinished
    }
}
```

---

## 4. Backend синхронизация

### 4.1 Sync Manager

```swift
import Foundation

// MARK: - Backend Sync Manager

@Observable
class BackendSyncManager {
    static let shared = BackendSyncManager()

    private let apiClient: APIClient
    private let queue = DispatchQueue(label: "sync.queue")

    // Статус синхронизации
    private(set) var isSyncing = false
    private(set) var lastSyncDate: Date?
    private(set) var syncError: Error?

    // Pending changes queue
    private var pendingChanges: [SyncChange] = []

    init(apiClient: APIClient = .shared) {
        self.apiClient = apiClient

        // Подписка на изменения сети
        setupNetworkObserver()
    }

    /// Полная синхронизация при запуске
    func performFullSync() async throws {
        isSyncing = true
        syncError = nil

        defer { isSyncing = false }

        do {
            // 1. Синхронизация профиля
            try await syncProfile()

            // 2. Синхронизация подписки
            try await syncSubscription()

            // 3. Синхронизация статистики
            try await syncStatistics()

            // 4. Синхронизация достижений
            try await syncAchievements()

            // 5. Отправка pending changes
            try await sendPendingChanges()

            lastSyncDate = Date()
        } catch {
            syncError = error
            throw error
        }
    }

    /// Фоновая синхронизация
    func backgroundSync() async {
        guard !isSyncing else { return }

        do {
            try await sendPendingChanges()
        } catch {
            // Queue changes for later
        }
    }

    /// Добавление изменения в очередь
    func enqueue(change: SyncChange) {
        queue.async {
            self.pendingChanges.append(change)
            self.persistPendingChanges()
        }
    }

    // MARK: - Private Methods

    private func syncProfile() async throws {
        let profile = try await apiClient.request(
            endpoint: .getProfile,
            responseType: UserProfile.self
        )

        // Сохраняем в UserDefaults / Keychain
        UserProfileStore.shared.update(profile)
    }

    private func syncSubscription() async throws {
        let subscription = try await apiClient.request(
            endpoint: .getSubscription,
            responseType: SubscriptionInfo.self
        )

        SubscriptionManager.shared.update(from: subscription)
    }

    private func syncStatistics() async throws {
        // Отправляем локальную статистику
        let localStats = ReadingStatsStore.shared.pendingStats
        if !localStats.isEmpty {
            try await apiClient.request(
                endpoint: .postStats(localStats),
                responseType: EmptyResponse.self
            )
            ReadingStatsStore.shared.clearPending()
        }

        // Получаем агрегированную статистику
        let stats = try await apiClient.request(
            endpoint: .getStats,
            responseType: ReadingStatistics.self
        )
        ReadingStatsStore.shared.update(stats)
    }

    private func syncAchievements() async throws {
        let achievements = try await apiClient.request(
            endpoint: .getAchievements,
            responseType: [Achievement].self
        )

        AchievementsStore.shared.update(achievements)
    }

    private func sendPendingChanges() async throws {
        let changes = pendingChanges
        guard !changes.isEmpty else { return }

        try await apiClient.request(
            endpoint: .postSyncChanges(changes),
            responseType: EmptyResponse.self
        )

        queue.async {
            self.pendingChanges.removeAll { changes.contains($0) }
            self.persistPendingChanges()
        }
    }

    private func persistPendingChanges() {
        // Сохраняем в UserDefaults для восстановления после рестарта
        if let data = try? JSONEncoder().encode(pendingChanges) {
            UserDefaults.standard.set(data, forKey: "pendingChanges")
        }
    }

    private func setupNetworkObserver() {
        // Наблюдение за сетью для отправки pending changes
    }
}

// MARK: - Sync Change

struct SyncChange: Identifiable, Codable, Equatable {
    let id: UUID
    let type: ChangeType
    let entityId: String
    let data: Data
    let timestamp: Date

    enum ChangeType: String, Codable {
        case readingSession
        case bookFinished
        case achievementUnlocked
        case ratingCreated
        case reviewCreated
    }
}
```

### 4.2 Background Sync (BGTaskScheduler)

```swift
import BackgroundTasks
import UIKit

// MARK: - Background Sync Task

class BackgroundSyncTask {
    static let identifier = "ru.fancai.app.sync"

    /// Регистрация задачи
    static func register() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: identifier,
            using: nil
        ) { task in
            handleSync(task: task as! BGAppRefreshTask)
        }
    }

    /// Планирование задачи
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 минут

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("Could not schedule background sync: \(error)")
        }
    }

    /// Обработка задачи
    private static func handleSync(task: BGAppRefreshTask) {
        // Планируем следующий запуск
        schedule()

        let syncTask = Task {
            await BackendSyncManager.shared.backgroundSync()
        }

        task.expirationHandler = {
            syncTask.cancel()
        }

        Task {
            await syncTask.value
            task.setTaskCompleted(success: true)
        }
    }
}

// MARK: - AppDelegate Integration

extension AppDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        BackgroundSyncTask.register()
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        BackgroundSyncTask.schedule()
    }
}
```

---

## 5. Sync Status UI

### 5.1 Индикатор синхронизации

```swift
import SwiftUI

struct SyncStatusView: View {
    @State private var syncManager = BackendSyncManager.shared

    var body: some View {
        HStack(spacing: 8) {
            if syncManager.isSyncing {
                ProgressView()
                    .controlSize(.small)

                Text("Синхронизация...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if let error = syncManager.syncError {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)

                Text("Ошибка синхронизации")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if let lastSync = syncManager.lastSyncDate {
                Image(systemName: "checkmark.icloud")
                    .foregroundStyle(.green)

                Text("Синхронизировано \(lastSync.formatted(.relative(presentation: .named)))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Full Sync Status Screen

struct SyncStatusScreen: View {
    @State private var syncManager = BackendSyncManager.shared

    var body: some View {
        List {
            Section {
                // Последняя синхронизация
                if let lastSync = syncManager.lastSyncDate {
                    LabeledContent("Последняя синхронизация") {
                        Text(lastSync.formatted())
                    }
                }

                // Статус
                LabeledContent("Статус") {
                    if syncManager.isSyncing {
                        HStack {
                            ProgressView()
                                .controlSize(.small)
                            Text("Синхронизация")
                        }
                    } else if syncManager.syncError != nil {
                        Label("Ошибка", systemImage: "xmark.circle")
                            .foregroundStyle(.red)
                    } else {
                        Label("Синхронизировано", systemImage: "checkmark.circle")
                            .foregroundStyle(.green)
                    }
                }
            }

            Section {
                // iCloud статус
                LabeledContent("Книги и закладки") {
                    Label("iCloud", systemImage: "icloud.fill")
                }

                LabeledContent("Профиль и статистика") {
                    Label("Сервер fancai", systemImage: "server.rack")
                }
            } header: {
                Text("Источники данных")
            }

            Section {
                Button("Синхронизировать сейчас") {
                    Task {
                        try? await syncManager.performFullSync()
                    }
                }
                .disabled(syncManager.isSyncing)
            }
        }
        .navigationTitle("Синхронизация")
    }
}
```

---

## 6. iCloud Drive для файлов

### 6.1 File Provider

```swift
import Foundation

// MARK: - iCloud File Manager

class iCloudFileManager {
    static let shared = iCloudFileManager()

    private let fileManager = FileManager.default

    /// Контейнер iCloud
    var containerURL: URL? {
        fileManager.url(forUbiquityContainerIdentifier: nil)?
            .appendingPathComponent("Documents")
    }

    /// Проверка доступности iCloud
    var isICloudAvailable: Bool {
        containerURL != nil
    }

    /// Сохранение книги в iCloud
    func saveBook(from localURL: URL, fileName: String) async throws -> URL {
        guard let container = containerURL else {
            throw iCloudError.notAvailable
        }

        let destinationURL = container
            .appendingPathComponent("Books")
            .appendingPathComponent(fileName)

        // Создаём директорию если нужно
        let booksDir = container.appendingPathComponent("Books")
        if !fileManager.fileExists(atPath: booksDir.path) {
            try fileManager.createDirectory(at: booksDir, withIntermediateDirectories: true)
        }

        // Копируем файл
        if fileManager.fileExists(atPath: destinationURL.path) {
            try fileManager.removeItem(at: destinationURL)
        }
        try fileManager.copyItem(at: localURL, to: destinationURL)

        return destinationURL
    }

    /// Загрузка книги из iCloud
    func downloadBook(at url: URL) async throws {
        // Начинаем загрузку если файл ещё не скачан
        try fileManager.startDownloadingUbiquitousItem(at: url)

        // Ждём завершения загрузки
        var resourceValues = try url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
        while resourceValues.ubiquitousItemDownloadingStatus != .current {
            try await Task.sleep(for: .milliseconds(500))
            resourceValues = try url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
        }
    }

    /// Получение всех книг из iCloud
    func getAllBooks() async throws -> [URL] {
        guard let container = containerURL else {
            throw iCloudError.notAvailable
        }

        let booksDir = container.appendingPathComponent("Books")

        let contents = try fileManager.contentsOfDirectory(
            at: booksDir,
            includingPropertiesForKeys: [.isUbiquitousItemKey],
            options: [.skipsHiddenFiles]
        )

        return contents.filter { url in
            ["epub", "fb2"].contains(url.pathExtension.lowercased())
        }
    }

    /// Удаление книги
    func deleteBook(at url: URL) throws {
        try fileManager.removeItem(at: url)
    }
}

enum iCloudError: LocalizedError {
    case notAvailable

    var errorDescription: String? {
        switch self {
        case .notAvailable:
            return "iCloud недоступен"
        }
    }
}
```

---

## 7. Приоритеты реализации

### MVP (Phase 1)
| Функция | Приоритет |
|---------|-----------|
| SwiftData + CloudKit для закладок | P0 |
| Backend синхронизация профиля | P0 |
| Локальное offline-хранение | P0 |

### Post-MVP (Phase 2)
| Функция | Приоритет |
|---------|-----------|
| Conflict resolution UI | P1 |
| Background sync | P1 |
| iCloud Drive для книг | P1 |

### Future (Phase 3)
| Функция | Приоритет |
|---------|-----------|
| Deduplication service | P2 |
| Sync status UI | P2 |
| Multi-device position sync | P2 |

---

## Источники

- [Apple SwiftData Documentation](https://developer.apple.com/documentation/swiftdata)
- [Apple CloudKit Documentation](https://developer.apple.com/documentation/cloudkit)
- [CloudKit Best Practices (WWDC)](https://developer.apple.com/videos/play/wwdc2023/10187/)
- [Background Tasks (BGTaskScheduler)](https://developer.apple.com/documentation/backgroundtasks)
