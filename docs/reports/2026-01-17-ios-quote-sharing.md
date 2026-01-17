# Спецификация шеринга цитат и изображений для fancai

**Дата:** 2026-01-17
**Scope:** Шеринг цитат из книг, дизайн карточек, социальные сети
**Автор:** Claude Code

---

## 1. Обзор функционала

### 1.1 Виды шеринга

| Тип | Описание | Формат |
|-----|----------|--------|
| **Цитата из книги** | Выделенный текст + информация о книге | Изображение-карточка |
| **AI-изображение** | Сгенерированное изображение + описание | Изображение + watermark |
| **Коллекция** | Публичная полка с книгами | Deep Link |

### 1.2 Target-платформы

| Платформа | Размеры | Формат |
|-----------|---------|--------|
| **Instagram Stories** | 1080 × 1920 (9:16) | PNG/JPG |
| **Instagram Feed** | 1080 × 1080 (1:1) | PNG/JPG |
| **Telegram** | Любой | PNG/JPG |
| **Twitter/X** | 1200 × 675 (16:9) | PNG/JPG |
| **Универсальный** | 1200 × 630 | PNG/JPG |

---

## 2. Ограничения цитат

### 2.1 Длина цитаты

| Параметр | Значение |
|----------|----------|
| **Минимальная длина** | 10 символов |
| **Максимальная длина** | 500 символов |
| **Рекомендуемая длина** | 100-200 символов |

### 2.2 Правила

```swift
struct QuoteLimits {
    static let minLength = 10
    static let maxLength = 500
    static let recommendedMaxLength = 200

    // Предупреждения
    static func validate(_ text: String) -> QuoteValidationResult {
        let length = text.count

        if length < minLength {
            return .tooShort
        }

        if length > maxLength {
            return .tooLong
        }

        if length > recommendedMaxLength {
            return .longButAllowed
        }

        return .valid
    }
}

enum QuoteValidationResult {
    case valid
    case tooShort
    case tooLong
    case longButAllowed // Предупреждение

    var message: String? {
        switch self {
        case .tooShort:
            return "Цитата слишком короткая"
        case .tooLong:
            return "Максимум 500 символов"
        case .longButAllowed:
            return "Длинные цитаты могут быть менее читаемыми"
        case .valid:
            return nil
        }
    }
}
```

---

## 3. Шаблоны дизайна карточек

### 3.1 Предустановленные шаблоны

| Шаблон | Стиль | Описание |
|--------|-------|----------|
| **Classic** | Минималистичный | Белый фон, чёрный текст, кавычки |
| **Dark Mode** | Тёмный | Тёмный фон, светлый текст |
| **Literary** | Книжный | Бумажная текстура, serif шрифт |
| **Gradient** | Современный | Цветной градиент, sans-serif |
| **Vintage** | Ретро | Сепия, состаренный эффект |
| **Neon** | Яркий | Тёмный фон, неоновые акценты |

### 3.2 Элементы карточки

```
┌─────────────────────────────────────────────────┐
│                                                 │
│               [Фон / Градиент]                  │
│                                                 │
│     ┌─────────────────────────────────────┐     │
│     │                                     │     │
│     │          ❝                          │     │
│     │     [Текст цитаты на               │     │
│     │      несколько строк,              │     │
│     │      красивый шрифт]               │     │
│     │                          ❞         │     │
│     │                                     │     │
│     │     — Автор                        │     │
│     │       «Название книги»              │     │
│     │                                     │     │
│     └─────────────────────────────────────┘     │
│                                                 │
│     ┌─────────┐                                 │
│     │ [Cover] │  [fancai logo]                  │
│     └─────────┘                                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 3.3 Конфигурация шаблонов

```swift
import SwiftUI

// MARK: - Quote Card Template

struct QuoteCardTemplate: Identifiable {
    let id: String
    let name: String
    let backgroundColor: Color
    let backgroundGradient: LinearGradient?
    let textColor: Color
    let accentColor: Color
    let fontFamily: String
    let quoteFontSize: CGFloat
    let authorFontSize: CGFloat
    let showQuoteMarks: Bool
    let showBookCover: Bool
    let showAppLogo: Bool
    let cornerRadius: CGFloat
    let padding: EdgeInsets

    static let templates: [QuoteCardTemplate] = [
        // 1. Classic
        QuoteCardTemplate(
            id: "classic",
            name: "Классика",
            backgroundColor: .white,
            backgroundGradient: nil,
            textColor: .black,
            accentColor: .gray,
            fontFamily: "Georgia",
            quoteFontSize: 24,
            authorFontSize: 16,
            showQuoteMarks: true,
            showBookCover: true,
            showAppLogo: true,
            cornerRadius: 0,
            padding: EdgeInsets(top: 60, leading: 40, bottom: 60, trailing: 40)
        ),

        // 2. Dark Mode
        QuoteCardTemplate(
            id: "dark",
            name: "Тёмная",
            backgroundColor: Color(white: 0.1),
            backgroundGradient: nil,
            textColor: .white,
            accentColor: .gray,
            fontFamily: "SF Pro Display",
            quoteFontSize: 24,
            authorFontSize: 16,
            showQuoteMarks: true,
            showBookCover: true,
            showAppLogo: true,
            cornerRadius: 0,
            padding: EdgeInsets(top: 60, leading: 40, bottom: 60, trailing: 40)
        ),

        // 3. Literary (Книжный)
        QuoteCardTemplate(
            id: "literary",
            name: "Книжный",
            backgroundColor: Color(red: 0.97, green: 0.94, blue: 0.89),
            backgroundGradient: nil,
            textColor: Color(red: 0.2, green: 0.15, blue: 0.1),
            accentColor: Color(red: 0.6, green: 0.5, blue: 0.4),
            fontFamily: "Palatino",
            quoteFontSize: 22,
            authorFontSize: 15,
            showQuoteMarks: true,
            showBookCover: true,
            showAppLogo: true,
            cornerRadius: 0,
            padding: EdgeInsets(top: 60, leading: 40, bottom: 60, trailing: 40)
        ),

        // 4. Gradient (Современный)
        QuoteCardTemplate(
            id: "gradient",
            name: "Градиент",
            backgroundColor: .clear,
            backgroundGradient: LinearGradient(
                colors: [
                    Color(red: 0.4, green: 0.3, blue: 0.9),
                    Color(red: 0.8, green: 0.3, blue: 0.5)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            textColor: .white,
            accentColor: .white.opacity(0.7),
            fontFamily: "SF Pro Display",
            quoteFontSize: 24,
            authorFontSize: 16,
            showQuoteMarks: false,
            showBookCover: true,
            showAppLogo: true,
            cornerRadius: 20,
            padding: EdgeInsets(top: 60, leading: 40, bottom: 60, trailing: 40)
        ),

        // 5. Vintage (Ретро)
        QuoteCardTemplate(
            id: "vintage",
            name: "Винтаж",
            backgroundColor: Color(red: 0.93, green: 0.88, blue: 0.78),
            backgroundGradient: nil,
            textColor: Color(red: 0.3, green: 0.25, blue: 0.2),
            accentColor: Color(red: 0.5, green: 0.45, blue: 0.35),
            fontFamily: "Baskerville",
            quoteFontSize: 22,
            authorFontSize: 15,
            showQuoteMarks: true,
            showBookCover: true,
            showAppLogo: true,
            cornerRadius: 0,
            padding: EdgeInsets(top: 60, leading: 40, bottom: 60, trailing: 40)
        ),

        // 6. Neon (Яркий)
        QuoteCardTemplate(
            id: "neon",
            name: "Неон",
            backgroundColor: Color(red: 0.05, green: 0.05, blue: 0.15),
            backgroundGradient: nil,
            textColor: .white,
            accentColor: Color(red: 0.0, green: 1.0, blue: 0.8),
            fontFamily: "SF Pro Display",
            quoteFontSize: 24,
            authorFontSize: 16,
            showQuoteMarks: false,
            showBookCover: true,
            showAppLogo: true,
            cornerRadius: 0,
            padding: EdgeInsets(top: 60, leading: 40, bottom: 60, trailing: 40)
        )
    ]
}
```

---

## 4. SwiftUI реализация генерации карточек

### 4.1 Quote Card View

```swift
import SwiftUI

// MARK: - Quote Card Data

struct QuoteCardData {
    let quote: String
    let authorName: String
    let bookTitle: String
    let bookCoverURL: URL?
}

// MARK: - Quote Card View (для рендеринга)

struct QuoteCardView: View {
    let data: QuoteCardData
    let template: QuoteCardTemplate
    let size: CGSize

    var body: some View {
        ZStack {
            // Фон
            if let gradient = template.backgroundGradient {
                gradient
            } else {
                template.backgroundColor
            }

            VStack(spacing: 24) {
                Spacer()

                // Кавычки открытия
                if template.showQuoteMarks {
                    Text("❝")
                        .font(.system(size: 48))
                        .foregroundStyle(template.accentColor)
                }

                // Текст цитаты
                Text(data.quote)
                    .font(.custom(template.fontFamily, size: scaledFontSize(template.quoteFontSize)))
                    .foregroundStyle(template.textColor)
                    .multilineTextAlignment(.center)
                    .lineSpacing(8)
                    .padding(.horizontal, template.padding.leading)

                // Кавычки закрытия
                if template.showQuoteMarks {
                    Text("❞")
                        .font(.system(size: 48))
                        .foregroundStyle(template.accentColor)
                }

                // Автор и книга
                VStack(spacing: 4) {
                    Text("— \(data.authorName)")
                        .font(.custom(template.fontFamily, size: scaledFontSize(template.authorFontSize)))
                        .fontWeight(.medium)
                        .foregroundStyle(template.textColor)

                    Text("«\(data.bookTitle)»")
                        .font(.custom(template.fontFamily, size: scaledFontSize(template.authorFontSize - 2)))
                        .foregroundStyle(template.accentColor)
                        .italic()
                }

                Spacer()

                // Нижняя панель
                HStack(alignment: .bottom, spacing: 16) {
                    // Обложка книги
                    if template.showBookCover, let coverURL = data.bookCoverURL {
                        AsyncImage(url: coverURL) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Color.gray.opacity(0.3)
                        }
                        .frame(width: 50, height: 75)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .shadow(radius: 4)
                    }

                    Spacer()

                    // Логотип приложения
                    if template.showAppLogo {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("fancai")
                                .font(.system(size: 16, weight: .bold, design: .rounded))
                                .foregroundStyle(template.accentColor)

                            Text("Читай с AI")
                                .font(.system(size: 10))
                                .foregroundStyle(template.accentColor.opacity(0.7))
                        }
                    }
                }
                .padding(.horizontal, template.padding.leading)
                .padding(.bottom, template.padding.bottom)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: template.cornerRadius))
    }

    private func scaledFontSize(_ baseSize: CGFloat) -> CGFloat {
        // Масштабирование шрифта в зависимости от длины цитаты
        let length = data.quote.count
        if length > 300 {
            return baseSize * 0.8
        } else if length > 200 {
            return baseSize * 0.9
        }
        return baseSize
    }
}

// MARK: - Preview

#Preview {
    QuoteCardView(
        data: QuoteCardData(
            quote: "Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему.",
            authorName: "Лев Толстой",
            bookTitle: "Анна Каренина",
            bookCoverURL: nil
        ),
        template: QuoteCardTemplate.templates[0],
        size: CGSize(width: 1080, height: 1920)
    )
    .scaleEffect(0.3)
}
```

### 4.2 Image Renderer (генерация изображения)

```swift
import SwiftUI
import UIKit

// MARK: - Quote Card Generator

@MainActor
class QuoteCardGenerator {
    static let shared = QuoteCardGenerator()

    // Размеры для разных платформ
    enum ExportSize {
        case instagramStory   // 1080 × 1920
        case instagramFeed    // 1080 × 1080
        case twitter          // 1200 × 675
        case universal        // 1200 × 630

        var size: CGSize {
            switch self {
            case .instagramStory:
                return CGSize(width: 1080, height: 1920)
            case .instagramFeed:
                return CGSize(width: 1080, height: 1080)
            case .twitter:
                return CGSize(width: 1200, height: 675)
            case .universal:
                return CGSize(width: 1200, height: 630)
            }
        }
    }

    /// Генерация изображения карточки с цитатой
    func generateQuoteCard(
        data: QuoteCardData,
        template: QuoteCardTemplate,
        exportSize: ExportSize = .instagramStory
    ) -> UIImage? {
        let view = QuoteCardView(
            data: data,
            template: template,
            size: exportSize.size
        )

        let renderer = ImageRenderer(content: view)

        // Высокое разрешение для Retina
        renderer.scale = 3.0

        return renderer.uiImage
    }

    /// Сохранение в Photo Library
    func saveToPhotos(
        data: QuoteCardData,
        template: QuoteCardTemplate,
        exportSize: ExportSize = .instagramStory
    ) async throws {
        guard let image = generateQuoteCard(
            data: data,
            template: template,
            exportSize: exportSize
        ) else {
            throw QuoteCardError.generationFailed
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
            continuation.resume()
        }
    }

    /// Share Sheet
    func shareCard(
        data: QuoteCardData,
        template: QuoteCardTemplate,
        exportSize: ExportSize = .instagramStory
    ) -> UIImage? {
        return generateQuoteCard(data: data, template: template, exportSize: exportSize)
    }
}

enum QuoteCardError: LocalizedError {
    case generationFailed

    var errorDescription: String? {
        switch self {
        case .generationFailed:
            return "Не удалось создать изображение"
        }
    }
}
```

### 4.3 Share Quote Sheet (UI)

```swift
import SwiftUI

struct ShareQuoteSheet: View {
    @Environment(\.dismiss) private var dismiss

    let quote: String
    let authorName: String
    let bookTitle: String
    let bookCoverURL: URL?

    @State private var selectedTemplate: QuoteCardTemplate = QuoteCardTemplate.templates[0]
    @State private var selectedSize: QuoteCardGenerator.ExportSize = .instagramStory
    @State private var isSharing = false
    @State private var isSaving = false
    @State private var showSuccess = false

    private var cardData: QuoteCardData {
        QuoteCardData(
            quote: quote,
            authorName: authorName,
            bookTitle: bookTitle,
            bookCoverURL: bookCoverURL
        )
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Превью карточки
                    QuoteCardView(
                        data: cardData,
                        template: selectedTemplate,
                        size: selectedSize.size
                    )
                    .frame(width: 270, height: previewHeight)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(radius: 8)

                    // Выбор шаблона
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Стиль")
                            .font(.headline)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(QuoteCardTemplate.templates) { template in
                                    TemplatePreviewButton(
                                        template: template,
                                        isSelected: template.id == selectedTemplate.id
                                    ) {
                                        selectedTemplate = template
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal)

                    // Выбор размера
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Формат")
                            .font(.headline)

                        HStack(spacing: 12) {
                            SizeButton(title: "Stories", icon: "rectangle.portrait", size: .instagramStory, selected: $selectedSize)
                            SizeButton(title: "Квадрат", icon: "square", size: .instagramFeed, selected: $selectedSize)
                            SizeButton(title: "Twitter", icon: "rectangle", size: .twitter, selected: $selectedSize)
                        }
                    }
                    .padding(.horizontal)

                    // Кнопки действий
                    VStack(spacing: 12) {
                        // Поделиться
                        Button {
                            shareCard()
                        } label: {
                            Label("Поделиться", systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)

                        // Сохранить
                        Button {
                            saveToPhotos()
                        } label: {
                            Label("Сохранить в Фото", systemImage: "arrow.down.circle")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical)
            }
            .navigationTitle("Поделиться цитатой")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Готово") {
                        dismiss()
                    }
                }
            }
            .overlay {
                if showSuccess {
                    SuccessOverlay()
                }
            }
        }
    }

    private var previewHeight: CGFloat {
        switch selectedSize {
        case .instagramStory:
            return 480
        case .instagramFeed:
            return 270
        case .twitter:
            return 152
        case .universal:
            return 142
        }
    }

    private func shareCard() {
        guard let image = QuoteCardGenerator.shared.shareCard(
            data: cardData,
            template: selectedTemplate,
            exportSize: selectedSize
        ) else { return }

        let activityVC = UIActivityViewController(
            activityItems: [image],
            applicationActivities: nil
        )

        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first,
           let rootVC = window.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }

    private func saveToPhotos() {
        Task {
            isSaving = true
            do {
                try await QuoteCardGenerator.shared.saveToPhotos(
                    data: cardData,
                    template: selectedTemplate,
                    exportSize: selectedSize
                )
                showSuccess = true
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()

                try await Task.sleep(for: .seconds(1.5))
                showSuccess = false
            } catch {
                // Handle error
            }
            isSaving = false
        }
    }
}

// MARK: - Supporting Views

struct TemplatePreviewButton: View {
    let template: QuoteCardTemplate
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                ZStack {
                    if let gradient = template.backgroundGradient {
                        gradient
                    } else {
                        template.backgroundColor
                    }

                    Text("Aa")
                        .font(.custom(template.fontFamily, size: 20))
                        .foregroundStyle(template.textColor)
                }
                .frame(width: 60, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 3)
                )

                Text(template.name)
                    .font(.caption)
                    .foregroundStyle(isSelected ? .primary : .secondary)
            }
        }
    }
}

struct SizeButton: View {
    let title: String
    let icon: String
    let size: QuoteCardGenerator.ExportSize
    @Binding var selected: QuoteCardGenerator.ExportSize

    var body: some View {
        Button {
            selected = size
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.title2)
                Text(title)
                    .font(.caption)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(selected == size ? Color.accentColor.opacity(0.1) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(selected == size ? Color.accentColor : Color.gray.opacity(0.3))
            )
        }
        .foregroundStyle(selected == size ? .primary : .secondary)
    }
}

struct SuccessOverlay: View {
    var body: some View {
        VStack {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 60))
                .foregroundStyle(.green)

            Text("Сохранено")
                .font(.headline)
        }
        .padding(40)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }
}
```

---

## 5. Шеринг AI-изображений

### 5.1 Watermark

```swift
import SwiftUI

struct ImageWatermarkView: View {
    let image: UIImage
    let showWatermark: Bool

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()

            if showWatermark {
                // Watermark в углу
                Text("fancai")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(8)
                    .background(.black.opacity(0.3))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .padding(12)
            }
        }
    }
}

// MARK: - Image Share Service

@MainActor
class ImageShareService {
    static let shared = ImageShareService()

    @AppStorage("enableWatermark") private var enableWatermark = true

    func shareImage(_ image: UIImage, description: String?) {
        var items: [Any] = []

        // Добавляем watermark если включено
        let finalImage = enableWatermark ? addWatermark(to: image) : image
        items.append(finalImage)

        // Добавляем текст
        if let description = description {
            items.append("«\(description)» — Создано в fancai")
        }

        let activityVC = UIActivityViewController(
            activityItems: items,
            applicationActivities: nil
        )

        presentActivityVC(activityVC)
    }

    private func addWatermark(to image: UIImage) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: image.size)

        return renderer.image { context in
            // Рисуем оригинал
            image.draw(at: .zero)

            // Watermark
            let text = "fancai"
            let font = UIFont.systemFont(ofSize: 24, weight: .bold)
            let attributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: UIColor.white.withAlphaComponent(0.7)
            ]

            let textSize = text.size(withAttributes: attributes)
            let padding: CGFloat = 20
            let point = CGPoint(
                x: image.size.width - textSize.width - padding,
                y: image.size.height - textSize.height - padding
            )

            // Фон для текста
            let bgRect = CGRect(
                x: point.x - 8,
                y: point.y - 4,
                width: textSize.width + 16,
                height: textSize.height + 8
            )
            UIColor.black.withAlphaComponent(0.3).setFill()
            UIBezierPath(roundedRect: bgRect, cornerRadius: 4).fill()

            // Текст
            text.draw(at: point, withAttributes: attributes)
        }
    }

    private func presentActivityVC(_ activityVC: UIActivityViewController) {
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first,
           let rootVC = window.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }
}
```

---

## 6. Instagram Stories интеграция

### 6.1 Прямой шеринг в Stories

```swift
import UIKit

class InstagramStoriesService {
    static let shared = InstagramStoriesService()

    /// Проверка установлен ли Instagram
    var isInstagramInstalled: Bool {
        guard let url = URL(string: "instagram-stories://share") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    /// Шеринг в Stories
    func shareToStories(image: UIImage, stickerImage: UIImage? = nil) {
        guard let imageData = image.pngData() else { return }

        var pasteboardItems: [[String: Any]] = []

        var item: [String: Any] = [
            "com.instagram.sharedSticker.backgroundImage": imageData
        ]

        // Добавляем стикер (например, логотип)
        if let sticker = stickerImage, let stickerData = sticker.pngData() {
            item["com.instagram.sharedSticker.stickerImage"] = stickerData
        }

        pasteboardItems.append(item)

        let pasteboardOptions: [UIPasteboard.OptionsKey: Any] = [
            .expirationDate: Date().addingTimeInterval(60 * 5) // 5 минут
        ]

        UIPasteboard.general.setItems(pasteboardItems, options: pasteboardOptions)

        if let url = URL(string: "instagram-stories://share") {
            UIApplication.shared.open(url)
        }
    }
}
```

### 6.2 Info.plist настройка

```xml
<key>LSApplicationQueriesSchemes</key>
<array>
    <string>instagram-stories</string>
    <string>instagram</string>
    <string>tg</string>
</array>
```

---

## 7. Настройки шеринга

### 7.1 Пользовательские настройки

```swift
import SwiftUI

struct SharingSettingsView: View {
    @AppStorage("enableWatermark") private var enableWatermark = true
    @AppStorage("defaultQuoteTemplate") private var defaultTemplate = "classic"
    @AppStorage("defaultExportSize") private var defaultSize = "instagramStory"
    @AppStorage("includeAppLink") private var includeAppLink = true

    var body: some View {
        Form {
            Section("Цитаты") {
                Picker("Стиль по умолчанию", selection: $defaultTemplate) {
                    ForEach(QuoteCardTemplate.templates) { template in
                        Text(template.name).tag(template.id)
                    }
                }

                Picker("Формат по умолчанию", selection: $defaultSize) {
                    Text("Instagram Stories").tag("instagramStory")
                    Text("Квадрат").tag("instagramFeed")
                    Text("Twitter").tag("twitter")
                }
            }

            Section("AI-изображения") {
                Toggle("Водяной знак", isOn: $enableWatermark)
            }

            Section("Ссылки") {
                Toggle("Добавлять ссылку на приложение", isOn: $includeAppLink)
            }
        }
        .navigationTitle("Настройки шеринга")
    }
}
```

---

## 8. Приоритеты реализации

### MVP (Phase 1)
| Функция | Приоритет |
|---------|-----------|
| Базовый шеринг цитат (1 шаблон) | P0 |
| Сохранение в Photos | P0 |
| Share Sheet | P0 |

### Post-MVP (Phase 2)
| Функция | Приоритет |
|---------|-----------|
| 6 шаблонов карточек | P1 |
| Выбор формата (Stories/Square) | P1 |
| Watermark для AI-изображений | P1 |

### Future (Phase 3)
| Функция | Приоритет |
|---------|-----------|
| Прямой шеринг в Instagram Stories | P2 |
| Кастомизация шаблонов | P2 |
| Анимированные карточки | P3 |

---

## Источники

- [Apple ImageRenderer Documentation](https://developer.apple.com/documentation/swiftui/imagerenderer)
- [Instagram Sharing to Stories](https://developers.facebook.com/docs/instagram/sharing-to-stories)
- [Instagram Stories Size Guidelines](https://help.instagram.com/)
- [UI/UX Card Design Best Practices](https://uxdesign.cc/)
