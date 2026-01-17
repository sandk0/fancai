# Спецификация отзывов, рейтингов и AI-рекомендаций для fancai

**Дата:** 2026-01-17
**Scope:** Отзывы и рейтинги книг, система AI-рекомендаций
**Автор:** Claude Code

---

## 1. Система рейтингов книг

### 1.1 Модель данных

```swift
import SwiftData
import Foundation

// MARK: - Rating Model

@Model
final class BookRating {
    @Attribute(.unique) var id: UUID
    var bookId: String // ID книги (hash файла или UUID)
    var userId: String
    var rating: Int // 1-5 звёзд
    var createdAt: Date
    var updatedAt: Date

    init(bookId: String, userId: String, rating: Int) {
        self.id = UUID()
        self.bookId = bookId
        self.userId = userId
        self.rating = max(1, min(5, rating)) // Ограничение 1-5
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

// MARK: - Rating Statistics

struct BookRatingStats: Codable {
    let bookId: String
    let averageRating: Double // 0.0 - 5.0
    let totalRatings: Int
    let distribution: [Int: Int] // [1: count, 2: count, ...]

    var formattedRating: String {
        String(format: "%.1f", averageRating)
    }
}
```

### 1.2 SwiftUI реализация рейтинга

```swift
import SwiftUI

// MARK: - Star Rating View (Interactive)

struct StarRatingView: View {
    @Binding var rating: Int
    var maxRating: Int = 5
    var size: CGFloat = 24
    var spacing: CGFloat = 4
    var isEditable: Bool = true

    var body: some View {
        HStack(spacing: spacing) {
            ForEach(1...maxRating, id: \.self) { index in
                Image(systemName: index <= rating ? "star.fill" : "star")
                    .font(.system(size: size))
                    .foregroundStyle(index <= rating ? .yellow : .gray.opacity(0.3))
                    .onTapGesture {
                        if isEditable {
                            withAnimation(.easeInOut(duration: 0.1)) {
                                rating = index
                            }
                            // Haptic feedback
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        }
                    }
            }
        }
        .sensoryFeedback(.selection, trigger: rating)
    }
}

// MARK: - Average Rating Display

struct AverageRatingView: View {
    let stats: BookRatingStats

    var body: some View {
        HStack(spacing: 8) {
            // Число рейтинга
            Text(stats.formattedRating)
                .font(.title.bold())

            // Звёзды (нередактируемые)
            HStack(spacing: 2) {
                ForEach(1...5, id: \.self) { index in
                    Image(systemName: starType(for: index))
                        .font(.caption)
                        .foregroundStyle(.yellow)
                }
            }

            // Количество оценок
            Text("(\(stats.totalRatings))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func starType(for index: Int) -> String {
        let rating = stats.averageRating
        if Double(index) <= rating {
            return "star.fill"
        } else if Double(index) - 0.5 <= rating {
            return "star.leadinghalf.filled"
        } else {
            return "star"
        }
    }
}

// MARK: - Rating Distribution Chart

struct RatingDistributionView: View {
    let stats: BookRatingStats

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach((1...5).reversed(), id: \.self) { stars in
                HStack(spacing: 8) {
                    // Число звёзд
                    Text("\(stars)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 12)

                    // Иконка звезды
                    Image(systemName: "star.fill")
                        .font(.caption2)
                        .foregroundStyle(.yellow)

                    // Прогресс-бар
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color.gray.opacity(0.2))

                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color.yellow)
                                .frame(width: barWidth(for: stars, in: geometry.size.width))
                        }
                    }
                    .frame(height: 8)

                    // Количество
                    Text("\(stats.distribution[stars] ?? 0)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(width: 30, alignment: .trailing)
                }
            }
        }
    }

    private func barWidth(for stars: Int, in totalWidth: CGFloat) -> CGFloat {
        guard stats.totalRatings > 0 else { return 0 }
        let count = stats.distribution[stars] ?? 0
        let percentage = Double(count) / Double(stats.totalRatings)
        return totalWidth * percentage
    }
}
```

---

## 2. Система отзывов

### 2.1 Модель данных

```swift
import SwiftData
import Foundation

// MARK: - Review Model

@Model
final class BookReview {
    @Attribute(.unique) var id: UUID
    var bookId: String
    var userId: String
    var userName: String
    var userAvatarURL: URL?
    var rating: Int // 1-5, обязательно
    var title: String? // Заголовок отзыва (опционально)
    var content: String // Текст отзыва
    var createdAt: Date
    var updatedAt: Date

    // Модерация
    var status: ReviewStatus
    var reportCount: Int
    var isHidden: Bool

    // Метрики
    var helpfulCount: Int
    var notHelpfulCount: Int

    init(
        bookId: String,
        userId: String,
        userName: String,
        rating: Int,
        content: String,
        title: String? = nil
    ) {
        self.id = UUID()
        self.bookId = bookId
        self.userId = userId
        self.userName = userName
        self.rating = rating
        self.title = title
        self.content = content
        self.createdAt = Date()
        self.updatedAt = Date()
        self.status = .pending // На модерации сначала
        self.reportCount = 0
        self.isHidden = false
        self.helpfulCount = 0
        self.notHelpfulCount = 0
    }
}

enum ReviewStatus: String, Codable {
    case pending = "pending"       // На модерации
    case approved = "approved"     // Одобрено
    case rejected = "rejected"     // Отклонено
    case flagged = "flagged"       // Помечено после жалоб
}

// MARK: - Review Report

@Model
final class ReviewReport {
    @Attribute(.unique) var id: UUID
    var reviewId: UUID
    var reporterId: String
    var reason: ReportReason
    var details: String?
    var createdAt: Date

    init(reviewId: UUID, reporterId: String, reason: ReportReason, details: String? = nil) {
        self.id = UUID()
        self.reviewId = reviewId
        self.reporterId = reporterId
        self.reason = reason
        self.details = details
        self.createdAt = Date()
    }
}

enum ReportReason: String, Codable, CaseIterable {
    case spam = "Спам"
    case offensive = "Оскорбительный контент"
    case spoiler = "Спойлеры без предупреждения"
    case harassment = "Преследование"
    case misinformation = "Ложная информация"
    case other = "Другое"
}
```

### 2.2 Ограничения и валидация

```swift
struct ReviewValidation {
    // Ограничения
    static let minContentLength = 20
    static let maxContentLength = 2000
    static let maxTitleLength = 100

    // Валидация
    static func validate(content: String, title: String?) -> [String] {
        var errors: [String] = []

        // Длина контента
        if content.count < minContentLength {
            errors.append("Отзыв должен содержать минимум \(minContentLength) символов")
        }
        if content.count > maxContentLength {
            errors.append("Отзыв не должен превышать \(maxContentLength) символов")
        }

        // Заголовок
        if let title = title, title.count > maxTitleLength {
            errors.append("Заголовок не должен превышать \(maxTitleLength) символов")
        }

        return errors
    }

    // Фильтрация нежелательного контента (клиентская сторона)
    static func containsProfanity(_ text: String) -> Bool {
        // Простая проверка на клиенте, основная модерация на сервере
        let profanityPatterns: [String] = [] // Заполняется на сервере
        return profanityPatterns.contains { text.lowercased().contains($0) }
    }
}
```

### 2.3 SwiftUI реализация отзывов

```swift
import SwiftUI

// MARK: - Review Card

struct ReviewCard: View {
    let review: BookReview
    var onHelpful: (() -> Void)?
    var onReport: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Заголовок с пользователем
            HStack(spacing: 12) {
                // Аватар
                AsyncImage(url: review.userAvatarURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Circle().fill(Color.gray.opacity(0.3))
                }
                .frame(width: 40, height: 40)
                .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(review.userName)
                        .font(.subheadline.bold())

                    HStack(spacing: 4) {
                        // Рейтинг
                        ForEach(1...5, id: \.self) { i in
                            Image(systemName: i <= review.rating ? "star.fill" : "star")
                                .font(.caption2)
                                .foregroundStyle(i <= review.rating ? .yellow : .gray.opacity(0.3))
                        }

                        Text("•")
                            .foregroundStyle(.secondary)

                        Text(review.createdAt.formatted(.relative(presentation: .named)))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                // Меню действий
                Menu {
                    Button("Пожаловаться", systemImage: "flag") {
                        onReport?()
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .foregroundStyle(.secondary)
                }
            }

            // Заголовок отзыва
            if let title = review.title {
                Text(title)
                    .font(.headline)
            }

            // Текст отзыва
            Text(review.content)
                .font(.body)
                .lineLimit(5)

            // Полезность
            HStack(spacing: 16) {
                Button {
                    onHelpful?()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "hand.thumbsup")
                        Text("Полезно (\(review.helpfulCount))")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Write Review Sheet

struct WriteReviewSheet: View {
    @Environment(\.dismiss) private var dismiss

    let bookTitle: String
    let onSubmit: (Int, String?, String) -> Void

    @State private var rating = 0
    @State private var title = ""
    @State private var content = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // Книга
                    Text(bookTitle)
                        .font(.headline)
                        .foregroundStyle(.secondary)

                    // Рейтинг
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Ваша оценка")
                            .font(.subheadline.bold())

                        StarRatingView(rating: $rating, size: 32)
                    }

                    // Заголовок (опционально)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Заголовок (необязательно)")
                            .font(.subheadline.bold())

                        TextField("Например: Отличная книга!", text: $title)
                            .textFieldStyle(.roundedBorder)
                    }

                    // Текст отзыва
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Ваш отзыв")
                                .font(.subheadline.bold())

                            Spacer()

                            Text("\(content.count)/\(ReviewValidation.maxContentLength)")
                                .font(.caption)
                                .foregroundStyle(content.count > ReviewValidation.maxContentLength ? .red : .secondary)
                        }

                        TextEditor(text: $content)
                            .frame(minHeight: 150)
                            .padding(8)
                            .background(Color(.secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    // Ошибка
                    if let error = errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    // Предупреждение о модерации
                    Label("Отзыв будет проверен модератором перед публикацией", systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
            .navigationTitle("Написать отзыв")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button("Отправить") {
                        submitReview()
                    }
                    .disabled(!canSubmit || isSubmitting)
                }
            }
        }
    }

    private var canSubmit: Bool {
        rating > 0 &&
        content.count >= ReviewValidation.minContentLength &&
        content.count <= ReviewValidation.maxContentLength
    }

    private func submitReview() {
        let errors = ReviewValidation.validate(content: content, title: title.isEmpty ? nil : title)
        if !errors.isEmpty {
            errorMessage = errors.first
            return
        }

        isSubmitting = true
        onSubmit(rating, title.isEmpty ? nil : title, content)
        dismiss()
    }
}

// MARK: - Report Review Sheet

struct ReportReviewSheet: View {
    @Environment(\.dismiss) private var dismiss

    let onReport: (ReportReason, String?) -> Void

    @State private var selectedReason: ReportReason?
    @State private var details = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Причина жалобы") {
                    ForEach(ReportReason.allCases, id: \.self) { reason in
                        Button {
                            selectedReason = reason
                        } label: {
                            HStack {
                                Text(reason.rawValue)
                                    .foregroundStyle(.primary)

                                Spacer()

                                if selectedReason == reason {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(.blue)
                                }
                            }
                        }
                    }
                }

                if selectedReason == .other {
                    Section("Подробности") {
                        TextField("Опишите проблему...", text: $details, axis: .vertical)
                            .lineLimit(3...6)
                    }
                }
            }
            .navigationTitle("Жалоба на отзыв")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button("Отправить") {
                        if let reason = selectedReason {
                            onReport(reason, details.isEmpty ? nil : details)
                            dismiss()
                        }
                    }
                    .disabled(selectedReason == nil)
                }
            }
        }
    }
}
```

### 2.4 Модерация (Backend)

```python
# backend/services/moderation.py

from enum import Enum
from datetime import datetime
from typing import Optional
import re

from google.cloud import language_v2
from pydantic import BaseModel

class ModerationResult(BaseModel):
    approved: bool
    reason: Optional[str] = None
    confidence: float
    flags: list[str] = []

class ContentModerator:
    """Сервис модерации отзывов"""

    def __init__(self):
        self.client = language_v2.LanguageServiceClient()
        self.blocked_patterns = self._load_blocked_patterns()

    def moderate_review(self, content: str, title: Optional[str] = None) -> ModerationResult:
        """Модерация отзыва"""
        flags = []

        # 1. Проверка на запрещённые паттерны
        text = f"{title or ''} {content}"
        if self._contains_blocked_content(text):
            return ModerationResult(
                approved=False,
                reason="Обнаружен запрещённый контент",
                confidence=1.0,
                flags=["blocked_content"]
            )

        # 2. Google Natural Language API - анализ токсичности
        toxicity_score = self._analyze_toxicity(text)
        if toxicity_score > 0.7:
            flags.append("high_toxicity")
            return ModerationResult(
                approved=False,
                reason="Высокий уровень токсичности",
                confidence=toxicity_score,
                flags=flags
            )

        # 3. Проверка на спам
        if self._is_spam(content):
            flags.append("spam")
            return ModerationResult(
                approved=False,
                reason="Обнаружен спам",
                confidence=0.9,
                flags=flags
            )

        # 4. Автоматическое одобрение если всё ок
        return ModerationResult(
            approved=True,
            confidence=1.0 - toxicity_score,
            flags=flags
        )

    def _analyze_toxicity(self, text: str) -> float:
        """Анализ токсичности через Google NLP API"""
        document = language_v2.Document(
            content=text,
            type_=language_v2.Document.Type.PLAIN_TEXT,
            language_code="ru"
        )

        try:
            response = self.client.moderate_text(
                request={"document": document}
            )

            # Находим максимальный score среди категорий
            max_score = 0.0
            for category in response.moderation_categories:
                if category.confidence > max_score:
                    max_score = category.confidence

            return max_score
        except Exception:
            return 0.0

    def _contains_blocked_content(self, text: str) -> bool:
        """Проверка на запрещённые паттерны"""
        text_lower = text.lower()
        for pattern in self.blocked_patterns:
            if re.search(pattern, text_lower):
                return True
        return False

    def _is_spam(self, content: str) -> bool:
        """Проверка на спам"""
        # Повторяющиеся символы
        if re.search(r'(.)\1{5,}', content):
            return True

        # Слишком много заглавных букв
        upper_ratio = sum(1 for c in content if c.isupper()) / max(len(content), 1)
        if upper_ratio > 0.7:
            return True

        # Ссылки
        if re.search(r'https?://|www\.', content):
            return True

        return False

    def _load_blocked_patterns(self) -> list[str]:
        """Загрузка паттернов из конфига"""
        return []  # Загружается из конфига
```

---

## 3. AI-рекомендации книг

### 3.1 Подходы к рекомендациям

| Метод | Описание | Применение |
|-------|----------|------------|
| **Content-Based** | Анализ контента книги (жанр, автор, темы) | Основной метод |
| **Collaborative Filtering** | На основе оценок похожих пользователей | При достаточном количестве пользователей |
| **LLM Embeddings** | Семантические эмбеддинги текста книги | Для "похожих книг" |
| **Hybrid** | Комбинация методов | Оптимальный подход |

### 3.2 Архитектура рекомендательной системы

```
┌─────────────────────────────────────────────────────────────────┐
│                    fancai Recommendation System                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐     │
│  │   Content    │  │Collaborative │  │   LLM Embeddings   │     │
│  │   Based      │  │  Filtering   │  │  (text-embedding)  │     │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘     │
│         │                 │                     │                │
│         └────────────┬────┴─────────────────────┘                │
│                      │                                           │
│              ┌───────▼───────┐                                   │
│              │ Hybrid Ranker │                                   │
│              └───────┬───────┘                                   │
│                      │                                           │
│              ┌───────▼───────┐                                   │
│              │   Re-Ranker   │  (personalization)                │
│              └───────┬───────┘                                   │
│                      │                                           │
│              ┌───────▼───────┐                                   │
│              │  Diversity    │  (избегаем однообразия)           │
│              │    Filter     │                                   │
│              └───────┬───────┘                                   │
│                      │                                           │
│                      ▼                                           │
│              [ Рекомендации ]                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Backend реализация

```python
# backend/services/recommendations.py

from dataclasses import dataclass
from typing import Optional
import numpy as np
from google import genai
from pgvector.sqlalchemy import Vector
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

@dataclass
class BookForRecommendation:
    id: str
    title: str
    author: str
    genres: list[str]
    description: str
    embedding: Optional[list[float]] = None

@dataclass
class RecommendationResult:
    book_id: str
    score: float
    reason: str
    source: str  # 'content', 'collaborative', 'embedding'

class RecommendationService:
    """Сервис рекомендаций книг"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = genai.Client()

    async def get_similar_books(
        self,
        book_id: str,
        limit: int = 10
    ) -> list[RecommendationResult]:
        """Получить похожие книги по содержанию"""

        # 1. Получаем книгу
        book = await self._get_book(book_id)
        if not book:
            return []

        results = []

        # 2. Content-based: по жанру и автору
        content_results = await self._content_based_recommendations(book, limit)
        results.extend(content_results)

        # 3. Embedding-based: семантическое сходство
        if book.embedding:
            embedding_results = await self._embedding_based_recommendations(
                book.embedding, book_id, limit
            )
            results.extend(embedding_results)

        # 4. Объединяем и ранжируем
        ranked = self._hybrid_ranking(results, limit)

        return ranked

    async def get_personalized_recommendations(
        self,
        user_id: str,
        limit: int = 10
    ) -> list[RecommendationResult]:
        """Персонализированные рекомендации для пользователя"""

        results = []

        # 1. Получаем историю пользователя
        user_books = await self._get_user_read_books(user_id)
        user_ratings = await self._get_user_ratings(user_id)

        if not user_books:
            # Cold start: популярные книги
            return await self._get_popular_books(limit)

        # 2. Collaborative filtering (если достаточно данных)
        cf_results = await self._collaborative_filtering(user_id, limit)
        results.extend(cf_results)

        # 3. Content-based на основе прочитанных
        for book_id, rating in user_ratings.items():
            if rating >= 4:  # Только высоко оценённые
                similar = await self.get_similar_books(book_id, limit=3)
                for rec in similar:
                    rec.score *= (rating / 5)  # Взвешиваем по оценке
                    results.append(rec)

        # 4. Ранжируем и фильтруем уже прочитанные
        ranked = self._hybrid_ranking(results, limit)
        filtered = [r for r in ranked if r.book_id not in user_books]

        return filtered[:limit]

    async def _content_based_recommendations(
        self,
        book: BookForRecommendation,
        limit: int
    ) -> list[RecommendationResult]:
        """Рекомендации на основе контента"""

        results = []

        # Книги того же автора
        author_books = await self._get_books_by_author(book.author, exclude=book.id)
        for b in author_books[:3]:
            results.append(RecommendationResult(
                book_id=b.id,
                score=0.9,
                reason=f"Другие книги автора {book.author}",
                source="content"
            ))

        # Книги того же жанра
        if book.genres:
            genre_books = await self._get_books_by_genre(
                book.genres[0],
                exclude=book.id
            )
            for b in genre_books[:5]:
                results.append(RecommendationResult(
                    book_id=b.id,
                    score=0.7,
                    reason=f"Похожий жанр: {book.genres[0]}",
                    source="content"
                ))

        return results

    async def _embedding_based_recommendations(
        self,
        embedding: list[float],
        exclude_book_id: str,
        limit: int
    ) -> list[RecommendationResult]:
        """Рекомендации на основе эмбеддингов"""

        # Поиск ближайших соседей в векторной БД
        # Используем pgvector для PostgreSQL

        query = """
            SELECT id, title, 1 - (embedding <=> $1::vector) as similarity
            FROM books
            WHERE id != $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3
        """

        # Выполняем запрос
        rows = await self.db.execute(query, [embedding, exclude_book_id, limit])

        results = []
        for row in rows:
            results.append(RecommendationResult(
                book_id=row.id,
                score=float(row.similarity),
                reason="Семантически похожая книга",
                source="embedding"
            ))

        return results

    async def _collaborative_filtering(
        self,
        user_id: str,
        limit: int
    ) -> list[RecommendationResult]:
        """Collaborative filtering"""

        # Находим похожих пользователей по оценкам
        query = """
            WITH user_ratings AS (
                SELECT book_id, rating FROM ratings WHERE user_id = $1
            ),
            similar_users AS (
                SELECT r.user_id, COUNT(*) as common_books,
                       AVG(ABS(r.rating - ur.rating)) as rating_diff
                FROM ratings r
                JOIN user_ratings ur ON r.book_id = ur.book_id
                WHERE r.user_id != $1
                GROUP BY r.user_id
                HAVING COUNT(*) >= 3
                ORDER BY rating_diff ASC, common_books DESC
                LIMIT 20
            )
            SELECT r.book_id, AVG(r.rating) as avg_rating,
                   COUNT(*) as rating_count
            FROM ratings r
            JOIN similar_users su ON r.user_id = su.user_id
            WHERE r.book_id NOT IN (SELECT book_id FROM user_ratings)
              AND r.rating >= 4
            GROUP BY r.book_id
            ORDER BY avg_rating DESC, rating_count DESC
            LIMIT $2
        """

        rows = await self.db.execute(query, [user_id, limit])

        results = []
        for row in rows:
            results.append(RecommendationResult(
                book_id=row.book_id,
                score=float(row.avg_rating) / 5,
                reason="Понравилась похожим читателям",
                source="collaborative"
            ))

        return results

    async def generate_book_embedding(self, book: BookForRecommendation) -> list[float]:
        """Генерация эмбеддинга книги через Gemini"""

        # Формируем текст для эмбеддинга
        text = f"""
        Название: {book.title}
        Автор: {book.author}
        Жанры: {', '.join(book.genres)}
        Описание: {book.description[:1000]}
        """

        # Gemini Embedding API
        response = await self.client.models.embed_content(
            model="text-embedding-004",
            content=text
        )

        return response.embedding

    def _hybrid_ranking(
        self,
        results: list[RecommendationResult],
        limit: int
    ) -> list[RecommendationResult]:
        """Гибридное ранжирование результатов"""

        # Группируем по book_id
        book_scores: dict[str, list[RecommendationResult]] = {}
        for r in results:
            if r.book_id not in book_scores:
                book_scores[r.book_id] = []
            book_scores[r.book_id].append(r)

        # Вычисляем финальный score
        final_results = []
        for book_id, recs in book_scores.items():
            # Веса для источников
            weights = {
                'embedding': 0.4,
                'content': 0.3,
                'collaborative': 0.3
            }

            weighted_score = sum(
                r.score * weights.get(r.source, 0.2)
                for r in recs
            )

            # Берём лучший reason
            best_rec = max(recs, key=lambda x: x.score)

            final_results.append(RecommendationResult(
                book_id=book_id,
                score=weighted_score,
                reason=best_rec.reason,
                source="hybrid"
            ))

        # Сортируем и возвращаем топ
        final_results.sort(key=lambda x: x.score, reverse=True)

        # Добавляем разнообразие (не более 2 книг одного автора)
        diverse_results = self._add_diversity(final_results)

        return diverse_results[:limit]

    def _add_diversity(
        self,
        results: list[RecommendationResult]
    ) -> list[RecommendationResult]:
        """Добавление разнообразия в результаты"""
        # Реализация фильтрации дубликатов по автору
        return results
```

### 3.4 iOS клиент для рекомендаций

```swift
import SwiftUI

// MARK: - Recommendations View

struct RecommendationsView: View {
    @State private var recommendations: [BookRecommendation] = []
    @State private var isLoading = true

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                if isLoading {
                    ProgressView()
                        .padding()
                } else {
                    ForEach(recommendations) { rec in
                        RecommendationCard(recommendation: rec)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Рекомендации")
        .task {
            await loadRecommendations()
        }
    }

    private func loadRecommendations() async {
        // API call
        isLoading = false
    }
}

struct RecommendationCard: View {
    let recommendation: BookRecommendation

    var body: some View {
        HStack(spacing: 12) {
            // Обложка
            AsyncImage(url: recommendation.coverURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color.gray.opacity(0.3)
            }
            .frame(width: 60, height: 90)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 4) {
                Text(recommendation.title)
                    .font(.headline)
                    .lineLimit(2)

                Text(recommendation.author)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                // Причина рекомендации
                Label(recommendation.reason, systemImage: "sparkles")
                    .font(.caption)
                    .foregroundStyle(.blue)
            }

            Spacer()
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Models

struct BookRecommendation: Identifiable {
    let id: String
    let title: String
    let author: String
    let coverURL: URL?
    let reason: String
    let score: Double
}
```

---

## 4. Требования App Store

### 4.1 Требования к UGC (User-Generated Content)

| Требование | Реализация в fancai |
|------------|---------------------|
| Фильтрация нежелательного контента | AI-модерация + ручная проверка |
| Механизм жалоб | Кнопка "Пожаловаться" на отзывах |
| Блокировка пользователей | Возможность заблокировать пользователя |
| Контактная информация | Email в настройках приложения |

### 4.2 Приватность

- Отзывы **не содержат** личных данных (только имя пользователя)
- Рейтинги **анонимизированы** в агрегированной статистике
- GDPR: возможность удаления всех отзывов при удалении аккаунта

---

## 5. Приоритеты реализации

### MVP (Phase 1)
| Функция | Приоритет |
|---------|-----------|
| Рейтинги книг (1-5 звёзд) | P0 |
| Просмотр среднего рейтинга | P0 |

### Post-MVP (Phase 2)
| Функция | Приоритет |
|---------|-----------|
| Написание отзывов | P1 |
| Модерация отзывов | P1 |
| AI-рекомендации (content-based) | P1 |

### Future (Phase 3+)
| Функция | Приоритет |
|---------|-----------|
| Collaborative filtering | P2 |
| Embedding-based рекомендации | P2 |
| Персонализация рекомендаций | P2 |

---

## Источники

- [Apple App Store Review Guidelines - UGC](https://developer.apple.com/app-store/review/guidelines/#user-generated-content)
- [Google Cloud Natural Language API](https://cloud.google.com/natural-language)
- [Gemini Embedding API](https://ai.google.dev/gemini-api/docs/embeddings)
- [pgvector - PostgreSQL Vector Extension](https://github.com/pgvector/pgvector)
- [Recommender Systems Handbook](https://link.springer.com/book/10.1007/978-1-0716-2197-4)
