# Детальный план разработки — Часть 3: Reader и AI Features

**Продолжение:** DEVELOPMENT_PLAN_PART2.md

---

## 6. Phase 3: EPUB/FB2 Reader

**Срок:** Неделя 6-8
**Цель:** Полнофункциональный reader с навигацией и кастомизацией

### Task 3.1: Интеграция Readium Navigator

**Приоритет:** P0 | **Оценка:** 12h | **Зависимости:** 0.4

**Критическая задача** — основа для всех функций reader

**Файлы:**
- `Features/Reader/Views/EPUBReaderView.swift`
- `Features/Reader/ViewModels/ReaderViewModel.swift`
- `Features/Reader/Services/ReadiumService.swift`

**ReadiumService.swift:**
```swift
import ReadiumNavigator
import ReadiumShared
import ReadiumStreamer

class ReadiumService {
    private let streamer = Streamer()
    private var publication: Publication?
    private var navigator: EPUBNavigatorViewController?
    
    func openBook(at url: URL) async throws -> Publication {
        let asset = FileAsset(url: url)
        let publication = try await streamer.open(asset: asset, allowUserInteraction: false)
        self.publication = publication
        return publication
    }
    
    func createNavigator(
        publication: Publication,
        initialLocator: Locator?,
        delegate: EPUBNavigatorDelegate
    ) -> EPUBNavigatorViewController {
        let navigator = EPUBNavigatorViewController(
            publication: publication,
            initialLocation: initialLocator,
            config: .init(
                preferences: EPUBPreferences(
                    fontFamily: .init(rawValue: "Georgia"),
                    fontSize: 1.0,
                    theme: .light
                )
            )
        )
        navigator.delegate = delegate
        self.navigator = navigator
        return navigator
    }
}
```

**EPUBReaderView.swift (UIViewControllerRepresentable):**
```swift
import SwiftUI
import ReadiumNavigator

struct EPUBReaderView: UIViewControllerRepresentable {
    let publication: Publication
    let initialLocator: Locator?
    @Binding var currentLocator: Locator?
    
    func makeUIViewController(context: Context) -> EPUBNavigatorViewController {
        let navigator = Container.shared.readiumService().createNavigator(
            publication: publication,
            initialLocator: initialLocator,
            delegate: context.coordinator
        )
        return navigator
    }
    
    func updateUIViewController(_ uiViewController: EPUBNavigatorViewController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(currentLocator: $currentLocator)
    }
    
    class Coordinator: NSObject, EPUBNavigatorDelegate {
        @Binding var currentLocator: Locator?
        
        init(currentLocator: Binding<Locator?>) {
            _currentLocator = currentLocator
        }
        
        func navigator(_ navigator: Navigator, locationDidChange locator: Locator) {
            currentLocator = locator
        }
    }
}
```

**Шаги:**
1. Изучить Readium Navigator API
2. Создать обёртку для SwiftUI
3. Реализовать базовое отображение
4. Тестировать на разных EPUB файлах

**Критерии готовности:**
- [ ] EPUB открывается и отображается
- [ ] Текст читаемый с корректным форматированием
- [ ] Изображения в книге отображаются

---

### Task 3.2: Readium конфигурация

**Приоритет:** P0 | **Оценка:** 6h | **Зависимости:** 3.1

**EPUBPreferences конфигурация:**
```swift
struct ReaderSettings: Codable {
    var fontFamily: String = "Georgia"
    var fontSize: Double = 1.0  // 0.5 - 2.0
    var lineHeight: Double = 1.4
    var theme: ReaderTheme = .light
    var textAlign: TextAlignment = .justify
    var margins: Double = 16
}

enum ReaderTheme: String, Codable, CaseIterable {
    case light, dark, sepia
    
    var backgroundColor: Color {
        switch self {
        case .light: return .white
        case .dark: return Color(hex: "1C1C1E")
        case .sepia: return Color(hex: "F4ECD8")
        }
    }
    
    var textColor: Color {
        switch self {
        case .light: return .black
        case .dark: return .white
        case .sepia: return Color(hex: "5B4636")
        }
    }
}
```

**Критерии готовности:**
- [ ] Preferences сохраняются в UserDefaults
- [ ] Изменения применяются без перезагрузки
- [ ] Syncс Readium EPUBPreferences

---

### Task 3.3: FB2 → EPUB конвертация

**Приоритет:** P0 | **Оценка:** 8h | **Зависимости:** Нет

**Подход:** Конвертировать FB2 в EPUB при импорте, читать как EPUB

**Features/Library/Services/FB2Converter.swift:**
```swift
class FB2Converter {
    func convert(fb2URL: URL) async throws -> URL {
        let fb2Data = try Data(contentsOf: fb2URL)
        let xml = try XMLDocument(data: fb2Data)
        
        // 1. Extract metadata
        let metadata = extractMetadata(from: xml)
        
        // 2. Extract body sections
        let chapters = extractChapters(from: xml)
        
        // 3. Extract images (base64 → files)
        let images = extractImages(from: xml)
        
        // 4. Generate EPUB structure
        let epubURL = try generateEPUB(
            metadata: metadata,
            chapters: chapters,
            images: images,
            originalName: fb2URL.lastPathComponent
        )
        
        return epubURL
    }
    
    private func generateEPUB(...) throws -> URL {
        // Create EPUB structure:
        // - mimetype (uncompressed)
        // - META-INF/container.xml
        // - OEBPS/content.opf
        // - OEBPS/toc.ncx
        // - OEBPS/chapter_*.xhtml
        // - OEBPS/images/*
    }
}
```

**Критерии готовности:**
- [ ] FB2 с кириллицей конвертируется корректно
- [ ] Изображения сохраняются
- [ ] Оглавление переносится

---

### Task 3.4: Tap Zones навигация

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 3.1

**Зоны:**
```
┌─────────────────────────┐
│     ← Prev (25%)        │
│                         │
│     Menu (50%)          │
│                         │
│     Next → (25%)        │
└─────────────────────────┘
```

**Реализация:**
```swift
extension EPUBNavigatorViewController {
    func setupTapZones() {
        let tapGesture = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        view.addGestureRecognizer(tapGesture)
    }
    
    @objc func handleTap(_ gesture: UITapGestureRecognizer) {
        let location = gesture.location(in: view)
        let width = view.bounds.width
        
        if location.x < width * 0.25 {
            goBackward(animated: true)
        } else if location.x > width * 0.75 {
            goForward(animated: true)
        } else {
            toggleMenu()
        }
    }
}
```

**Критерии готовности:**
- [ ] Тап слева — назад
- [ ] Тап справа — вперёд
- [ ] Тап по центру — меню

---

### Task 3.5-3.6: Swipe и Page Curl

**Приоритет:** P0 | **Оценка:** 10h | **Зависимости:** 3.1

**Readium поддерживает:**
- `Scrolling` — вертикальный скролл
- `Pagination` — горизонтальный пейджинг

**Page curl анимация:** Требует кастомной реализации или библиотеки

**Критерии готовности:**
- [ ] Swipe влево/вправо работает
- [ ] Page curl (базовый) для iOS-like experience
- [ ] Настройка в Settings

---

### Task 3.7: Settings Panel

**Приоритет:** P0 | **Оценка:** 8h | **Зависимости:** 3.2

**Features/Reader/Views/ReaderSettingsSheet.swift:**
```swift
struct ReaderSettingsSheet: View {
    @Binding var settings: ReaderSettings
    
    var body: some View {
        NavigationStack {
            List {
                // Font Size
                Section("Размер шрифта") {
                    Slider(value: $settings.fontSize, in: 0.5...2.0, step: 0.1)
                    Text("Aa").font(.system(size: 16 * settings.fontSize))
                }
                
                // Font Family
                Section("Шрифт") {
                    Picker("Шрифт", selection: $settings.fontFamily) {
                        Text("Georgia").tag("Georgia")
                        Text("Palatino").tag("Palatino")
                        Text("System").tag("-apple-system")
                    }
                }
                
                // Theme
                Section("Тема") {
                    Picker("Тема", selection: $settings.theme) {
                        ForEach(ReaderTheme.allCases, id: \.self) { theme in
                            ThemePreview(theme: theme)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                
                // Line Height
                Section("Межстрочный интервал") {
                    Slider(value: $settings.lineHeight, in: 1.0...2.0, step: 0.1)
                }
            }
            .navigationTitle("Настройки чтения")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }
}
```

**Критерии готовности:**
- [ ] Все настройки работают
- [ ] Preview изменений в реальном времени
- [ ] Сохранение при закрытии

---

### Task 3.8-3.9: Темы и шрифты

**Приоритет:** P0 | **Оценка:** 8h | **Зависимости:** 3.7

**Кастомные шрифты:**
1. Добавить .ttf/.otf в Resources/Fonts/
2. Добавить в Info.plist: `Fonts provided by application`
3. Использовать в Readium EPUBPreferences

**Критерии готовности:**
- [ ] Light/Dark/Sepia темы
- [ ] Минимум 3 шрифта (serif, sans-serif, monospace)
- [ ] Изменения применяются мгновенно

---

### Task 3.10-3.17: TOC, Прогресс, Закладки, Highlights, Поиск, iPad

**Приоритет:** P0-P1 | **Оценка:** 38h | **Зависимости:** 3.1

Полные спецификации: `ios-epub-reader-best-practices.md`

---

## 7. Phase 4: AI Features

**Срок:** Неделя 9-11
**Цель:** Извлечение описаний и генерация изображений

### Task 4.1: Backend Gemini API интеграция

**Приоритет:** P0 | **Оценка:** 6h | **Зависимости:** 0.10

**backend/app/services/gemini.py:**
```python
import google.generativeai as genai
from app.core.config import settings

genai.configure(api_key=settings.GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.5-flash')

EXTRACTION_PROMPT = """
Извлеки из текста описания персонажей, локаций и важных объектов.

Для каждой сущности верни JSON:
{
    "type": "character" | "location" | "object",
    "name": "имя",
    "description": "подробное визуальное описание для генерации изображения",
    "appearance": "внешность (для персонажей)",
    "context": "контекст первого появления"
}

Текст:
{text}
"""

async def extract_entities(text: str) -> list[dict]:
    response = await model.generate_content_async(
        EXTRACTION_PROMPT.format(text=text),
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json"
        )
    )
    return json.loads(response.text)
```

**Критерии готовности:**
- [ ] API key настроен в environment
- [ ] JSON response парсится корректно
- [ ] Rate limiting реализован

---

### Task 4.2: Backend Imagen 4 API интеграция

**Приоритет:** P0 | **Оценка:** 6h | **Зависимости:** 0.10

**backend/app/services/imagen.py:**
```python
from google.cloud import aiplatform
from google.cloud.aiplatform import ImageGenerationModel

model = ImageGenerationModel.from_pretrained("imagen-4-standard")

async def generate_image(
    prompt: str,
    reference_image: bytes | None = None,
    style: str = "realistic"
) -> bytes:
    """
    Generate image using Imagen 4.
    
    Args:
        prompt: Text description
        reference_image: Optional reference for consistency
        style: Art style (realistic, anime, watercolor, etc.)
    
    Returns:
        PNG image bytes
    """
    style_suffix = {
        "realistic": ", photorealistic, highly detailed",
        "anime": ", anime style, Studio Ghibli",
        "watercolor": ", watercolor painting style",
        "oil_painting": ", oil painting, classical art style"
    }
    
    full_prompt = prompt + style_suffix.get(style, "")
    
    if reference_image:
        # Use IP-Adapter for consistency
        response = model.generate_images(
            prompt=full_prompt,
            reference_images=[Image(reference_image)],
            reference_strength=0.7,
            number_of_images=1
        )
    else:
        response = model.generate_images(
            prompt=full_prompt,
            number_of_images=1
        )
    
    return response.images[0]._image_bytes
```

**Критерии готовности:**
- [ ] Изображение генерируется по prompt
- [ ] Разные стили работают
- [ ] Reference image влияет на результат

---

### Task 4.3: Backend Book Processing Endpoint

**Приоритет:** P0 | **Оценка:** 8h | **Зависимости:** 4.1

**backend/app/api/v1/ai.py:**
```python
from fastapi import APIRouter, BackgroundTasks
from app.services.gemini import extract_entities
from app.services.book_processor import process_book_chunks

router = APIRouter()

@router.post("/books/{book_id}/process")
async def start_processing(
    book_id: str,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user)
):
    """Start background book processing"""
    
    # Check user limits
    if not await check_processing_limit(user):
        raise HTTPException(status_code=429, detail="Processing limit reached")
    
    # Start background task
    background_tasks.add_task(process_book_async, book_id, user.id)
    
    return {"status": "processing", "book_id": book_id}

@router.get("/books/{book_id}/entities")
async def get_entities(
    book_id: str,
    user: User = Depends(get_current_user)
):
    """Get extracted entities for a book"""
    entities = await get_book_entities(book_id)
    return {"entities": entities}
```

**Background processing:**
1. Получить текст книги (по главам)
2. Отправить каждую главу в Gemini
3. Агрегировать сущности (дедупликация)
4. Сохранить в БД
5. Отправить push-уведомление

**Критерии готовности:**
- [ ] Background processing работает
- [ ] Прогресс отслеживается
- [ ] Результаты сохраняются

---

### Task 4.4: Backend Image Generation Endpoint

**Приоритет:** P0 | **Оценка:** 6h | **Зависимости:** 4.2

**Endpoint:** `POST /v1/ai/entities/{entity_id}/generate`

**Request:**
```json
{
    "style": "realistic",
    "reference_entity_id": "uuid-of-reference" // optional
}
```

**Response:**
```json
{
    "image_id": "uuid",
    "url": "https://cdn.fancai.ru/images/uuid.png",
    "prompt_used": "...",
    "created_at": "2026-01-17T12:00:00Z"
}
```

**Критерии готовности:**
- [ ] Изображение генерируется
- [ ] Сохраняется в storage (S3/GCS)
- [ ] URL возвращается клиенту

---

### Task 4.5: iOS Processing Trigger UI

**Приоритет:** P0 | **Оценка:** 4h | **Зависимости:** 4.3

**Features/AI/Views/ProcessBookButton.swift:**
```swift
struct ProcessBookButton: View {
    let book: Book
    @State private var isProcessing = false
    @State private var progress: Double = 0
    
    var body: some View {
        Button {
            Task { await startProcessing() }
        } label: {
            HStack {
                if isProcessing {
                    ProgressView()
                        .progressViewStyle(.circular)
                    Text("Обработка... \(Int(progress * 100))%")
                } else {
                    Image(systemName: "sparkles")
                    Text("Извлечь описания")
                }
            }
        }
        .disabled(isProcessing)
    }
    
    private func startProcessing() async {
        isProcessing = true
        do {
            try await Container.shared.aiService().processBook(book.id)
            // Poll for status or use WebSocket
        } catch {
            // Handle error
        }
        isProcessing = false
    }
}
```

**Критерии готовности:**
- [ ] Кнопка на BookDetailView
- [ ] Loading state во время обработки
- [ ] Уведомление о завершении

---

### Task 4.6-4.15: AI UI компоненты

**Приоритет:** P0-P1 | **Оценка:** 52h | **Зависимости:** 4.1-4.4

| Task | Описание | Оценка |
|------|----------|--------|
| 4.6 | Processing progress indicator | 4h |
| 4.7 | Entity cards (Character, Location) | 8h |
| 4.8 | Highlight описаний в reader | 8h |
| 4.9 | Image generation trigger | 4h |
| 4.10 | Image preview/fullscreen | 4h |
| 4.11 | Gallery view | 6h |
| 4.12 | Backend: Консистентность (IP-Adapter) | 12h |
| 4.13 | Reference image selection | 4h |
| 4.14 | Стили генерации | 4h |
| 4.15 | Error handling и retry | 4h |

Полные спецификации: `ios-ai-features-specification.md`

---

## Продолжение

> **Следующие фазы:** См. `DEVELOPMENT_PLAN_PART4.md`
