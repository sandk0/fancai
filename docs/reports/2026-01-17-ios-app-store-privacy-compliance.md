# App Store Guidelines и Privacy Compliance для fancai

**Дата:** 2026-01-17
**Scope:** App Store Review Guidelines, GDPR, 152-ФЗ, ATT
**Автор:** Claude Code

---

## 1. App Store Review Guidelines 2025

### 1.1 Reader App Requirements

fancai классифицируется как **Reader App** (приложение для чтения), что даёт определённые преимущества:

| Требование | Статус fancai |
|------------|---------------|
| External Link Account Entitlement | Можно использовать (с мая 2025 в США) |
| Ссылка на внешний сайт для управления аккаунтом | ✅ Разрешено |
| Прямые внешние платежи (США) | ✅ Разрешено без специального entitlement |

### 1.2 Требования к AI-контенту

#### Guideline 5.1.2(i) — Передача данных сторонним AI

> Apps that share personal data with third-party AI systems must clearly disclose this practice and obtain explicit user consent.

**Для fancai:**

| Данные | AI-сервис | Требуется |
|--------|-----------|-----------|
| Текст книги | Google Gemini (извлечение описаний) | Consent + Disclosure |
| Описания для генерации | Google Imagen | Consent + Disclosure |

**Реализация:**

```swift
import SwiftUI

struct AIDataDisclosureView: View {
    @Binding var isPresented: Bool
    let onAccept: () -> Void
    let onDecline: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Заголовок
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "brain.head.profile")
                            .font(.system(size: 48))
                            .foregroundStyle(.blue)

                        Text("AI-функции")
                            .font(.largeTitle.bold())

                        Text("Для работы AI-функций требуется обработка данных")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    Divider()

                    // Описание передачи данных
                    VStack(alignment: .leading, spacing: 16) {
                        DataSharingRow(
                            icon: "text.alignleft",
                            title: "Текст книги",
                            description: "Передаётся в Google Gemini для извлечения визуальных описаний персонажей и локаций",
                            dataType: "Фрагменты текста"
                        )

                        DataSharingRow(
                            icon: "photo",
                            title: "Описания для генерации",
                            description: "Описания персонажей передаются в Google Imagen для создания изображений",
                            dataType: "Текстовые описания"
                        )
                    }

                    Divider()

                    // Гарантии
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Наши гарантии:")
                            .font(.headline)

                        BulletPoint(text: "Данные не используются для обучения AI-моделей")
                        BulletPoint(text: "Передаются только фрагменты, необходимые для функции")
                        BulletPoint(text: "Данные не хранятся на серверах Google дольше 24 часов")
                        BulletPoint(text: "Вы можете отключить AI-функции в любой момент")
                    }

                    // Ссылки
                    VStack(alignment: .leading, spacing: 8) {
                        Link("Политика конфиденциальности fancai", destination: URL(string: "https://fancai.ru/privacy")!)
                        Link("Политика Google AI", destination: URL(string: "https://ai.google/responsibility/")!)
                    }
                    .font(.footnote)
                }
                .padding()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Закрыть") {
                        isPresented = false
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 12) {
                    Button {
                        onAccept()
                        isPresented = false
                    } label: {
                        Text("Согласен и продолжить")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    Button("Использовать без AI") {
                        onDecline()
                        isPresented = false
                    }
                    .font(.footnote)
                }
                .padding()
                .background(.ultraThinMaterial)
            }
        }
    }
}

struct DataSharingRow: View {
    let icon: String
    let title: String
    let description: String
    let dataType: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(.blue)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)

                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Label(dataType, systemImage: "arrow.up.circle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
    }
}

struct BulletPoint: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)

            Text(text)
                .font(.subheadline)
        }
    }
}
```

### 1.3 User-Generated Content (Guideline 1.2)

Для отзывов и коллекций требуется:

| Требование | Реализация |
|------------|------------|
| Механизм фильтрации контента | AI-модерация + ручная |
| Механизм жалоб | Кнопка "Пожаловаться" |
| Блокировка пользователей | Функция в профиле |
| Контактная информация | Email в настройках |

### 1.4 Privacy Manifest (обязательно с 2024)

```xml
<!-- PrivacyInfo.xcprivacy -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Декларация собираемых данных -->
    <key>NSPrivacyCollectedDataTypes</key>
    <array>
        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypeEmailAddress</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <true/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
            </array>
        </dict>
        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypeName</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <true/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
            </array>
        </dict>
        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypeUserID</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <true/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
            </array>
        </dict>
    </array>

    <!-- Декларация используемых API -->
    <key>NSPrivacyAccessedAPITypes</key>
    <array>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>C617.1</string>
            </array>
        </dict>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>CA92.1</string>
            </array>
        </dict>
    </array>

    <!-- Tracking declaration -->
    <key>NSPrivacyTracking</key>
    <false/>
</dict>
</plist>
```

---

## 2. GDPR Compliance

### 2.1 Основные требования

| Требование | Реализация в fancai |
|------------|---------------------|
| **Lawful basis** | Consent (явное согласие) |
| **Transparency** | Privacy Policy в приложении |
| **Data minimization** | Только необходимые данные |
| **Purpose limitation** | Данные используются только для заявленных целей |
| **Accuracy** | Возможность редактирования профиля |
| **Storage limitation** | Удаление неактивных аккаунтов через 2 года |
| **Security** | Шифрование, HTTPS, secure storage |
| **Accountability** | Логирование обработки данных |

### 2.2 Права субъекта данных

```swift
import SwiftUI

// MARK: - Data Rights Management

struct DataRightsView: View {
    @State private var showExportSheet = false
    @State private var showDeleteConfirmation = false
    @State private var isExporting = false
    @State private var isDeleting = false

    var body: some View {
        List {
            Section {
                Text("В соответствии с GDPR, вы имеете права на доступ, исправление, удаление и перенос ваших данных.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            // Право на доступ
            Section("Доступ к данным") {
                NavigationLink {
                    MyDataView()
                } label: {
                    Label("Просмотреть мои данные", systemImage: "doc.text.magnifyingglass")
                }
            }

            // Право на экспорт (portability)
            Section("Экспорт данных") {
                Button {
                    showExportSheet = true
                } label: {
                    HStack {
                        Label("Скачать мои данные", systemImage: "arrow.down.doc")

                        Spacer()

                        if isExporting {
                            ProgressView()
                        }
                    }
                }
                .disabled(isExporting)

                Text("Вы получите ZIP-архив со всеми вашими данными: профиль, статистика, закладки, отзывы.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            // Право на удаление
            Section("Удаление аккаунта") {
                Button(role: .destructive) {
                    showDeleteConfirmation = true
                } label: {
                    Label("Удалить аккаунт и все данные", systemImage: "trash")
                }
            }

            // Право на исправление
            Section("Исправление данных") {
                NavigationLink {
                    ProfileEditView()
                } label: {
                    Label("Редактировать профиль", systemImage: "pencil")
                }
            }
        }
        .navigationTitle("Мои права на данные")
        .sheet(isPresented: $showExportSheet) {
            DataExportSheet(isExporting: $isExporting)
        }
        .alert("Удаление аккаунта", isPresented: $showDeleteConfirmation) {
            Button("Отмена", role: .cancel) {}
            Button("Удалить всё", role: .destructive) {
                deleteAccount()
            }
        } message: {
            Text("Все ваши данные будут безвозвратно удалены: книги, изображения, статистика, профиль. Это действие нельзя отменить.")
        }
    }

    private func deleteAccount() {
        isDeleting = true
        // API call to delete account
    }
}

// MARK: - Data Export

struct DataExportSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var isExporting: Bool

    @State private var exportProgress: Double = 0
    @State private var downloadURL: URL?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                if isExporting {
                    VStack(spacing: 16) {
                        ProgressView(value: exportProgress)
                            .progressViewStyle(.linear)

                        Text("Подготовка данных...")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                } else if let url = downloadURL {
                    VStack(spacing: 16) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(.green)

                        Text("Данные готовы")
                            .font(.headline)

                        ShareLink(item: url) {
                            Label("Сохранить архив", systemImage: "arrow.down.circle")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                } else {
                    VStack(spacing: 16) {
                        Image(systemName: "arrow.down.doc")
                            .font(.system(size: 48))
                            .foregroundStyle(.blue)

                        Text("Экспорт данных")
                            .font(.headline)

                        Text("В архив будут включены:")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        VStack(alignment: .leading, spacing: 8) {
                            ExportItem(text: "Профиль и настройки")
                            ExportItem(text: "Статистика чтения")
                            ExportItem(text: "Закладки и заметки")
                            ExportItem(text: "Отзывы и рейтинги")
                            ExportItem(text: "История достижений")
                        }

                        Button("Начать экспорт") {
                            startExport()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
            .padding()
            .navigationTitle("Экспорт данных")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Закрыть") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func startExport() {
        isExporting = true
        // API call to export data
    }
}

struct ExportItem: View {
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
            Text(text)
        }
    }
}
```

### 2.3 Consent Management

```swift
import SwiftUI

// MARK: - Consent Manager

@Observable
class ConsentManager {
    static let shared = ConsentManager()

    // Типы согласий
    @AppStorage("consent.analytics") var analyticsConsent = false
    @AppStorage("consent.aiProcessing") var aiProcessingConsent = false
    @AppStorage("consent.marketing") var marketingConsent = false
    @AppStorage("consent.termsAccepted") var termsAccepted = false
    @AppStorage("consent.date") var consentDate: Date?

    // Проверка необходимости показать consent
    var needsConsent: Bool {
        !termsAccepted
    }

    // Необходимые согласия для AI
    var canUseAIFeatures: Bool {
        aiProcessingConsent
    }

    // Отзыв согласия
    func revokeConsent(type: ConsentType) {
        switch type {
        case .analytics:
            analyticsConsent = false
        case .aiProcessing:
            aiProcessingConsent = false
        case .marketing:
            marketingConsent = false
        case .terms:
            break // Нельзя отозвать terms (нужно удалить аккаунт)
        }
    }

    // Запись согласия
    func recordConsent(
        analytics: Bool,
        aiProcessing: Bool,
        marketing: Bool
    ) {
        self.analyticsConsent = analytics
        self.aiProcessingConsent = aiProcessing
        self.marketingConsent = marketing
        self.termsAccepted = true
        self.consentDate = Date()

        // Отправка на сервер для аудита
        Task {
            await sendConsentToServer()
        }
    }

    private func sendConsentToServer() async {
        // POST /api/v1/consent
    }

    enum ConsentType {
        case analytics
        case aiProcessing
        case marketing
        case terms
    }
}

// MARK: - Consent Screen

struct ConsentScreen: View {
    @Environment(\.dismiss) private var dismiss
    @State private var consentManager = ConsentManager.shared

    @State private var analyticsEnabled = true
    @State private var aiEnabled = true
    @State private var marketingEnabled = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // Заголовок
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Добро пожаловать в fancai")
                            .font(.largeTitle.bold())

                        Text("Для продолжения, пожалуйста, ознакомьтесь с условиями использования")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    Divider()

                    // Обязательные условия
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Обязательные условия")
                            .font(.headline)

                        ConsentRow(
                            title: "Условия использования",
                            description: "Правила пользования сервисом",
                            isRequired: true,
                            isEnabled: .constant(true),
                            linkURL: URL(string: "https://fancai.ru/terms")
                        )

                        ConsentRow(
                            title: "Политика конфиденциальности",
                            description: "Как мы обрабатываем ваши данные",
                            isRequired: true,
                            isEnabled: .constant(true),
                            linkURL: URL(string: "https://fancai.ru/privacy")
                        )
                    }

                    Divider()

                    // Опциональные согласия
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Дополнительные разрешения")
                            .font(.headline)

                        ConsentRow(
                            title: "AI-обработка текста",
                            description: "Извлечение описаний и генерация изображений с использованием Google AI",
                            isRequired: false,
                            isEnabled: $aiEnabled,
                            linkURL: URL(string: "https://fancai.ru/ai-privacy")
                        )

                        ConsentRow(
                            title: "Аналитика",
                            description: "Анонимная статистика для улучшения приложения",
                            isRequired: false,
                            isEnabled: $analyticsEnabled,
                            linkURL: nil
                        )

                        ConsentRow(
                            title: "Маркетинговые уведомления",
                            description: "Новости, акции и специальные предложения",
                            isRequired: false,
                            isEnabled: $marketingEnabled,
                            linkURL: nil
                        )
                    }
                }
                .padding()
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    Button {
                        acceptAndContinue()
                    } label: {
                        Text("Принять и продолжить")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    Text("Нажимая «Принять», вы соглашаетесь с обязательными условиями")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
                .padding()
                .background(.ultraThinMaterial)
            }
        }
    }

    private func acceptAndContinue() {
        consentManager.recordConsent(
            analytics: analyticsEnabled,
            aiProcessing: aiEnabled,
            marketing: marketingEnabled
        )
        dismiss()
    }
}

struct ConsentRow: View {
    let title: String
    let description: String
    let isRequired: Bool
    @Binding var isEnabled: Bool
    let linkURL: URL?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(title)
                        .font(.subheadline.bold())

                    if isRequired {
                        Text("Обязательно")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.blue.opacity(0.2))
                            .clipShape(Capsule())
                    }
                }

                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let url = linkURL {
                    Link("Подробнее", destination: url)
                        .font(.caption)
                }
            }

            Spacer()

            if isRequired {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            } else {
                Toggle("", isOn: $isEnabled)
                    .labelsHidden()
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
```

---

## 3. 152-ФЗ (Российский закон о персональных данных)

### 3.1 Ключевые требования (с июля 2025)

| Требование | Срок | Влияние на fancai |
|------------|------|-------------------|
| **Локализация данных** | 1 июля 2025 | Backend должен быть в России |
| **Раздельное согласие** | 1 сентября 2025 | Отдельная форма согласия |
| **Анонимизация по запросу** | 1 сентября 2025 | Возможность анонимизации данных |

### 3.2 Архитектура для соответствия 152-ФЗ

```
┌─────────────────────────────────────────────────────────────────┐
│                    Российские пользователи                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                      ┌────────────────┐                         │
│                      │   iOS App      │                         │
│                      └────────┬───────┘                         │
│                               │                                  │
│                               ▼                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │               Backend (Россия, ru-central1)                 ││
│  │                                                              ││
│  │   ┌─────────────────┐  ┌─────────────────────────────────┐  ││
│  │   │ PostgreSQL      │  │ Redis                           │  ││
│  │   │ (персональные   │  │ (сессии)                        │  ││
│  │   │  данные)        │  │                                 │  ││
│  │   └─────────────────┘  └─────────────────────────────────┘  ││
│  │                                                              ││
│  │   Первичная обработка персональных данных:                  ││
│  │   • Email, имя, профиль                                     ││
│  │   • Статистика чтения                                       ││
│  │   • Подписки и платежи                                      ││
│  └──────────────────────────┬──────────────────────────────────┘│
│                             │                                    │
│                             │ Только анонимизированные данные    │
│                             ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           External AI Services (Google Cloud)               ││
│  │                                                              ││
│  │   • Gemini API (текст книги — не персональные данные)       ││
│  │   • Imagen API (описания — не персональные данные)          ││
│  │                                                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Реализация согласия по 152-ФЗ

```swift
// MARK: - 152-FZ Specific Consent

struct Russian152FZConsentView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var agreedToProcessing = false
    @State private var agreedToStorage = false

    let onAccept: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Согласие на обработку персональных данных")
                        .font(.title2.bold())

                    // Текст согласия
                    VStack(alignment: .leading, spacing: 16) {
                        Text("""
                        В соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных», я даю своё согласие ООО «Фанкай» (ИНН: XXXXXXXX) на обработку моих персональных данных.
                        """)
                        .font(.subheadline)

                        // Категории данных
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Категории обрабатываемых данных:")
                                .font(.subheadline.bold())

                            BulletText("Фамилия, имя")
                            BulletText("Адрес электронной почты")
                            BulletText("Идентификатор пользователя")
                            BulletText("Данные об использовании приложения")
                        }

                        // Цели
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Цели обработки:")
                                .font(.subheadline.bold())

                            BulletText("Предоставление услуг приложения")
                            BulletText("Идентификация пользователя")
                            BulletText("Техническая поддержка")
                            BulletText("Улучшение качества услуг")
                        }

                        // Срок
                        Text("""
                        Согласие действует до момента его отзыва или удаления аккаунта. Согласие может быть отозвано путём направления письменного заявления на адрес: privacy@fancai.ru
                        """)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }

                    Divider()

                    // Чекбоксы
                    VStack(spacing: 16) {
                        Toggle(isOn: $agreedToProcessing) {
                            Text("Даю согласие на обработку персональных данных")
                                .font(.subheadline)
                        }

                        Toggle(isOn: $agreedToStorage) {
                            Text("Даю согласие на хранение данных на территории РФ")
                                .font(.subheadline)
                        }
                    }
                }
                .padding()
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    onAccept()
                    dismiss()
                } label: {
                    Text("Подтвердить согласие")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!agreedToProcessing || !agreedToStorage)
                .padding()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Закрыть") {
                        dismiss()
                    }
                }
            }
        }
    }
}

struct BulletText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•")
            Text(text)
        }
        .font(.subheadline)
    }
}
```

---

## 4. App Tracking Transparency (ATT)

### 4.1 Нужен ли ATT для fancai?

| Критерий | fancai | ATT требуется? |
|----------|--------|----------------|
| Отслеживание для рекламы | ❌ Нет | Нет |
| Передача IDFA | ❌ Нет | Нет |
| Fingerprinting | ❌ Нет | Нет |
| Сторонняя аналитика (TelemetryDeck) | Privacy-first, без tracking | Нет |

**Вывод:** ATT prompt НЕ требуется, так как приложение не использует tracking.

### 4.2 Info.plist (если понадобится в будущем)

```xml
<!-- Только если добавим рекламу или tracking -->
<key>NSUserTrackingUsageDescription</key>
<string>Мы используем идентификатор устройства для персонализации рекламы и улучшения рекомендаций</string>
```

---

## 5. Чеклист Privacy Compliance

### 5.1 Pre-Launch Checklist

| Пункт | Статус | Ответственный |
|-------|--------|---------------|
| Privacy Policy опубликована | ⬜ | Legal |
| Terms of Service опубликованы | ⬜ | Legal |
| Privacy Manifest добавлен | ⬜ | iOS Dev |
| Consent flow реализован | ⬜ | iOS Dev |
| Data export API реализовано | ⬜ | Backend Dev |
| Account deletion API реализовано | ⬜ | Backend Dev |
| Модерация UGC настроена | ⬜ | Backend Dev |
| Backend размещён в России (152-ФЗ) | ⬜ | DevOps |
| App Store Privacy Labels заполнены | ⬜ | Product |

### 5.2 App Store Privacy Labels

```yaml
Data Linked to You:
  - Contact Info:
      - Email Address: Used for app functionality
      - Name: Used for app functionality

  - Identifiers:
      - User ID: Used for app functionality

  - Usage Data:
      - Product Interaction: Used for analytics

Data Not Linked to You:
  - Diagnostics:
      - Crash Data: Used for analytics
```

---

## 6. Политика конфиденциальности (структура)

### 6.1 Обязательные разделы

1. **Введение** — кто оператор, контакты
2. **Какие данные собираем** — полный список
3. **Как используем данные** — цели обработки
4. **Хранение данных** — где, как долго
5. **Передача третьим лицам** — кому, зачем (Google AI)
6. **Ваши права** — доступ, удаление, экспорт
7. **Защита данных** — меры безопасности
8. **Файлы cookie** — если применимо
9. **Дети** — политика для несовершеннолетних
10. **Изменения политики** — как уведомляем
11. **Контакты** — email, адрес

---

## Источники

- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple Privacy Manifest Documentation](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files)
- [GDPR Official Text](https://gdpr.eu/)
- [152-ФЗ О персональных данных](https://www.consultant.ru/document/cons_doc_LAW_61801/)
- [Роскомнадзор — Разъяснения по 152-ФЗ](https://rkn.gov.ru/)
