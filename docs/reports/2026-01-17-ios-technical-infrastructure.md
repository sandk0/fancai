# Техническая инфраструктура: DI, Logging, Security, Crash Reporting

**Дата:** 2026-01-17
**Scope:** Dependency Injection, OSLog, Keychain, CryptoKit, Certificate Pinning, Crashlytics/Sentry
**Автор:** Claude Code

---

## 1. Dependency Injection

### 1.1 Сравнение подходов

| Подход | Плюсы | Минусы | Применение |
|--------|-------|--------|------------|
| **@Environment** | Нативный SwiftUI, простой | Только для Views | Глобальные настройки |
| **Factory** | Compile-time safe, легковесный | Дополнительная зависимость | ✅ **Рекомендуется** |
| **Swinject** | Мощный, гибкий | Сложный, runtime errors | Большие проекты |
| **Manual DI** | Без зависимостей | Много boilerplate | Небольшие проекты |

### 1.2 Рекомендация для fancai: Factory

```swift
// Package.swift
.package(url: "https://github.com/hmlongco/Factory", from: "2.3.0")
```

### 1.3 Настройка Factory

```swift
import Factory

// MARK: - Container Extension

extension Container {
    // Repositories
    var bookRepository: Factory<BookRepositoryProtocol> {
        Factory(self) { BookRepository() }
            .singleton // Один экземпляр на всё приложение
    }

    var readingStatsRepository: Factory<ReadingStatsRepositoryProtocol> {
        Factory(self) { ReadingStatsRepository() }
            .singleton
    }

    // Services
    var aiService: Factory<AIServiceProtocol> {
        Factory(self) { GoogleAIService() }
            .singleton
    }

    var authService: Factory<AuthServiceProtocol> {
        Factory(self) { AuthService() }
            .singleton
    }

    // Scoped dependencies
    var imageCache: Factory<ImageCacheProtocol> {
        Factory(self) { ImageCache(maxSize: 100_000_000) } // 100MB
            .shared // Shared пока есть хотя бы одна ссылка
    }
}
```

### 1.4 Использование в Views

```swift
import SwiftUI
import Factory

struct LibraryView: View {
    @Injected(\.bookRepository) private var bookRepository

    @State private var books: [Book] = []

    var body: some View {
        List(books) { book in
            BookRow(book: book)
        }
        .task {
            books = try? await bookRepository.fetchAll() ?? []
        }
    }
}
```

### 1.5 Использование в ViewModels

```swift
import Foundation
import Factory

@Observable
class LibraryViewModel {
    @ObservationIgnored
    @Injected(\.bookRepository) private var repository

    @ObservationIgnored
    @Injected(\.aiService) private var aiService

    var books: [Book] = []
    var isLoading = false
    var error: Error?

    func loadBooks() async {
        isLoading = true
        defer { isLoading = false }

        do {
            books = try await repository.fetchAll()
        } catch {
            self.error = error
        }
    }
}
```

### 1.6 Моки для тестов и Preview

```swift
import Factory

// MARK: - Mock Registration

#if DEBUG
extension Container {
    static func registerMocks() {
        shared.bookRepository.register { MockBookRepository() }
        shared.aiService.register { MockAIService() }
    }
}
#endif

// SwiftUI Preview
#Preview {
    let _ = Container.shared.bookRepository.register { MockBookRepository() }
    return LibraryView()
}
```

---

## 2. Logging (OSLog)

### 2.1 Настройка Logger

```swift
import OSLog

// MARK: - Logger Extensions

extension Logger {
    private static let subsystem = Bundle.main.bundleIdentifier ?? "ru.fancai.app"

    // Категории логирования
    static let general = Logger(subsystem: subsystem, category: "general")
    static let network = Logger(subsystem: subsystem, category: "network")
    static let database = Logger(subsystem: subsystem, category: "database")
    static let ai = Logger(subsystem: subsystem, category: "ai")
    static let auth = Logger(subsystem: subsystem, category: "auth")
    static let reader = Logger(subsystem: subsystem, category: "reader")
    static let sync = Logger(subsystem: subsystem, category: "sync")
}
```

### 2.2 Использование

```swift
import OSLog

class BookLoader {
    func load(from url: URL) async throws -> Book {
        Logger.reader.info("Loading book from: \(url.lastPathComponent)")

        do {
            let data = try Data(contentsOf: url)
            Logger.reader.debug("Book data size: \(data.count) bytes")

            let book = try parseBook(data)
            Logger.reader.notice("Book loaded successfully: \(book.title)")

            return book
        } catch {
            Logger.reader.error("Failed to load book: \(error.localizedDescription)")
            throw error
        }
    }
}
```

### 2.3 Уровни логирования

| Уровень | Метод | Использование | Persistence |
|---------|-------|---------------|-------------|
| Debug | `.debug()` | Детальная отладка | Memory only |
| Info | `.info()` | Общая информация | Memory only |
| Notice | `.notice()` | Важные события | Disk |
| Error | `.error()` | Ошибки | Disk |
| Fault | `.fault()` | Критические ошибки | Disk + persistence |

### 2.4 Privacy и Redaction

```swift
// Чувствительные данные автоматически скрываются
Logger.auth.info("User logged in: \(userEmail, privacy: .private)")
Logger.network.debug("Request to: \(url, privacy: .public)")

// Хеширование для анализа без раскрытия данных
Logger.database.info("Book hash: \(bookId, privacy: .private(mask: .hash))")
```

---

## 3. Crash Reporting

### 3.1 Сравнение

| Критерий | Firebase Crashlytics | Sentry |
|----------|----------------------|--------|
| **Цена** | Бесплатно | Бесплатно базовый, от $26/мес |
| **Фокус** | Только crashes | Crashes + errors + performance |
| **Интеграции** | Firebase ecosystem | Jira, GitHub, Slack |
| **Swift поддержка** | Хорошая | Отличная (части SDK на Swift) |
| **AI features** | Группировка, скоро fix suggestions | Intelligent issue grouping |
| **Performance** | Нет | App Hang Detection, profiling |

### 3.2 Рекомендация: Firebase Crashlytics

Для MVP рекомендуется Crashlytics — бесплатный и достаточный функционал.

### 3.3 Настройка Crashlytics

```swift
// AppDelegate.swift
import UIKit
import FirebaseCore
import FirebaseCrashlytics

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        FirebaseApp.configure()

        // Включение/выключение по согласию пользователя
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(true)

        return true
    }
}
```

### 3.4 Кастомные логи и ключи

```swift
import FirebaseCrashlytics

// MARK: - Crash Reporter Helper

enum CrashReporter {
    static func setUserId(_ userId: String) {
        Crashlytics.crashlytics().setUserID(userId)
    }

    static func log(_ message: String) {
        Crashlytics.crashlytics().log(message)
    }

    static func setCustomKey(_ key: String, value: String) {
        Crashlytics.crashlytics().setCustomValue(value, forKey: key)
    }

    static func recordError(_ error: Error, userInfo: [String: Any]? = nil) {
        Crashlytics.crashlytics().record(error: error, userInfo: userInfo)
    }
}

// Использование
class BookLoader {
    func load(from url: URL) async throws -> Book {
        CrashReporter.log("Loading book: \(url.lastPathComponent)")
        CrashReporter.setCustomKey("currentBook", value: url.lastPathComponent)

        do {
            return try await loadBookInternal(from: url)
        } catch {
            CrashReporter.recordError(error, userInfo: [
                "bookURL": url.absoluteString
            ])
            throw error
        }
    }
}
```

---

## 4. Security

### 4.1 Keychain

#### Wrapper для удобства

```swift
import Foundation
import Security

// MARK: - Keychain Manager

actor KeychainManager {
    static let shared = KeychainManager()

    private let service = "ru.fancai.app"

    enum KeychainError: Error {
        case itemNotFound
        case duplicateItem
        case unexpectedStatus(OSStatus)
        case encodingError
        case decodingError
    }

    // MARK: - Save

    func save(_ data: Data, forKey key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        // Удаляем существующий элемент
        SecItemDelete(query as CFDictionary)

        let status = SecItemAdd(query as CFDictionary, nil)

        guard status == errSecSuccess else {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    // MARK: - Load

    func load(forKey key: String) throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            if status == errSecItemNotFound {
                throw KeychainError.itemNotFound
            }
            throw KeychainError.unexpectedStatus(status)
        }

        guard let data = result as? Data else {
            throw KeychainError.decodingError
        }

        return data
    }

    // MARK: - Delete

    func delete(forKey key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}

// MARK: - Typed Extensions

extension KeychainManager {
    func saveToken(_ token: String, forKey key: String) async throws {
        guard let data = token.data(using: .utf8) else {
            throw KeychainError.encodingError
        }
        try save(data, forKey: key)
    }

    func loadToken(forKey key: String) async throws -> String {
        let data = try load(forKey: key)
        guard let token = String(data: data, encoding: .utf8) else {
            throw KeychainError.decodingError
        }
        return token
    }
}
```

#### Использование

```swift
// Сохранение токена
try await KeychainManager.shared.saveToken(accessToken, forKey: "accessToken")
try await KeychainManager.shared.saveToken(refreshToken, forKey: "refreshToken")

// Загрузка токена
let token = try await KeychainManager.shared.loadToken(forKey: "accessToken")

// Удаление при logout
try await KeychainManager.shared.delete(forKey: "accessToken")
try await KeychainManager.shared.delete(forKey: "refreshToken")
```

### 4.2 CryptoKit

```swift
import CryptoKit
import Foundation

// MARK: - Encryption Service

struct EncryptionService {
    private let key: SymmetricKey

    init() throws {
        // Пытаемся загрузить ключ из Keychain
        if let existingKey = try? loadKeyFromKeychain() {
            self.key = existingKey
        } else {
            // Генерируем новый ключ
            self.key = SymmetricKey(size: .bits256)
            try saveKeyToKeychain(key)
        }
    }

    // MARK: - Encrypt

    func encrypt(_ data: Data) throws -> Data {
        let sealedBox = try AES.GCM.seal(data, using: key)
        guard let combined = sealedBox.combined else {
            throw EncryptionError.encryptionFailed
        }
        return combined
    }

    // MARK: - Decrypt

    func decrypt(_ data: Data) throws -> Data {
        let sealedBox = try AES.GCM.SealedBox(combined: data)
        return try AES.GCM.open(sealedBox, using: key)
    }

    // MARK: - Hash

    static func hash(_ string: String) -> String {
        let data = Data(string.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Private

    private func loadKeyFromKeychain() throws -> SymmetricKey? {
        let data = try KeychainManager.shared.load(forKey: "encryptionKey")
        return SymmetricKey(data: data)
    }

    private func saveKeyToKeychain(_ key: SymmetricKey) throws {
        let keyData = key.withUnsafeBytes { Data($0) }
        try KeychainManager.shared.save(keyData, forKey: "encryptionKey")
    }

    enum EncryptionError: Error {
        case encryptionFailed
    }
}
```

### 4.3 Certificate Pinning

```swift
import Foundation

// MARK: - Certificate Pinning Delegate

class PinnedSessionDelegate: NSObject, URLSessionDelegate {
    // SHA256 hash публичного ключа сервера
    private let pinnedPublicKeyHashes: Set<String> = [
        "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=", // Primary
        "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC="  // Backup
    ]

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Проверяем цепочку сертификатов
        var error: CFError?
        guard SecTrustEvaluateWithError(serverTrust, &error) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Получаем публичный ключ
        guard let certificate = SecTrustGetCertificateAtIndex(serverTrust, 0),
              let publicKey = SecCertificateCopyKey(certificate),
              let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Вычисляем hash
        let hash = sha256(data: publicKeyData)
        let hashBase64 = hash.base64EncodedString()

        // Проверяем пиннинг
        if pinnedPublicKeyHashes.contains(hashBase64) {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    private func sha256(data: Data) -> Data {
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes {
            _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash)
        }
        return Data(hash)
    }
}

// Использование
let delegate = PinnedSessionDelegate()
let session = URLSession(
    configuration: .default,
    delegate: delegate,
    delegateQueue: nil
)
```

### 4.4 Альтернатива: Alamofire Pinning

```swift
import Alamofire

// MARK: - Alamofire Certificate Pinning

let evaluators: [String: ServerTrustEvaluating] = [
    "api.fancai.ru": PublicKeysTrustEvaluator()
]

let session = Session(
    serverTrustManager: ServerTrustManager(evaluators: evaluators)
)
```

---

## 5. Чеклист безопасности

| Пункт | Статус |
|-------|--------|
| Токены хранятся в Keychain | ⬜ |
| Чувствительные данные шифруются | ⬜ |
| Certificate Pinning для API | ⬜ |
| Логи не содержат PII в production | ⬜ |
| Crashlytics не отправляет PII | ⬜ |
| ATS включён (HTTPS only) | ⬜ |
| Биометрия для авторизации | ⬜ |
| Jailbreak detection (опционально) | ⬜ |

---

## Источники

- [Factory — GitHub](https://github.com/hmlongco/Factory)
- [Apple OSLog Documentation](https://developer.apple.com/documentation/os/logging)
- [Apple Security Documentation](https://developer.apple.com/documentation/security)
- [Apple CryptoKit](https://developer.apple.com/documentation/cryptokit)
- [Firebase Crashlytics](https://firebase.google.com/docs/crashlytics)
