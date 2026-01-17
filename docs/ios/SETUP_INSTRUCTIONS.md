# Инструкции по подготовке к разработке fancai iOS

**Дата:** 2026-01-17

---

## Шаг 1: Получение доступов (День 1)

### 1.1 Apple Developer Program

```bash
# 1. Зайти на https://developer.apple.com/programs/
# 2. Нажать "Enroll" → Individual или Organization
# 3. Оплатить $99/год
# 4. Дождаться подтверждения (до 48 часов)
```

### 1.2 Google Cloud Console

1. Создать проект: https://console.cloud.google.com
2. Включить APIs:
   - Generative Language API (Gemini)
   - Vertex AI API (Imagen)
3. Создать API Key: APIs & Services → Credentials
4. Сохранить ключ в безопасном месте

### 1.3 RevenueCat

1. Зарегистрироваться: https://app.revenuecat.com
2. Создать Project: "fancai"
3. Добавить iOS App с Bundle ID: `ru.fancai.app`
4. Скопировать Public API Key

### 1.4 Firebase (Crashlytics)

1. Создать проект: https://console.firebase.google.com
2. Добавить iOS App
3. Скачать `GoogleService-Info.plist`

### 1.5 GitHub Repository

```bash
# Создать репозиторий (приватный)
gh repo create fancai-ios --private

# Клонировать
git clone https://github.com/[username]/fancai-ios.git
cd fancai-ios
```

---

## Шаг 2: Настройка окружения (День 2)

### 2.1 Установка Xcode

```bash
# Через App Store или
xcode-select --install

# Проверить версию
xcodebuild -version
# Xcode 16.0 или выше
```

### 2.2 Установка Homebrew и инструментов

```bash
# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# SwiftLint (линтер)
brew install swiftlint

# SwiftFormat (форматтер)
brew install swiftformat
```

### 2.3 Python для Backend

```bash
# Python 3.11+
brew install python@3.11

# Poetry (менеджер зависимостей)
pip install poetry

# Проверить
python3 --version
poetry --version
```

### 2.4 PostgreSQL и Redis

```bash
# PostgreSQL
brew install postgresql@15
brew services start postgresql@15

# Redis
brew install redis
brew services start redis

# Создать базу данных
createdb fancai_dev
```

---

## Шаг 3: Создание Xcode проекта (День 3)

### 3.1 Создание проекта

1. Open Xcode → File → New → Project
2. Выбрать: iOS → App
3. Настройки:
   - Product Name: `Fancai`
   - Team: [Your Team]
   - Organization Identifier: `ru.fancai`
   - Interface: SwiftUI
   - Language: Swift
   - Storage: SwiftData
   - Include Tests: ✅

### 3.2 Настройка Capabilities

1. Project → Target → Signing & Capabilities
2. Добавить:
   - Sign in with Apple
   - Push Notifications
   - iCloud → CloudKit (выбрать container)
   - Background Modes → Remote notifications

### 3.3 Добавление SPM зависимостей

File → Add Package Dependencies:

| Package | URL |
|---------|-----|
| Factory | `https://github.com/hmlongco/Factory` |
| Nuke | `https://github.com/kean/Nuke` |
| RevenueCat | `https://github.com/RevenueCat/purchases-ios-spm` |
| Firebase | `https://github.com/firebase/firebase-ios-sdk` |
| TelemetryDeck | `https://github.com/TelemetryDeck/SwiftClient` |
| Readium | `https://github.com/readium/swift-toolkit` |

---

## Шаг 4: Структура проекта (День 3-4)

### 4.1 Создание папок

```
Fancai/
├── App/
├── Core/
│   ├── DI/
│   ├── Network/
│   ├── Storage/
│   └── Utilities/
├── Features/
│   ├── Auth/
│   ├── Library/
│   ├── Reader/
│   ├── AI/
│   ├── Profile/
│   └── Settings/
├── UI/
│   ├── Components/
│   ├── Modifiers/
│   └── Styles/
└── Resources/
```

### 4.2 Создание базовых файлов

```bash
# В Xcode создать группы и файлы:
# Core/DI/Container+Factories.swift
# Core/Network/APIClient.swift
# Core/Storage/KeychainManager.swift
# Core/Utilities/Logger+Extensions.swift
# UI/Styles/Colors.swift
# UI/Components/PrimaryButton.swift
```

---

## Шаг 5: Настройка Backend (День 4-5)

### 5.1 Создание структуры

```bash
mkdir -p backend/app/{api/v1,models,schemas,services,core}
cd backend

# Инициализация Poetry
poetry init --name fancai-backend --python "^3.11"
```

### 5.2 Установка зависимостей

```bash
poetry add fastapi uvicorn[standard] sqlalchemy asyncpg pydantic python-jose[cryptography] passlib[bcrypt] httpx google-generativeai alembic
poetry add --group dev pytest pytest-asyncio httpx
```

### 5.3 Базовый main.py

```python
# backend/app/main.py
from fastapi import FastAPI
from app.api.v1 import auth, books, ai, users

app = FastAPI(title="Fancai API", version="1.0.0")

app.include_router(auth.router, prefix="/v1/auth", tags=["Auth"])
app.include_router(books.router, prefix="/v1/books", tags=["Books"])
app.include_router(ai.router, prefix="/v1/ai", tags=["AI"])
app.include_router(users.router, prefix="/v1/users", tags=["Users"])

@app.get("/health")
def health():
    return {"status": "ok"}
```

### 5.4 Запуск

```bash
poetry run uvicorn app.main:app --reload
# Open http://localhost:8000/docs
```

---

## Шаг 6: Конфигурация секретов (День 5)

### 6.1 iOS — Config.xcconfig

```xcconfig
# Fancai/Resources/Config.xcconfig (НЕ коммитить!)
API_BASE_URL = https://api.fancai.ru
REVENUECAT_API_KEY = appl_xxxxx
TELEMETRY_APP_ID = xxxxx
```

### 6.2 iOS — Config.swift

```swift
// Core/Config.swift
enum Config {
    static let apiBaseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String ?? ""
    static let revenueCatAPIKey = Bundle.main.infoDictionary?["REVENUECAT_API_KEY"] as? String ?? ""
    static let telemetryAppID = Bundle.main.infoDictionary?["TELEMETRY_APP_ID"] as? String ?? ""
}
```

### 6.3 Backend — .env

```bash
# backend/.env (НЕ коммитить!)
DATABASE_URL=postgresql+asyncpg://localhost/fancai_dev
REDIS_URL=redis://localhost:6379
SECRET_KEY=your-secret-key-here
GEMINI_API_KEY=AIzaSy...
GOOGLE_CLOUD_PROJECT=fancai-prod
APNS_KEY_ID=...
APNS_TEAM_ID=...
```

---

## Шаг 7: Git Setup (День 5)

### 7.1 .gitignore

```gitignore
# Xcode
DerivedData/
*.xcworkspace/xcuserdata/
*.xcodeproj/xcuserdata/

# Secrets
*.xcconfig
!*.xcconfig.template
.env
GoogleService-Info.plist

# Python
__pycache__/
*.pyc
.venv/

# OS
.DS_Store
```

### 7.2 Первый коммит

```bash
git add .
git commit -m "Initial project structure"
git push -u origin main
```

---

## Шаг 8: CI/CD Setup (День 6)

### 8.1 GitHub Actions — iOS

```yaml
# .github/workflows/ios.yml
name: iOS CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: xcodebuild build -scheme Fancai -destination 'platform=iOS Simulator,name=iPhone 15 Pro'
      - name: Test
        run: xcodebuild test -scheme Fancai -destination 'platform=iOS Simulator,name=iPhone 15 Pro'
```

### 8.2 Xcode Cloud (опционально)

1. Project → Settings → Xcode Cloud
2. Create Workflow
3. Configure: Build on PR, Deploy to TestFlight on main

---

## Чеклист готовности

```
□ Apple Developer Program активен
□ Bundle ID зарегистрирован
□ Google Cloud API keys получены
□ RevenueCat настроен
□ Firebase Crashlytics добавлен
□ Xcode проект создан и компилируется
□ SPM зависимости установлены
□ Структура папок создана
□ Backend запускается
□ Git репозиторий настроен
□ Секреты не в git
□ CI/CD работает
```

**После выполнения всех шагов — готовы к Phase 1: Authentication!**
