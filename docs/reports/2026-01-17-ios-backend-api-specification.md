# Спецификация Backend API для iOS-приложения fancai

**Дата:** 2026-01-17
**Scope:** FastAPI endpoints, Swift client, Pydantic schemas
**Автор:** Claude Code

---

## 1. Общая архитектура

### 1.1 URL-структура

```
https://api.fancai.ru/v1/...
```

### 1.2 Версионирование

| Версия | Статус | Поддержка |
|--------|--------|-----------|
| v1 | Active | Текущая |

---

## 2. Аутентификация

### 2.1 Endpoints

| Method | Path | Описание |
|--------|------|----------|
| POST | `/v1/auth/apple` | Sign in with Apple |
| POST | `/v1/auth/google` | Google Sign-In |
| POST | `/v1/auth/telegram` | Telegram Login |
| POST | `/v1/auth/refresh` | Обновление токена |
| POST | `/v1/auth/logout` | Выход |
| DELETE | `/v1/auth/account` | Удаление аккаунта |

### 2.2 Схемы

```python
# Backend (Pydantic)
from pydantic import BaseModel, EmailStr
from datetime import datetime

class AppleAuthRequest(BaseModel):
    identity_token: str
    authorization_code: str
    user_identifier: str
    email: EmailStr | None = None
    full_name: str | None = None

class GoogleAuthRequest(BaseModel):
    id_token: str

class TelegramAuthRequest(BaseModel):
    auth_data: dict
    hash: str

class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_at: datetime
    user: "UserProfile"

class UserProfile(BaseModel):
    id: str
    email: str | None
    name: str | None
    avatar_url: str | None
    subscription_tier: str  # "free" | "pro"
    created_at: datetime
```

```swift
// iOS (Swift)
struct AppleAuthRequest: Encodable {
    let identityToken: String
    let authorizationCode: String
    let userIdentifier: String
    let email: String?
    let fullName: String?
}

struct AuthResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let user: UserProfile
}

struct UserProfile: Decodable {
    let id: String
    let email: String?
    let name: String?
    let avatarUrl: URL?
    let subscriptionTier: String
    let createdAt: Date
}
```

---

## 3. Профиль пользователя

### 3.1 Endpoints

| Method | Path | Описание |
|--------|------|----------|
| GET | `/v1/profile` | Получить профиль |
| PATCH | `/v1/profile` | Обновить профиль |
| GET | `/v1/profile/data-export` | Экспорт данных (GDPR) |

### 3.2 Схемы

```python
class ProfileUpdateRequest(BaseModel):
    name: str | None = None
    avatar_url: str | None = None
    reading_goal_pages: int | None = None
    reading_goal_minutes: int | None = None
    notification_settings: dict | None = None

class DataExportResponse(BaseModel):
    download_url: str
    expires_at: datetime
```

---

## 4. Книги и библиотека

### 4.1 Endpoints

| Method | Path | Описание |
|--------|------|----------|
| GET | `/v1/books` | Список книг пользователя (metadata) |
| POST | `/v1/books` | Регистрация новой книги |
| GET | `/v1/books/{book_id}` | Детали книги |
| PATCH | `/v1/books/{book_id}` | Обновление метаданных |
| DELETE | `/v1/books/{book_id}` | Удаление книги |
| GET | `/v1/books/{book_id}/position` | Позиция чтения |
| PUT | `/v1/books/{book_id}/position` | Сохранение позиции |

### 4.2 Схемы

```python
class BookRegistration(BaseModel):
    file_hash: str
    title: str
    author: str | None = None
    format: str  # "epub" | "fb2"
    file_size: int
    page_count: int | None = None

class BookResponse(BaseModel):
    id: str
    file_hash: str
    title: str
    author: str | None
    cover_url: str | None
    format: str
    progress: float  # 0.0 - 1.0
    last_opened_at: datetime | None
    is_finished: bool
    created_at: datetime

class ReadingPosition(BaseModel):
    cfi: str
    progress: float
    chapter: int | None = None
    page: int | None = None
    updated_at: datetime
```

```swift
struct BookRegistration: Encodable {
    let fileHash: String
    let title: String
    let author: String?
    let format: String
    let fileSize: Int
    let pageCount: Int?
}

struct BookResponse: Decodable {
    let id: String
    let fileHash: String
    let title: String
    let author: String?
    let coverUrl: URL?
    let format: String
    let progress: Double
    let lastOpenedAt: Date?
    let isFinished: Bool
    let createdAt: Date
}
```

---

## 5. AI-функции

### 5.1 Endpoints

| Method | Path | Описание |
|--------|------|----------|
| POST | `/v1/ai/extract` | Извлечение описаний |
| POST | `/v1/ai/generate` | Генерация изображения |
| GET | `/v1/ai/generations` | История генераций |
| GET | `/v1/ai/limits` | Лимиты и квоты |

### 5.2 Схемы

```python
class ExtractionRequest(BaseModel):
    book_id: str
    text_fragment: str
    entity_type: str  # "character" | "location" | "scene"
    entity_name: str | None = None

class ExtractionResponse(BaseModel):
    request_id: str
    status: str  # "processing" | "completed" | "failed"
    description: str | None = None
    visual_tags: list[str] = []

class GenerationRequest(BaseModel):
    book_id: str
    entity_id: str
    prompt: str
    style: str  # "realistic" | "illustrated" | "anime"
    reference_image_ids: list[str] = []

class GenerationResponse(BaseModel):
    generation_id: str
    status: str  # "queued" | "processing" | "completed" | "failed"
    image_url: str | None = None
    thumbnail_url: str | None = None
    created_at: datetime

class AILimits(BaseModel):
    tier: str
    daily_generations_limit: int
    daily_generations_used: int
    monthly_generations_limit: int
    monthly_generations_used: int
    reset_at: datetime
```

```swift
struct GenerationRequest: Encodable {
    let bookId: String
    let entityId: String
    let prompt: String
    let style: String
    let referenceImageIds: [String]
}

struct GenerationResponse: Decodable {
    let generationId: String
    let status: String
    let imageUrl: URL?
    let thumbnailUrl: URL?
    let createdAt: Date
}

struct AILimits: Decodable {
    let tier: String
    let dailyGenerationsLimit: Int
    let dailyGenerationsUsed: Int
    let monthlyGenerationsLimit: Int
    let monthlyGenerationsUsed: Int
    let resetAt: Date
}
```

---

## 6. Подписки

### 6.1 Endpoints

| Method | Path | Описание |
|--------|------|----------|
| GET | `/v1/subscription` | Статус подписки |
| POST | `/v1/subscription/verify` | Верификация покупки |
| POST | `/v1/subscription/restore` | Восстановление покупок |

### 6.2 Схемы

```python
class SubscriptionStatus(BaseModel):
    tier: str  # "free" | "pro"
    is_active: bool
    expires_at: datetime | None
    auto_renew: bool
    product_id: str | None
    original_transaction_id: str | None

class PurchaseVerification(BaseModel):
    transaction_id: str
    product_id: str
    receipt_data: str  # Base64

class VerificationResponse(BaseModel):
    success: bool
    tier: str
    expires_at: datetime | None
    message: str | None = None
```

---

## 7. Статистика и достижения

### 7.1 Endpoints

| Method | Path | Описание |
|--------|------|----------|
| POST | `/v1/stats/sessions` | Отправка сессии чтения |
| GET | `/v1/stats/summary` | Сводная статистика |
| GET | `/v1/stats/weekly` | Недельная статистика |
| GET | `/v1/achievements` | Список достижений |
| GET | `/v1/achievements/check` | Проверка новых достижений |

### 7.2 Схемы

```python
class ReadingSession(BaseModel):
    book_id: str
    started_at: datetime
    ended_at: datetime
    pages_read: int
    start_progress: float
    end_progress: float

class StatsSummary(BaseModel):
    total_books_read: int
    total_pages_read: int
    total_reading_time_minutes: int
    current_streak: int
    longest_streak: int
    books_this_year: int
    pages_this_month: int
    average_pages_per_day: float

class Achievement(BaseModel):
    id: str
    name: str
    description: str
    icon_name: str
    tier: str  # "bronze" | "silver" | "gold"
    unlocked: bool
    unlocked_at: datetime | None
    progress: float | None  # 0.0 - 1.0
    target: int | None
```

```swift
struct ReadingSession: Encodable {
    let bookId: String
    let startedAt: Date
    let endedAt: Date
    let pagesRead: Int
    let startProgress: Double
    let endProgress: Double
}

struct StatsSummary: Decodable {
    let totalBooksRead: Int
    let totalPagesRead: Int
    let totalReadingTimeMinutes: Int
    let currentStreak: Int
    let longestStreak: Int
    let booksThisYear: Int
    let pagesThisMonth: Int
    let averagePagesPerDay: Double
}

struct Achievement: Decodable {
    let id: String
    let name: String
    let description: String
    let iconName: String
    let tier: String
    let unlocked: Bool
    let unlockedAt: Date?
    let progress: Double?
    let target: Int?
}
```

---

## 8. Отзывы и рейтинги

### 8.1 Endpoints

| Method | Path | Описание |
|--------|------|----------|
| GET | `/v1/books/{book_hash}/reviews` | Отзывы на книгу |
| POST | `/v1/books/{book_hash}/reviews` | Создать отзыв |
| PUT | `/v1/books/{book_hash}/reviews/{id}` | Обновить отзыв |
| DELETE | `/v1/books/{book_hash}/reviews/{id}` | Удалить отзыв |
| POST | `/v1/reviews/{id}/report` | Пожаловаться |
| POST | `/v1/books/{book_hash}/rating` | Поставить рейтинг |

### 8.2 Схемы

```python
class ReviewCreate(BaseModel):
    rating: int  # 1-5
    title: str | None = None
    content: str
    contains_spoilers: bool = False

class ReviewResponse(BaseModel):
    id: str
    user_id: str
    user_name: str
    user_avatar_url: str | None
    rating: int
    title: str | None
    content: str
    contains_spoilers: bool
    helpful_count: int
    created_at: datetime

class BookRatingStats(BaseModel):
    book_hash: str
    average_rating: float
    total_ratings: int
    distribution: dict[int, int]  # {1: count, 2: count, ...}
```

---

## 9. Коллекции

### 9.1 Endpoints

| Method | Path | Описание |
|--------|------|----------|
| GET | `/v1/collections` | Мои коллекции |
| POST | `/v1/collections` | Создать коллекцию |
| GET | `/v1/collections/{id}` | Детали коллекции |
| PATCH | `/v1/collections/{id}` | Обновить коллекцию |
| DELETE | `/v1/collections/{id}` | Удалить коллекцию |
| POST | `/v1/collections/{id}/books` | Добавить книгу |
| DELETE | `/v1/collections/{id}/books/{book_id}` | Удалить книгу |
| GET | `/v1/collections/public/{share_id}` | Публичная коллекция |

### 9.2 Схемы

```python
class CollectionCreate(BaseModel):
    name: str
    description: str | None = None
    is_public: bool = False
    icon: str | None = None
    color: str | None = None

class CollectionResponse(BaseModel):
    id: str
    share_id: str | None  # Для публичных
    name: str
    description: str | None
    is_public: bool
    icon: str | None
    color: str | None
    book_count: int
    created_at: datetime
    updated_at: datetime
```

---

## 10. Push-уведомления

### 10.1 Endpoints

| Method | Path | Описание |
|--------|------|----------|
| POST | `/v1/devices` | Регистрация устройства |
| DELETE | `/v1/devices/{token}` | Удаление устройства |
| PATCH | `/v1/devices/{token}/settings` | Настройки уведомлений |

### 10.2 Схемы

```python
class DeviceRegistration(BaseModel):
    token: str
    platform: str  # "ios"
    app_version: str
    os_version: str
    device_model: str
    locale: str

class NotificationSettings(BaseModel):
    reading_reminders: bool = True
    goal_achievements: bool = True
    new_features: bool = True
    marketing: bool = False
```

---

## 11. Рекомендации

### 11.1 Endpoints

| Method | Path | Описание |
|--------|------|----------|
| GET | `/v1/recommendations` | Персональные рекомендации |
| GET | `/v1/recommendations/similar/{book_hash}` | Похожие книги |
| POST | `/v1/recommendations/feedback` | Обратная связь |

### 11.2 Схемы

```python
class Recommendation(BaseModel):
    book_hash: str
    title: str
    author: str | None
    cover_url: str | None
    reason: str
    score: float
    source: str  # "content" | "collaborative" | "trending"

class RecommendationFeedback(BaseModel):
    book_hash: str
    action: str  # "interested" | "not_interested" | "already_read"
```

---

## 12. Swift API Client

### 12.1 Базовый клиент

```swift
import Foundation

// MARK: - API Client

actor APIClient {
    static let shared = APIClient()

    private let baseURL = URL(string: "https://api.fancai.ru/v1")!
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60

        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601

        self.encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
    }

    // MARK: - Request

    func request<T: Decodable>(
        endpoint: Endpoint,
        responseType: T.Type
    ) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(endpoint.path))
        request.httpMethod = endpoint.method

        // Headers
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token = try? await KeychainManager.shared.loadToken(forKey: "accessToken") {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // Body
        if let body = endpoint.body {
            request.httpBody = try encoder.encode(body)
        }

        // Execute
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        // Handle errors
        switch httpResponse.statusCode {
        case 200...299:
            return try decoder.decode(T.self, from: data)
        case 401:
            throw APIError.unauthorized
        case 403:
            throw APIError.forbidden
        case 404:
            throw APIError.notFound
        case 429:
            throw APIError.rateLimited
        default:
            let errorResponse = try? decoder.decode(ErrorResponse.self, from: data)
            throw APIError.serverError(
                code: httpResponse.statusCode,
                message: errorResponse?.message
            )
        }
    }
}

// MARK: - Endpoint

struct Endpoint {
    let path: String
    let method: String
    let body: Encodable?

    // Auth
    static func authApple(_ request: AppleAuthRequest) -> Endpoint {
        Endpoint(path: "auth/apple", method: "POST", body: request)
    }

    static var profile: Endpoint {
        Endpoint(path: "profile", method: "GET", body: nil)
    }

    // AI
    static func generateImage(_ request: GenerationRequest) -> Endpoint {
        Endpoint(path: "ai/generate", method: "POST", body: request)
    }

    static var aiLimits: Endpoint {
        Endpoint(path: "ai/limits", method: "GET", body: nil)
    }

    // Stats
    static func postSession(_ session: ReadingSession) -> Endpoint {
        Endpoint(path: "stats/sessions", method: "POST", body: session)
    }

    static var statsSummary: Endpoint {
        Endpoint(path: "stats/summary", method: "GET", body: nil)
    }

    // Subscription
    static var subscription: Endpoint {
        Endpoint(path: "subscription", method: "GET", body: nil)
    }
}

// MARK: - Errors

enum APIError: LocalizedError {
    case invalidResponse
    case unauthorized
    case forbidden
    case notFound
    case rateLimited
    case serverError(code: Int, message: String?)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Некорректный ответ сервера"
        case .unauthorized: return "Требуется авторизация"
        case .forbidden: return "Доступ запрещён"
        case .notFound: return "Не найдено"
        case .rateLimited: return "Слишком много запросов"
        case .serverError(_, let message): return message ?? "Ошибка сервера"
        }
    }
}

struct ErrorResponse: Decodable {
    let message: String
    let code: String?
}
```

---

## 13. Rate Limits

| Tier | Requests/min | AI Generations/day |
|------|--------------|-------------------|
| Free | 60 | 5 |
| Pro | 300 | 50 |

---

## 14. Pagination

```python
class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    has_next: bool
```

```swift
struct PaginatedResponse<T: Decodable>: Decodable {
    let items: [T]
    let total: Int
    let page: Int
    let pageSize: Int
    let hasNext: Bool
}
```

---

## Источники

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Pydantic Models](https://docs.pydantic.dev/)
- [Apple URLSession](https://developer.apple.com/documentation/foundation/urlsession)
