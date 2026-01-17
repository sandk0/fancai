# Тестирование iOS-приложения fancai

**Дата:** 2026-01-17
**Scope:** Swift Testing, XCTest, UI-тесты, мокирование
**Автор:** Claude Code

---

## 1. Сравнение фреймворков

### 1.1 Swift Testing vs XCTest

| Критерий | Swift Testing | XCTest |
|----------|---------------|--------|
| **Появление** | WWDC 2024, Xcode 16 | 2013, iOS 7 |
| **Синтаксис** | @Test, #expect | XCTestCase, XCTAssert |
| **Наследование** | Не нужно | XCTestCase обязательно |
| **async/await** | Нативная поддержка | Поддерживается |
| **UI-тесты** | ❌ Нет | ✅ XCUITest |
| **Performance-тесты** | ❌ Нет | ✅ XCTMetric |
| **Параметризация** | ✅ Встроенная | @testable import |
| **Open Source** | ✅ Да | ❌ Нет |
| **Платформы** | iOS, macOS, Linux, Windows | Apple platforms |

### 1.2 Рекомендация для fancai

| Тип тестов | Фреймворк |
|------------|-----------|
| Unit-тесты | **Swift Testing** |
| Integration-тесты | **Swift Testing** |
| UI-тесты | **XCTest (XCUITest)** |
| Snapshot-тесты | **swift-snapshot-testing** |
| Performance-тесты | **XCTest** |

---

## 2. Swift Testing

### 2.1 Базовый синтаксис

```swift
import Testing
@testable import Fancai

// MARK: - Простой тест

@Test
func bookTitleParsing() {
    let book = Book(title: "Война и мир", author: "Л.Н. Толстой")

    #expect(book.title == "Война и мир")
    #expect(book.author == "Л.Н. Толстой")
}

// MARK: - Тест с throws

@Test
func bookLoadingThrowsOnInvalidPath() throws {
    let loader = BookLoader()

    #expect(throws: BookError.fileNotFound) {
        try loader.load(from: URL(fileURLWithPath: "/invalid/path"))
    }
}

// MARK: - Async тест

@Test
func fetchBookMetadata() async throws {
    let service = BookMetadataService()
    let metadata = try await service.fetch(isbn: "978-5-389-06256-6")

    #expect(metadata.title.contains("Война"))
    #expect(metadata.pageCount > 0)
}
```

### 2.2 Организация тестов

```swift
import Testing
@testable import Fancai

// MARK: - Группировка через struct

struct LibraryTests {
    let library = Library()

    @Test
    func addBook() {
        library.add(Book(title: "Test"))
        #expect(library.count == 1)
    }

    @Test
    func removeBook() {
        let book = Book(title: "Test")
        library.add(book)
        library.remove(book)
        #expect(library.count == 0)
    }

    // Вложенная группа
    struct SortingTests {
        @Test
        func sortByTitle() {
            let library = Library()
            library.add(Book(title: "Zebra"))
            library.add(Book(title: "Apple"))

            let sorted = library.sorted(by: .title)
            #expect(sorted.first?.title == "Apple")
        }
    }
}
```

### 2.3 Параметризованные тесты

```swift
import Testing

@Test(arguments: [
    (1, "1 книга"),
    (2, "2 книги"),
    (5, "5 книг"),
    (21, "21 книга"),
    (0, "0 книг")
])
func pluralization(count: Int, expected: String) {
    let result = "\(count) \(count.pluralized("книга", "книги", "книг"))"
    #expect(result == expected)
}

// Комбинации параметров
@Test(arguments: Theme.allCases, [12.0, 16.0, 24.0])
func fontSizeInTheme(theme: Theme, fontSize: Double) {
    let settings = ReaderSettings(theme: theme, fontSize: fontSize)
    #expect(settings.isValid)
}
```

### 2.4 Traits (условия и метаданные)

```swift
import Testing

// Пропустить тест
@Test(.disabled("Требует API key"))
func aiImageGeneration() async throws {
    // ...
}

// Условное выполнение
@Test(.enabled(if: ProcessInfo.processInfo.environment["CI"] != nil))
func ciOnlyTest() {
    // Запускается только в CI
}

// Таймаут
@Test(.timeLimit(.minutes(1)))
func longRunningTest() async throws {
    // ...
}

// Баг-трекинг
@Test(.bug("https://github.com/fancai/app/issues/123"))
func testWithKnownBug() {
    // Связан с issue
}
```

---

## 3. XCTest (UI-тесты)

### 3.1 UI-тест для Reader

```swift
import XCTest

final class ReaderUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launch()
    }

    func testOpenBookAndNavigate() throws {
        // Открываем библиотеку
        let libraryTab = app.tabBars.buttons["Библиотека"]
        XCTAssertTrue(libraryTab.waitForExistence(timeout: 5))
        libraryTab.tap()

        // Открываем первую книгу
        let firstBook = app.collectionViews.cells.firstMatch
        XCTAssertTrue(firstBook.waitForExistence(timeout: 5))
        firstBook.tap()

        // Проверяем что reader открылся
        let readerView = app.otherElements["ReaderView"]
        XCTAssertTrue(readerView.waitForExistence(timeout: 5))

        // Свайп для перехода на следующую страницу
        readerView.swipeLeft()

        // Проверяем прогресс
        let progressLabel = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS '2'")
        ).firstMatch
        XCTAssertTrue(progressLabel.exists)
    }

    func testBookmarkCreation() throws {
        // Открываем книгу
        openFirstBook()

        // Долгое нажатие для контекстного меню
        let readerView = app.otherElements["ReaderView"]
        readerView.press(forDuration: 1.0)

        // Выбираем "Добавить закладку"
        let bookmarkButton = app.buttons["Добавить закладку"]
        XCTAssertTrue(bookmarkButton.waitForExistence(timeout: 3))
        bookmarkButton.tap()

        // Проверяем появление индикатора закладки
        let bookmarkIndicator = app.images["BookmarkIndicator"]
        XCTAssertTrue(bookmarkIndicator.exists)
    }

    private func openFirstBook() {
        app.tabBars.buttons["Библиотека"].tap()
        app.collectionViews.cells.firstMatch.tap()
    }
}
```

### 3.2 Accessibility Identifiers

```swift
// В коде приложения
struct ReaderView: View {
    var body: some View {
        VStack {
            // ...
        }
        .accessibilityIdentifier("ReaderView")
    }
}

struct BookmarkButton: View {
    var body: some View {
        Button("Добавить закладку") { }
            .accessibilityIdentifier("AddBookmarkButton")
    }
}
```

---

## 4. Мокирование

### 4.1 Протоколы для DI

```swift
// MARK: - Protocols

protocol BookRepositoryProtocol {
    func fetchAll() async throws -> [Book]
    func save(_ book: Book) async throws
    func delete(_ book: Book) async throws
}

protocol AIServiceProtocol {
    func generateImage(prompt: String) async throws -> Data
    func extractDescription(from text: String) async throws -> String
}

// MARK: - Production Implementation

class BookRepository: BookRepositoryProtocol {
    private let modelContext: ModelContext

    func fetchAll() async throws -> [Book] {
        try modelContext.fetch(FetchDescriptor<Book>())
    }

    func save(_ book: Book) async throws {
        modelContext.insert(book)
        try modelContext.save()
    }

    func delete(_ book: Book) async throws {
        modelContext.delete(book)
        try modelContext.save()
    }
}
```

### 4.2 Mock-реализации

```swift
import Testing
@testable import Fancai

// MARK: - Mock Repository

class MockBookRepository: BookRepositoryProtocol {
    var books: [Book] = []
    var shouldThrow = false
    var fetchCallCount = 0

    func fetchAll() async throws -> [Book] {
        fetchCallCount += 1
        if shouldThrow {
            throw BookError.databaseError
        }
        return books
    }

    func save(_ book: Book) async throws {
        if shouldThrow { throw BookError.databaseError }
        books.append(book)
    }

    func delete(_ book: Book) async throws {
        if shouldThrow { throw BookError.databaseError }
        books.removeAll { $0.id == book.id }
    }
}

// MARK: - Mock AI Service

class MockAIService: AIServiceProtocol {
    var imageData = Data()
    var description = "Mock description"
    var delay: Duration = .zero

    func generateImage(prompt: String) async throws -> Data {
        try await Task.sleep(for: delay)
        return imageData
    }

    func extractDescription(from text: String) async throws -> String {
        try await Task.sleep(for: delay)
        return description
    }
}
```

### 4.3 Тесты с моками

```swift
import Testing
@testable import Fancai

struct LibraryViewModelTests {
    @Test
    func loadBooksSuccess() async throws {
        // Arrange
        let mockRepo = MockBookRepository()
        mockRepo.books = [
            Book(title: "Book 1"),
            Book(title: "Book 2")
        ]
        let viewModel = LibraryViewModel(repository: mockRepo)

        // Act
        await viewModel.loadBooks()

        // Assert
        #expect(viewModel.books.count == 2)
        #expect(viewModel.isLoading == false)
        #expect(viewModel.error == nil)
    }

    @Test
    func loadBooksError() async throws {
        // Arrange
        let mockRepo = MockBookRepository()
        mockRepo.shouldThrow = true
        let viewModel = LibraryViewModel(repository: mockRepo)

        // Act
        await viewModel.loadBooks()

        // Assert
        #expect(viewModel.books.isEmpty)
        #expect(viewModel.error != nil)
    }

    @Test
    func deleteBookRefreshesList() async throws {
        // Arrange
        let mockRepo = MockBookRepository()
        let book = Book(title: "To Delete")
        mockRepo.books = [book]
        let viewModel = LibraryViewModel(repository: mockRepo)
        await viewModel.loadBooks()

        // Act
        await viewModel.delete(book)

        // Assert
        #expect(viewModel.books.isEmpty)
        #expect(mockRepo.fetchCallCount == 2) // Initial + after delete
    }
}
```

---

## 5. Snapshot-тесты

### 5.1 Настройка swift-snapshot-testing

```swift
// Package.swift или SPM
.package(url: "https://github.com/pointfreeco/swift-snapshot-testing", from: "1.15.0")
```

### 5.2 Snapshot-тесты для SwiftUI

```swift
import XCTest
import SnapshotTesting
import SwiftUI
@testable import Fancai

final class BookCardSnapshotTests: XCTestCase {
    func testBookCardLight() {
        let view = BookCardView(book: .preview)
            .frame(width: 300, height: 400)
            .environment(\.colorScheme, .light)

        assertSnapshot(of: view, as: .image)
    }

    func testBookCardDark() {
        let view = BookCardView(book: .preview)
            .frame(width: 300, height: 400)
            .environment(\.colorScheme, .dark)

        assertSnapshot(of: view, as: .image)
    }

    func testEmptyLibraryState() {
        let view = EmptyLibraryView()
            .frame(width: 375, height: 667)

        assertSnapshot(of: view, as: .image(layout: .device(config: .iPhone13)))
    }
}

// Preview data
extension Book {
    static var preview: Book {
        Book(
            title: "Война и мир",
            author: "Л.Н. Толстой",
            coverData: UIImage(named: "sample_cover")?.pngData()
        )
    }
}
```

---

## 6. Тестирование async/await

### 6.1 Swift Testing (рекомендуется)

```swift
import Testing
@testable import Fancai

@Test
func fetchBookCoversInParallel() async throws {
    let service = BookCoverService()
    let isbns = ["978-1", "978-2", "978-3"]

    let covers = try await service.fetchCovers(for: isbns)

    #expect(covers.count == 3)
    #expect(covers.allSatisfy { $0.value != nil })
}

@Test
func timeoutOnSlowNetwork() async throws {
    let mockService = MockNetworkService()
    mockService.delay = .seconds(10)

    await #expect(throws: NetworkError.timeout) {
        try await mockService.fetch(timeout: .seconds(1))
    }
}
```

### 6.2 XCTest для async

```swift
import XCTest
@testable import Fancai

final class AsyncXCTests: XCTestCase {
    func testAsyncBookLoading() async throws {
        let loader = BookLoader()
        let book = try await loader.load(from: testBookURL)

        XCTAssertEqual(book.title, "Test Book")
        XCTAssertGreaterThan(book.chapters.count, 0)
    }

    // MainActor для UI-related тестов
    @MainActor
    func testViewModelUpdatesUI() async {
        let viewModel = LibraryViewModel()
        await viewModel.loadBooks()

        XCTAssertFalse(viewModel.isLoading)
    }
}
```

---

## 7. Тестирование SwiftData

### 7.1 In-Memory Container

```swift
import Testing
import SwiftData
@testable import Fancai

struct SwiftDataTests {
    @Test
    func saveAndFetchBook() throws {
        // In-memory container для тестов
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        let container = try ModelContainer(
            for: Book.self,
            configurations: config
        )
        let context = container.mainContext

        // Создаём и сохраняем
        let book = Book(title: "Test Book")
        context.insert(book)
        try context.save()

        // Загружаем
        let descriptor = FetchDescriptor<Book>()
        let books = try context.fetch(descriptor)

        #expect(books.count == 1)
        #expect(books.first?.title == "Test Book")
    }

    @Test
    func deleteBook() throws {
        let container = try createTestContainer()
        let context = container.mainContext

        let book = Book(title: "To Delete")
        context.insert(book)
        try context.save()

        context.delete(book)
        try context.save()

        let books = try context.fetch(FetchDescriptor<Book>())
        #expect(books.isEmpty)
    }

    private func createTestContainer() throws -> ModelContainer {
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        return try ModelContainer(for: Book.self, configurations: config)
    }
}
```

---

## 8. Тестирование Network Layer

### 8.1 URLProtocol Mock

```swift
import Foundation

class MockURLProtocol: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = MockURLProtocol.requestHandler else {
            fatalError("Handler not set")
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
```

### 8.2 Тесты с MockURLProtocol

```swift
import Testing
@testable import Fancai

struct APIClientTests {
    @Test
    func fetchProfile() async throws {
        // Arrange
        let jsonData = """
        {"id": "123", "name": "Test User", "email": "test@example.com"}
        """.data(using: .utf8)!

        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!
            return (response, jsonData)
        }

        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: config)
        let client = APIClient(session: session)

        // Act
        let profile = try await client.fetchProfile()

        // Assert
        #expect(profile.id == "123")
        #expect(profile.name == "Test User")
    }
}
```

---

## 9. Code Coverage

### 9.1 Настройка в Xcode

```
Scheme → Edit Scheme → Test → Options → Code Coverage ✓
```

### 9.2 Целевые показатели

| Модуль | Целевой coverage |
|--------|------------------|
| Models | 90%+ |
| ViewModels | 80%+ |
| Services | 85%+ |
| Utilities | 90%+ |
| Views | 50%+ (через snapshots) |

---

## 10. CI интеграция

### 10.1 Xcode Cloud

```yaml
# ci_scripts/ci_post_clone.sh
#!/bin/sh
# Запуск после клонирования
xcodebuild test \
  -scheme Fancai \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -resultBundlePath TestResults.xcresult
```

### 10.2 GitHub Actions

```yaml
name: Tests
on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4

      - name: Select Xcode
        run: sudo xcode-select -s /Applications/Xcode_16.app

      - name: Run Tests
        run: |
          xcodebuild test \
            -scheme Fancai \
            -destination 'platform=iOS Simulator,name=iPhone 15' \
            -enableCodeCoverage YES

      - name: Upload Results
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: TestResults.xcresult
```

---

## 11. Чеклист тестирования

| Пункт | Статус |
|-------|--------|
| Swift Testing для unit-тестов | ⬜ |
| XCTest для UI-тестов | ⬜ |
| Mock-реализации протоколов | ⬜ |
| Snapshot-тесты для UI | ⬜ |
| In-memory SwiftData container | ⬜ |
| Network mocking | ⬜ |
| CI pipeline с тестами | ⬜ |
| Code coverage > 70% | ⬜ |

---

## Источники

- [Apple — Swift Testing](https://developer.apple.com/documentation/testing)
- [WWDC 2024 — Meet Swift Testing](https://developer.apple.com/videos/play/wwdc2024/10179/)
- [Point-Free — swift-snapshot-testing](https://github.com/pointfreeco/swift-snapshot-testing)
- [Apple — Testing with Xcode](https://developer.apple.com/documentation/xcode/testing-your-apps-in-xcode)
