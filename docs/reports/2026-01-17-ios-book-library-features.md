# Исследование функций библиотеки книг для iOS приложения (2026)

**Дата:** 2026-01-17
**Scope:** iOS приложение fancai - функционал библиотеки книг
**Автор:** Claude Code

## Executive Summary

Исследованы ключевые функции библиотеки книг для iOS приложения: отображение (Grid/List), сортировка и фильтрация в SwiftData, коллекции с Deep Links, серии книг, импорт из различных источников, OPDS каталоги, определение дубликатов, страница книги и лимиты хранения для Freemium модели.

---

## 1. Отображение библиотеки

### Grid View vs List View - переключение

```swift
import SwiftUI

enum LibraryViewMode: String, CaseIterable {
    case grid = "Grid"
    case list = "List"
}

struct LibraryView: View {
    @State private var viewMode: LibraryViewMode = .grid
    @Query(sort: \Book.addedDate, order: .reverse) var books: [Book]

    var body: some View {
        NavigationStack {
            Group {
                switch viewMode {
                case .grid:
                    BookGridView(books: books)
                case .list:
                    BookListView(books: books)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Picker("View Mode", selection: $viewMode) {
                        Image(systemName: "square.grid.2x2")
                            .tag(LibraryViewMode.grid)
                        Image(systemName: "list.bullet")
                            .tag(LibraryViewMode.list)
                    }
                    .pickerStyle(.segmented)
                }
            }
        }
    }
}
```

### LazyVGrid vs List - сравнение

| Характеристика | LazyVGrid | List |
|----------------|-----------|------|
| **Производительность** | Отличная для больших коллекций | Хорошая, но UICollectionView под капотом (iOS 16+) |
| **Гибкость** | Полный контроль над layout | Ограничен встроенными стилями |
| **Swipe Actions** | Нужно реализовывать вручную | Встроенная поддержка |
| **Accessibility** | Требует настройки | Встроенная поддержка |
| **Рекомендация** | Grid view для обложек | List view для детального списка |

**Источники:**
- [SwiftUI Grid, LazyVGrid, LazyHGrid Explained](https://www.avanderlee.com/swiftui/grid-lazyvgrid-lazyhgrid-gridviews/)
- [List or LazyVStack - Choosing the Right Lazy Container](https://fatbobman.com/en/posts/list-or-lazyvstack/)

### BookGridView с LazyVGrid

```swift
struct BookGridView: View {
    let books: [Book]

    // Адаптивные колонки: минимум 100pt, максимум гибко
    let columns = [
        GridItem(.adaptive(minimum: 100, maximum: 150), spacing: 16)
    ]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 20) {
                ForEach(books) { book in
                    NavigationLink(value: book) {
                        BookCoverCell(book: book)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
    }
}

struct BookCoverCell: View {
    let book: Book

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Обложка с соотношением 2:3 (стандарт для книг)
            AsyncImage(url: book.coverURL) { phase in
                switch phase {
                case .empty:
                    Rectangle()
                        .fill(Color.gray.opacity(0.3))
                        .overlay {
                            ProgressView()
                        }
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure:
                    BookPlaceholderCover(title: book.title)
                @unknown default:
                    EmptyView()
                }
            }
            .aspectRatio(2/3, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .shadow(radius: 4)

            // Название книги (2 строки максимум)
            Text(book.title)
                .font(.caption)
                .lineLimit(2)
                .foregroundStyle(.primary)

            // Прогресс чтения
            if book.readingProgress > 0 {
                ProgressView(value: book.readingProgress)
                    .tint(.accentColor)
            }
        }
    }
}

struct BookPlaceholderCover: View {
    let title: String

    var body: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [.blue.opacity(0.6), .purple.opacity(0.6)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(8)
            }
    }
}
```

### Рекомендуемые размеры обложек

| Устройство | Ширина ячейки | Высота ячейки | Колонок |
|------------|---------------|---------------|---------|
| iPhone SE | 100pt | 150pt | 3 |
| iPhone 15 | 110pt | 165pt | 3 |
| iPhone 15 Pro Max | 120pt | 180pt | 3-4 |
| iPad Mini | 130pt | 195pt | 4-5 |
| iPad Pro 12.9" | 150pt | 225pt | 6-8 |

**Соотношение сторон:** 2:3 (стандарт для книжных обложек)

**Источник:** [Fitting images into available space - Apple](https://developer.apple.com/documentation/swiftui/fitting-images-into-available-space)

### Pagination для больших библиотек

```swift
import SwiftData

struct PaginatedLibraryView: View {
    @Environment(\.modelContext) private var modelContext

    @State private var books: [Book] = []
    @State private var isLoading = false
    @State private var hasMoreData = true

    private let pageSize = 20
    @State private var currentPage = 0

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 20) {
                ForEach(books) { book in
                    BookCoverCell(book: book)
                        .onAppear {
                            // Загружаем следующую страницу когда видим последние 5 элементов
                            if book == books.suffix(5).first {
                                loadMoreIfNeeded()
                            }
                        }
                }

                if isLoading {
                    ProgressView()
                        .gridCellColumns(columns.count)
                }
            }
            .padding()
        }
        .task {
            await loadInitialData()
        }
    }

    private func loadInitialData() async {
        await loadPage(0)
    }

    private func loadMoreIfNeeded() {
        guard !isLoading && hasMoreData else { return }
        Task {
            await loadPage(currentPage + 1)
        }
    }

    private func loadPage(_ page: Int) async {
        isLoading = true
        defer { isLoading = false }

        let descriptor = FetchDescriptor<Book>(
            sortBy: [SortDescriptor(\.addedDate, order: .reverse)]
        )
        descriptor.fetchLimit = pageSize
        descriptor.fetchOffset = page * pageSize

        do {
            let newBooks = try modelContext.fetch(descriptor)

            await MainActor.run {
                if page == 0 {
                    books = newBooks
                } else {
                    books.append(contentsOf: newBooks)
                }
                currentPage = page
                hasMoreData = newBooks.count == pageSize
            }
        } catch {
            print("Failed to fetch books: \(error)")
        }
    }
}
```

---

## 2. Сортировка и фильтрация

### Модель данных Book

```swift
import SwiftData
import Foundation

@Model
final class Book {
    var id: UUID
    var title: String
    var author: String
    var series: String?
    var seriesIndex: Double?
    var addedDate: Date
    var lastReadDate: Date?
    var readingProgress: Double // 0.0 - 1.0
    var rating: Int? // 1-5
    var status: ReadingStatus
    var genres: [String]
    var fileHash: String?
    var isbn: String?
    var coverURL: URL?
    var filePath: String
    var fileSize: Int64
    var isOfflineAvailable: Bool

    // Relationships
    @Relationship(deleteRule: .nullify, inverse: \Collection.books)
    var collections: [Collection]?

    init(
        title: String,
        author: String,
        filePath: String,
        fileSize: Int64
    ) {
        self.id = UUID()
        self.title = title
        self.author = author
        self.filePath = filePath
        self.fileSize = fileSize
        self.addedDate = Date()
        self.readingProgress = 0
        self.status = .notStarted
        self.genres = []
        self.isOfflineAvailable = true
    }
}

enum ReadingStatus: String, Codable, CaseIterable {
    case notStarted = "Not Started"
    case reading = "Reading"
    case finished = "Finished"
    case onHold = "On Hold"
    case dropped = "Dropped"
}
```

### Динамическая сортировка

```swift
enum SortOption: String, CaseIterable {
    case addedDateDesc = "Recently Added"
    case addedDateAsc = "Oldest First"
    case titleAsc = "Title A-Z"
    case titleDesc = "Title Z-A"
    case authorAsc = "Author A-Z"
    case authorDesc = "Author Z-A"
    case progressDesc = "Most Progress"
    case progressAsc = "Least Progress"
    case ratingDesc = "Highest Rated"
    case lastReadDesc = "Recently Read"
}

struct SortedLibraryView: View {
    @State private var sortOption: SortOption = .addedDateDesc

    var body: some View {
        BookListContainer(sortOption: sortOption)
            .toolbar {
                Menu {
                    ForEach(SortOption.allCases, id: \.self) { option in
                        Button {
                            sortOption = option
                        } label: {
                            HStack {
                                Text(option.rawValue)
                                if sortOption == option {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
            }
    }
}

struct BookListContainer: View {
    let sortOption: SortOption

    // Динамический Query в init
    @Query var books: [Book]

    init(sortOption: SortOption) {
        self.sortOption = sortOption

        let sortDescriptor: SortDescriptor<Book>
        switch sortOption {
        case .addedDateDesc:
            sortDescriptor = SortDescriptor(\.addedDate, order: .reverse)
        case .addedDateAsc:
            sortDescriptor = SortDescriptor(\.addedDate, order: .forward)
        case .titleAsc:
            sortDescriptor = SortDescriptor(\.title, order: .forward)
        case .titleDesc:
            sortDescriptor = SortDescriptor(\.title, order: .reverse)
        case .authorAsc:
            sortDescriptor = SortDescriptor(\.author, order: .forward)
        case .authorDesc:
            sortDescriptor = SortDescriptor(\.author, order: .reverse)
        case .progressDesc:
            sortDescriptor = SortDescriptor(\.readingProgress, order: .reverse)
        case .progressAsc:
            sortDescriptor = SortDescriptor(\.readingProgress, order: .forward)
        case .ratingDesc:
            sortDescriptor = SortDescriptor(\.rating, order: .reverse)
        case .lastReadDesc:
            sortDescriptor = SortDescriptor(\.lastReadDate, order: .reverse)
        }

        _books = Query(sort: [sortDescriptor])
    }

    var body: some View {
        List(books) { book in
            BookRowView(book: book)
        }
    }
}
```

**Источники:**
- [Filtering and sorting persistent data - Apple](https://developer.apple.com/documentation/swiftdata/filtering-and-sorting-persistent-data)
- [Dynamically sorting and filtering @Query with SwiftUI](https://www.hackingwithswift.com/books/ios-swiftui/dynamically-sorting-and-filtering-query-with-swiftui)

### Фильтрация с Predicate

```swift
struct FilteredLibraryView: View {
    @State private var selectedStatus: ReadingStatus?
    @State private var selectedGenre: String?
    @State private var searchText: String = ""

    var body: some View {
        FilteredBookList(
            status: selectedStatus,
            genre: selectedGenre,
            searchText: searchText
        )
        .searchable(text: $searchText, prompt: "Search by title or author")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                FilterMenu(
                    selectedStatus: $selectedStatus,
                    selectedGenre: $selectedGenre
                )
            }
        }
    }
}

struct FilteredBookList: View {
    let status: ReadingStatus?
    let genre: String?
    let searchText: String

    @Query var books: [Book]

    init(status: ReadingStatus?, genre: String?, searchText: String) {
        self.status = status
        self.genre = genre
        self.searchText = searchText

        // Построение предиката
        let predicate = Book.buildPredicate(
            status: status,
            genre: genre,
            searchText: searchText
        )

        _books = Query(
            filter: predicate,
            sort: [SortDescriptor(\.addedDate, order: .reverse)]
        )
    }

    var body: some View {
        List(books) { book in
            BookRowView(book: book)
        }
        .overlay {
            if books.isEmpty {
                ContentUnavailableView.search(text: searchText)
            }
        }
    }
}

// Extension для Book с предикатами
extension Book {
    static func buildPredicate(
        status: ReadingStatus?,
        genre: String?,
        searchText: String
    ) -> Predicate<Book>? {

        // Базовый предикат для поиска
        let searchPredicate: Predicate<Book>? = searchText.isEmpty ? nil : #Predicate<Book> { book in
            book.title.localizedStandardContains(searchText) ||
            book.author.localizedStandardContains(searchText)
        }

        // Предикат для статуса
        let statusPredicate: Predicate<Book>?
        if let status = status {
            let statusRaw = status.rawValue
            statusPredicate = #Predicate<Book> { book in
                book.status.rawValue == statusRaw
            }
        } else {
            statusPredicate = nil
        }

        // Предикат для жанра
        let genrePredicate: Predicate<Book>?
        if let genre = genre {
            genrePredicate = #Predicate<Book> { book in
                book.genres.contains(genre)
            }
        } else {
            genrePredicate = nil
        }

        // Комбинирование предикатов
        // Примечание: SwiftData не поддерживает динамическое объединение,
        // поэтому нужно обрабатывать все комбинации
        switch (searchPredicate, statusPredicate, genrePredicate) {
        case (nil, nil, nil):
            return nil
        case (let s?, nil, nil):
            return s
        case (nil, let st?, nil):
            return st
        case (nil, nil, let g?):
            return g
        case (let s?, let st?, nil):
            return #Predicate<Book> { book in
                (book.title.localizedStandardContains(searchText) ||
                 book.author.localizedStandardContains(searchText)) &&
                book.status.rawValue == status!.rawValue
            }
        // ... другие комбинации
        default:
            return #Predicate<Book> { book in
                (searchText.isEmpty ||
                 book.title.localizedStandardContains(searchText) ||
                 book.author.localizedStandardContains(searchText))
            }
        }
    }
}
```

**Важно:** `localizedStandardContains()` - лучший выбор для пользовательского поиска (case-insensitive).

---

## 3. Коллекции и полки

### Модель Collection

```swift
@Model
final class Collection {
    var id: UUID
    var name: String
    var emoji: String?
    var createdDate: Date
    var isPublic: Bool
    var shareSlug: String?
    var sortOrder: Int

    @Relationship
    var books: [Book]

    init(name: String, emoji: String? = nil) {
        self.id = UUID()
        self.name = name
        self.emoji = emoji
        self.createdDate = Date()
        self.isPublic = false
        self.sortOrder = 0
        self.books = []
    }

    // Генерация уникального slug для публичной ссылки
    func generateShareSlug() {
        // Формат: name-slug + 6 случайных символов
        let nameSlug = name
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .filter { $0.isLetter || $0.isNumber || $0 == "-" }
            .prefix(20)

        let randomSuffix = String((0..<6).map { _ in
            "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()!
        })

        self.shareSlug = "\(nameSlug)-\(randomSuffix)"
    }
}
```

### CRUD для коллекций

```swift
@Observable
final class CollectionManager {
    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    // CREATE
    func createCollection(name: String, emoji: String?) -> Collection {
        let collection = Collection(name: name, emoji: emoji)

        // Установить порядок сортировки
        let descriptor = FetchDescriptor<Collection>(
            sortBy: [SortDescriptor(\.sortOrder, order: .reverse)]
        )
        descriptor.fetchLimit = 1

        if let lastCollection = try? modelContext.fetch(descriptor).first {
            collection.sortOrder = lastCollection.sortOrder + 1
        }

        modelContext.insert(collection)
        return collection
    }

    // READ
    func fetchCollections() -> [Collection] {
        let descriptor = FetchDescriptor<Collection>(
            sortBy: [SortDescriptor(\.sortOrder)]
        )
        return (try? modelContext.fetch(descriptor)) ?? []
    }

    func fetchCollection(bySlug slug: String) -> Collection? {
        let descriptor = FetchDescriptor<Collection>(
            predicate: #Predicate { $0.shareSlug == slug }
        )
        return try? modelContext.fetch(descriptor).first
    }

    // UPDATE
    func updateCollection(_ collection: Collection, name: String?, emoji: String?) {
        if let name = name {
            collection.name = name
        }
        if let emoji = emoji {
            collection.emoji = emoji
        }
    }

    func addBook(_ book: Book, to collection: Collection) {
        if collection.books.contains(where: { $0.id == book.id }) == false {
            collection.books.append(book)
        }
    }

    func removeBook(_ book: Book, from collection: Collection) {
        collection.books.removeAll { $0.id == book.id }
    }

    func makePublic(_ collection: Collection) {
        collection.isPublic = true
        collection.generateShareSlug()
    }

    func makePrivate(_ collection: Collection) {
        collection.isPublic = false
        collection.shareSlug = nil
    }

    // DELETE
    func deleteCollection(_ collection: Collection) {
        modelContext.delete(collection)
    }
}
```

### Публичные коллекции с Universal Links

**Источники:**
- [Universal Links implementation on iOS - SwiftLee](https://www.avanderlee.com/swiftui/universal-links-ios/)
- [A Complete Guide to Configuring Deep Links & Universal Links in iOS](https://medium.com/@kumarsuraj19111997/a-complete-guide-to-configuring-deep-links-universal-links-in-ios-swiftui-backend-22d08ac67307)

```swift
// 1. Настройка Associated Domains в Xcode:
// Signing & Capabilities -> Associated Domains
// applinks:fancai.ru

// 2. Apple App Site Association (AASA) файл на сервере
// https://fancai.ru/.well-known/apple-app-site-association
/*
{
    "applinks": {
        "apps": [],
        "details": [{
            "appID": "TEAM_ID.ru.fancai.app",
            "paths": ["/collection/*", "/book/*"]
        }]
    }
}
*/

// 3. Обработка в приложении
@main
struct FancaiApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
        .modelContainer(for: [Book.self, Collection.self])
    }

    private func handleDeepLink(_ url: URL) {
        // URL: https://fancai.ru/collection/my-favorites-abc123
        guard let host = url.host,
              host == "fancai.ru" else { return }

        let pathComponents = url.pathComponents

        if pathComponents.count >= 3 && pathComponents[1] == "collection" {
            let slug = pathComponents[2]
            // Навигация к коллекции
            NavigationRouter.shared.navigateToCollection(slug: slug)
        }
    }
}

// Router для навигации
@Observable
final class NavigationRouter {
    static let shared = NavigationRouter()

    var collectionSlug: String?
    var bookId: UUID?

    func navigateToCollection(slug: String) {
        collectionSlug = slug
    }
}
```

### Генерация ссылки для шеринга

```swift
struct ShareCollectionView: View {
    let collection: Collection
    @Environment(\.modelContext) private var modelContext
    @State private var showShareSheet = false

    var shareURL: URL? {
        guard let slug = collection.shareSlug else { return nil }
        return URL(string: "https://fancai.ru/collection/\(slug)")
    }

    var body: some View {
        VStack {
            if collection.isPublic, let url = shareURL {
                HStack {
                    Text(url.absoluteString)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Button {
                        UIPasteboard.general.string = url.absoluteString
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }

                    Button {
                        showShareSheet = true
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            } else {
                Button("Make Public") {
                    let manager = CollectionManager(modelContext: modelContext)
                    manager.makePublic(collection)
                }
            }
        }
        .sheet(isPresented: $showShareSheet) {
            if let url = shareURL {
                ShareSheet(items: [url])
            }
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
```

---

## 4. Серии книг

### Автоматическая группировка

```swift
@Model
final class BookSeries {
    var id: UUID
    var name: String
    var author: String?
    var totalBooks: Int?
    var externalId: String? // OpenLibrary/Goodreads ID

    @Relationship(deleteRule: .nullify)
    var books: [Book]

    init(name: String, author: String? = nil) {
        self.id = UUID()
        self.name = name
        self.author = author
        self.books = []
    }
}

// Extension для парсинга серии из EPUB метаданных
extension Book {
    // Calibre использует следующие метаданные:
    // - calibre:series
    // - calibre:series_index

    static func parseSeriesFromEPUB(metadata: EPUBMetadata) -> (name: String, index: Double)? {
        // Проверяем Calibre метаданные
        if let series = metadata.customMetadata["calibre:series"],
           let indexStr = metadata.customMetadata["calibre:series_index"],
           let index = Double(indexStr) {
            return (series, index)
        }

        // Проверяем EPUB 3 метаданные
        if let series = metadata.belongsToSeries {
            return (series.name, series.position ?? 1.0)
        }

        return nil
    }
}
```

**Источник:** [Parsing EPUB Metadata - Readium Architecture](https://readium.org/architecture/streamer/parser/metadata.html)

### Отображение серий

```swift
struct SeriesListView: View {
    @Query(sort: \BookSeries.name) var series: [BookSeries]

    var body: some View {
        List(series) { series in
            NavigationLink(value: series) {
                SeriesRowView(series: series)
            }
        }
        .navigationTitle("Series")
    }
}

struct SeriesRowView: View {
    let series: BookSeries

    var body: some View {
        HStack(spacing: 12) {
            // Стопка обложек (до 3)
            ZStack {
                ForEach(Array(series.books.prefix(3).enumerated()), id: \.element.id) { index, book in
                    AsyncImage(url: book.coverURL) { image in
                        image.resizable()
                    } placeholder: {
                        Rectangle().fill(.gray.opacity(0.3))
                    }
                    .frame(width: 40, height: 60)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .offset(x: CGFloat(index * 8))
                }
            }
            .frame(width: 60)

            VStack(alignment: .leading) {
                Text(series.name)
                    .font(.headline)

                if let author = series.author {
                    Text(author)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Text("\(series.books.count) books")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

struct SeriesDetailView: View {
    let series: BookSeries

    var sortedBooks: [Book] {
        series.books.sorted { ($0.seriesIndex ?? 0) < ($1.seriesIndex ?? 0) }
    }

    var body: some View {
        List {
            ForEach(Array(sortedBooks.enumerated()), id: \.element.id) { index, book in
                HStack {
                    // Номер в серии
                    Text("#\(Int(book.seriesIndex ?? Double(index + 1)))")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                        .frame(width: 40)

                    BookRowView(book: book)
                }
            }
        }
        .navigationTitle(series.name)
    }
}
```

### Поиск информации о сериях (API)

**Источники:**
- [Open Library Books API](https://openlibrary.org/dev/docs/api/books)
- [Google Books APIs](https://developers.google.com/books)

```swift
struct SeriesSearchService {

    // Open Library API
    func searchSeriesInOpenLibrary(bookTitle: String, author: String) async throws -> SeriesInfo? {
        let query = "\(bookTitle) \(author)".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let url = URL(string: "https://openlibrary.org/search.json?q=\(query)&fields=key,title,author_name,series")!

        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(OpenLibrarySearchResponse.self, from: data)

        // Ищем книгу с информацией о серии
        for doc in response.docs {
            if let seriesNames = doc.series, !seriesNames.isEmpty {
                return SeriesInfo(
                    name: seriesNames[0],
                    source: "OpenLibrary",
                    externalId: doc.key
                )
            }
        }

        return nil
    }

    // Google Books API
    func searchSeriesInGoogleBooks(isbn: String) async throws -> SeriesInfo? {
        let url = URL(string: "https://www.googleapis.com/books/v1/volumes?q=isbn:\(isbn)")!

        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(GoogleBooksResponse.self, from: data)

        if let volumeInfo = response.items?.first?.volumeInfo,
           let seriesInfo = volumeInfo.seriesInfo {
            return SeriesInfo(
                name: seriesInfo.shortSeriesBookTitle ?? "",
                source: "GoogleBooks",
                externalId: nil
            )
        }

        return nil
    }
}

struct SeriesInfo {
    let name: String
    let source: String
    let externalId: String?
}

// Response models
struct OpenLibrarySearchResponse: Codable {
    let docs: [OpenLibraryDoc]
}

struct OpenLibraryDoc: Codable {
    let key: String
    let title: String
    let authorName: [String]?
    let series: [String]?

    enum CodingKeys: String, CodingKey {
        case key, title, series
        case authorName = "author_name"
    }
}

struct GoogleBooksResponse: Codable {
    let items: [GoogleBooksItem]?
}

struct GoogleBooksItem: Codable {
    let volumeInfo: GoogleBooksVolumeInfo
}

struct GoogleBooksVolumeInfo: Codable {
    let title: String
    let seriesInfo: GoogleBooksSeriesInfo?
}

struct GoogleBooksSeriesInfo: Codable {
    let shortSeriesBookTitle: String?
}
```

---

## 5. Импорт книг

### UIDocumentPickerViewController (Files.app)

**Источники:**
- [UIDocumentPickerViewController - Apple](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller)
- [SwiftUI Import/Export files](https://rizwan.dev/blog/swiftui-import-export-files/)

```swift
import SwiftUI
import UniformTypeIdentifiers

struct BookImportButton: View {
    @State private var showFilePicker = false
    @State private var isImporting = false
    @State private var importError: ImportError?

    let onImport: (URL) async throws -> Void

    var body: some View {
        Button {
            showFilePicker = true
        } label: {
            Label("Import Book", systemImage: "plus")
        }
        .disabled(isImporting)
        .fileImporter(
            isPresented: $showFilePicker,
            allowedContentTypes: [.epub, .fb2Type], // Кастомный UTType для FB2
            allowsMultipleSelection: false // Ограничение: 1 книга
        ) { result in
            Task {
                await handleImport(result)
            }
        }
        .alert("Import Error", isPresented: .constant(importError != nil)) {
            Button("OK") { importError = nil }
        } message: {
            if let error = importError {
                Text(error.localizedDescription)
            }
        }
    }

    private func handleImport(_ result: Result<[URL], Error>) async {
        isImporting = true
        defer { isImporting = false }

        do {
            let urls = try result.get()
            guard let url = urls.first else { return }

            // Security-scoped resource access
            guard url.startAccessingSecurityScopedResource() else {
                throw ImportError.accessDenied
            }
            defer { url.stopAccessingSecurityScopedResource() }

            try await onImport(url)
        } catch {
            importError = ImportError.importFailed(error)
        }
    }
}

// Кастомный UTType для FB2
extension UTType {
    static let fb2Type = UTType(filenameExtension: "fb2") ?? .data
    static let fb2Zip = UTType(filenameExtension: "fb2.zip") ?? .data
}

enum ImportError: LocalizedError {
    case accessDenied
    case importFailed(Error)
    case duplicateBook
    case storageLimitReached

    var errorDescription: String? {
        switch self {
        case .accessDenied:
            return "Could not access the file. Please try again."
        case .importFailed(let error):
            return "Import failed: \(error.localizedDescription)"
        case .duplicateBook:
            return "This book is already in your library."
        case .storageLimitReached:
            return "Storage limit reached. Upgrade to Pro for unlimited books."
        }
    }
}
```

### Share Extension

**Источник:** [iOS Share Extension with SwiftUI and SwiftData](https://www.merrell.dev/ios-share-extension-with-swiftui-and-swiftdata/)

```swift
// ShareExtension/ShareViewController.swift
import UIKit
import SwiftUI
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()

        // Получаем shared items
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = extensionItem.attachments else {
            close()
            return
        }

        // Ищем EPUB файл
        for attachment in attachments {
            if attachment.hasItemConformingToTypeIdentifier(UTType.epub.identifier) {
                attachment.loadItem(forTypeIdentifier: UTType.epub.identifier) { [weak self] item, error in
                    guard let url = item as? URL else {
                        self?.close()
                        return
                    }

                    DispatchQueue.main.async {
                        self?.handleImport(url)
                    }
                }
                return
            }
        }

        close()
    }

    private func handleImport(_ url: URL) {
        // Копируем файл в App Group container
        let appGroupURL = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: "group.ru.fancai.app")!
            .appendingPathComponent("SharedBooks")

        try? FileManager.default.createDirectory(at: appGroupURL, withIntermediateDirectories: true)

        let destinationURL = appGroupURL.appendingPathComponent(url.lastPathComponent)

        do {
            // Удаляем существующий файл если есть
            try? FileManager.default.removeItem(at: destinationURL)
            try FileManager.default.copyItem(at: url, to: destinationURL)

            // Уведомляем главное приложение
            let userDefaults = UserDefaults(suiteName: "group.ru.fancai.app")
            userDefaults?.set(destinationURL.path, forKey: "pendingBookImport")

            // Показываем UI
            let hostingController = UIHostingController(
                rootView: ShareExtensionView(
                    fileName: url.lastPathComponent,
                    onComplete: { [weak self] in
                        self?.close()
                    }
                )
            )

            addChild(hostingController)
            view.addSubview(hostingController.view)
            hostingController.view.frame = view.bounds
            hostingController.didMove(toParent: self)

        } catch {
            close()
        }
    }

    private func close() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}

struct ShareExtensionView: View {
    let fileName: String
    let onComplete: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 60))
                .foregroundStyle(.green)

            Text("Book Added!")
                .font(.title2)
                .fontWeight(.semibold)

            Text(fileName)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text("Open Fancai to view your book.")
                .font(.caption)
                .foregroundStyle(.tertiary)

            Button("Done", action: onComplete)
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
```

### Drag & Drop на iPad

**Источник:** [Drag and Drop in SwiftUI - From draggable, SwiftData to UTType](https://yannicj.medium.com/drag-and-drop-in-swiftui-from-draggable-swiftdata-to-uttype-a3306752f08d)

```swift
import SwiftUI
import UniformTypeIdentifiers

struct LibraryDropZone: View {
    @Environment(\.modelContext) private var modelContext
    @State private var isTargeted = false

    let bookImporter: BookImporter

    var body: some View {
        ContentView()
            .dropDestination(for: URL.self) { urls, location in
                guard let url = urls.first else { return false }

                // Проверяем тип файла
                guard url.pathExtension.lowercased() == "epub" ||
                      url.pathExtension.lowercased() == "fb2" else {
                    return false
                }

                Task {
                    try await bookImporter.importBook(from: url)
                }

                return true
            } isTargeted: { isTargeted in
                self.isTargeted = isTargeted
            }
            .overlay {
                if isTargeted {
                    DropTargetOverlay()
                }
            }
    }
}

struct DropTargetOverlay: View {
    var body: some View {
        ZStack {
            Color.accentColor.opacity(0.2)

            VStack(spacing: 12) {
                Image(systemName: "arrow.down.doc")
                    .font(.system(size: 40))

                Text("Drop to import")
                    .font(.headline)
            }
            .foregroundStyle(.accentColor)
        }
        .ignoresSafeArea()
    }
}

// Альтернативный подход с onDrop для более гибкого контроля
struct AdvancedDropZone: View {
    @State private var isTargeted = false

    var body: some View {
        ContentView()
            .onDrop(of: [.epub, .fileURL], isTargeted: $isTargeted) { providers in
                guard let provider = providers.first else { return false }

                // Загружаем URL файла
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier) { item, error in
                    guard let data = item as? Data,
                          let url = URL(dataRepresentation: data, relativeTo: nil) else {
                        return
                    }

                    Task { @MainActor in
                        // Обработка импорта
                        await handleDrop(url)
                    }
                }

                return true
            }
    }

    private func handleDrop(_ url: URL) async {
        // Импорт книги
    }
}
```

### Облачные хранилища SDK

**Источники:**
- [SwiftyDropbox - Official Dropbox SDK](https://github.com/dropbox/SwiftyDropbox)
- [FileProvider - FileManager replacement](https://github.com/amosavian/FileProvider)
- [Filestack iOS SDK](https://www.filestack.com/docs/api/sdk/ios/)

| Хранилище | SDK | Примечания |
|-----------|-----|------------|
| **iCloud Drive** | Встроенный `UIDocumentPickerViewController` | Работает "из коробки" |
| **Dropbox** | [SwiftyDropbox](https://github.com/dropbox/SwiftyDropbox) | Официальный SDK |
| **Google Drive** | [GoogleAPIClientForREST](https://github.com/google/google-api-objectivec-client-for-rest) | Требует OAuth |
| **OneDrive** | [MSAL](https://github.com/AzureAD/microsoft-authentication-library-for-objc) | Microsoft Auth Library |
| **Универсальный** | [FileProvider](https://github.com/amosavian/FileProvider) | Абстракция для всех |

```swift
// Рекомендация: использовать UIDocumentPickerViewController
// Он автоматически показывает все подключенные облачные хранилища

struct CloudStorageImportView: View {
    @State private var showPicker = false

    var body: some View {
        Button("Import from Cloud") {
            showPicker = true
        }
        .sheet(isPresented: $showPicker) {
            DocumentPickerView(
                contentTypes: [.epub],
                allowsMultipleSelection: false
            ) { urls in
                if let url = urls.first {
                    handleImport(url)
                }
            }
        }
    }
}

struct DocumentPickerView: UIViewControllerRepresentable {
    let contentTypes: [UTType]
    let allowsMultipleSelection: Bool
    let onPick: ([URL]) -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: contentTypes)
        picker.allowsMultipleSelection = allowsMultipleSelection
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onPick: onPick)
    }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: ([URL]) -> Void

        init(onPick: @escaping ([URL]) -> Void) {
            self.onPick = onPick
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            onPick(urls)
        }
    }
}
```

### Ограничение: только 1 книга за раз

```swift
@Observable
final class BookImporter {
    private let modelContext: ModelContext
    private var isImporting = false

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    func importBook(from url: URL) async throws {
        // Проверка: не импортируем если уже идёт импорт
        guard !isImporting else {
            throw ImportError.importInProgress
        }

        isImporting = true
        defer { isImporting = false }

        // Проверка лимита хранения
        let storageManager = StorageManager(modelContext: modelContext)
        guard storageManager.canAddBook() else {
            throw ImportError.storageLimitReached
        }

        // Проверка на дубликат
        let duplicateChecker = DuplicateChecker(modelContext: modelContext)
        if try await duplicateChecker.isDuplicate(url) {
            throw ImportError.duplicateBook
        }

        // Парсинг метаданных
        let metadata = try await parseMetadata(from: url)

        // Копирование файла в Documents
        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let booksFolder = documentsURL.appendingPathComponent("Books", isDirectory: true)
        try FileManager.default.createDirectory(at: booksFolder, withIntermediateDirectories: true)

        let destinationURL = booksFolder.appendingPathComponent("\(UUID().uuidString).\(url.pathExtension)")
        try FileManager.default.copyItem(at: url, to: destinationURL)

        // Создание записи в базе
        let book = Book(
            title: metadata.title,
            author: metadata.author,
            filePath: destinationURL.path,
            fileSize: try FileManager.default.attributesOfItem(atPath: destinationURL.path)[.size] as? Int64 ?? 0
        )

        book.isbn = metadata.isbn
        book.series = metadata.series?.name
        book.seriesIndex = metadata.series?.index

        modelContext.insert(book)
    }
}

enum ImportError: LocalizedError {
    case importInProgress
    case storageLimitReached
    case duplicateBook
    // ...

    var errorDescription: String? {
        switch self {
        case .importInProgress:
            return "Please wait for the current import to complete."
        // ...
        }
    }
}
```

---

## 6. OPDS каталоги

### Что такое OPDS

**OPDS (Open Publication Distribution System)** - формат синдикации для электронных публикаций, основанный на Atom и HTTP.

**Источники:**
- [OPDS Catalog 1.2 Specification](https://specs.opds.io/opds-1.2.html)
- [OPDS - MobileRead Wiki](https://wiki.mobileread.com/wiki/OPDS)

Ключевые особенности:
- Основан на Atom Syndication Format (RFC4287)
- Два типа документов: Feed Documents и Entry Documents
- Поддержка поиска через OpenSearch
- Типы ссылок: navigation feeds, acquisition feeds

### Популярные OPDS каталоги

| Каталог | URL | Описание |
|---------|-----|----------|
| Flibusta | `http://flibusta.is/opds` | Крупнейшая русскоязычная библиотека |
| Project Gutenberg | `https://www.gutenberg.org/ebooks.opds/` | Бесплатные классические книги |
| Calibre Server | `http://localhost:8080/opds` | Локальный сервер |
| Standard Ebooks | `https://standardebooks.org/opds` | Качественно отформатированные книги |

### Парсинг OPDS feed

**Источник:** [Readium Swift Toolkit - ReadiumOPDS](https://github.com/readium/swift-toolkit)

```swift
import Foundation

// OPDS Feed Parser
struct OPDSFeedParser {

    func parseFeed(from url: URL) async throws -> OPDSFeed {
        let (data, _) = try await URLSession.shared.data(from: url)
        return try parseFeed(from: data)
    }

    func parseFeed(from data: Data) throws -> OPDSFeed {
        let xml = try XMLDocument(data: data)
        let root = xml.rootElement()

        guard root?.name == "feed" else {
            throw OPDSError.invalidFormat
        }

        var feed = OPDSFeed()

        // Parse feed metadata
        feed.title = root?.elements(forName: "title").first?.stringValue ?? ""
        feed.id = root?.elements(forName: "id").first?.stringValue ?? ""
        feed.updated = root?.elements(forName: "updated").first?.stringValue ?? ""

        // Parse links
        feed.links = parseLinks(root?.elements(forName: "link") ?? [])

        // Parse entries
        feed.entries = try parseEntries(root?.elements(forName: "entry") ?? [])

        return feed
    }

    private func parseLinks(_ elements: [XMLElement]) -> [OPDSLink] {
        elements.compactMap { element in
            guard let href = element.attribute(forName: "href")?.stringValue else {
                return nil
            }

            return OPDSLink(
                href: href,
                rel: element.attribute(forName: "rel")?.stringValue,
                type: element.attribute(forName: "type")?.stringValue,
                title: element.attribute(forName: "title")?.stringValue
            )
        }
    }

    private func parseEntries(_ elements: [XMLElement]) throws -> [OPDSEntry] {
        try elements.map { element in
            var entry = OPDSEntry()

            entry.id = element.elements(forName: "id").first?.stringValue ?? ""
            entry.title = element.elements(forName: "title").first?.stringValue ?? ""
            entry.updated = element.elements(forName: "updated").first?.stringValue

            // Author
            if let authorElement = element.elements(forName: "author").first {
                entry.author = authorElement.elements(forName: "name").first?.stringValue
            }

            // Summary
            entry.summary = element.elements(forName: "summary").first?.stringValue

            // Content
            entry.content = element.elements(forName: "content").first?.stringValue

            // Links (cover, acquisition)
            entry.links = parseLinks(element.elements(forName: "link"))

            // Dublin Core metadata
            let dcPrefix = "dc"
            entry.language = element.elements(forLocalName: "language", uri: "http://purl.org/dc/terms/").first?.stringValue
            entry.publisher = element.elements(forLocalName: "publisher", uri: "http://purl.org/dc/terms/").first?.stringValue

            // Categories/Genres
            entry.categories = element.elements(forName: "category").compactMap {
                $0.attribute(forName: "label")?.stringValue ?? $0.attribute(forName: "term")?.stringValue
            }

            return entry
        }
    }
}

// OPDS Models
struct OPDSFeed {
    var id: String = ""
    var title: String = ""
    var updated: String = ""
    var links: [OPDSLink] = []
    var entries: [OPDSEntry] = []

    var navigationLinks: [OPDSLink] {
        links.filter { $0.isNavigation }
    }

    var searchLink: OPDSLink? {
        links.first { $0.rel == "search" }
    }
}

struct OPDSEntry: Identifiable {
    var id: String = ""
    var title: String = ""
    var author: String?
    var summary: String?
    var content: String?
    var updated: String?
    var language: String?
    var publisher: String?
    var categories: [String] = []
    var links: [OPDSLink] = []

    var coverLink: OPDSLink? {
        links.first { $0.rel?.contains("image") == true || $0.rel?.contains("thumbnail") == true }
    }

    var acquisitionLinks: [OPDSLink] {
        links.filter { $0.rel?.contains("acquisition") == true || $0.type?.contains("epub") == true }
    }
}

struct OPDSLink {
    let href: String
    let rel: String?
    let type: String?
    let title: String?

    var isNavigation: Bool {
        type?.contains("type=feed") == true || rel == "subsection"
    }

    var isAcquisition: Bool {
        rel?.contains("acquisition") == true
    }
}

enum OPDSError: Error {
    case invalidFormat
    case networkError(Error)
    case parseError(Error)
}
```

### Использование Readium OPDS Parser

```swift
// Package.swift
// dependencies: [
//     .package(url: "https://github.com/readium/swift-toolkit.git", from: "3.0.0")
// ]

import ReadiumOPDS

class OPDSCatalogService {
    private let parser = OPDSParser()

    func loadCatalog(from url: URL) async throws -> ParseData {
        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw OPDSError.networkError(NSError(domain: "HTTP", code: -1))
        }

        return try parser.parse(data: data, url: url)
    }

    func searchCatalog(_ searchURL: URL, query: String) async throws -> ParseData {
        var components = URLComponents(url: searchURL, resolvingAgainstBaseURL: true)
        components?.queryItems = [URLQueryItem(name: "q", value: query)]

        guard let url = components?.url else {
            throw OPDSError.invalidFormat
        }

        return try await loadCatalog(from: url)
    }
}
```

### UI для OPDS каталогов

```swift
struct OPDSCatalogView: View {
    let catalogURL: URL

    @State private var feed: OPDSFeed?
    @State private var isLoading = false
    @State private var searchText = ""

    var body: some View {
        Group {
            if let feed = feed {
                List {
                    // Navigation links
                    if !feed.navigationLinks.isEmpty {
                        Section("Categories") {
                            ForEach(feed.navigationLinks, id: \.href) { link in
                                NavigationLink(value: link) {
                                    Text(link.title ?? "Untitled")
                                }
                            }
                        }
                    }

                    // Book entries
                    Section("Books") {
                        ForEach(feed.entries) { entry in
                            OPDSEntryRow(entry: entry)
                        }
                    }
                }
                .searchable(text: $searchText)
                .onSubmit(of: .search) {
                    Task { await performSearch() }
                }
            } else if isLoading {
                ProgressView()
            }
        }
        .task {
            await loadFeed()
        }
    }

    private func loadFeed() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let parser = OPDSFeedParser()
            feed = try await parser.parseFeed(from: catalogURL)
        } catch {
            print("Failed to load OPDS feed: \(error)")
        }
    }

    private func performSearch() async {
        guard let searchLink = feed?.searchLink,
              let searchURL = URL(string: searchLink.href) else { return }

        // Выполнить поиск
    }
}

struct OPDSEntryRow: View {
    let entry: OPDSEntry

    var body: some View {
        HStack(spacing: 12) {
            // Cover image
            if let coverLink = entry.coverLink,
               let coverURL = URL(string: coverLink.href) {
                AsyncImage(url: coverURL) { image in
                    image.resizable()
                } placeholder: {
                    Rectangle().fill(.gray.opacity(0.3))
                }
                .frame(width: 60, height: 90)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(entry.title)
                    .font(.headline)
                    .lineLimit(2)

                if let author = entry.author {
                    Text(author)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if !entry.categories.isEmpty {
                    Text(entry.categories.joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            // Download button
            if !entry.acquisitionLinks.isEmpty {
                Button {
                    // Download book
                } label: {
                    Image(systemName: "arrow.down.circle")
                }
            }
        }
    }
}
```

---

## 7. Определение дубликатов

### Алгоритм сравнения

**Источники:**
- [Find Duplicates Plugin - Calibre](https://deepwiki.com/kiwidude68/calibre_plugins/6.2-find-duplicates-plugin)
- [Zotero Duplicate Detection](https://www.zotero.org/support/duplicate_detection)

```swift
@Observable
final class DuplicateChecker {
    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    /// Проверяет, является ли книга дубликатом
    func isDuplicate(_ url: URL) async throws -> Bool {
        // 1. Проверка по хешу файла (самый надёжный метод)
        let fileHash = try await calculateFileHash(url)
        if try await existsBookWithHash(fileHash) {
            return true
        }

        // 2. Парсим метаданные
        let metadata = try await parseMetadata(from: url)

        // 3. Проверка по ISBN (если есть)
        if let isbn = metadata.isbn {
            if try await existsBookWithISBN(isbn) {
                return true
            }
        }

        // 4. Проверка по title + author (fuzzy matching)
        if try await existsSimilarBook(title: metadata.title, author: metadata.author) {
            return true
        }

        return false
    }

    /// Находит потенциальные дубликаты для книги
    func findDuplicates(for book: Book) async throws -> [Book] {
        var duplicates: [Book] = []

        // По хешу
        if let hash = book.fileHash {
            let hashDuplicates = try await fetchBooksWithHash(hash, excluding: book.id)
            duplicates.append(contentsOf: hashDuplicates)
        }

        // По ISBN
        if let isbn = book.isbn {
            let isbnDuplicates = try await fetchBooksWithISBN(isbn, excluding: book.id)
            duplicates.append(contentsOf: isbnDuplicates)
        }

        // По названию и автору (fuzzy)
        let titleAuthorDuplicates = try await fetchSimilarBooks(
            title: book.title,
            author: book.author,
            excluding: book.id
        )
        duplicates.append(contentsOf: titleAuthorDuplicates)

        // Убираем дубликаты из результата
        return Array(Set(duplicates))
    }

    // MARK: - Private Methods

    private func calculateFileHash(_ url: URL) async throws -> String {
        let data = try Data(contentsOf: url)
        let hash = SHA256.hash(data: data)
        return hash.compactMap { String(format: "%02x", $0) }.joined()
    }

    private func existsBookWithHash(_ hash: String) async throws -> Bool {
        let descriptor = FetchDescriptor<Book>(
            predicate: #Predicate { $0.fileHash == hash }
        )
        descriptor.fetchLimit = 1
        let results = try modelContext.fetch(descriptor)
        return !results.isEmpty
    }

    private func existsBookWithISBN(_ isbn: String) async throws -> Bool {
        let normalizedISBN = normalizeISBN(isbn)
        let descriptor = FetchDescriptor<Book>(
            predicate: #Predicate { $0.isbn == normalizedISBN }
        )
        descriptor.fetchLimit = 1
        let results = try modelContext.fetch(descriptor)
        return !results.isEmpty
    }

    private func existsSimilarBook(title: String, author: String) async throws -> Bool {
        // Нормализуем для сравнения
        let normalizedTitle = normalizeString(title)
        let normalizedAuthor = normalizeString(author)

        // Получаем все книги (для fuzzy matching нужен полный список)
        let descriptor = FetchDescriptor<Book>()
        let allBooks = try modelContext.fetch(descriptor)

        for book in allBooks {
            let bookTitle = normalizeString(book.title)
            let bookAuthor = normalizeString(book.author)

            // Проверяем схожесть (Levenshtein distance или простое сравнение)
            if titleSimilarity(normalizedTitle, bookTitle) > 0.85 &&
               authorSimilarity(normalizedAuthor, bookAuthor) > 0.85 {
                return true
            }
        }

        return false
    }

    private func normalizeString(_ string: String) -> String {
        string
            .lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)
    }

    private func normalizeISBN(_ isbn: String) -> String {
        isbn.replacingOccurrences(of: "[^0-9X]", with: "", options: .regularExpression)
    }

    private func titleSimilarity(_ a: String, _ b: String) -> Double {
        // Простое сравнение на основе общих слов
        let wordsA = Set(a.split(separator: " ").map(String.init))
        let wordsB = Set(b.split(separator: " ").map(String.init))

        let intersection = wordsA.intersection(wordsB)
        let union = wordsA.union(wordsB)

        return union.isEmpty ? 0 : Double(intersection.count) / Double(union.count)
    }

    private func authorSimilarity(_ a: String, _ b: String) -> Double {
        // Для авторов проверяем фамилию
        let lastNameA = a.split(separator: " ").last.map(String.init) ?? a
        let lastNameB = b.split(separator: " ").last.map(String.init) ?? b

        return lastNameA == lastNameB ? 1.0 : 0.0
    }
}

import CryptoKit

extension SHA256 {
    static func hash(data: Data) -> SHA256.Digest {
        SHA256.hash(data: data)
    }
}
```

### UI для предупреждения о дубликатах

```swift
struct DuplicateWarningView: View {
    let newBook: BookMetadata
    let existingBooks: [Book]
    let onImportAnyway: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 50))
                .foregroundStyle(.orange)

            Text("Possible Duplicate")
                .font(.title2)
                .fontWeight(.semibold)

            Text("This book may already be in your library:")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            // Показываем существующие похожие книги
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(existingBooks) { book in
                        ExistingBookRow(book: book)
                    }
                }
            }
            .frame(maxHeight: 200)

            Divider()

            // Новая книга
            VStack(alignment: .leading, spacing: 4) {
                Text("New book:")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(newBook.title)
                    .font(.headline)

                Text(newBook.author)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(Color.accentColor.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            HStack(spacing: 16) {
                Button("Cancel", role: .cancel, action: onCancel)
                    .buttonStyle(.bordered)

                Button("Import Anyway", action: onImportAnyway)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding()
    }
}

struct ExistingBookRow: View {
    let book: Book

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: book.coverURL) { image in
                image.resizable()
            } placeholder: {
                Rectangle().fill(.gray.opacity(0.3))
            }
            .frame(width: 40, height: 60)
            .clipShape(RoundedRectangle(cornerRadius: 4))

            VStack(alignment: .leading) {
                Text(book.title)
                    .font(.subheadline)
                    .lineLimit(1)

                Text(book.author)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Индикатор прогресса чтения
            if book.readingProgress > 0 {
                Text("\(Int(book.readingProgress * 100))%")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal)
    }
}
```

---

## 8. Страница книги (Book Detail)

### Какие данные отображать

```swift
struct BookDetailView: View {
    @Bindable var book: Book
    @State private var showMetadataEditor = false
    @State private var isLoadingMetadata = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Обложка
                BookCoverLarge(book: book)

                // Основная информация
                VStack(spacing: 8) {
                    Text(book.title)
                        .font(.title2)
                        .fontWeight(.bold)
                        .multilineTextAlignment(.center)

                    Text(book.author)
                        .font(.title3)
                        .foregroundStyle(.secondary)

                    // Серия
                    if let series = book.series {
                        HStack {
                            Text(series)
                            if let index = book.seriesIndex {
                                Text("#\(Int(index))")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .font(.subheadline)
                        .foregroundStyle(.accent)
                    }
                }

                // Рейтинг
                RatingView(rating: $book.rating)

                // Статус чтения
                StatusPicker(status: $book.status)

                // Прогресс
                if book.readingProgress > 0 {
                    ProgressSection(progress: book.readingProgress)
                }

                // Действия
                ActionButtons(book: book)

                Divider()

                // Метаданные
                MetadataSection(book: book)

                // Жанры
                if !book.genres.isEmpty {
                    GenresSection(genres: book.genres)
                }

                // Коллекции
                CollectionsSection(book: book)
            }
            .padding()
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        showMetadataEditor = true
                    } label: {
                        Label("Edit Metadata", systemImage: "pencil")
                    }

                    Button {
                        Task { await fetchMetadata() }
                    } label: {
                        Label("Fetch Metadata", systemImage: "arrow.down.circle")
                    }

                    Divider()

                    Button(role: .destructive) {
                        // Delete
                    } label: {
                        Label("Delete Book", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    private func fetchMetadata() async {
        isLoadingMetadata = true
        defer { isLoadingMetadata = false }

        let fetcher = MetadataFetcher()

        // Пробуем разные источники
        if let isbn = book.isbn {
            if let metadata = try? await fetcher.fetchFromGoogleBooks(isbn: isbn) {
                updateBook(with: metadata)
                return
            }

            if let metadata = try? await fetcher.fetchFromOpenLibrary(isbn: isbn) {
                updateBook(with: metadata)
                return
            }
        }

        // Поиск по названию и автору
        if let metadata = try? await fetcher.searchGoogleBooks(title: book.title, author: book.author) {
            updateBook(with: metadata)
        }
    }

    private func updateBook(with metadata: FetchedMetadata) {
        if book.coverURL == nil, let coverURL = metadata.coverURL {
            book.coverURL = coverURL
        }
        if book.genres.isEmpty {
            book.genres = metadata.genres
        }
        // ...
    }
}

struct BookCoverLarge: View {
    let book: Book

    var body: some View {
        AsyncImage(url: book.coverURL) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            case .failure, .empty:
                BookPlaceholderCover(title: book.title)
            @unknown default:
                EmptyView()
            }
        }
        .frame(height: 300)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(radius: 10)
    }
}

struct RatingView: View {
    @Binding var rating: Int?

    var body: some View {
        HStack(spacing: 8) {
            ForEach(1...5, id: \.self) { star in
                Image(systemName: star <= (rating ?? 0) ? "star.fill" : "star")
                    .foregroundStyle(star <= (rating ?? 0) ? .yellow : .gray)
                    .onTapGesture {
                        if rating == star {
                            rating = nil // Сброс
                        } else {
                            rating = star
                        }
                    }
            }
        }
        .font(.title2)
    }
}

struct StatusPicker: View {
    @Binding var status: ReadingStatus

    var body: some View {
        Picker("Status", selection: $status) {
            ForEach(ReadingStatus.allCases, id: \.self) { status in
                Text(status.rawValue).tag(status)
            }
        }
        .pickerStyle(.segmented)
    }
}

struct MetadataSection: View {
    let book: Book

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Details")
                .font(.headline)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                if let isbn = book.isbn {
                    MetadataRow(label: "ISBN", value: isbn)
                }

                MetadataRow(label: "Added", value: book.addedDate.formatted(date: .abbreviated, time: .omitted))

                if let lastRead = book.lastReadDate {
                    MetadataRow(label: "Last Read", value: lastRead.formatted(date: .abbreviated, time: .omitted))
                }

                MetadataRow(label: "Size", value: ByteCountFormatter.string(fromByteCount: book.fileSize, countStyle: .file))
            }
        }
    }
}

struct MetadataRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(value)
                .font(.subheadline)
        }
    }
}
```

### Поиск обложек и метаданных

**Источники:**
- [Google Books API](https://developers.google.com/books/docs/v1/using)
- [Open Library API](https://openlibrary.org/dev/docs/api/books)
- [Open Library Covers API](https://openlibrary.org/dev/docs/api/covers)
- [Top 9 Book APIs in 2025](https://isbndb.com/blog/book-api/)

```swift
struct MetadataFetcher {

    // MARK: - Google Books API

    func fetchFromGoogleBooks(isbn: String) async throws -> FetchedMetadata? {
        let urlString = "https://www.googleapis.com/books/v1/volumes?q=isbn:\(isbn)"
        guard let url = URL(string: urlString) else { return nil }

        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(GoogleBooksResponse.self, from: data)

        guard let item = response.items?.first else { return nil }
        let info = item.volumeInfo

        return FetchedMetadata(
            title: info.title,
            author: info.authors?.joined(separator: ", "),
            description: info.description,
            coverURL: info.imageLinks?.thumbnail.flatMap { URL(string: $0.replacingOccurrences(of: "http:", with: "https:")) },
            genres: info.categories ?? [],
            pageCount: info.pageCount,
            publishedDate: info.publishedDate,
            publisher: info.publisher,
            language: info.language,
            averageRating: info.averageRating
        )
    }

    func searchGoogleBooks(title: String, author: String) async throws -> FetchedMetadata? {
        let query = "\(title) \(author)".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let urlString = "https://www.googleapis.com/books/v1/volumes?q=\(query)&maxResults=1"
        guard let url = URL(string: urlString) else { return nil }

        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(GoogleBooksResponse.self, from: data)

        guard let item = response.items?.first else { return nil }
        let info = item.volumeInfo

        return FetchedMetadata(
            title: info.title,
            author: info.authors?.joined(separator: ", "),
            description: info.description,
            coverURL: info.imageLinks?.thumbnail.flatMap { URL(string: $0) },
            genres: info.categories ?? [],
            pageCount: info.pageCount,
            publishedDate: info.publishedDate,
            publisher: info.publisher,
            language: info.language,
            averageRating: info.averageRating
        )
    }

    // MARK: - Open Library API

    func fetchFromOpenLibrary(isbn: String) async throws -> FetchedMetadata? {
        let urlString = "https://openlibrary.org/api/books?bibkeys=ISBN:\(isbn)&jscmd=data&format=json"
        guard let url = URL(string: urlString) else { return nil }

        let (data, _) = try await URLSession.shared.data(from: url)

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let bookData = json["ISBN:\(isbn)"] as? [String: Any] else {
            return nil
        }

        // Обложка
        let coverURL: URL?
        if let cover = bookData["cover"] as? [String: String],
           let coverURLString = cover["large"] ?? cover["medium"] {
            coverURL = URL(string: coverURLString)
        } else {
            // Используем Covers API
            coverURL = URL(string: "https://covers.openlibrary.org/b/isbn/\(isbn)-L.jpg")
        }

        // Авторы
        let authors: String?
        if let authorsArray = bookData["authors"] as? [[String: Any]] {
            authors = authorsArray.compactMap { $0["name"] as? String }.joined(separator: ", ")
        } else {
            authors = nil
        }

        // Жанры/Subjects
        let genres: [String]
        if let subjects = bookData["subjects"] as? [[String: Any]] {
            genres = subjects.compactMap { $0["name"] as? String }
        } else {
            genres = []
        }

        return FetchedMetadata(
            title: bookData["title"] as? String,
            author: authors,
            description: nil,
            coverURL: coverURL,
            genres: genres,
            pageCount: bookData["number_of_pages"] as? Int,
            publishedDate: bookData["publish_date"] as? String,
            publisher: (bookData["publishers"] as? [[String: Any]])?.first?["name"] as? String,
            language: nil,
            averageRating: nil
        )
    }
}

struct FetchedMetadata {
    let title: String?
    let author: String?
    let description: String?
    let coverURL: URL?
    let genres: [String]
    let pageCount: Int?
    let publishedDate: String?
    let publisher: String?
    let language: String?
    let averageRating: Double?
}

// Response Models
struct GoogleBooksResponse: Codable {
    let items: [GoogleBooksItem]?
}

struct GoogleBooksItem: Codable {
    let volumeInfo: GoogleBooksVolumeInfo
}

struct GoogleBooksVolumeInfo: Codable {
    let title: String
    let authors: [String]?
    let description: String?
    let imageLinks: GoogleBooksImageLinks?
    let categories: [String]?
    let pageCount: Int?
    let publishedDate: String?
    let publisher: String?
    let language: String?
    let averageRating: Double?
}

struct GoogleBooksImageLinks: Codable {
    let thumbnail: String?
    let smallThumbnail: String?
}
```

### Возрастные ограничения

```swift
enum AgeRating: String, Codable, CaseIterable {
    case everyone = "Everyone"
    case teen = "Teen (13+)"
    case mature = "Mature (17+)"
    case adult = "Adult (18+)"
    case unknown = "Unknown"
}

extension Book {
    /// Определяет возрастной рейтинг на основе метаданных и жанров
    func determineAgeRating() -> AgeRating {
        // Проверяем жанры
        let adultGenres = ["erotica", "erotic", "adult"]
        let matureGenres = ["horror", "thriller", "crime", "violence"]
        let teenGenres = ["young adult", "ya"]

        let lowercasedGenres = genres.map { $0.lowercased() }

        for genre in lowercasedGenres {
            if adultGenres.contains(where: { genre.contains($0) }) {
                return .adult
            }
            if matureGenres.contains(where: { genre.contains($0) }) {
                return .mature
            }
            if teenGenres.contains(where: { genre.contains($0) }) {
                return .teen
            }
        }

        // Можно добавить проверку через внешние API
        // (Google Books иногда включает maturityRating)

        return .unknown
    }
}
```

---

## 9. Лимиты хранения

### Freemium модель

**Источники:**
- [StoreKit 2 - Apple Developer](https://developer.apple.com/storekit/)
- [Mastering StoreKit 2 in SwiftUI: A Complete Guide to In-App Purchases (2025)](https://medium.com/@dhruvinbhalodiya752/mastering-storekit-2-in-swiftui-a-complete-guide-to-in-app-purchases-2025-ef9241fced46)

```swift
import StoreKit

enum SubscriptionTier: String {
    case free = "free"
    case pro = "pro"

    var bookLimit: Int {
        switch self {
        case .free: return 10
        case .pro: return Int.max // Unlimited
        }
    }

    var offlineBookLimit: Int {
        switch self {
        case .free: return 3
        case .pro: return Int.max
        }
    }

    var canCreatePublicCollections: Bool {
        self == .pro
    }
}

@Observable
final class SubscriptionManager {
    var currentTier: SubscriptionTier = .free
    var isProSubscribed: Bool { currentTier == .pro }

    private let productId = "ru.fancai.pro.monthly"

    init() {
        Task {
            await checkSubscriptionStatus()
        }
    }

    func checkSubscriptionStatus() async {
        // Проверяем текущие entitlements
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result {
                if transaction.productID == productId {
                    currentTier = .pro
                    return
                }
            }
        }

        currentTier = .free
    }

    func purchase() async throws {
        guard let product = try await Product.products(for: [productId]).first else {
            throw SubscriptionError.productNotFound
        }

        let result = try await product.purchase()

        switch result {
        case .success(let verification):
            if case .verified = verification {
                await checkSubscriptionStatus()
            }
        case .pending:
            throw SubscriptionError.purchasePending
        case .userCancelled:
            throw SubscriptionError.userCancelled
        @unknown default:
            throw SubscriptionError.unknown
        }
    }

    func restorePurchases() async {
        await checkSubscriptionStatus()
    }
}

enum SubscriptionError: LocalizedError {
    case productNotFound
    case purchasePending
    case userCancelled
    case unknown

    var errorDescription: String? {
        switch self {
        case .productNotFound:
            return "Subscription product not found."
        case .purchasePending:
            return "Purchase is pending approval."
        case .userCancelled:
            return "Purchase was cancelled."
        case .unknown:
            return "An unknown error occurred."
        }
    }
}
```

### StorageManager для лимитов

```swift
@Observable
final class StorageManager {
    private let modelContext: ModelContext
    private let subscriptionManager: SubscriptionManager

    init(modelContext: ModelContext, subscriptionManager: SubscriptionManager = SubscriptionManager()) {
        self.modelContext = modelContext
        self.subscriptionManager = subscriptionManager
    }

    var currentBookCount: Int {
        let descriptor = FetchDescriptor<Book>()
        return (try? modelContext.fetchCount(descriptor)) ?? 0
    }

    var offlineBookCount: Int {
        let descriptor = FetchDescriptor<Book>(
            predicate: #Predicate { $0.isOfflineAvailable }
        )
        return (try? modelContext.fetchCount(descriptor)) ?? 0
    }

    var bookLimit: Int {
        subscriptionManager.currentTier.bookLimit
    }

    var offlineBookLimit: Int {
        subscriptionManager.currentTier.offlineBookLimit
    }

    var canAddBook: Bool {
        currentBookCount < bookLimit
    }

    var canAddOfflineBook: Bool {
        offlineBookCount < offlineBookLimit
    }

    var remainingBookSlots: Int {
        max(0, bookLimit - currentBookCount)
    }

    var usagePercentage: Double {
        guard bookLimit != Int.max else { return 0 }
        return Double(currentBookCount) / Double(bookLimit)
    }

    func canAddBook() -> Bool {
        return currentBookCount < bookLimit
    }
}
```

### Offline vs Online книги

```swift
extension Book {
    /// Помечает книгу как доступную офлайн (файл хранится локально)
    func makeAvailableOffline() {
        isOfflineAvailable = true
    }

    /// Удаляет локальный файл, оставляя только метаданные
    func removeOfflineData(fileManager: FileManager = .default) throws {
        guard isOfflineAvailable else { return }

        let fileURL = URL(fileURLWithPath: filePath)
        try fileManager.removeItem(at: fileURL)

        isOfflineAvailable = false
        filePath = "" // Или сохраняем URL для повторной загрузки
    }
}

struct OfflineManagementView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(filter: #Predicate<Book> { $0.isOfflineAvailable }) var offlineBooks: [Book]

    let storageManager: StorageManager

    var totalSize: Int64 {
        offlineBooks.reduce(0) { $0 + $1.fileSize }
    }

    var body: some View {
        List {
            Section {
                HStack {
                    Text("Offline Books")
                    Spacer()
                    Text("\(offlineBooks.count) / \(storageManager.offlineBookLimit)")
                        .foregroundStyle(.secondary)
                }

                HStack {
                    Text("Storage Used")
                    Spacer()
                    Text(ByteCountFormatter.string(fromByteCount: totalSize, countStyle: .file))
                        .foregroundStyle(.secondary)
                }
            }

            Section("Offline Books") {
                ForEach(offlineBooks) { book in
                    HStack {
                        Text(book.title)
                        Spacer()
                        Text(ByteCountFormatter.string(fromByteCount: book.fileSize, countStyle: .file))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            try? book.removeOfflineData()
                        } label: {
                            Label("Remove", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .navigationTitle("Offline Storage")
    }
}
```

### UI для лимитов

```swift
struct StorageLimitBanner: View {
    let storageManager: StorageManager
    @State private var showUpgradeSheet = false

    var body: some View {
        if !storageManager.subscriptionManager.isProSubscribed {
            VStack(spacing: 8) {
                HStack {
                    Text("Library")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Spacer()

                    Text("\(storageManager.currentBookCount) / \(storageManager.bookLimit) books")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                ProgressView(value: storageManager.usagePercentage)
                    .tint(storageManager.usagePercentage > 0.8 ? .orange : .accentColor)

                if storageManager.usagePercentage >= 1.0 {
                    Button {
                        showUpgradeSheet = true
                    } label: {
                        HStack {
                            Image(systemName: "crown.fill")
                            Text("Upgrade to Pro for unlimited books")
                        }
                        .font(.caption)
                    }
                }
            }
            .padding()
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .sheet(isPresented: $showUpgradeSheet) {
                UpgradeView()
            }
        }
    }
}

struct UpgradeView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var subscriptionManager = SubscriptionManager()
    @State private var isPurchasing = false
    @State private var error: Error?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: "crown.fill")
                    .font(.system(size: 60))
                    .foregroundStyle(.yellow)

                Text("Upgrade to Pro")
                    .font(.title)
                    .fontWeight(.bold)

                VStack(alignment: .leading, spacing: 12) {
                    FeatureRow(icon: "books.vertical", text: "Unlimited books")
                    FeatureRow(icon: "arrow.down.circle", text: "Unlimited offline storage")
                    FeatureRow(icon: "link", text: "Public collections")
                    FeatureRow(icon: "wand.and.stars", text: "Priority AI processing")
                }
                .padding()

                Spacer()

                Button {
                    Task {
                        isPurchasing = true
                        do {
                            try await subscriptionManager.purchase()
                            dismiss()
                        } catch {
                            self.error = error
                        }
                        isPurchasing = false
                    }
                } label: {
                    if isPurchasing {
                        ProgressView()
                    } else {
                        Text("Subscribe for $4.99/month")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isPurchasing)

                Button("Restore Purchases") {
                    Task {
                        await subscriptionManager.restorePurchases()
                        if subscriptionManager.isProSubscribed {
                            dismiss()
                        }
                    }
                }
                .font(.caption)
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                }
            }
            .alert("Error", isPresented: .constant(error != nil)) {
                Button("OK") { error = nil }
            } message: {
                if let error = error {
                    Text(error.localizedDescription)
                }
            }
        }
    }
}

struct FeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(.accentColor)
                .frame(width: 24)

            Text(text)
        }
    }
}
```

---

## Recommendations

| # | Рекомендация | Приоритет | Сложность |
|---|--------------|-----------|-----------|
| 1 | Использовать `LazyVGrid` для Grid view с адаптивными колонками | P0 | Низкая |
| 2 | Реализовать динамическую сортировку через init в subview | P0 | Средняя |
| 3 | Интегрировать Share Extension с App Groups для импорта | P1 | Средняя |
| 4 | Использовать Readium Swift Toolkit для OPDS | P1 | Низкая |
| 5 | Реализовать дубликаты через hash + ISBN + fuzzy title match | P1 | Средняя |
| 6 | Использовать Google Books + Open Library для метаданных | P1 | Низкая |
| 7 | Реализовать Universal Links для публичных коллекций | P2 | Средняя |
| 8 | Использовать StoreKit 2 для Freemium модели | P2 | Средняя |
| 9 | Добавить Drag & Drop для iPad | P2 | Низкая |

---

## Next Steps

1. Создать SwiftData модели (`Book`, `Collection`, `BookSeries`)
2. Реализовать базовый UI библиотеки с Grid/List переключением
3. Добавить импорт через `fileImporter`
4. Интегрировать EPUBKit для парсинга метаданных
5. Реализовать сортировку и фильтрацию
6. Добавить поиск метаданных через Google Books API
7. Реализовать Share Extension
8. Добавить OPDS каталоги
9. Интегрировать StoreKit 2 для подписок

---

## Appendix: Библиотеки и SDK

### Парсинг EPUB
- [EPUBKit](https://github.com/witekbobrowski/EPUBKit) - Легковесный парсер метаданных
- [FolioReaderKit](https://github.com/FolioReader/FolioReaderKit) - Полноценный reader + parser
- [Readium Swift Toolkit](https://github.com/readium/swift-toolkit) - Comprehensive toolkit

### API для метаданных
- [Google Books API](https://developers.google.com/books)
- [Open Library API](https://openlibrary.org/developers/api)
- [Open Library Covers API](https://openlibrary.org/dev/docs/api/covers)

### OPDS
- [Readium OPDS](https://github.com/readium/swift-toolkit) - ReadiumOPDS module
- [OPDS Spec 1.2](https://specs.opds.io/opds-1.2.html)

### Облачные хранилища
- [SwiftyDropbox](https://github.com/dropbox/SwiftyDropbox)
- [FileProvider](https://github.com/amosavian/FileProvider)
