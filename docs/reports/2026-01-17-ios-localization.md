# Локализация iOS-приложения fancai

**Дата:** 2026-01-17
**Scope:** String Catalogs, Pluralization, RTL, форматирование дат
**Автор:** Claude Code

---

## 1. Обзор String Catalogs (Xcode 15+)

### 1.1 Преимущества

| Аспект | Старый подход (.strings) | Новый подход (.xcstrings) |
|--------|--------------------------|---------------------------|
| Файлы | Отдельный файл на язык | Один файл для всех языков |
| Синхронизация | Ручная | Автоматическая |
| Плюрализация | .stringsdict отдельно | Встроена |
| Комментарии | Ручные | Автогенерация контекста |
| Прогресс | Вручную считать | Визуальный в Xcode |

### 1.2 Создание String Catalog

```
File → New → File → String Catalog → Localizable.xcstrings
```

---

## 2. Поддерживаемые языки

| Язык | Код | Приоритет | Особенности |
|------|-----|-----------|-------------|
| **Русский** | `ru` | P0 (основной) | Сложная плюрализация (4 формы) |
| **Английский** | `en` | P1 | 2 формы плюрализации |

---

## 3. SwiftUI локализация

### 3.1 Базовое использование

```swift
import SwiftUI

struct BookDetailView: View {
    let book: Book

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Автоматически локализуется
            Text("Информация о книге")
                .font(.title)

            // С интерполяцией
            Text("Автор: \(book.author)")

            // Из переменной — НЕ локализуется автоматически
            let title = book.title
            Text(title) // ⚠️ Не локализуется!

            // Правильный способ для динамических строк
            Text(book.localizedGenre)
        }
    }
}

extension Book {
    var localizedGenre: LocalizedStringKey {
        LocalizedStringKey(genre)
    }
}
```

### 3.2 Локализация вне SwiftUI

```swift
import Foundation

// MARK: - Для кода вне SwiftUI

class NotificationService {
    func sendReadingReminder() {
        let title = String(localized: "Напоминание о чтении")
        let body = String(localized: "Пора продолжить читать!")

        // Отправить уведомление
        sendNotification(title: title, body: body)
    }
}

// MARK: - С ключами

enum LocalizedStrings {
    static let welcomeTitle = String(localized: "welcome.title")
    static let welcomeSubtitle = String(localized: "welcome.subtitle")

    static func bookCount(_ count: Int) -> String {
        String(localized: "\(count) книг в библиотеке")
    }
}
```

### 3.3 Комментарии для переводчиков

```swift
// Добавление контекста
Text("Продолжить", comment: "Кнопка продолжения чтения на главном экране")

Text("Открыть", comment: "Кнопка открытия книги в библиотеке")
```

---

## 4. Плюрализация

### 4.1 Правила для русского языка

| Правило | Числа | Пример |
|---------|-------|--------|
| **one** | 1, 21, 31... | 1 книга |
| **few** | 2-4, 22-24... | 2 книги |
| **many** | 5-20, 25-30... | 5 книг |
| **other** | 0, дробные | 0 книг |

### 4.2 Реализация в SwiftUI

```swift
import SwiftUI

struct LibraryStatsView: View {
    let bookCount: Int
    let pageCount: Int
    let minutesRead: Int

    var body: some View {
        VStack(spacing: 12) {
            // Плюрализация книг
            Text("\(bookCount) книг")

            // Страницы
            Text("Прочитано \(pageCount) страниц")

            // Минуты
            Text("\(minutesRead) минут чтения")
        }
    }
}
```

### 4.3 Конфигурация в String Catalog

```json
{
  "sourceLanguage": "ru",
  "strings": {
    "%lld книг": {
      "localizations": {
        "ru": {
          "variations": {
            "plural": {
              "one": {
                "stringUnit": {
                  "state": "translated",
                  "value": "%lld книга"
                }
              },
              "few": {
                "stringUnit": {
                  "state": "translated",
                  "value": "%lld книги"
                }
              },
              "many": {
                "stringUnit": {
                  "state": "translated",
                  "value": "%lld книг"
                }
              },
              "other": {
                "stringUnit": {
                  "state": "translated",
                  "value": "%lld книг"
                }
              }
            }
          }
        },
        "en": {
          "variations": {
            "plural": {
              "one": {
                "stringUnit": {
                  "state": "translated",
                  "value": "%lld book"
                }
              },
              "other": {
                "stringUnit": {
                  "state": "translated",
                  "value": "%lld books"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### 4.4 Хелпер для плюрализации

```swift
import Foundation

// MARK: - Pluralization Helper

extension Int {
    /// Выбор правильной формы слова для русского языка
    func pluralized(_ one: String, _ few: String, _ many: String) -> String {
        let absValue = abs(self) % 100
        let lastDigit = absValue % 10

        if absValue >= 11 && absValue <= 19 {
            return many
        }

        switch lastDigit {
        case 1:
            return one
        case 2, 3, 4:
            return few
        default:
            return many
        }
    }
}

// Использование (для случаев когда String Catalog недоступен)
let count = 23
let label = "\(count) \(count.pluralized("книга", "книги", "книг"))"
// → "23 книги"
```

---

## 5. Форматирование дат и чисел

### 5.1 Даты

```swift
import Foundation

struct DateFormattingExamples {
    let date = Date()

    // Автоматическое форматирование по локали
    var formattedDate: String {
        date.formatted(date: .long, time: .omitted)
        // RU: "17 января 2026 г."
        // EN: "January 17, 2026"
    }

    var relativeDate: String {
        date.formatted(.relative(presentation: .named))
        // RU: "сегодня", "вчера", "2 дня назад"
        // EN: "today", "yesterday", "2 days ago"
    }

    var readingDuration: String {
        let minutes = 145
        let duration = Duration.seconds(minutes * 60)
        return duration.formatted(.time(pattern: .hourMinute))
        // "2:25" (в обеих локалях)
    }
}
```

### 5.2 Числа

```swift
import Foundation

struct NumberFormattingExamples {
    // Целые числа
    func formatCount(_ count: Int) -> String {
        count.formatted()
        // RU: "1 234 567"
        // EN: "1,234,567"
    }

    // Десятичные
    func formatRating(_ rating: Double) -> String {
        rating.formatted(.number.precision(.fractionLength(1)))
        // RU: "4,5"
        // EN: "4.5"
    }

    // Проценты
    func formatProgress(_ progress: Double) -> String {
        progress.formatted(.percent)
        // RU: "75 %"
        // EN: "75%"
    }

    // Байты
    func formatFileSize(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
        // RU: "2,5 МБ"
        // EN: "2.5 MB"
    }
}
```

### 5.3 SwiftUI форматирование

```swift
import SwiftUI

struct StatsView: View {
    let pagesRead: Int
    let hoursRead: Double
    let progress: Double

    var body: some View {
        VStack {
            // Автоматическое форматирование по локали
            Text(pagesRead, format: .number)

            Text(hoursRead, format: .number.precision(.fractionLength(1)))

            Text(progress, format: .percent)

            // Дата
            Text(Date.now, format: .dateTime.day().month(.wide))
        }
    }
}
```

---

## 6. Структура ключей локализации

### 6.1 Рекомендуемая система

```
ИмяЭкрана.ИмяКомпонента.ТипТекста

Примеры:
- Library.Header.title
- Library.EmptyState.message
- Reader.Settings.fontSize
- Onboarding.Page1.title
- Achievements.Badge.unlocked
```

### 6.2 Файл локализации для fancai

```swift
// Localizable.xcstrings
{
  "sourceLanguage": "ru",
  "strings": {
    // Библиотека
    "Library.title": {
      "localizations": {
        "ru": { "stringUnit": { "value": "Библиотека" } },
        "en": { "stringUnit": { "value": "Library" } }
      }
    },
    "Library.EmptyState.title": {
      "localizations": {
        "ru": { "stringUnit": { "value": "Пока пусто" } },
        "en": { "stringUnit": { "value": "No books yet" } }
      }
    },
    "Library.EmptyState.message": {
      "localizations": {
        "ru": { "stringUnit": { "value": "Добавьте первую книгу" } },
        "en": { "stringUnit": { "value": "Add your first book" } }
      }
    },

    // Reader
    "Reader.Settings.title": {
      "localizations": {
        "ru": { "stringUnit": { "value": "Настройки" } },
        "en": { "stringUnit": { "value": "Settings" } }
      }
    },
    "Reader.Controls.previousPage": {
      "localizations": {
        "ru": { "stringUnit": { "value": "Назад" } },
        "en": { "stringUnit": { "value": "Previous" } }
      }
    },

    // Общие
    "Common.cancel": {
      "localizations": {
        "ru": { "stringUnit": { "value": "Отмена" } },
        "en": { "stringUnit": { "value": "Cancel" } }
      }
    },
    "Common.done": {
      "localizations": {
        "ru": { "stringUnit": { "value": "Готово" } },
        "en": { "stringUnit": { "value": "Done" } }
      }
    },
    "Common.save": {
      "localizations": {
        "ru": { "stringUnit": { "value": "Сохранить" } },
        "en": { "stringUnit": { "value": "Save" } }
      }
    }
  }
}
```

---

## 7. Тестирование локализации

### 7.1 SwiftUI Preview

```swift
import SwiftUI

struct LibraryView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            LibraryView()
                .environment(\.locale, Locale(identifier: "ru"))
                .previewDisplayName("Русский")

            LibraryView()
                .environment(\.locale, Locale(identifier: "en"))
                .previewDisplayName("English")
        }
    }
}
```

### 7.2 Pseudolocalization

```swift
// Scheme → Run → Options → App Language: Pseudolanguage

// Или программно для тестов
extension String {
    var pseudolocalized: String {
        "[[\(self)]]" // Добавляет маркеры для проверки
    }
}
```

### 7.3 Unit Tests

```swift
import XCTest

final class LocalizationTests: XCTestCase {
    func testRussianPluralization() {
        // one
        XCTAssertEqual(formatBooks(1), "1 книга")
        XCTAssertEqual(formatBooks(21), "21 книга")

        // few
        XCTAssertEqual(formatBooks(2), "2 книги")
        XCTAssertEqual(formatBooks(23), "23 книги")

        // many
        XCTAssertEqual(formatBooks(5), "5 книг")
        XCTAssertEqual(formatBooks(11), "11 книг")
        XCTAssertEqual(formatBooks(100), "100 книг")
    }

    func testAllStringsTranslated() {
        // Проверка что все ключи переведены
        let bundle = Bundle.main
        let languages = ["ru", "en"]

        for lang in languages {
            guard let path = bundle.path(forResource: lang, ofType: "lproj"),
                  let langBundle = Bundle(path: path) else {
                XCTFail("Missing \(lang) localization")
                continue
            }

            // Проверить критичные ключи
            XCTAssertNotEqual(
                langBundle.localizedString(forKey: "Library.title", value: nil, table: nil),
                "Library.title",
                "Missing translation for Library.title in \(lang)"
            )
        }
    }
}
```

---

## 8. UI адаптация

### 8.1 Длина текста

```swift
import SwiftUI

struct AdaptiveButton: View {
    let title: LocalizedStringKey

    var body: some View {
        Button(title) { }
            .lineLimit(1)
            .minimumScaleFactor(0.8) // Уменьшение до 80% при необходимости
    }
}

struct FlexibleLabel: View {
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .fixedSize(horizontal: false, vertical: true)
            // Позволяет тексту занять несколько строк
    }
}
```

### 8.2 Layout Direction

```swift
import SwiftUI

struct ContentView: View {
    @Environment(\.layoutDirection) var layoutDirection

    var body: some View {
        HStack {
            if layoutDirection == .rightToLeft {
                // RTL layout
                trailingContent
                leadingContent
            } else {
                leadingContent
                trailingContent
            }
        }
    }

    var leadingContent: some View {
        Image(systemName: "book")
    }

    var trailingContent: some View {
        Text("Заголовок")
    }
}
```

---

## 9. Workflow локализации

### 9.1 Экспорт для переводчиков

```bash
# Экспорт в XLIFF для перевода
xcodebuild -exportLocalizations -project Fancai.xcodeproj -localizationPath ./Localizations

# Импорт переводов
xcodebuild -importLocalizations -project Fancai.xcodeproj -localizationPath ./Localizations/en.xcloc
```

### 9.2 Интеграция с сервисами

| Сервис | Интеграция |
|--------|------------|
| **Lokalise** | XLIFF import/export, CI/CD |
| **Crowdin** | XLIFF, GitHub sync |
| **Phrase** | Xcode plugin, API |
| **POEditor** | XLIFF, простой UI |

---

## 10. Чеклист локализации

| Пункт | Статус |
|-------|--------|
| String Catalog создан | ⬜ |
| Русский язык (базовый) | ⬜ |
| Английский язык | ⬜ |
| Плюрализация настроена | ⬜ |
| Даты/числа форматируются по локали | ⬜ |
| UI адаптирован под длинный текст | ⬜ |
| Previews для обоих языков | ⬜ |
| Unit tests для плюрализации | ⬜ |

---

## Источники

- [Apple Developer — String Catalogs](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog)
- [WWDC 2023 — Discover String Catalogs](https://developer.apple.com/videos/play/wwdc2023/10155/)
- [Unicode CLDR — Plural Rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
