# Детальный план разработки — Часть 4: Subscriptions, Sync, Polish, Launch

**Продолжение:** DEVELOPMENT_PLAN_PART3.md

---

## 8. Phase 5: Subscriptions

**Срок:** Неделя 12
**Цель:** Работающая подписка Pro с RevenueCat

### Task 5.1: RevenueCat SDK интеграция

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 0.4

**Core/Services/PurchaseService.swift:**
```swift
import RevenueCat

class PurchaseService {
    static let shared = PurchaseService()
    
    func configure() {
        Purchases.logLevel = .debug
        Purchases.configure(withAPIKey: Config.revenueCatAPIKey)
        Purchases.shared.delegate = self
    }
    
    func getOfferings() async throws -> Offerings {
        try await Purchases.shared.offerings()
    }
    
    func purchase(package: Package) async throws -> CustomerInfo {
        let (_, customerInfo, _) = try await Purchases.shared.purchase(package: package)
        return customerInfo
    }
    
    func restorePurchases() async throws -> CustomerInfo {
        try await Purchases.shared.restorePurchases()
    }
    
    func checkProStatus() async -> Bool {
        let customerInfo = try? await Purchases.shared.customerInfo()
        return customerInfo?.entitlements["pro"]?.isActive == true
    }
}

extension PurchaseService: PurchasesDelegate {
    func purchases(_ purchases: Purchases, receivedUpdated customerInfo: CustomerInfo) {
        // Update UI state
        NotificationCenter.default.post(name: .subscriptionUpdated, object: customerInfo)
    }
}
```

**Критерии готовности:**
- [ ] SDK инициализируется при launch
- [ ] Offerings загружаются
- [ ] CustomerInfo доступен

---

### Task 5.2: Paywall UI

**Приоритет:** P0 | **Оценка:** 6h | **Зависимости:** 5.1

**Features/Subscription/Views/PaywallView.swift:**
```swift
struct PaywallView: View {
    @StateObject private var viewModel = PaywallViewModel()
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Hero
                VStack(spacing: 8) {
                    Text("fancai Pro")
                        .font(.largeTitle.bold())
                    Text("Безлимитные AI-иллюстрации")
                        .foregroundStyle(.secondary)
                }
                
                // Features
                VStack(alignment: .leading, spacing: 12) {
                    FeatureRow(icon: "sparkles", title: "300 генераций в месяц")
                    FeatureRow(icon: "book.fill", title: "10 книг в обработке")
                    FeatureRow(icon: "icloud.fill", title: "Синхронизация на всех устройствах")
                    FeatureRow(icon: "paintbrush", title: "Все стили генерации")
                }
                
                // Price
                if let offering = viewModel.currentOffering {
                    ForEach(offering.availablePackages, id: \.identifier) { package in
                        PriceButton(package: package) {
                            Task { await viewModel.purchase(package) }
                        }
                    }
                }
                
                // Legal
                HStack {
                    Link("Условия", destination: URL(string: "https://fancai.ru/terms")!)
                    Text("•")
                    Link("Конфиденциальность", destination: URL(string: "https://fancai.ru/privacy")!)
                }
                .font(.caption)
                
                Button("Восстановить покупки") {
                    Task { await viewModel.restore() }
                }
            }
            .padding()
        }
    }
}
```

**Критерии готовности:**
- [ ] Все преимущества Pro показаны
- [ ] Цена отображается из offerings
- [ ] Legal links работают

---

### Task 5.3-5.9: IAP Flow

**Приоритет:** P0 | **Оценка:** 20h | **Зависимости:** 5.1

| Task | Описание |
|------|----------|
| 5.3 | Создать продукты в ASC |
| 5.4 | Purchase flow с обработкой ошибок |
| 5.5 | Restore purchases |
| 5.6 | Entitlement checking |
| 5.7 | Backend webhook |
| 5.8 | Лимиты Free/Pro в UI |
| 5.9 | Subscription status в Profile |

**Критерии готовности:**
- [ ] Подписка покупается в sandbox
- [ ] Pro features разблокируются
- [ ] Лимиты применяются для Free

---

## 9. Phase 6: Sync & Push

**Срок:** Неделя 13-14
**Цель:** Синхронизация данных и push-уведомления

### Task 6.1-6.4: CloudKit Sync

**Приоритет:** P1 | **Оценка:** 20h | **Зависимости:** 0.6

**SwiftData + CloudKit:**
```swift
@main
struct FancaiApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [Book.self, Bookmark.self], cloudKitDatabase: .private("iCloud.ru.fancai.app"))
    }
}
```

**Conflict Resolution:**
- Reading position: server wins (последняя позиция)
- Bookmarks: merge (объединение)
- AI data: server only (не синхронизируется локально)

**Критерии готовности:**
- [ ] Данные синхронизируются между устройствами
- [ ] Конфликты разрешаются автоматически
- [ ] Offline режим работает

---

### Task 6.5-6.10: Push Notifications

**Приоритет:** P1 | **Оценка:** 22h | **Зависимости:** Phase 1

**Шаги:**
1. Добавить Push capability в Xcode
2. Запросить разрешение при onboarding
3. Зарегистрировать device token на backend
4. Реализовать отправку с backend через APNs

**Features/Push/PushManager.swift:**
```swift
import UserNotifications

class PushManager: NSObject {
    static let shared = PushManager()
    
    func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let (granted, _) = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        
        if granted {
            await MainActor.run {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
        return granted
    }
    
    func registerToken(_ deviceToken: Data) async {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        try? await Container.shared.apiClient().registerPushToken(token)
    }
}
```

**Типы уведомлений:**
- `book_processed` — книга обработана
- `image_ready` — изображение готово
- `reading_reminder` — напоминание о чтении
- `streak_warning` — streak под угрозой

**Критерии готовности:**
- [ ] Permission запрашивается
- [ ] Token отправляется на backend
- [ ] Rich notifications с изображениями

---

## 10. Phase 7: Polish & Testing

**Срок:** Неделя 15-16
**Цель:** Отполированный продукт без критических багов

### Task 7.1-7.4: UI/UX Polish

**Приоритет:** P0 | **Оценка:** 34h

| Task | Описание | Оценка |
|------|----------|--------|
| 7.1 | UI/UX polish (spacing, colors) | 16h |
| 7.2 | Animations и transitions | 8h |
| 7.3 | Error states | 6h |
| 7.4 | Loading states | 4h |

**Checklist:**
- [ ] Все экраны соответствуют HIG
- [ ] Анимации плавные (60fps)
- [ ] Empty/Error/Loading states везде

---

### Task 7.5-7.7: Testing

**Приоритет:** P0 | **Оценка:** 26h

**Unit Tests (7.5):**
```swift
import Testing
@testable import Fancai

struct BookServiceTests {
    @Test func importEPUB() async throws {
        let service = BookService()
        let url = Bundle.module.url(forResource: "test", withExtension: "epub")!
        
        let book = try await service.importBook(from: url)
        
        #expect(book.title == "Test Book")
        #expect(book.format == .epub)
    }
}
```

**UI Tests (7.6):**
```swift
import XCTest

final class LibraryUITests: XCTestCase {
    func testAddBook() throws {
        let app = XCUIApplication()
        app.launch()
        
        app.buttons["addBook"].tap()
        // Continue flow...
    }
}
```

**Snapshot Tests (7.7):** SnapshotTesting library

**Критерии готовности:**
- [ ] Unit test coverage > 60%
- [ ] Critical paths covered by UI tests
- [ ] Snapshots для основных экранов

---

### Task 7.8-7.12: Performance и Localization

**Приоритет:** P0-P1 | **Оценка:** 26h

| Task | Описание | Оценка |
|------|----------|--------|
| 7.8 | Performance profiling (Instruments) | 6h |
| 7.9 | Memory leak fixing | 6h |
| 7.10 | Localization RU/EN | 8h |
| 7.11 | TelemetryDeck интеграция | 3h |
| 7.12 | Crashlytics интеграция | 3h |

**Performance targets:**
- Launch time: < 2s
- Memory: < 200MB idle
- Battery: < 5% per hour reading

**Критерии готовности:**
- [ ] No memory leaks в Instruments
- [ ] Все строки локализованы
- [ ] Analytics события отправляются

---

## 11. Phase 8: Launch

**Срок:** Неделя 17-18
**Цель:** Приложение в App Store

### Task 8.1-8.6: App Store Prep

**Приоритет:** P0 | **Оценка:** 26h

| Task | Описание | Оценка |
|------|----------|--------|
| 8.1 | App Store Connect setup | 2h |
| 8.2 | App icons (все размеры) | 4h |
| 8.3 | Screenshots (iPhone, iPad) | 8h |
| 8.4 | App Store description | 4h |
| 8.5 | Privacy policy page | 4h |
| 8.6 | Terms of service | 4h |

**Screenshots:**
- iPhone 6.7" (Pro Max)
- iPhone 6.5" (Plus)
- iPad Pro 12.9"

**Критерии готовности:**
- [ ] Все assets загружены в ASC
- [ ] Описание на RU/EN
- [ ] Legal pages опубликованы

---

### Task 8.7-8.10: Submission

**Приоритет:** P0 | **Оценка:** 24h

| Task | Описание |
|------|----------|
| 8.7 | App Review submission |
| 8.8 | TestFlight beta (internal) |
| 8.9 | Beta feedback fixes |
| 8.10 | Final submission |

**App Review Notes:**
```
Demo Account:
- Email: review@fancai.ru
- Password: [secure password]

Test Pro subscription:
- Use sandbox account
- Subscription auto-renews in sandbox

AI Features:
- Process sample book "Война и мир"
- Generate images for main characters
```

**Критерии готовности:**
- [ ] TestFlight beta протестирован
- [ ] Critical bugs fixed
- [ ] App Review approved

---

## Сводная таблица задач

| Phase | Задач | Часов | Недели |
|-------|-------|-------|--------|
| 0: Setup | 10 | 37h | 1-2 |
| 1: Auth | 9 | 35h | 3 |
| 2: Library | 12 | 47h | 4-5 |
| 3: Reader | 17 | 98h | 6-8 |
| 4: AI | 15 | 78h | 9-11 |
| 5: Subscriptions | 9 | 34h | 12 |
| 6: Sync & Push | 10 | 42h | 13-14 |
| 7: Polish | 12 | 86h | 15-16 |
| 8: Launch | 10 | 50h | 17-18 |
| **Итого** | **104** | **507h** | **18** |

---

## Quick Reference

### Критический путь
```
Setup → Auth → Library → Reader → AI → Subscriptions → Launch
```

### Параллельные треки
- **iOS:** Все UI/UX
- **Backend:** Auth API → AI API → Push
- **Design:** Icons, Screenshots

### Weekly Checkpoints
- **Week 4:** Auth + Library MVP
- **Week 8:** Reader complete
- **Week 11:** AI features working
- **Week 14:** Sync & Push done
- **Week 16:** Testing complete
- **Week 18:** App Store launch
