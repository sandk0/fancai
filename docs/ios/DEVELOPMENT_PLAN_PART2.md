# Детальный план разработки — Часть 2: Authentication и Library

**Продолжение:** DEVELOPMENT_PLAN.md

---

## 4. Phase 1: Authentication

**Срок:** Неделя 3
**Цель:** Полный auth flow с Sign in with Apple и Email

### Task 1.1: Sign in with Apple UI

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 0.1, 0.7

**Файлы:**
- `Features/Auth/Views/LoginView.swift`
- `Features/Auth/Views/SignInWithAppleButton.swift`

**Реализация:**
```swift
import AuthenticationServices
import SwiftUI

struct SignInWithAppleButton: View {
    let onRequest: (ASAuthorizationAppleIDRequest) -> Void
    let onCompletion: (Result<ASAuthorization, Error>) -> Void
    
    var body: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.fullName, .email]
            onRequest(request)
        } onCompletion: { result in
            onCompletion(result)
        }
        .signInWithAppleButtonStyle(.black)
        .frame(height: 50)
    }
}
```

**Шаги:**
1. Добавить capability "Sign in with Apple" в Xcode
2. Создать LoginView с брендингом
3. Добавить SignInWithAppleButton
4. Обработать ASAuthorizationAppleIDCredential

**Критерии готовности:**
- [ ] Кнопка отображается корректно
- [ ] Системный sheet появляется при нажатии
- [ ] Credentials получаются после авторизации

---

### Task 1.2: Sign in with Apple Backend

**Приоритет:** P0 | **Оценка:** 6h | **Зависимости:** 0.10

**Endpoint:** `POST /v1/auth/apple`

**backend/app/api/v1/auth.py:**
```python
from fastapi import APIRouter, HTTPException
from app.schemas.auth import AppleAuthRequest, AuthResponse
from app.services.auth import verify_apple_token, create_user_tokens

router = APIRouter()

@router.post("/apple", response_model=AuthResponse)
async def auth_apple(request: AppleAuthRequest):
    # 1. Verify identity_token with Apple
    apple_user = await verify_apple_token(request.identity_token)
    if not apple_user:
        raise HTTPException(status_code=401, detail="Invalid Apple token")
    
    # 2. Find or create user
    user = await get_or_create_user(
        apple_id=apple_user.sub,
        email=request.email,
        name=request.full_name
    )
    
    # 3. Generate JWT tokens
    tokens = create_user_tokens(user)
    
    return AuthResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_at=tokens.expires_at,
        user=user.to_profile()
    )
```

**Шаги:**
1. Установить `python-jose` для JWT
2. Получить Apple public keys для верификации
3. Реализовать verify_apple_token
4. Создать таблицу users в PostgreSQL
5. Реализовать create_user_tokens

**Критерии готовности:**
- [ ] Endpoint принимает identity_token
- [ ] Токен верифицируется с Apple
- [ ] JWT токены возвращаются

---

### Task 1.3: Email + Password UI

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 0.5

**Файлы:**
- `Features/Auth/Views/EmailLoginView.swift`
- `Features/Auth/Views/RegistrationView.swift`

**Реализация EmailLoginView:**
```swift
struct EmailLoginView: View {
    @State private var email = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var error: String?
    
    var body: some View {
        VStack(spacing: 16) {
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
                .textFieldStyle(.roundedBorder)
            
            SecureField("Пароль", text: $password)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)
            
            if let error {
                Text(error)
                    .foregroundStyle(.red)
                    .font(.caption)
            }
            
            PrimaryButton(title: "Войти") {
                Task { await login() }
            }
            .disabled(isLoading || !isValid)
        }
        .padding()
    }
    
    private var isValid: Bool {
        email.contains("@") && password.count >= 6
    }
}
```

**Критерии готовности:**
- [ ] Форма с валидацией email/password
- [ ] Переключение Login/Register
- [ ] Loading state во время запроса

---

### Task 1.4: Email + Password Backend

**Приоритет:** P0 | **Оценка:** 6h | **Зависимости:** 0.10

**Endpoints:**
- `POST /v1/auth/register`
- `POST /v1/auth/login`

**Шаги:**
1. Хеширование паролей с bcrypt
2. Email validation (regex + формат)
3. Rate limiting для защиты от brute-force
4. Верификация email (опционально для MVP)

**Критерии готовности:**
- [ ] Регистрация создаёт пользователя
- [ ] Login возвращает токены
- [ ] Пароли хешируются

---

### Task 1.5: JWT Token Management

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 1.2, 1.4

**iOS токен менеджер:**
```swift
actor TokenManager {
    static let shared = TokenManager()
    
    private let keychain = KeychainManager.shared
    
    func saveTokens(access: String, refresh: String) async throws {
        try await keychain.save(access, forKey: "accessToken")
        try await keychain.save(refresh, forKey: "refreshToken")
    }
    
    func getAccessToken() async throws -> String {
        try await keychain.load(forKey: "accessToken")
    }
    
    func refreshIfNeeded() async throws -> String {
        // Check expiration, refresh if needed
    }
    
    func clearTokens() async throws {
        try await keychain.delete(forKey: "accessToken")
        try await keychain.delete(forKey: "refreshToken")
    }
}
```

**Критерии готовности:**
- [ ] Токены сохраняются после login
- [ ] Auto-refresh перед истечением
- [ ] Токены очищаются при logout

---

### Task 1.6: Keychain Storage

**Приоритет:** P0 | **Оценка:** 3h | **Зависимости:** 0.1

**Реализация:** См. `ios-technical-infrastructure.md` — KeychainManager

**Критерии готовности:**
- [ ] Save/Load/Delete работают
- [ ] Данные persist между launches
- [ ] Ошибки логируются

---

### Task 1.7: Auto-Login Flow

**Приоритет:** P0 | **Оценка:** 2h | **Зависимости:** 1.5, 1.6

**App/FancaiApp.swift:**
```swift
@main
struct FancaiApp: App {
    @State private var isAuthenticated = false
    @State private var isLoading = true
    
    var body: some Scene {
        WindowGroup {
            Group {
                if isLoading {
                    LaunchScreen()
                } else if isAuthenticated {
                    MainTabView()
                } else {
                    LoginView()
                }
            }
            .task {
                await checkAuthentication()
            }
        }
    }
    
    private func checkAuthentication() async {
        defer { isLoading = false }
        
        do {
            let token = try await TokenManager.shared.getAccessToken()
            // Validate token with backend
            isAuthenticated = true
        } catch {
            isAuthenticated = false
        }
    }
}
```

**Критерии готовности:**
- [ ] При наличии валидного токена — сразу MainTabView
- [ ] При отсутствии — LoginView
- [ ] Loading screen во время проверки

---

### Task 1.8: Logout Flow

**Приоритет:** P1 | **Оценка:** 2h | **Зависимости:** 1.5

**Шаги:**
1. Очистить токены из Keychain
2. Очистить локальный кэш
3. Сбросить state к LoginView
4. Отозвать refresh token на backend (опционально)

**Критерии готовности:**
- [ ] Кнопка Logout в Settings
- [ ] После logout — LoginView
- [ ] Токены удалены

---

### Task 1.9: Onboarding Screens

**Приоритет:** P1 | **Оценка:** 4h | **Зависимости:** 0.5

**Файл:** `Features/Auth/Views/OnboardingView.swift`

**Экраны:**
1. "Добро пожаловать в fancai" — Лого, краткое описание
2. "Читайте книги" — EPUB/FB2 illustration
3. "AI-иллюстрации" — Примеры генерации
4. "Начать" → LoginView

**Реализация:**
```swift
struct OnboardingView: View {
    @AppStorage("hasSeenOnboarding") private var hasSeenOnboarding = false
    @State private var currentPage = 0
    
    var body: some View {
        TabView(selection: $currentPage) {
            OnboardingPage(
                title: "Добро пожаловать",
                description: "fancai — чтение книг с AI-иллюстрациями",
                imageName: "book.fill"
            ).tag(0)
            
            OnboardingPage(
                title: "Читайте книги",
                description: "EPUB и FB2 форматы с кастомизацией",
                imageName: "text.book.closed"
            ).tag(1)
            
            OnboardingPage(
                title: "AI-иллюстрации",
                description: "Визуализация персонажей и локаций",
                imageName: "sparkles"
            ).tag(2)
        }
        .tabViewStyle(.page)
        .overlay(alignment: .bottom) {
            if currentPage == 2 {
                PrimaryButton(title: "Начать") {
                    hasSeenOnboarding = true
                }
                .padding()
            }
        }
    }
}
```

**Критерии готовности:**
- [ ] 3 экрана с PageControl
- [ ] Показывается только при первом запуске
- [ ] Кнопка "Начать" на последнем экране

---

## 5. Phase 2: Book Library

**Срок:** Неделя 4-5
**Цель:** Импорт, хранение и отображение книг

### Task 2.1: Book SwiftData Model

**Приоритет:** P0 | **Оценка:** 2h | **Зависимости:** 0.6

**Полная модель:** См. Task 0.6

**Дополнительно:**
- Индексы для быстрого поиска
- Computed properties для UI

**Критерии готовности:**
- [ ] Модель сохраняется/загружается
- [ ] Relationships работают

---

### Task 2.2: Library Grid/List View

**Приоритет:** P0 | **Оценка:** 6h | **Зависимости:** 2.1

**Файлы:**
- `Features/Library/Views/LibraryView.swift`
- `Features/Library/Views/BookGridItem.swift`
- `Features/Library/Views/BookListItem.swift`
- `Features/Library/ViewModels/LibraryViewModel.swift`

**LibraryView.swift:**
```swift
struct LibraryView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Book.lastOpenedAt, order: .reverse) private var books: [Book]
    @State private var viewMode: ViewMode = .grid
    @State private var searchText = ""
    
    var body: some View {
        NavigationStack {
            Group {
                if books.isEmpty {
                    EmptyLibraryView()
                } else {
                    switch viewMode {
                    case .grid:
                        bookGrid
                    case .list:
                        bookList
                    }
                }
            }
            .navigationTitle("Библиотека")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Picker("Вид", selection: $viewMode) {
                            Label("Сетка", systemImage: "square.grid.2x2").tag(ViewMode.grid)
                            Label("Список", systemImage: "list.bullet").tag(ViewMode.list)
                        }
                    } label: {
                        Image(systemName: viewMode == .grid ? "square.grid.2x2" : "list.bullet")
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Поиск книг")
        }
    }
    
    private var bookGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 16) {
                ForEach(filteredBooks) { book in
                    NavigationLink(destination: BookDetailView(book: book)) {
                        BookGridItem(book: book)
                    }
                }
            }
            .padding()
        }
    }
}
```

**Критерии готовности:**
- [ ] Grid view с обложками
- [ ] List view с деталями
- [ ] Переключение режимов
- [ ] Поиск работает

---

### Task 2.3: Document Picker

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 2.1

**Features/Library/Views/DocumentPickerView.swift:**
```swift
import SwiftUI
import UniformTypeIdentifiers

struct DocumentPickerView: UIViewControllerRepresentable {
    let onPick: (URL) -> Void
    
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let types: [UTType] = [
            UTType(filenameExtension: "epub")!,
            UTType(filenameExtension: "fb2")!
        ]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types)
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        return picker
    }
    
    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(onPick: onPick)
    }
    
    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: (URL) -> Void
        
        init(onPick: @escaping (URL) -> Void) {
            self.onPick = onPick
        }
        
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            
            // Start accessing security-scoped resource
            guard url.startAccessingSecurityScopedResource() else { return }
            defer { url.stopAccessingSecurityScopedResource() }
            
            onPick(url)
        }
    }
}
```

**Критерии готовности:**
- [ ] Открывается Files.app
- [ ] Фильтрация по .epub/.fb2
- [ ] Файл копируется в Documents

---

### Task 2.4: Share Extension

**Приоритет:** P1 | **Оценка:** 6h | **Зависимости:** 2.3

**Шаги:**
1. File → New → Target → Share Extension
2. Настроить NSExtensionActivationRule для epub/fb2
3. Shared App Group для передачи данных
4. Уведомление основного приложения

**Критерии готовности:**
- [ ] "Открыть в fancai" в Share Sheet
- [ ] Книга появляется в библиотеке

---

### Task 2.5: EPUB Parsing (Metadata)

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 0.4 (Readium)

**Features/Library/Services/EPUBParser.swift:**
```swift
import ReadiumShared
import ReadiumStreamer

class EPUBParser {
    private let streamer = Streamer()
    
    func parseMetadata(from url: URL) async throws -> BookMetadata {
        let asset = FileAsset(url: url)
        let publication = try await streamer.open(asset: asset, allowUserInteraction: false)
        
        let metadata = publication.metadata
        
        return BookMetadata(
            title: metadata.title ?? url.lastPathComponent,
            author: metadata.authors.first?.name,
            description: metadata.description,
            language: metadata.languages.first,
            publisher: metadata.publishers.first?.name,
            coverData: try? await extractCover(from: publication)
        )
    }
    
    private func extractCover(from publication: Publication) async throws -> Data? {
        guard let coverLink = publication.linkWithRel(.cover) ?? publication.coverLink else {
            return nil
        }
        let resource = publication.get(coverLink)
        return try await resource?.read().get()
    }
}
```

**Критерии готовности:**
- [ ] Название и автор извлекаются
- [ ] Обложка извлекается
- [ ] Работает для разных EPUB файлов

---

### Task 2.6: FB2 Parsing (Metadata)

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** Нет

**Features/Library/Services/FB2Parser.swift:**
```swift
import Foundation

class FB2Parser {
    func parseMetadata(from url: URL) throws -> BookMetadata {
        let data = try Data(contentsOf: url)
        let xml = try XMLDocument(data: data)
        
        let titleInfo = xml.rootElement()?.elements(forName: "description")
            .first?.elements(forName: "title-info").first
        
        let title = titleInfo?.elements(forName: "book-title").first?.stringValue
        let author = extractAuthor(from: titleInfo)
        let coverData = extractCover(from: xml)
        
        return BookMetadata(
            title: title ?? url.lastPathComponent,
            author: author,
            description: titleInfo?.elements(forName: "annotation").first?.stringValue,
            language: titleInfo?.elements(forName: "lang").first?.stringValue,
            publisher: nil,
            coverData: coverData
        )
    }
    
    private func extractAuthor(from titleInfo: XMLElement?) -> String? {
        guard let author = titleInfo?.elements(forName: "author").first else { return nil }
        let firstName = author.elements(forName: "first-name").first?.stringValue ?? ""
        let lastName = author.elements(forName: "last-name").first?.stringValue ?? ""
        return "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces)
    }
}
```

**Критерии готовности:**
- [ ] Парсинг Windows-1251 кодировки
- [ ] Извлечение base64 обложки
- [ ] Обработка невалидного XML

---

### Task 2.7: Cover Extraction

**Приоритет:** P1 | **Оценка:** 3h | **Зависимости:** 2.5, 2.6

**Fallback стратегия:**
1. Из файла книги (EPUB/FB2)
2. Google Books API
3. Open Library API
4. Placeholder image

**Критерии готовности:**
- [ ] Обложка из файла извлекается
- [ ] Fallback на API поиск
- [ ] Placeholder для книг без обложки

---

### Task 2.8: Book Detail Page

**Приоритет:** P0 | **Оценка:** 6h | **Зависимости:** 2.1

**Features/Library/Views/BookDetailView.swift:**

Секции:
1. Hero — обложка, название, автор
2. Прогресс — процент, время чтения
3. Описание — аннотация
4. Метаданные — издательство, год, ISBN
5. Действия — Читать, Удалить

**Критерии готовности:**
- [ ] Все поля отображаются
- [ ] "Читать" открывает Reader
- [ ] "Удалить" с подтверждением

---

### Task 2.9-2.12: Поиск, Сортировка, Удаление, Коллекции

**Приоритет:** P1 | **Оценка:** 14h | **Зависимости:** 2.2

См. полные спецификации в `ios-book-library-features.md`

---

## Продолжение

> **Следующие фазы:** См. `DEVELOPMENT_PLAN_PART3.md`
