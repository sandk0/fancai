# Детальный план разработки iOS-приложения fancai

**Версия:** 1.1
**Дата:** 2026-01-17
**Цель:** MVP за 12 недель, v1.0 за 18 недель

> ⚠️ **Дополнение:** См. [DEVELOPMENT_PLAN_ADDENDUM.md](./DEVELOPMENT_PLAN_ADDENDUM.md) — 10 дополнительных задач (Google Sign-In, GDPR удаление аккаунта, Settings Page и др.)

---

## Содержание

1. [Подготовка к разработке](#1-подготовка-к-разработке)
2. [Граф зависимостей задач](#2-граф-зависимостей-задач)
3. [Phase 0: Project Setup](#3-phase-0-project-setup)
4. [Phase 1: Authentication](#4-phase-1-authentication)
5. [Phase 2: Book Library](#5-phase-2-book-library)
6. [Phase 3: EPUB/FB2 Reader](#6-phase-3-epubfb2-reader)
7. [Phase 4: AI Features](#7-phase-4-ai-features)
8. [Phase 5: Subscriptions](#8-phase-5-subscriptions)
9. [Phase 6: Sync & Push](#9-phase-6-sync--push)
10. [Phase 7: Polish & Testing](#10-phase-7-polish--testing)
11. [Phase 8: Launch](#11-phase-8-launch)

---

## 1. Подготовка к разработке

### 1.1 Требования к окружению

| Компонент | Версия | Примечание |
|-----------|--------|------------|
| **macOS** | 14.0+ (Sonoma) | Для Xcode 16 |
| **Xcode** | 16.0+ | Swift 6, iOS 18 SDK |
| **iOS Deployment Target** | 17.0 | Минимальная версия |
| **Python** | 3.11+ | Для backend |
| **PostgreSQL** | 15+ | База данных |
| **Redis** | 7+ | Кэширование |

### 1.2 Аккаунты и доступы

| Сервис | Что нужно | Приоритет |
|--------|-----------|-----------|
| **Apple Developer Program** | $99/год, Team ID | P0 — Week 1 |
| **App Store Connect** | Доступ к ASC | P0 — Week 1 |
| **Google Cloud** | API Key для Gemini/Imagen | P0 — Week 1 |
| **RevenueCat** | Account + API keys | P0 — Week 1 |
| **TelemetryDeck** | App ID | P1 — Week 2 |
| **Firebase** | Project для Crashlytics | P1 — Week 2 |
| **GitHub** | Репозиторий | P0 — Week 1 |

### 1.3 Чеклист перед началом

```
□ Apple Developer Program активен
□ Certificates & Provisioning Profiles созданы
□ Bundle ID зарегистрирован (ru.fancai.app)
□ App ID с capabilities: Sign in with Apple, Push Notifications, iCloud
□ Google Cloud проект создан, Gemini/Imagen API включены
□ RevenueCat проект создан, продукты настроены
□ GitHub репозиторий создан с .gitignore
□ PostgreSQL база развёрнута (local или cloud)
```

### 1.4 Структура репозиториев

```
fancai/
├── ios/                    # iOS приложение
│   ├── Fancai/
│   │   ├── App/            # @main, AppDelegate
│   │   ├── Core/           # Базовые сервисы
│   │   ├── Features/       # Модули по фичам
│   │   ├── UI/             # Общие UI компоненты
│   │   └── Resources/      # Assets, Fonts, Strings
│   ├── FancaiTests/
│   └── FancaiUITests/
│
├── backend/                # FastAPI backend
│   ├── app/
│   │   ├── api/            # Endpoints
│   │   ├── core/           # Config, Security
│   │   ├── models/         # SQLAlchemy models
│   │   ├── schemas/        # Pydantic schemas
│   │   └── services/       # Business logic
│   └── tests/
│
└── docs/                   # Документация
```

---

## 2. Граф зависимостей задач

### 2.1 Критические зависимости

```
[0.1 Project Setup] ─────────────────────────────────────────────┐
        │                                                         │
        ▼                                                         │
[0.2 SwiftData Models] ──────────────────────────────────────────┤
        │                                                         │
        ▼                                                         │
[0.3 NetworkManager] ────────────────────────────────────────────┤
        │                                                         │
        ├──────────────────────┬─────────────────────────────────┤
        ▼                      ▼                                  │
[1.x Auth Flow]    [2.x Book Library]                            │
        │                      │                                  │
        │                      ▼                                  │
        │          [2.5 EPUB Parsing] ───────────────────────────┤
        │                      │                                  │
        │                      ▼                                  │
        │          [3.x Reader Integration] ─────────────────────┤
        │                      │                                  │
        │                      ▼                                  │
        │          [4.x AI Features] ← Backend AI Integration ───┤
        │                      │                                  │
        ▼                      ▼                                  │
[5.x Subscriptions] ────► [Entitlement Checks] ──────────────────┤
        │                      │                                  │
        ▼                      ▼                                  │
[6.x Sync & Push] ─────────────┴─────────────────────────────────┤
        │                                                         │
        ▼                                                         │
[7.x Polish] ────────────────────────────────────────────────────┤
        │                                                         │
        ▼                                                         │
[8.x Launch] ◄───────────────────────────────────────────────────┘
```

### 2.2 Параллельные потоки

**Поток 1 (iOS):** Setup → Auth → Library → Reader → AI UI → Subscriptions
**Поток 2 (Backend):** Setup → Auth API → AI API → Push API
**Поток 3 (Sync):** После Auth — CloudKit integration

### 2.3 Блокеры и решения

| Блокер | Влияние | Решение |
|--------|---------|---------|
| Readium интеграция сложная | Задержка Phase 3 | Начать исследование в Week 1 |
| Apple Developer ID не готов | Нельзя тестировать Sign in with Apple | Получить до начала Phase 1 |
| Google API квоты | Ограничение тестирования AI | Заказать увеличение квот в Week 1 |
| RevenueCat sandbox | Тестирование подписок | Настроить ASC Sandbox users |

---

## 3. Phase 0: Project Setup

**Срок:** Неделя 1-2
**Цель:** Рабочий проект с базовой архитектурой

### Task 0.1: Создание Xcode проекта

**Приоритет:** P0 | **Оценка:** 2h | **Зависимости:** Нет

**Шаги:**
1. Создать проект: `File → New → Project → App`
   - Product Name: `Fancai`
   - Team: [Your Team]
   - Organization Identifier: `ru.fancai`
   - Interface: SwiftUI
   - Language: Swift
   - Storage: SwiftData
   - Include Tests: ✓

2. Настроить Targets:
   - Fancai (iOS App)
   - FancaiTests (Unit Tests)
   - FancaiUITests (UI Tests)
   - FancaiShareExtension (Share Sheet) — добавить позже

3. Настроить Schemes:
   - Debug (development server)
   - Release (production server)

4. Signing & Capabilities:
   - Team: [Your Team]
   - Bundle ID: `ru.fancai.app`
   - Signing Certificate: Automatic

**Критерии готовности:**
- [ ] Проект компилируется без ошибок
- [ ] Запускается на симуляторе

---

### Task 0.2: Настройка Git и .gitignore

**Приоритет:** P0 | **Оценка:** 1h | **Зависимости:** 0.1

**Файл .gitignore:**
```gitignore
# Xcode
*.xcodeproj/*
!*.xcodeproj/project.pbxproj
!*.xcodeproj/xcshareddata/
*.xcworkspace/*
!*.xcworkspace/contents.xcworkspacedata
!*.xcworkspace/xcshareddata/
DerivedData/
*.hmap
*.ipa
*.dSYM.zip
*.dSYM

# Swift Package Manager
.build/
Packages/

# CocoaPods
Pods/

# Secrets
*.xcconfig
!*.xcconfig.template
Secrets/

# OS
.DS_Store
```

**Шаги:**
1. `git init`
2. Добавить .gitignore
3. Первый коммит: `git commit -m "Initial project setup"`
4. Создать remote: `git remote add origin [URL]`
5. Push: `git push -u origin main`

**Критерии готовности:**
- [ ] Репозиторий на GitHub
- [ ] .gitignore корректно игнорирует файлы

---

### Task 0.3: Структура папок (MVVM)

**Приоритет:** P0 | **Оценка:** 2h | **Зависимости:** 0.1

**Структура:**
```
Fancai/
├── App/
│   ├── FancaiApp.swift          # @main entry point
│   ├── AppDelegate.swift        # UIApplicationDelegateAdaptor
│   └── ContentView.swift        # Root view with TabView
│
├── Core/
│   ├── DI/
│   │   └── Container+Factories.swift   # Factory DI registrations
│   ├── Network/
│   │   ├── APIClient.swift
│   │   ├── Endpoint.swift
│   │   └── APIError.swift
│   ├── Storage/
│   │   ├── KeychainManager.swift
│   │   └── UserDefaultsManager.swift
│   └── Utilities/
│       ├── Logger+Extensions.swift
│       └── Date+Extensions.swift
│
├── Features/
│   ├── Auth/
│   │   ├── Models/
│   │   ├── Views/
│   │   ├── ViewModels/
│   │   └── Services/
│   ├── Library/
│   ├── Reader/
│   ├── AI/
│   ├── Profile/
│   └── Settings/
│
├── UI/
│   ├── Components/              # Reusable SwiftUI views
│   ├── Modifiers/               # Custom ViewModifiers
│   └── Styles/                  # ButtonStyle, TextFieldStyle
│
└── Resources/
    ├── Assets.xcassets
    ├── Fonts/
    ├── Localizable.xcstrings
    └── Info.plist
```

**Шаги:**
1. Создать группы (New Group) для каждой папки
2. Переместить существующие файлы
3. Создать placeholder файлы для структуры

**Критерии готовности:**
- [ ] Все папки созданы
- [ ] Проект компилируется

---

### Task 0.4: Подключение SPM зависимостей

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 0.1

**Зависимости для добавления:**

| Package | URL | Version | Назначение |
|---------|-----|---------|------------|
| Factory | `github.com/hmlongco/Factory` | 2.3+ | DI |
| Nuke | `github.com/kean/Nuke` | 12.0+ | Image caching |
| ReadiumSwiftToolkit | `github.com/readium/swift-toolkit` | 3.0+ | EPUB |
| RevenueCat | `github.com/RevenueCat/purchases-ios-spm` | 5.0+ | IAP |
| FirebaseCrashlytics | `github.com/firebase/firebase-ios-sdk` | 10.0+ | Crash reporting |
| TelemetryDeck | `github.com/TelemetryDeck/SwiftClient` | 2.0+ | Analytics |

**Шаги:**
1. File → Add Package Dependencies
2. Добавить каждый package
3. Выбрать нужные targets
4. Импортировать в тестовом файле для проверки

**Критерии готовности:**
- [ ] Все packages добавлены
- [ ] `import Factory` работает
- [ ] Проект компилируется

---

### Task 0.5: Base UI компоненты (Design System)

**Приоритет:** P0 | **Оценка:** 8h | **Зависимости:** 0.1

**Файлы для создания:**

**1. UI/Styles/Colors.swift**
```swift
import SwiftUI

extension Color {
    static let fancaiPrimary = Color("Primary")
    static let fancaiSecondary = Color("Secondary")
    static let fancaiBackground = Color("Background")
    static let fancaiSurface = Color("Surface")
    static let fancaiError = Color("Error")
}
```

**2. UI/Styles/Typography.swift**
```swift
import SwiftUI

extension Font {
    static let fancaiTitle = Font.system(.title, design: .serif)
    static let fancaiHeadline = Font.system(.headline)
    static let fancaiBody = Font.system(.body)
    static let fancaiCaption = Font.system(.caption)
}
```

**3. UI/Components/PrimaryButton.swift**
```swift
import SwiftUI

struct PrimaryButton: View {
    let title: String
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.fancaiPrimary)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
}
```

**4. UI/Components/LoadingView.swift**
**5. UI/Components/ErrorView.swift**
**6. UI/Components/EmptyStateView.swift**
**7. UI/Modifiers/CardModifier.swift**

**Критерии готовности:**
- [ ] Все базовые компоненты созданы
- [ ] Colors в Assets.xcassets (Light/Dark)
- [ ] Preview работает для каждого компонента

---

### Task 0.6: Настройка SwiftData моделей

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 0.1

**Модели для создания:**

**Features/Library/Models/Book.swift**
```swift
import SwiftData
import Foundation

@Model
final class Book {
    @Attribute(.unique) var id: UUID
    var fileHash: String
    var title: String
    var author: String?
    var coverData: Data?
    var format: BookFormat
    var filePath: String
    var fileSize: Int
    var progress: Double = 0.0
    var currentCFI: String?
    var isFinished: Bool = false
    var addedAt: Date
    var lastOpenedAt: Date?
    
    @Relationship(deleteRule: .cascade)
    var bookmarks: [Bookmark] = []
    
    @Relationship(deleteRule: .cascade)
    var highlights: [Highlight] = []
    
    @Relationship(deleteRule: .cascade)
    var entities: [Entity] = []
    
    init(title: String, author: String?, format: BookFormat, filePath: String, fileSize: Int) {
        self.id = UUID()
        self.fileHash = "" // Calculate on import
        self.title = title
        self.author = author
        self.format = format
        self.filePath = filePath
        self.fileSize = fileSize
        self.addedAt = Date()
    }
}

enum BookFormat: String, Codable {
    case epub
    case fb2
}
```

**Дополнительные модели:**
- `Bookmark.swift`
- `Highlight.swift`
- `Entity.swift` (для AI-описаний)
- `GeneratedImage.swift`
- `Collection.swift`
- `ReadingSession.swift`

**Критерии готовности:**
- [ ] Все модели компилируются
- [ ] ModelContainer настроен в FancaiApp

---

### Task 0.7: Настройка Factory DI

**Приоритет:** P0 | **Оценка:** 2h | **Зависимости:** 0.4

**Core/DI/Container+Factories.swift**
```swift
import Factory
import Foundation

extension Container {
    // MARK: - Network
    var apiClient: Factory<APIClient> {
        Factory(self) { APIClient() }
            .singleton
    }
    
    // MARK: - Storage
    var keychainManager: Factory<KeychainManager> {
        Factory(self) { KeychainManager() }
            .singleton
    }
    
    // MARK: - Services
    var authService: Factory<AuthServiceProtocol> {
        Factory(self) { AuthService() }
            .singleton
    }
    
    var bookService: Factory<BookServiceProtocol> {
        Factory(self) { BookService() }
            .singleton
    }
    
    var aiService: Factory<AIServiceProtocol> {
        Factory(self) { AIService() }
            .singleton
    }
}
```

**Критерии готовности:**
- [ ] Container настроен
- [ ] @Injected работает в ViewModel

---

### Task 0.8: Настройка OSLog

**Приоритет:** P1 | **Оценка:** 2h | **Зависимости:** 0.1

**Core/Utilities/Logger+Extensions.swift**
```swift
import OSLog

extension Logger {
    private static let subsystem = Bundle.main.bundleIdentifier ?? "ru.fancai.app"
    
    static let app = Logger(subsystem: subsystem, category: "app")
    static let network = Logger(subsystem: subsystem, category: "network")
    static let database = Logger(subsystem: subsystem, category: "database")
    static let reader = Logger(subsystem: subsystem, category: "reader")
    static let ai = Logger(subsystem: subsystem, category: "ai")
    static let auth = Logger(subsystem: subsystem, category: "auth")
}
```

**Критерии готовности:**
- [ ] Logger доступен во всех модулях
- [ ] Логи видны в Console.app

---

### Task 0.9: Базовый NetworkManager

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 0.7

**Core/Network/APIClient.swift** — см. отчёт `ios-backend-api-specification.md`

**Критерии готовности:**
- [ ] GET/POST/PUT/DELETE методы работают
- [ ] JWT токен автоматически добавляется в headers
- [ ] Ошибки корректно обрабатываются

---

### Task 0.10: FastAPI Backend Skeleton

**Приоритет:** P0 | **Оценка:** 8h | **Зависимости:** Нет (параллельно)

**Структура backend:**
```
backend/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── v1/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── books.py
│   │   │   ├── ai.py
│   │   │   └── users.py
│   ├── models/
│   ├── schemas/
│   └── services/
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

**requirements.txt:**
```
fastapi==0.109.0
uvicorn[standard]==0.27.0
sqlalchemy==2.0.25
asyncpg==0.29.0
pydantic==2.5.3
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
httpx==0.26.0
google-generativeai==0.3.0
```

**Критерии готовности:**
- [ ] `uvicorn app.main:app --reload` работает
- [ ] `/health` endpoint отвечает
- [ ] Swagger UI доступен на `/docs`

---

## Продолжение плана

> **Примечание:** Полный план продолжается в файле `DEVELOPMENT_PLAN_PART2.md`
