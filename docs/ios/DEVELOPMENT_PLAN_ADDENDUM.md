# Дополнение к плану разработки — Недостающие задачи

**Дата:** 2026-01-17
**Версия:** 1.1

> Этот документ дополняет основной план, добавляя задачи, которые были пропущены при первоначальном планировании.

---

## Дополнительные задачи Phase 1: Authentication

### Task 1.10: Google Sign-In

**Приоритет:** P1 | **Оценка:** 6h | **Зависимости:** 1.1

**Файлы:**
- `Features/Auth/Views/GoogleSignInButton.swift`
- `Features/Auth/Services/GoogleAuthService.swift`

**Реализация:**
```swift
import GoogleSignIn

class GoogleAuthService {
    func signIn(presenting: UIViewController) async throws -> GIDGoogleUser {
        let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenting)
        return result.user
    }
    
    func signOut() {
        GIDSignIn.sharedInstance.signOut()
    }
}
```

**Backend endpoint:** `POST /v1/auth/google`

**Шаги:**
1. Добавить GoogleSignIn SPM package
2. Настроить OAuth в Google Cloud Console
3. Добавить URL scheme в Info.plist
4. Реализовать backend верификацию токена

**Критерии готовности:**
- [ ] Кнопка Google Sign-In на LoginView
- [ ] Токен верифицируется на backend
- [ ] Пользователь создаётся/авторизуется

---

### Task 1.11: Account Deletion (GDPR/152-ФЗ)

**Приоритет:** P0 | **Оценка:** 8h | **Зависимости:** 1.8

> ⚠️ **КРИТИЧНО для App Store** — Apple требует возможность удаления аккаунта

**Файлы:**
- `Features/Settings/Views/DeleteAccountView.swift`
- `Features/Settings/ViewModels/DeleteAccountViewModel.swift`

**Реализация:**
```swift
struct DeleteAccountView: View {
    @StateObject private var viewModel = DeleteAccountViewModel()
    @State private var confirmText = ""
    @State private var showConfirmation = false
    
    var body: some View {
        VStack(spacing: 20) {
            // Warning
            VStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.largeTitle)
                    .foregroundStyle(.red)
                Text("Удаление аккаунта")
                    .font(.title2.bold())
                Text("Это действие необратимо. Будут удалены:")
                    .foregroundStyle(.secondary)
            }
            
            // What will be deleted
            VStack(alignment: .leading, spacing: 8) {
                DeleteItem(text: "Все ваши книги")
                DeleteItem(text: "Сгенерированные изображения")
                DeleteItem(text: "Закладки и заметки")
                DeleteItem(text: "Статистика чтения")
                DeleteItem(text: "Подписка (без возврата)")
            }
            .padding()
            .background(Color.red.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            
            // Confirmation
            TextField("Введите DELETE для подтверждения", text: $confirmText)
                .textFieldStyle(.roundedBorder)
            
            // Export option
            Button("Скачать мои данные") {
                Task { await viewModel.exportData() }
            }
            
            // Delete button
            Button("Удалить аккаунт навсегда", role: .destructive) {
                showConfirmation = true
            }
            .disabled(confirmText != "DELETE")
        }
        .padding()
        .confirmationDialog("Вы уверены?", isPresented: $showConfirmation) {
            Button("Удалить", role: .destructive) {
                Task { await viewModel.deleteAccount() }
            }
        }
    }
}
```

**Backend endpoint:** `DELETE /v1/users/me`

**Шаги:**
1. Создать UI с предупреждениями
2. Реализовать экспорт данных в ZIP
3. Удаление всех данных на backend
4. Отзыв подписки в RevenueCat
5. Очистка локальных данных

**Критерии готовности:**
- [ ] Кнопка в Settings → Account
- [ ] Предупреждение о последствиях
- [ ] Подтверждение вводом "DELETE"
- [ ] Экспорт данных перед удалением
- [ ] Полное удаление на backend

---

### Task 1.12: Profile Page

**Приоритет:** P1 | **Оценка:** 6h | **Зависимости:** 1.1

**Файлы:**
- `Features/Profile/Views/ProfileView.swift`
- `Features/Profile/Views/EditProfileView.swift`
- `Features/Profile/ViewModels/ProfileViewModel.swift`

**Реализация:**
```swift
struct ProfileView: View {
    @StateObject private var viewModel = ProfileViewModel()
    
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Avatar
                ProfileAvatarView(imageData: viewModel.avatarData)
                    .frame(width: 100, height: 100)
                
                // Name
                Text(viewModel.displayName)
                    .font(.title2.bold())
                
                // Stats summary
                HStack(spacing: 40) {
                    StatItem(value: "\(viewModel.booksRead)", label: "Книг")
                    StatItem(value: "\(viewModel.streak)", label: "Streak")
                    StatItem(value: "\(viewModel.imagesGenerated)", label: "Изображений")
                }
                
                // Visibility toggle
                Toggle("Публичный профиль", isOn: $viewModel.isPublic)
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                
                // Age setting (for 18+ filter)
                Picker("Возраст", selection: $viewModel.ageGroup) {
                    Text("До 18").tag(AgeGroup.under18)
                    Text("18+").tag(AgeGroup.adult)
                }
                .pickerStyle(.segmented)
            }
            .padding()
        }
        .navigationTitle("Профиль")
    }
}
```

**Критерии готовности:**
- [ ] Отображение аватара и имени
- [ ] Редактирование профиля
- [ ] Настройка публичности
- [ ] Настройка возраста (18+ фильтр)

---

## Дополнительные задачи Phase 2: Library

### Task 2.13: Duplicate Detection

**Приоритет:** P1 | **Оценка:** 4h | **Зависимости:** 2.5, 2.6

**Реализация:**
```swift
class DuplicateDetector {
    func checkDuplicate(newBook: URL, existingBooks: [Book]) throws -> Book? {
        // 1. Calculate file hash
        let fileHash = try calculateHash(of: newBook)
        
        // 2. Check against existing
        if let existing = existingBooks.first(where: { $0.fileHash == fileHash }) {
            return existing
        }
        
        // 3. Check by title + author (fuzzy match)
        let metadata = try parseMetadata(from: newBook)
        let similar = existingBooks.first { book in
            book.title.lowercased() == metadata.title?.lowercased() &&
            book.author?.lowercased() == metadata.author?.lowercased()
        }
        
        return similar
    }
    
    private func calculateHash(of url: URL) throws -> String {
        let data = try Data(contentsOf: url)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
```

**UI Alert:**
```swift
.alert("Эта книга уже есть", isPresented: $showDuplicateAlert) {
    Button("Отмена", role: .cancel) { }
    Button("Заменить") { replaceBook() }
    Button("Добавить копию") { addAnyway() }
}
```

**Критерии готовности:**
- [ ] Hash-based detection
- [ ] Title+Author fuzzy match
- [ ] Alert с опциями

---

### Task 2.14: Series Grouping

**Приоритет:** P2 | **Оценка:** 6h | **Зависимости:** 2.5

**Модель:**
```swift
@Model
final class BookSeries {
    @Attribute(.unique) var id: UUID
    var name: String
    var description: String?
    
    @Relationship
    var books: [Book] = []
    
    var sortedBooks: [Book] {
        books.sorted { ($0.seriesIndex ?? 0) < ($1.seriesIndex ?? 0) }
    }
}

// Добавить в Book:
var series: BookSeries?
var seriesIndex: Int?
```

**Критерии готовности:**
- [ ] Метаданные серии из EPUB
- [ ] UI группировки
- [ ] Навигация между книгами серии

---

### Task 2.15: Cloud Import (Dropbox)

**Приоритет:** P2 | **Оценка:** 8h | **Зависимости:** 2.3

**Реализация:**
```swift
import SwiftyDropbox

class DropboxImporter {
    func authorize(from viewController: UIViewController) {
        let scopeRequest = ScopeRequest(
            scopeType: .user,
            scopes: ["files.content.read"],
            includeGrantedScopes: false
        )
        DropboxClientsManager.authorizeFromControllerV2(
            UIApplication.shared,
            controller: viewController,
            loadingStatusDelegate: nil,
            openURL: { url in UIApplication.shared.open(url) },
            scopeRequest: scopeRequest
        )
    }
    
    func listBooks() async throws -> [DropboxFile] {
        guard let client = DropboxClientsManager.authorizedClient else {
            throw ImportError.notAuthorized
        }
        
        let response = try await client.files.search(
            path: "",
            query: ".epub OR .fb2"
        )
        
        return response.matches.map { DropboxFile(from: $0) }
    }
    
    func download(file: DropboxFile) async throws -> URL {
        // Download to temporary location
    }
}
```

**Критерии готовности:**
- [ ] OAuth авторизация
- [ ] Поиск .epub/.fb2 файлов
- [ ] Скачивание и импорт

---

### Task 2.16: Cloud Import (Google Drive)

**Приоритет:** P2 | **Оценка:** 8h | **Зависимости:** 2.3

Аналогично Task 2.15, использовать Google Drive API.

---

### Task 2.17: OPDS Catalog Support

**Приоритет:** P2 (Future) | **Оценка:** 12h | **Зависимости:** 2.1

**Модель:**
```swift
struct OPDSCatalog: Codable, Identifiable {
    let id: UUID
    var name: String
    var url: URL
    var username: String?
    var password: String?
}

class OPDSService {
    func fetchCatalog(from url: URL) async throws -> OPDSFeed {
        let (data, _) = try await URLSession.shared.data(from: url)
        let parser = OPDSParser()
        return try parser.parse(data)
    }
    
    func downloadBook(from entry: OPDSEntry) async throws -> URL {
        guard let downloadLink = entry.links.first(where: { $0.rel == "acquisition" }) else {
            throw OPDSError.noDownloadLink
        }
        // Download book
    }
}
```

**Критерии готовности:**
- [ ] Добавление OPDS каталога
- [ ] Парсинг OPDS 1.2 / 2.0
- [ ] Поиск и скачивание книг

---

## Дополнительные задачи Phase 3: Reader

### Task 3.18: Reading Speed Calculation

**Приоритет:** P1 | **Оценка:** 4h | **Зависимости:** 3.1

**Реализация:**
```swift
class ReadingSpeedTracker {
    private var pageStartTime: Date?
    private var wordCounts: [Int] = []
    private var readingTimes: [TimeInterval] = []
    
    func pageDidAppear(wordCount: Int) {
        pageStartTime = Date()
    }
    
    func pageDidDisappear(wordCount: Int) {
        guard let startTime = pageStartTime else { return }
        let duration = Date().timeIntervalSince(startTime)
        
        // Ignore very short times (likely skipping)
        guard duration > 5 else { return }
        // Ignore very long times (likely distracted)
        guard duration < 300 else { return }
        
        wordCounts.append(wordCount)
        readingTimes.append(duration)
    }
    
    var wordsPerMinute: Int {
        guard !wordCounts.isEmpty else { return 250 } // Default
        
        let totalWords = wordCounts.reduce(0, +)
        let totalMinutes = readingTimes.reduce(0, +) / 60
        
        guard totalMinutes > 0 else { return 250 }
        return Int(Double(totalWords) / totalMinutes)
    }
    
    func estimatedTimeRemaining(wordsLeft: Int) -> TimeInterval {
        let wpm = max(wordsPerMinute, 100) // Minimum WPM
        return TimeInterval(wordsLeft) / TimeInterval(wpm) * 60
    }
}
```

**Критерии готовности:**
- [ ] Отслеживание времени на странице
- [ ] Расчёт WPM
- [ ] Оценка оставшегося времени

---

## Дополнительные задачи Phase 7: Settings

### Task 7.13: Settings Page (Full)

**Приоритет:** P0 | **Оценка:** 8h | **Зависимости:** Phase 1-6

**Features/Settings/Views/SettingsView.swift:**
```swift
struct SettingsView: View {
    var body: some View {
        NavigationStack {
            List {
                // Account Section
                Section("Аккаунт") {
                    NavigationLink("Профиль") {
                        ProfileView()
                    }
                    NavigationLink("Подписка") {
                        SubscriptionStatusView()
                    }
                    NavigationLink("Связанные аккаунты") {
                        LinkedAccountsView()
                    }
                }
                
                // Reader Section
                Section("Чтение") {
                    NavigationLink("Шрифт и тема") {
                        ReaderDefaultsView()
                    }
                    Picker("Навигация", selection: $navigationMode) {
                        Text("Tap").tag(NavigationMode.tap)
                        Text("Swipe").tag(NavigationMode.swipe)
                    }
                    Picker("Анимация", selection: $pageAnimation) {
                        Text("Curl").tag(PageAnimation.curl)
                        Text("Slide").tag(PageAnimation.slide)
                        Text("Fade").tag(PageAnimation.fade)
                    }
                    Toggle("Звук перелистывания", isOn: $pageTurnSound)
                }
                
                // AI Section
                Section("AI-генерация") {
                    Picker("Стиль по умолчанию", selection: $defaultStyle) {
                        ForEach(GenerationStyle.allCases) { style in
                            Text(style.displayName).tag(style)
                        }
                    }
                    NavigationLink("Категории описаний") {
                        EntityCategoriesView()
                    }
                }
                
                // Notifications Section
                Section("Уведомления") {
                    Toggle("Push-уведомления", isOn: $pushEnabled)
                    if pushEnabled {
                        DatePicker("Напоминание о чтении", selection: $reminderTime, displayedComponents: .hourAndMinute)
                    }
                }
                
                // Storage Section
                Section("Хранилище") {
                    StorageUsageView()
                    Button("Очистить кэш") {
                        clearCache()
                    }
                }
                
                // About Section
                Section("О приложении") {
                    LabeledContent("Версия", value: Bundle.main.appVersion)
                    Link("Политика конфиденциальности", destination: URL(string: "https://fancai.ru/privacy")!)
                    Link("Условия использования", destination: URL(string: "https://fancai.ru/terms")!)
                    Link("FAQ", destination: URL(string: "https://fancai.ru/faq")!)
                }
                
                // Danger Zone
                Section {
                    NavigationLink("Удалить аккаунт") {
                        DeleteAccountView()
                    }
                    .foregroundStyle(.red)
                }
            }
            .navigationTitle("Настройки")
        }
    }
}
```

**Критерии готовности:**
- [ ] Все секции из промпта 2.20 реализованы
- [ ] Настройки сохраняются
- [ ] Навигация работает

---

## Обновлённая сводная таблица

| Phase | Было задач | Добавлено | Итого | Часов |
|-------|------------|-----------|-------|-------|
| 0: Setup | 10 | 0 | 10 | 37h |
| 1: Auth | 9 | **3** | **12** | **55h** |
| 2: Library | 12 | **5** | **17** | **85h** |
| 3: Reader | 17 | **1** | **18** | **102h** |
| 4: AI | 15 | 0 | 15 | 78h |
| 5: Subscriptions | 9 | 0 | 9 | 34h |
| 6: Sync & Push | 10 | 0 | 10 | 42h |
| 7: Polish | 12 | **1** | **13** | **94h** |
| 8: Launch | 10 | 0 | 10 | 50h |
| **Итого** | **104** | **10** | **114** | **577h** |

---

## Приоритизация дополнительных задач

| Task | Название | Приоритет | MVP? |
|------|----------|-----------|------|
| 1.10 | Google Sign-In | P1 | ⚠️ Week 3 |
| **1.11** | **Account Deletion** | **P0** | **✅ Обязательно** |
| 1.12 | Profile Page | P1 | ⚠️ Week 3 |
| 2.13 | Duplicate Detection | P1 | ⚠️ Week 5 |
| 2.14 | Series Grouping | P2 | ❌ Post-MVP |
| 2.15 | Dropbox Import | P2 | ❌ Post-MVP |
| 2.16 | Google Drive Import | P2 | ❌ Post-MVP |
| 2.17 | OPDS Catalogs | P2 | ❌ Post-MVP |
| 3.18 | Reading Speed Calc | P1 | ⚠️ Week 8 |
| **7.13** | **Settings Page** | **P0** | **✅ Обязательно** |

---

## Обновлённый критический путь

```
Setup → Auth (+ Google, GDPR) → Library (+ Duplicates) → Reader (+ Speed) → AI → Settings → Launch
```
