# Спецификация инфраструктуры iOS-приложения fancai

**Дата:** 2026-01-17
**Scope:** In-App Purchases, Push Notifications, Analytics, CI/CD
**Автор:** Claude Code

## Executive Summary

Данный отчёт охватывает инфраструктурные компоненты iOS-приложения fancai: подписки (StoreKit 2 vs RevenueCat), push-уведомления (APNs vs FCM), аналитику (TelemetryDeck vs Firebase) и CI/CD (Xcode Cloud vs GitHub Actions).

---

## 1. In-App Purchases и Подписки

### 1.1 Сравнение StoreKit 2 vs RevenueCat

| Критерий | StoreKit 2 | RevenueCat |
|----------|------------|------------|
| **Стоимость** | Бесплатно | Бесплатно до $2,500 MTR, затем % от дохода |
| **Платформы** | iOS only | iOS, Android, Web |
| **Backend** | Нужен свой сервер | Managed backend |
| **A/B тестирование** | Нет (ручное) | Встроенное + Remote Config |
| **Аналитика** | Базовая в App Store Connect | Продвинутая (MRR, LTV, churn) |
| **Code Signing** | Автоматический JWS | Через RevenueCat |
| **Сложность интеграции** | Средняя | Низкая |
| **Dunning Management** | Ручное | Автоматическое |

### 1.2 Рекомендация для fancai

**Выбор: RevenueCat** (на первых этапах)

**Обоснование:**
1. Ускоряет time-to-market
2. Встроенный paywall builder
3. A/B тестирование цен без App Store updates
4. Аналитика retention и churn
5. Бесплатно до $2,500/мес (достаточно для MVP)

**Fallback plan:** Миграция на StoreKit 2 при росте выше $50,000 MTR для экономии.

### 1.3 Реализация с RevenueCat

```swift
import RevenueCat
import SwiftUI

// MARK: - Configuration

@main
struct FancaiApp: App {
    init() {
        Purchases.logLevel = .debug
        Purchases.configure(withAPIKey: "your_revenuecat_api_key")

        // Идентификация пользователя (после аутентификации)
        // Purchases.shared.logIn("user_id") { ... }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

// MARK: - Subscription Manager

@Observable
class SubscriptionManager {
    static let shared = SubscriptionManager()

    private(set) var isProUser = false
    private(set) var currentOffering: Offering?
    private(set) var customerInfo: CustomerInfo?

    init() {
        Task {
            await refreshCustomerInfo()
            await fetchOfferings()
        }
    }

    // Загрузка предложений
    func fetchOfferings() async {
        do {
            let offerings = try await Purchases.shared.offerings()
            currentOffering = offerings.current
        } catch {
            print("Error fetching offerings: \(error)")
        }
    }

    // Обновление статуса подписки
    func refreshCustomerInfo() async {
        do {
            customerInfo = try await Purchases.shared.customerInfo()
            isProUser = customerInfo?.entitlements["pro"]?.isActive == true
        } catch {
            print("Error fetching customer info: \(error)")
        }
    }

    // Покупка подписки
    func purchase(package: Package) async throws -> Bool {
        let result = try await Purchases.shared.purchase(package: package)

        if result.customerInfo.entitlements["pro"]?.isActive == true {
            isProUser = true
            return true
        }

        return false
    }

    // Восстановление покупок
    func restorePurchases() async throws {
        customerInfo = try await Purchases.shared.restorePurchases()
        isProUser = customerInfo?.entitlements["pro"]?.isActive == true
    }
}

// MARK: - Paywall View

struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selectedPackage: Package?
    @State private var isPurchasing = false
    @State private var errorMessage: String?

    let offering: Offering?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(spacing: 8) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 48))
                            .foregroundStyle(.linearGradient(
                                colors: [.purple, .blue],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ))

                        Text("fancai Pro")
                            .font(.largeTitle.bold())

                        Text("Разблокируй все возможности")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top)

                    // Features
                    VStack(alignment: .leading, spacing: 12) {
                        FeatureRow(icon: "infinity", text: "Безлимитные генерации")
                        FeatureRow(icon: "wand.and.stars", text: "Все стили изображений")
                        FeatureRow(icon: "books.vertical", text: "Неограниченная библиотека")
                        FeatureRow(icon: "icloud", text: "Синхронизация iCloud")
                    }
                    .padding()
                    .background(.ultraThinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                    // Package options
                    if let packages = offering?.availablePackages {
                        VStack(spacing: 12) {
                            ForEach(packages, id: \.identifier) { package in
                                PackageOptionView(
                                    package: package,
                                    isSelected: selectedPackage?.identifier == package.identifier
                                )
                                .onTapGesture {
                                    selectedPackage = package
                                }
                            }
                        }
                    }

                    // Error message
                    if let error = errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    // CTA Button
                    Button {
                        Task {
                            await purchaseSelected()
                        }
                    } label: {
                        if isPurchasing {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Text("Продолжить")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(selectedPackage == nil || isPurchasing)

                    // Restore
                    Button("Восстановить покупки") {
                        Task {
                            await restorePurchases()
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                    // Legal
                    Text("Подписка автоматически продлевается. Отмена возможна в настройках App Store.")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
                .padding()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func purchaseSelected() async {
        guard let package = selectedPackage else { return }

        isPurchasing = true
        errorMessage = nil

        do {
            let success = try await SubscriptionManager.shared.purchase(package: package)
            if success {
                dismiss()
            }
        } catch {
            errorMessage = "Ошибка покупки: \(error.localizedDescription)"
        }

        isPurchasing = false
    }

    private func restorePurchases() async {
        isPurchasing = true
        errorMessage = nil

        do {
            try await SubscriptionManager.shared.restorePurchases()
            if SubscriptionManager.shared.isProUser {
                dismiss()
            } else {
                errorMessage = "Активные подписки не найдены"
            }
        } catch {
            errorMessage = "Ошибка восстановления: \(error.localizedDescription)"
        }

        isPurchasing = false
    }
}

struct FeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(.blue)
                .frame(width: 24)

            Text(text)
        }
    }
}

struct PackageOptionView: View {
    let package: Package
    let isSelected: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(package.storeProduct.localizedTitle)
                    .font(.headline)

                Text(package.storeProduct.localizedPriceString)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.blue)
            }
        }
        .padding()
        .background(isSelected ? Color.blue.opacity(0.1) : Color.clear)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? Color.blue : Color.gray.opacity(0.3), lineWidth: 2)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
```

---

## 2. Push Notifications

### 2.1 Сравнение APNs vs Firebase Cloud Messaging

| Критерий | APNs (нативно) | FCM |
|----------|----------------|-----|
| **Платформы** | Apple only | iOS, Android, Web |
| **Интеграция** | Нативная | SDK required |
| **Topics/Groups** | Нет | Да |
| **Аналитика** | Нет | Встроенная |
| **A/B тестирование** | Нет | Да |
| **Сложность backend** | Средняя | Низкая |

### 2.2 Рекомендация для fancai

**Выбор: Нативный APNs + Backend интеграция**

**Обоснование:**
1. iOS-only приложение
2. FastAPI backend может отправлять push напрямую
3. Меньше зависимостей
4. Полный контроль
5. Нет дополнительных SDK

**Примечание:** Если в будущем появится Android — переход на FCM.

### 2.3 Реализация

```swift
import UserNotifications
import SwiftUI

// MARK: - Push Notification Manager

@Observable
class PushNotificationManager: NSObject {
    static let shared = PushNotificationManager()

    private(set) var isAuthorized = false
    private(set) var deviceToken: String?

    private let userDefaults = UserDefaults.standard

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    // Запрос разрешения
    func requestAuthorization() async throws -> Bool {
        let center = UNUserNotificationCenter.current()

        let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
        isAuthorized = granted

        if granted {
            await MainActor.run {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }

        return granted
    }

    // Обработка токена
    func handleDeviceToken(_ deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        self.deviceToken = token

        // Отправка на сервер
        Task {
            await sendTokenToServer(token)
        }
    }

    private func sendTokenToServer(_ token: String) async {
        // POST /api/v1/devices
        // { "platform": "ios", "push_token": token }
    }

    // Проверка статуса
    func checkAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        isAuthorized = settings.authorizationStatus == .authorized
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension PushNotificationManager: UNUserNotificationCenterDelegate {
    // Уведомление получено в foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        return [.banner, .sound, .badge]
    }

    // Пользователь нажал на уведомление
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo

        // Обработка deep link
        if let type = userInfo["type"] as? String {
            handleNotificationType(type, userInfo: userInfo)
        }
    }

    private func handleNotificationType(_ type: String, userInfo: [AnyHashable: Any]) {
        switch type {
        case "generation_complete":
            if let imageId = userInfo["image_id"] as? String {
                NotificationCenter.default.post(
                    name: .generationComplete,
                    object: nil,
                    userInfo: ["image_id": imageId]
                )
            }

        case "new_achievement":
            NotificationCenter.default.post(name: .newAchievement, object: nil)

        case "reading_reminder":
            NotificationCenter.default.post(name: .readingReminder, object: nil)

        default:
            break
        }
    }
}

extension Notification.Name {
    static let generationComplete = Notification.Name("generationComplete")
    static let newAchievement = Notification.Name("newAchievement")
    static let readingReminder = Notification.Name("readingReminder")
}

// MARK: - App Delegate Integration

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushNotificationManager.shared.handleDeviceToken(deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("Failed to register for push notifications: \(error)")
    }
}
```

### 2.4 Backend (FastAPI) отправка Push

```python
import httpx
import jwt
from datetime import datetime, timedelta

class APNsService:
    def __init__(self, key_id: str, team_id: str, key_path: str, bundle_id: str):
        self.key_id = key_id
        self.team_id = team_id
        self.bundle_id = bundle_id

        with open(key_path, 'r') as f:
            self.private_key = f.read()

    def _generate_token(self) -> str:
        headers = {
            "alg": "ES256",
            "kid": self.key_id
        }
        payload = {
            "iss": self.team_id,
            "iat": datetime.utcnow()
        }
        return jwt.encode(payload, self.private_key, algorithm="ES256", headers=headers)

    async def send_push(
        self,
        device_token: str,
        title: str,
        body: str,
        data: dict = None,
        badge: int = None
    ) -> bool:
        token = self._generate_token()

        payload = {
            "aps": {
                "alert": {
                    "title": title,
                    "body": body
                },
                "sound": "default"
            }
        }

        if badge is not None:
            payload["aps"]["badge"] = badge

        if data:
            payload.update(data)

        headers = {
            "authorization": f"bearer {token}",
            "apns-push-type": "alert",
            "apns-topic": self.bundle_id,
            "apns-priority": "10"
        }

        url = f"https://api.push.apple.com/3/device/{device_token}"

        async with httpx.AsyncClient(http2=True) as client:
            response = await client.post(url, json=payload, headers=headers)
            return response.status_code == 200
```

---

## 3. Analytics

### 3.1 Сравнение платформ

| Критерий | TelemetryDeck | Firebase Analytics | Mixpanel |
|----------|---------------|-------------------|----------|
| **Privacy** | ⭐⭐⭐⭐⭐ (No PII) | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **GDPR** | Не требует consent | Требует consent | Требует consent |
| **Стоимость** | $9/мес - $99/мес | Бесплатно | Бесплатно до лимита |
| **Events** | Неограниченно | Неограниченно | 20M/мес (free) |
| **Retention** | Да | Да | Да |
| **Funnels** | Да | Да | Продвинутые |
| **Realtime** | Нет | Да | Да |
| **iOS SDK** | Swift-native | Firebase SDK | Mixpanel SDK |
| **SDK Size** | Минимальный | ~15MB | ~5MB |

### 3.2 Рекомендация для fancai

**Выбор: TelemetryDeck**

**Обоснование:**
1. **Privacy-first** — не требует GDPR consent
2. Swift-native SDK
3. Минимальный SDK size
4. Достаточен для метрик чтения
5. Прозрачная ценовая модель
6. Данные не продаются третьим лицам

### 3.3 Реализация

```swift
import TelemetryDeck
import SwiftUI

// MARK: - Analytics Manager

@Observable
class AnalyticsManager {
    static let shared = AnalyticsManager()

    private var isInitialized = false

    func configure() {
        let config = TelemetryDeck.Config(appID: "YOUR_TELEMETRYDECK_APP_ID")
        TelemetryDeck.initialize(config: config)
        isInitialized = true
    }

    // MARK: - Reading Events

    func trackBookOpened(bookId: String, format: String) {
        TelemetryDeck.signal(
            "book_opened",
            parameters: [
                "book_id": bookId,
                "format": format
            ]
        )
    }

    func trackReadingSession(
        bookId: String,
        durationMinutes: Int,
        pagesRead: Int
    ) {
        TelemetryDeck.signal(
            "reading_session",
            parameters: [
                "book_id": bookId,
                "duration_minutes": String(durationMinutes),
                "pages_read": String(pagesRead)
            ]
        )
    }

    func trackBookCompleted(bookId: String, totalDays: Int) {
        TelemetryDeck.signal(
            "book_completed",
            parameters: [
                "book_id": bookId,
                "total_days": String(totalDays)
            ]
        )
    }

    // MARK: - AI Events

    func trackGenerationStarted(entityType: String, style: String) {
        TelemetryDeck.signal(
            "generation_started",
            parameters: [
                "entity_type": entityType,
                "style": style
            ]
        )
    }

    func trackGenerationCompleted(
        entityType: String,
        durationSeconds: Int,
        success: Bool
    ) {
        TelemetryDeck.signal(
            "generation_completed",
            parameters: [
                "entity_type": entityType,
                "duration_seconds": String(durationSeconds),
                "success": String(success)
            ]
        )
    }

    func trackGenerationFeedback(imageId: String, isPositive: Bool) {
        TelemetryDeck.signal(
            "generation_feedback",
            parameters: [
                "image_id": imageId,
                "is_positive": String(isPositive)
            ]
        )
    }

    // MARK: - Library Events

    func trackBookImported(source: String, format: String) {
        TelemetryDeck.signal(
            "book_imported",
            parameters: [
                "source": source,
                "format": format
            ]
        )
    }

    // MARK: - Subscription Events

    func trackPaywallViewed(placement: String) {
        TelemetryDeck.signal(
            "paywall_viewed",
            parameters: [
                "placement": placement
            ]
        )
    }

    func trackSubscriptionStarted(plan: String) {
        TelemetryDeck.signal(
            "subscription_started",
            parameters: [
                "plan": plan
            ]
        )
    }

    // MARK: - Screen Views

    func trackScreenView(_ screen: String) {
        TelemetryDeck.signal(
            "screen_view",
            parameters: [
                "screen": screen
            ]
        )
    }
}

// MARK: - View Modifier for Screen Tracking

struct ScreenTrackingModifier: ViewModifier {
    let screenName: String

    func body(content: Content) -> some View {
        content
            .onAppear {
                AnalyticsManager.shared.trackScreenView(screenName)
            }
    }
}

extension View {
    func trackScreen(_ name: String) -> some View {
        modifier(ScreenTrackingModifier(screenName: name))
    }
}
```

### 3.4 Ключевые метрики для отслеживания

| Метрика | Event | Параметры |
|---------|-------|-----------|
| **DAU/MAU** | Автоматически TelemetryDeck | — |
| **Время чтения** | `reading_session` | `duration_minutes` |
| **Книг прочитано** | `book_completed` | `total_days` |
| **Генераций выполнено** | `generation_completed` | `entity_type`, `success` |
| **Conversion Rate** | `subscription_started` / `paywall_viewed` | — |
| **Retention** | Автоматически TelemetryDeck | — |

---

## 4. CI/CD

### 4.1 Сравнение Xcode Cloud vs GitHub Actions

| Критерий | Xcode Cloud | GitHub Actions + Fastlane |
|----------|-------------|--------------------------|
| **Интеграция Apple** | Нативная | Через Fastlane |
| **Code Signing** | Автоматический | fastlane match |
| **TestFlight** | Встроенный | Через Fastlane |
| **Стоимость** | 25 ч/мес бесплатно | 2,000 мин/мес (free tier) |
| **Гибкость** | Ограниченная | Высокая |
| **Multi-platform** | Apple only | Любые |
| **Backend deploy** | Нет | Да |
| **Secrets management** | App Store Connect | GitHub Secrets |

### 4.2 Рекомендация для fancai

**Выбор: Xcode Cloud** (iOS) + **GitHub Actions** (Backend)

**Обоснование:**
1. Xcode Cloud — проще для iOS, автоматический code signing
2. GitHub Actions — для FastAPI backend
3. Разделение ответственности
4. Оба имеют бесплатные tier

### 4.3 Xcode Cloud Workflow

```yaml
# Файл: ci_scripts/ci_post_clone.sh

#!/bin/sh

# Установка зависимостей
echo "Installing dependencies..."

# CocoaPods (если используется)
# pod install

# Swift Package Manager — автоматически

# Настройка переменных окружения
echo "REVENUECAT_API_KEY=$REVENUECAT_API_KEY" >> .env
echo "TELEMETRYDECK_APP_ID=$TELEMETRYDECK_APP_ID" >> .env
```

**Xcode Cloud Workflows:**

| Workflow | Trigger | Actions |
|----------|---------|---------|
| **PR Build** | Pull Request | Build + Unit Tests |
| **TestFlight** | Push to `main` | Build + Tests + Deploy to TestFlight |
| **Release** | Tag `v*` | Build + Tests + App Store Submit |

### 4.4 GitHub Actions для Backend

```yaml
# .github/workflows/backend.yml

name: Backend CI/CD

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
  pull_request:
    branches: [main]
    paths:
      - 'backend/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: |
          cd backend
          pip install -r requirements.txt
          pip install pytest pytest-asyncio

      - name: Run tests
        run: |
          cd backend
          pytest

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: fancai-api
          region: europe-west1
          source: backend
```

### 4.5 Fastlane Setup (альтернатива/дополнение)

```ruby
# fastlane/Fastfile

default_platform(:ios)

platform :ios do
  desc "Run tests"
  lane :test do
    run_tests(
      scheme: "fancai",
      devices: ["iPhone 15 Pro"]
    )
  end

  desc "Build and upload to TestFlight"
  lane :beta do
    setup_ci if ENV['CI']

    # Получаем версию
    increment_build_number(
      build_number: ENV["GITHUB_RUN_NUMBER"] || Time.now.strftime("%Y%m%d%H%M")
    )

    # Собираем
    build_app(
      scheme: "fancai",
      export_method: "app-store"
    )

    # Загружаем в TestFlight
    upload_to_testflight(
      skip_waiting_for_build_processing: true
    )
  end

  desc "Release to App Store"
  lane :release do
    setup_ci if ENV['CI']

    build_app(
      scheme: "fancai",
      export_method: "app-store"
    )

    upload_to_app_store(
      submit_for_review: false,
      automatic_release: false
    )
  end
end
```

---

## 5. Рекомендуемая архитектура инфраструктуры

```
┌─────────────────────────────────────────────────────────────┐
│                        User Device                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    iOS App (fancai)                     ││
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐   ││
│  │  │ RevenueCat  │ │ TelemetryDeck│ │ APNs Handler    │   ││
│  │  │    SDK      │ │     SDK      │ │ (UserNotifs)    │   ││
│  │  └──────┬──────┘ └──────┬───────┘ └────────┬────────┘   ││
│  └─────────┼───────────────┼──────────────────┼────────────┘│
└────────────┼───────────────┼──────────────────┼─────────────┘
             │               │                  │
             ▼               ▼                  ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────────┐
│  RevenueCat    │  │ TelemetryDeck  │  │ APNs (Apple)       │
│  Platform      │  │   Dashboard    │  │                    │
└────────────────┘  └────────────────┘  └─────────▲──────────┘
                                                  │
                    ┌─────────────────────────────┘
                    │
            ┌───────┴───────────────────────────────────────┐
            │              FastAPI Backend                   │
            │  ┌───────────┐ ┌───────────┐ ┌─────────────┐  │
            │  │ Auth      │ │ AI/Gen    │ │ Push Service│  │
            │  │ Service   │ │ Service   │ │ (APNs)      │  │
            │  └───────────┘ └───────────┘ └─────────────┘  │
            └───────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            │         GitHub Actions CI/CD      │
            │   (Backend deploys + Tests)       │
            └───────────────────────────────────┘

            ┌───────────────────────────────────┐
            │         Xcode Cloud               │
            │   (iOS builds + TestFlight)       │
            └───────────────────────────────────┘
```

---

## 6. Приоритеты реализации

### MVP (Phase 1)
| Компонент | Инструмент | Приоритет |
|-----------|------------|-----------|
| **Subscriptions** | RevenueCat | P0 |
| **Analytics** | TelemetryDeck | P0 |
| **CI/CD iOS** | Xcode Cloud | P1 |

### Post-MVP (Phase 2)
| Компонент | Инструмент | Приоритет |
|-----------|------------|-----------|
| **Push Notifications** | APNs native | P1 |
| **CI/CD Backend** | GitHub Actions | P1 |

---

## Источники

- [StoreKit 2 Documentation](https://developer.apple.com/documentation/storekit)
- [RevenueCat Documentation](https://www.revenuecat.com/docs/)
- [TelemetryDeck Documentation](https://telemetrydeck.com/docs/)
- [Apple Push Notification Service](https://developer.apple.com/documentation/usernotifications)
- [Xcode Cloud Documentation](https://developer.apple.com/documentation/xcode/xcode-cloud)
- [Fastlane Documentation](https://docs.fastlane.tools/)
