# iOS EPUB/FB2 Reader Best Practices 2026

**Дата:** 2026-01-17
**Scope:** iOS native (SwiftUI/UIKit) и web-based реализации EPUB/FB2 ридеров
**Автор:** Claude Code

## Executive Summary

Исследование охватывает 10 ключевых областей разработки iOS EPUB/FB2 ридера: навигация (tap-зоны и swipe), анимации перелистывания, жесты, haptic feedback, ориентация экрана, TOC, поиск, прогресс чтения, preloading и поддержка RTL/вертикального текста. Основные библиотеки: Readium Swift Toolkit (рекомендуется), FolioReaderKit, EPUBKit. Apple Human Interface Guidelines 2025 требует минимальный размер touch target 44x44 points.

---

## 1. Навигация по книге

### 1.1 Tap-зоны vs Swipe-жесты

**Конкуренты используют оба подхода:**

| Приложение | Tap-зоны | Swipe | По умолчанию |
|------------|----------|-------|--------------|
| Apple Books | Да | Да | Tap |
| Kindle | Да | Да | Tap |
| Kobo | Да | Да | Настраивается |
| Google Play Books | Да | Да | Swipe |

**Kobo предлагает настройку:**
> "Beside 'Page forward and back by', you can select between 'Tapping or swiping' and 'Swiping only'"

### 1.2 Размеры tap-зон

**Apple HIG рекомендует:**
- Минимальный touch target: **44x44 points**
- Исследования показывают, что элементы меньше этого размера пропускаются >25% пользователей

**Рекомендуемая схема tap-зон:**

```
┌─────────────────────────────────┐
│  ←  │      центр      │  →      │
│ 25% │       50%       │   25%   │
│     │                 │         │
│prev │  show/hide UI   │  next   │
│page │                 │  page   │
└─────────────────────────────────┘
```

### 1.3 Реализация в SwiftUI

```swift
import SwiftUI

enum NavigationMode {
    case tapOnly
    case swipeOnly
    case both
}

struct ReaderNavigationView: View {
    @Binding var currentPage: Int
    @State var navigationMode: NavigationMode = .both
    @State var showUI: Bool = false

    let totalPages: Int

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Контент страницы
                PageContentView(page: currentPage)

                // Tap-зоны (если включены)
                if navigationMode != .swipeOnly {
                    HStack(spacing: 0) {
                        // Левая зона - предыдущая страница
                        Color.clear
                            .frame(width: geometry.size.width * 0.25)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                withAnimation { goToPreviousPage() }
                            }

                        // Центральная зона - показать/скрыть UI
                        Color.clear
                            .frame(width: geometry.size.width * 0.5)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                withAnimation { showUI.toggle() }
                            }

                        // Правая зона - следующая страница
                        Color.clear
                            .frame(width: geometry.size.width * 0.25)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                withAnimation { goToNextPage() }
                            }
                    }
                }
            }
            // Swipe-жесты (если включены)
            .gesture(
                navigationMode != .tapOnly ?
                DragGesture(minimumDistance: 50)
                    .onEnded { value in
                        if value.translation.width < 0 {
                            goToNextPage()
                        } else if value.translation.width > 0 {
                            goToPreviousPage()
                        }
                    }
                : nil
            )
        }
    }

    private func goToNextPage() {
        if currentPage < totalPages - 1 {
            currentPage += 1
        }
    }

    private func goToPreviousPage() {
        if currentPage > 0 {
            currentPage -= 1
        }
    }
}
```

### 1.4 Настройка пользователем

```swift
struct NavigationSettingsView: View {
    @AppStorage("navigationMode") var navigationMode: String = "both"

    var body: some View {
        Form {
            Section("Навигация по страницам") {
                Picker("Режим", selection: $navigationMode) {
                    Text("Только tap").tag("tap")
                    Text("Только swipe").tag("swipe")
                    Text("Tap и swipe").tag("both")
                }
                .pickerStyle(.segmented)
            }
        }
    }
}
```

---

## 2. Анимации перелистывания

### 2.1 Типы анимаций

| Тип | Описание | Подходит для |
|-----|----------|--------------|
| **Page Curl** | Как бумажная страница | Книги, имитация физического опыта |
| **Slide** | Горизонтальное скольжение | Современный минималистичный UI |
| **Fade** | Плавное затухание | Ночное чтение, меньше нагрузки на глаза |

### 2.2 Page Curl с UIPageViewController

**UIKit реализация:**

```swift
import UIKit

class BookPageViewController: UIPageViewController {

    var pages: [UIViewController] = []

    override init(transitionStyle style: UIPageViewController.TransitionStyle,
                  navigationOrientation: UIPageViewController.NavigationOrientation,
                  options: [UIPageViewController.OptionsKey : Any]? = nil) {
        // Page Curl - имитация бумажной страницы
        super.init(transitionStyle: .pageCurl,
                   navigationOrientation: .horizontal,
                   options: [.spineLocation: SpineLocation.min.rawValue])
    }

    required init?(coder: NSCoder) {
        super.init(transitionStyle: .pageCurl,
                   navigationOrientation: .horizontal,
                   options: nil)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        dataSource = self
        delegate = self

        if let firstPage = pages.first {
            setViewControllers([firstPage], direction: .forward, animated: true)
        }
    }
}

extension BookPageViewController: UIPageViewControllerDataSource {
    func pageViewController(_ pageViewController: UIPageViewController,
                          viewControllerBefore viewController: UIViewController) -> UIViewController? {
        guard let index = pages.firstIndex(of: viewController), index > 0 else { return nil }
        return pages[index - 1]
    }

    func pageViewController(_ pageViewController: UIPageViewController,
                          viewControllerAfter viewController: UIViewController) -> UIViewController? {
        guard let index = pages.firstIndex(of: viewController), index < pages.count - 1 else { return nil }
        return pages[index + 1]
    }
}

extension BookPageViewController: UIPageViewControllerDelegate {
    func pageViewController(_ pageViewController: UIPageViewController,
                          didFinishAnimating finished: Bool,
                          previousViewControllers: [UIViewController],
                          transitionCompleted completed: Bool) {
        // Haptic feedback при успешном перелистывании
        if completed {
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
        }
    }
}
```

### 2.3 SwiftUI обёртка для Page Curl

```swift
import SwiftUI

struct PageCurlView<Content: View>: UIViewControllerRepresentable {
    @Binding var currentPage: Int
    let pageCount: Int
    let content: (Int) -> Content

    func makeUIViewController(context: Context) -> UIPageViewController {
        let pageVC = UIPageViewController(
            transitionStyle: .pageCurl,
            navigationOrientation: .horizontal,
            options: [.spineLocation: UIPageViewController.SpineLocation.min.rawValue]
        )
        pageVC.dataSource = context.coordinator
        pageVC.delegate = context.coordinator
        return pageVC
    }

    func updateUIViewController(_ pageVC: UIPageViewController, context: Context) {
        let direction: UIPageViewController.NavigationDirection =
            context.coordinator.previousPage < currentPage ? .forward : .reverse

        let hostingController = UIHostingController(rootView: content(currentPage))
        hostingController.view.tag = currentPage

        pageVC.setViewControllers([hostingController], direction: direction, animated: true)
        context.coordinator.previousPage = currentPage
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
        var parent: PageCurlView
        var previousPage: Int = 0

        init(_ parent: PageCurlView) {
            self.parent = parent
        }

        func pageViewController(_ pageVC: UIPageViewController,
                              viewControllerBefore viewController: UIViewController) -> UIViewController? {
            let currentIndex = viewController.view.tag
            guard currentIndex > 0 else { return nil }

            let hostingController = UIHostingController(rootView: parent.content(currentIndex - 1))
            hostingController.view.tag = currentIndex - 1
            return hostingController
        }

        func pageViewController(_ pageVC: UIPageViewController,
                              viewControllerAfter viewController: UIViewController) -> UIViewController? {
            let currentIndex = viewController.view.tag
            guard currentIndex < parent.pageCount - 1 else { return nil }

            let hostingController = UIHostingController(rootView: parent.content(currentIndex + 1))
            hostingController.view.tag = currentIndex + 1
            return hostingController
        }

        func pageViewController(_ pageVC: UIPageViewController,
                              didFinishAnimating finished: Bool,
                              previousViewControllers: [UIViewController],
                              transitionCompleted completed: Bool) {
            if completed,
               let visibleVC = pageVC.viewControllers?.first {
                parent.currentPage = visibleVC.view.tag
            }
        }
    }
}
```

### 2.4 Slide Animation (чистый SwiftUI)

```swift
struct SlidePageView<Content: View>: View {
    @Binding var currentPage: Int
    let pageCount: Int
    let content: (Int) -> Content

    @GestureState private var dragOffset: CGFloat = 0

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                ForEach(0..<pageCount, id: \.self) { index in
                    content(index)
                        .frame(width: geometry.size.width)
                }
            }
            .offset(x: -CGFloat(currentPage) * geometry.size.width + dragOffset)
            .animation(.easeInOut(duration: 0.3), value: currentPage)
            .gesture(
                DragGesture()
                    .updating($dragOffset) { value, state, _ in
                        state = value.translation.width
                    }
                    .onEnded { value in
                        let threshold = geometry.size.width * 0.25
                        let newPage: Int

                        if value.translation.width < -threshold {
                            newPage = min(currentPage + 1, pageCount - 1)
                        } else if value.translation.width > threshold {
                            newPage = max(currentPage - 1, 0)
                        } else {
                            newPage = currentPage
                        }

                        currentPage = newPage
                    }
            )
        }
    }
}
```

### 2.5 Fade Animation

```swift
struct FadePageView<Content: View>: View {
    @Binding var currentPage: Int
    let content: (Int) -> Content

    var body: some View {
        content(currentPage)
            .transition(.opacity)
            .animation(.easeInOut(duration: 0.3), value: currentPage)
    }
}
```

### 2.6 Выбор анимации пользователем

```swift
enum PageAnimation: String, CaseIterable {
    case curl = "Перелистывание"
    case slide = "Скольжение"
    case fade = "Затухание"
    case none = "Без анимации"
}

struct AnimationSettingsView: View {
    @AppStorage("pageAnimation") var pageAnimation: String = PageAnimation.slide.rawValue

    var body: some View {
        Form {
            Section("Анимация страниц") {
                Picker("Тип", selection: $pageAnimation) {
                    ForEach(PageAnimation.allCases, id: \.rawValue) { animation in
                        Text(animation.rawValue).tag(animation.rawValue)
                    }
                }
            }
        }
    }
}
```

---

## 3. Жесты в Reader

### 3.1 Анализ конкурентов

| Жест | Apple Books | Kindle | Kobo |
|------|-------------|--------|------|
| **Single Tap** | Перелистывание / показать UI | Перелистывание | Перелистывание |
| **Double Tap** | Увеличение (PDF) | Увеличение | Увеличение |
| **Long Press** | Выделение текста | Выделение + словарь | Выделение + перевод |
| **Pinch** | Zoom (изображения/PDF) | Zoom (Kindle Fire) | Изменение размера шрифта |
| **Swipe** | Перелистывание | Перелистывание | Перелистывание |

**Kobo инновация:**
> "Kobo добавила возможность изменять размер шрифта жестом pinch - при pinch появляется круглое превью окно, показывающее размер шрифта"

### 3.2 Реализация жестов

```swift
import SwiftUI

struct GestureHandlingReaderView: View {
    @State private var currentPage: Int = 0
    @State private var showUI: Bool = false
    @State private var selectedText: String = ""
    @State private var showTextMenu: Bool = false
    @State private var imageZoomScale: CGFloat = 1.0

    // Для определения типа контента
    @State private var isImageVisible: Bool = false

    var body: some View {
        ZStack {
            // Основной контент
            pageContent
                // Double tap - zoom для изображений
                .gesture(
                    TapGesture(count: 2)
                        .onEnded {
                            if isImageVisible {
                                withAnimation {
                                    imageZoomScale = imageZoomScale == 1.0 ? 2.0 : 1.0
                                }
                            }
                        }
                )
                // Single tap - навигация/UI
                .gesture(
                    TapGesture(count: 1)
                        .onEnded { /* Обработка в tap-зонах */ }
                )
                // Long press - выделение текста
                .gesture(
                    LongPressGesture(minimumDuration: 0.5)
                        .onEnded { _ in
                            showTextMenu = true
                            triggerHaptic(.selection)
                        }
                )
                // Pinch - zoom для изображений
                .gesture(
                    MagnificationGesture()
                        .onChanged { value in
                            if isImageVisible {
                                imageZoomScale = value
                            }
                        }
                        .onEnded { value in
                            if isImageVisible {
                                withAnimation {
                                    imageZoomScale = max(1.0, min(value, 3.0))
                                }
                            }
                        }
                )
        }
    }

    var pageContent: some View {
        // Контент страницы
        Text("Page content")
    }

    private func triggerHaptic(_ type: UIImpactFeedbackGenerator.FeedbackStyle) {
        let generator = UIImpactFeedbackGenerator(style: type)
        generator.impactOccurred()
    }
}
```

### 3.3 Предотвращение конфликтов жестов

```swift
struct GestureCoordinator: View {
    @GestureState private var isDragging: Bool = false
    @GestureState private var isPinching: Bool = false

    var body: some View {
        content
            // Приоритет жестов: pinch > drag > tap
            .simultaneousGesture(pinchGesture)
            .simultaneousGesture(dragGesture)
            .gesture(tapGesture)
    }

    var pinchGesture: some Gesture {
        MagnificationGesture()
            .updating($isPinching) { _, state, _ in state = true }
            .onChanged { value in
                // Блокируем другие жесты во время pinch
                guard !isDragging else { return }
                // Обработка pinch
            }
    }

    var dragGesture: some Gesture {
        DragGesture(minimumDistance: 20)
            .updating($isDragging) { _, state, _ in state = true }
            .onEnded { value in
                // Блокируем если был pinch
                guard !isPinching else { return }
                // Обработка drag
            }
    }

    var tapGesture: some Gesture {
        TapGesture()
            .onEnded {
                // Блокируем если были другие жесты
                guard !isDragging && !isPinching else { return }
                // Обработка tap
            }
    }

    var content: some View {
        Text("Content")
    }
}
```

### 3.4 Exclusive Gesture для WebView

При использовании WKWebView (для EPUB рендеринга) нужна специальная обработка:

```swift
import WebKit

class ReaderWebView: WKWebView {

    private var tapGesture: UITapGestureRecognizer!
    private var longPressGesture: UILongPressGestureRecognizer!

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        setupGestures()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupGestures()
    }

    private func setupGestures() {
        // Tap для перелистывания
        tapGesture = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tapGesture.numberOfTapsRequired = 1
        tapGesture.delegate = self
        addGestureRecognizer(tapGesture)

        // Long press для выделения
        longPressGesture = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
        longPressGesture.minimumPressDuration = 0.5
        longPressGesture.delegate = self
        addGestureRecognizer(longPressGesture)
    }

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        let location = gesture.location(in: self)
        let width = bounds.width

        if location.x < width * 0.25 {
            // Предыдущая страница
            NotificationCenter.default.post(name: .previousPage, object: nil)
        } else if location.x > width * 0.75 {
            // Следующая страница
            NotificationCenter.default.post(name: .nextPage, object: nil)
        } else {
            // Показать/скрыть UI
            NotificationCenter.default.post(name: .toggleUI, object: nil)
        }
    }

    @objc private func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
        // Позволяем встроенному выделению текста работать
    }
}

extension ReaderWebView: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                          shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        // Разрешаем одновременное распознавание для long press (выделение текста)
        if otherGestureRecognizer is UILongPressGestureRecognizer {
            return true
        }
        return false
    }
}

extension Notification.Name {
    static let previousPage = Notification.Name("previousPage")
    static let nextPage = Notification.Name("nextPage")
    static let toggleUI = Notification.Name("toggleUI")
}
```

---

## 4. Звуки и Haptic Feedback

### 4.1 UIFeedbackGenerator - типы и применение

| Класс | Типы | Когда использовать |
|-------|------|-------------------|
| `UIImpactFeedbackGenerator` | `.light`, `.medium`, `.heavy`, `.soft`, `.rigid` | Перелистывание страниц |
| `UISelectionFeedbackGenerator` | - | Выбор в меню, изменение настроек |
| `UINotificationFeedbackGenerator` | `.success`, `.warning`, `.error` | Закладка добавлена, ошибка загрузки |

### 4.2 Реализация Haptic Manager

```swift
import UIKit
import CoreHaptics

class HapticManager {
    static let shared = HapticManager()

    private var engine: CHHapticEngine?
    private var supportsHaptics: Bool = false

    private init() {
        setupHapticEngine()
    }

    private func setupHapticEngine() {
        // Проверяем поддержку
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            return
        }

        supportsHaptics = true

        do {
            engine = try CHHapticEngine()
            try engine?.start()

            // Автоматический перезапуск
            engine?.resetHandler = { [weak self] in
                do {
                    try self?.engine?.start()
                } catch {
                    print("Failed to restart haptic engine: \(error)")
                }
            }
        } catch {
            print("Failed to create haptic engine: \(error)")
        }
    }

    // MARK: - Simple Haptics (UIFeedbackGenerator)

    /// Перелистывание страницы
    func pageTurn() {
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.prepare()
        generator.impactOccurred()
    }

    /// Выбор элемента (настройки, меню)
    func selection() {
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
    }

    /// Закладка добавлена
    func bookmarkAdded() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.success)
    }

    /// Достигнут конец главы/книги
    func chapterEnd() {
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.prepare()
        generator.impactOccurred()
    }

    // MARK: - Custom Haptics (Core Haptics)

    /// Кастомный паттерн для перелистывания (мягче стандартного)
    func customPageTurn() {
        guard supportsHaptics, let engine = engine else {
            pageTurn() // Fallback
            return
        }

        do {
            // Создаём мягкий, короткий импульс
            let sharpness = CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.3)
            let intensity = CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.5)

            let event = CHHapticEvent(
                eventType: .hapticTransient,
                parameters: [sharpness, intensity],
                relativeTime: 0
            )

            let pattern = try CHHapticPattern(events: [event], parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            print("Failed to play custom haptic: \(error)")
            pageTurn() // Fallback
        }
    }

    /// Паттерн "переворот бумажной страницы"
    func paperPageTurn() {
        guard supportsHaptics, let engine = engine else {
            pageTurn()
            return
        }

        do {
            // Серия из трёх импульсов с уменьшающейся интенсивностью
            var events: [CHHapticEvent] = []

            let intensities: [Float] = [0.6, 0.4, 0.2]
            let times: [TimeInterval] = [0, 0.05, 0.1]

            for i in 0..<3 {
                let intensity = CHHapticEventParameter(parameterID: .hapticIntensity, value: intensities[i])
                let sharpness = CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.2)

                let event = CHHapticEvent(
                    eventType: .hapticTransient,
                    parameters: [intensity, sharpness],
                    relativeTime: times[i]
                )
                events.append(event)
            }

            let pattern = try CHHapticPattern(events: events, parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            pageTurn()
        }
    }
}
```

### 4.3 Звук перелистывания

```swift
import AVFoundation

class SoundManager {
    static let shared = SoundManager()

    private var pageTurnPlayer: AVAudioPlayer?
    private var isSoundEnabled: Bool = true

    private init() {
        setupAudioSession()
        preloadSounds()
    }

    private func setupAudioSession() {
        do {
            // Ambient - не прерывает музыку пользователя
            try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Failed to setup audio session: \(error)")
        }
    }

    private func preloadSounds() {
        // Загружаем звук заранее для мгновенного воспроизведения
        if let url = Bundle.main.url(forResource: "page_turn", withExtension: "mp3") {
            do {
                pageTurnPlayer = try AVAudioPlayer(contentsOf: url)
                pageTurnPlayer?.prepareToPlay()
                pageTurnPlayer?.volume = 0.3 // Тихий, ненавязчивый
            } catch {
                print("Failed to load page turn sound: \(error)")
            }
        }
    }

    func playPageTurn() {
        guard isSoundEnabled else { return }

        // Перезапускаем с начала для быстрого последовательного перелистывания
        pageTurnPlayer?.currentTime = 0
        pageTurnPlayer?.play()
    }

    func setSoundEnabled(_ enabled: Bool) {
        isSoundEnabled = enabled
    }
}
```

### 4.4 Где взять звуки

| Источник | Лицензия | Описание |
|----------|----------|----------|
| [freesound.org](https://freesound.org) | CC / CC0 | Бесплатные звуки |
| [zapsplat.com](https://zapsplat.com) | Бесплатно с атрибуцией | Качественные SFX |
| Apple System Sounds | Встроенные | `/System/Library/Audio/UISounds/` |
| Собственная запись | - | Уникальный звук |

### 4.5 Настройки звуков и haptic

```swift
struct FeedbackSettingsView: View {
    @AppStorage("hapticEnabled") var hapticEnabled: Bool = true
    @AppStorage("soundEnabled") var soundEnabled: Bool = false
    @AppStorage("hapticStyle") var hapticStyle: String = "light"

    var body: some View {
        Form {
            Section("Тактильный отклик") {
                Toggle("Включить вибрацию", isOn: $hapticEnabled)

                if hapticEnabled {
                    Picker("Интенсивность", selection: $hapticStyle) {
                        Text("Лёгкая").tag("light")
                        Text("Средняя").tag("medium")
                        Text("Сильная").tag("heavy")
                    }
                }
            }

            Section("Звуки") {
                Toggle("Звук перелистывания", isOn: $soundEnabled)
            }
        }
    }
}
```

---

## 5. Ориентация экрана

### 5.1 Рекомендации по ориентации

| Устройство | Portrait | Landscape |
|------------|----------|-----------|
| **iPhone** | Основной режим чтения | Для изображений / отключить |
| **iPad** | 1 колонка текста | 2 колонки (как книга) |

### 5.2 Определение ориентации в SwiftUI

```swift
import SwiftUI

struct OrientationAdaptiveReader: View {
    @Environment(\.horizontalSizeClass) var horizontalSizeClass
    @Environment(\.verticalSizeClass) var verticalSizeClass

    var isLandscape: Bool {
        verticalSizeClass == .compact
    }

    var isIPad: Bool {
        horizontalSizeClass == .regular && verticalSizeClass == .regular
    }

    var body: some View {
        GeometryReader { geometry in
            if isIPad && isLandscape {
                // iPad Landscape - две колонки
                TwoColumnReaderView()
            } else if isIPad {
                // iPad Portrait - одна широкая колонка
                SingleColumnReaderView(maxWidth: 600)
            } else if isLandscape {
                // iPhone Landscape - полноэкранное изображение или запрет
                ImageFullscreenView()
            } else {
                // iPhone Portrait - стандартный вид
                SingleColumnReaderView(maxWidth: geometry.size.width)
            }
        }
    }
}
```

### 5.3 Двухколоночный layout для iPad

```swift
struct TwoColumnReaderView: View {
    @State var leftPageIndex: Int = 0

    var rightPageIndex: Int {
        leftPageIndex + 1
    }

    var body: some View {
        HStack(spacing: 0) {
            // Левая страница
            PageView(pageIndex: leftPageIndex)
                .frame(maxWidth: .infinity)

            // Разделитель (корешок книги)
            Rectangle()
                .fill(Color.gray.opacity(0.3))
                .frame(width: 2)
                .shadow(color: .black.opacity(0.2), radius: 5, x: 2, y: 0)

            // Правая страница
            PageView(pageIndex: rightPageIndex)
                .frame(maxWidth: .infinity)
        }
        .gesture(
            DragGesture()
                .onEnded { value in
                    if value.translation.width < -50 {
                        // Вперёд на 2 страницы
                        leftPageIndex += 2
                    } else if value.translation.width > 50 {
                        // Назад на 2 страницы
                        leftPageIndex = max(0, leftPageIndex - 2)
                    }
                }
        )
    }
}

struct PageView: View {
    let pageIndex: Int

    var body: some View {
        Text("Page \(pageIndex)")
    }
}
```

### 5.4 Блокировка ориентации для чтения

```swift
import SwiftUI

class OrientationManager: ObservableObject {
    static let shared = OrientationManager()

    @Published var isLocked: Bool = false

    func lockToPortrait() {
        isLocked = true
        UIDevice.current.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation")

        if #available(iOS 16.0, *) {
            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
            windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
        }
    }

    func unlock() {
        isLocked = false
        if #available(iOS 16.0, *) {
            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
            windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: .all))
        }
    }
}
```

### 5.5 Боковая панель на iPad (NavigationSplitView)

```swift
struct iPadReaderWithSidebar: View {
    @State private var columnVisibility: NavigationSplitViewVisibility = .detailOnly
    @State private var selectedChapter: Chapter?

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            // Sidebar - оглавление
            TableOfContentsView(selectedChapter: $selectedChapter)
                .navigationTitle("Оглавление")
        } detail: {
            // Основной контент - читалка
            if let chapter = selectedChapter {
                ChapterReaderView(chapter: chapter)
            } else {
                Text("Выберите главу")
            }
        }
        .navigationSplitViewStyle(.balanced)
    }
}

struct TableOfContentsView: View {
    @Binding var selectedChapter: Chapter?
    let chapters: [Chapter] = [] // Загрузка из EPUB

    var body: some View {
        List(chapters, selection: $selectedChapter) { chapter in
            NavigationLink(value: chapter) {
                HStack {
                    Text(chapter.title)
                    Spacer()
                    if chapter.isCurrentlyReading {
                        Image(systemName: "bookmark.fill")
                            .foregroundColor(.blue)
                    }
                }
            }
        }
    }
}

struct Chapter: Identifiable, Hashable {
    let id: UUID
    let title: String
    var isCurrentlyReading: Bool = false
}
```

---

## 6. TOC (Оглавление)

### 6.1 EPUB TOC структура

EPUB 3 использует `nav` элемент с вложенными `ol` списками:

```html
<nav epub:type="toc">
  <ol>
    <li><a href="chapter1.xhtml">Глава 1</a>
      <ol>
        <li><a href="chapter1.xhtml#section1">Раздел 1.1</a></li>
        <li><a href="chapter1.xhtml#section2">Раздел 1.2</a></li>
      </ol>
    </li>
    <li><a href="chapter2.xhtml">Глава 2</a></li>
  </ol>
</nav>
```

### 6.2 Иерархическое отображение в SwiftUI

```swift
struct TOCItem: Identifiable {
    let id: UUID = UUID()
    let title: String
    let href: String
    let children: [TOCItem]
    var isExpanded: Bool = false
    var progress: Double = 0 // 0-1
}

struct HierarchicalTOCView: View {
    @State var items: [TOCItem]
    @Binding var selectedHref: String?
    let currentHref: String // Текущая позиция чтения

    var body: some View {
        List {
            ForEach($items) { $item in
                TOCRowView(
                    item: $item,
                    selectedHref: $selectedHref,
                    currentHref: currentHref,
                    level: 0
                )
            }
        }
        .listStyle(.plain)
    }
}

struct TOCRowView: View {
    @Binding var item: TOCItem
    @Binding var selectedHref: String?
    let currentHref: String
    let level: Int

    var isCurrent: Bool {
        item.href == currentHref
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Основная строка
            HStack {
                // Отступ для уровня вложенности
                Spacer()
                    .frame(width: CGFloat(level) * 20)

                // Индикатор раскрытия
                if !item.children.isEmpty {
                    Button(action: { item.isExpanded.toggle() }) {
                        Image(systemName: item.isExpanded ? "chevron.down" : "chevron.right")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                } else {
                    Spacer().frame(width: 16)
                }

                // Название главы
                Button(action: { selectedHref = item.href }) {
                    HStack {
                        Text(item.title)
                            .fontWeight(isCurrent ? .semibold : .regular)
                            .foregroundColor(isCurrent ? .blue : .primary)

                        Spacer()

                        // Индикатор прогресса
                        if item.progress > 0 && item.progress < 1 {
                            ProgressView(value: item.progress)
                                .frame(width: 40)
                        } else if item.progress >= 1 {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                        }

                        // Индикатор текущей позиции
                        if isCurrent {
                            Image(systemName: "location.fill")
                                .foregroundColor(.blue)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            .padding(.vertical, 8)

            // Дочерние элементы
            if item.isExpanded {
                ForEach($item.children) { $child in
                    TOCRowView(
                        item: $child,
                        selectedHref: $selectedHref,
                        currentHref: currentHref,
                        level: level + 1
                    )
                }
            }
        }
    }
}
```

### 6.3 Парсинг TOC из EPUB

```swift
import Foundation

struct TOCParser {

    static func parse(navDocument: String) -> [TOCItem] {
        // Упрощённый парсер - в реальности использовать XMLParser или SwiftSoup
        var items: [TOCItem] = []

        // Используем Readium или EPUBKit для реального парсинга
        // Пример структуры:
        items = [
            TOCItem(
                title: "Введение",
                href: "intro.xhtml",
                children: []
            ),
            TOCItem(
                title: "Глава 1: Начало",
                href: "chapter1.xhtml",
                children: [
                    TOCItem(title: "1.1 Предыстория", href: "chapter1.xhtml#s1", children: []),
                    TOCItem(title: "1.2 Первые шаги", href: "chapter1.xhtml#s2", children: [])
                ]
            )
        ]

        return items
    }
}
```

---

## 7. Поиск по книге

### 7.1 Архитектура полнотекстового поиска

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   EPUB файл     │────▶│   Индексатор    │────▶│  Поисковый      │
│                 │     │   (фоновый)     │     │  индекс         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Результаты    │◀────│   Поиск         │◀────│   Запрос        │
│   с контекстом  │     │   (мгновенный)  │     │   пользователя  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 7.2 Реализация поиска

```swift
import Foundation

struct SearchResult: Identifiable {
    let id: UUID = UUID()
    let chapterTitle: String
    let chapterHref: String
    let textBefore: String  // Контекст до
    let matchedText: String // Найденный текст
    let textAfter: String   // Контекст после
    let cfi: String         // EPUB CFI для навигации
}

class BookSearchEngine: ObservableObject {
    @Published var results: [SearchResult] = []
    @Published var isSearching: Bool = false
    @Published var currentResultIndex: Int = 0

    private var chapters: [(title: String, href: String, content: String)] = []
    private var searchTask: Task<Void, Never>?

    // Индексация при открытии книги
    func indexBook(epubPath: URL) async {
        // Извлекаем текст из всех глав
        // В реальности используем Readium или EPUBKit
        chapters = await extractChaptersText(from: epubPath)
    }

    func search(query: String) {
        // Отменяем предыдущий поиск
        searchTask?.cancel()

        guard query.count >= 2 else {
            results = []
            return
        }

        isSearching = true

        searchTask = Task {
            var foundResults: [SearchResult] = []
            let lowercasedQuery = query.lowercased()

            for chapter in chapters {
                // Проверяем отмену
                if Task.isCancelled { break }

                let content = chapter.content
                let lowercasedContent = content.lowercased()

                var searchRange = lowercasedContent.startIndex..<lowercasedContent.endIndex

                while let range = lowercasedContent.range(of: lowercasedQuery, range: searchRange) {
                    if Task.isCancelled { break }

                    // Извлекаем контекст
                    let contextLength = 40
                    let matchStart = content.index(range.lowerBound, offsetBy: 0)
                    let matchEnd = content.index(range.upperBound, offsetBy: 0)

                    let beforeStart = content.index(matchStart, offsetBy: -contextLength, limitedBy: content.startIndex) ?? content.startIndex
                    let afterEnd = content.index(matchEnd, offsetBy: contextLength, limitedBy: content.endIndex) ?? content.endIndex

                    let result = SearchResult(
                        chapterTitle: chapter.title,
                        chapterHref: chapter.href,
                        textBefore: String(content[beforeStart..<matchStart]),
                        matchedText: String(content[matchStart..<matchEnd]),
                        textAfter: String(content[matchEnd..<afterEnd]),
                        cfi: generateCFI(chapter: chapter.href, offset: content.distance(from: content.startIndex, to: matchStart))
                    )
                    foundResults.append(result)

                    // Продвигаем поиск
                    searchRange = range.upperBound..<lowercasedContent.endIndex
                }
            }

            await MainActor.run {
                self.results = foundResults
                self.isSearching = false
                self.currentResultIndex = 0
            }
        }
    }

    func goToNextResult() {
        if currentResultIndex < results.count - 1 {
            currentResultIndex += 1
        }
    }

    func goToPreviousResult() {
        if currentResultIndex > 0 {
            currentResultIndex -= 1
        }
    }

    private func extractChaptersText(from url: URL) async -> [(title: String, href: String, content: String)] {
        // Placeholder - использовать Readium
        return []
    }

    private func generateCFI(chapter: String, offset: Int) -> String {
        // Генерация EPUB CFI для точной навигации
        return "epubcfi(/6/\(chapter)!/4/2/1:\(offset))"
    }
}
```

### 7.3 UI поиска

```swift
struct SearchView: View {
    @StateObject var searchEngine = BookSearchEngine()
    @State var query: String = ""
    @Environment(\.dismiss) var dismiss

    let onNavigate: (String) -> Void // CFI callback

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Поле поиска
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(.secondary)

                    TextField("Поиск по книге", text: $query)
                        .textFieldStyle(.plain)
                        .autocorrectionDisabled()
                        .onChange(of: query) { _, newValue in
                            searchEngine.search(query: newValue)
                        }

                    if !query.isEmpty {
                        Button(action: { query = "" }) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .padding()
                .background(Color(.systemGray6))

                // Навигация по результатам
                if !searchEngine.results.isEmpty {
                    HStack {
                        Text("\(searchEngine.currentResultIndex + 1) из \(searchEngine.results.count)")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Spacer()

                        Button(action: { searchEngine.goToPreviousResult() }) {
                            Image(systemName: "chevron.up")
                        }
                        .disabled(searchEngine.currentResultIndex == 0)

                        Button(action: { searchEngine.goToNextResult() }) {
                            Image(systemName: "chevron.down")
                        }
                        .disabled(searchEngine.currentResultIndex >= searchEngine.results.count - 1)
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }

                Divider()

                // Список результатов
                if searchEngine.isSearching {
                    ProgressView("Поиск...")
                        .padding()
                } else if searchEngine.results.isEmpty && !query.isEmpty {
                    ContentUnavailableView(
                        "Ничего не найдено",
                        systemImage: "magnifyingglass",
                        description: Text("Попробуйте другой запрос")
                    )
                } else {
                    List(searchEngine.results) { result in
                        SearchResultRow(result: result, query: query)
                            .onTapGesture {
                                onNavigate(result.cfi)
                                dismiss()
                            }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Поиск")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
        }
    }
}

struct SearchResultRow: View {
    let result: SearchResult
    let query: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(result.chapterTitle)
                .font(.caption)
                .foregroundColor(.secondary)

            // Текст с подсветкой
            HStack(spacing: 0) {
                Text("..." + result.textBefore)
                    .foregroundColor(.secondary)
                Text(result.matchedText)
                    .foregroundColor(.primary)
                    .fontWeight(.semibold)
                    .background(Color.yellow.opacity(0.3))
                Text(result.textAfter + "...")
                    .foregroundColor(.secondary)
            }
            .font(.subheadline)
            .lineLimit(2)
        }
        .padding(.vertical, 4)
    }
}
```

---

## 8. Прогресс чтения

### 8.1 Подходы к отображению прогресса

| Подход | Пример | Плюсы | Минусы |
|--------|--------|-------|--------|
| **Страницы** | "Стр. 142 из 380" | Интуитивно | Зависит от размера шрифта |
| **Проценты** | "37%" | Универсально | Не информативно |
| **Locations** (Kindle) | "Loc 2341" | Стабильно | Непривычно |
| **Время** | "~45 мин до конца главы" | Практично | Требует калибровки |

### 8.2 Алгоритм расчёта времени (WPM)

```swift
class ReadingProgressTracker: ObservableObject {
    // Настройки
    private let defaultWPM: Double = 250 // Средняя скорость чтения
    @Published var personalWPM: Double = 250

    // Данные для расчёта
    private var readingStartTime: Date?
    private var wordsReadSinceStart: Int = 0
    private var recentReadingSpeeds: [Double] = [] // Последние 10 измерений

    // Статистика книги
    var totalWords: Int = 0
    var wordsRead: Int = 0

    // MARK: - Публичные свойства

    var progressPercent: Double {
        guard totalWords > 0 else { return 0 }
        return Double(wordsRead) / Double(totalWords) * 100
    }

    var estimatedTimeRemaining: TimeInterval {
        let wordsRemaining = totalWords - wordsRead
        guard personalWPM > 0 else { return 0 }
        return Double(wordsRemaining) / personalWPM * 60 // секунды
    }

    var formattedTimeRemaining: String {
        let minutes = Int(estimatedTimeRemaining / 60)
        if minutes < 60 {
            return "~\(minutes) мин"
        } else {
            let hours = minutes / 60
            let remainingMinutes = minutes % 60
            return "~\(hours) ч \(remainingMinutes) мин"
        }
    }

    // MARK: - Калибровка скорости

    func startReadingSession() {
        readingStartTime = Date()
        wordsReadSinceStart = 0
    }

    func recordPageRead(wordsOnPage: Int) {
        wordsReadSinceStart += wordsOnPage
        wordsRead += wordsOnPage

        // Обновляем WPM каждые 500 слов
        if wordsReadSinceStart >= 500, let startTime = readingStartTime {
            let elapsedMinutes = Date().timeIntervalSince(startTime) / 60
            guard elapsedMinutes > 0 else { return }

            let currentWPM = Double(wordsReadSinceStart) / elapsedMinutes

            // Добавляем в историю (максимум 10 измерений)
            recentReadingSpeeds.append(currentWPM)
            if recentReadingSpeeds.count > 10 {
                recentReadingSpeeds.removeFirst()
            }

            // Вычисляем среднее
            personalWPM = recentReadingSpeeds.reduce(0, +) / Double(recentReadingSpeeds.count)

            // Сбрасываем счётчик
            readingStartTime = Date()
            wordsReadSinceStart = 0
        }
    }

    func pauseReading() {
        // Сохраняем прогресс до паузы
        if wordsReadSinceStart > 100, let startTime = readingStartTime {
            let elapsedMinutes = Date().timeIntervalSince(startTime) / 60
            if elapsedMinutes > 0.5 { // Минимум 30 секунд чтения
                let currentWPM = Double(wordsReadSinceStart) / elapsedMinutes
                recentReadingSpeeds.append(currentWPM)
                if recentReadingSpeeds.count > 10 {
                    recentReadingSpeeds.removeFirst()
                }
                personalWPM = recentReadingSpeeds.reduce(0, +) / Double(recentReadingSpeeds.count)
            }
        }
        readingStartTime = nil
    }

    // MARK: - Kindle-style Locations

    /// Location = примерно 128 байт текста (стандарт Kindle)
    var currentLocation: Int {
        // Упрощённый расчёт: 1 location ≈ 25 слов
        return wordsRead / 25
    }

    var totalLocations: Int {
        return totalWords / 25
    }

    // MARK: - Сохранение/восстановление

    func save() -> [String: Any] {
        return [
            "wordsRead": wordsRead,
            "personalWPM": personalWPM,
            "recentSpeeds": recentReadingSpeeds
        ]
    }

    func restore(from data: [String: Any]) {
        wordsRead = data["wordsRead"] as? Int ?? 0
        personalWPM = data["personalWPM"] as? Double ?? defaultWPM
        recentReadingSpeeds = data["recentSpeeds"] as? [Double] ?? []
    }
}
```

### 8.3 UI прогресса

```swift
struct ReadingProgressView: View {
    @ObservedObject var tracker: ReadingProgressTracker
    @State var displayMode: ProgressDisplayMode = .time

    enum ProgressDisplayMode: CaseIterable {
        case percent
        case pages
        case locations
        case time

        var icon: String {
            switch self {
            case .percent: return "percent"
            case .pages: return "book"
            case .locations: return "location"
            case .time: return "clock"
            }
        }
    }

    var body: some View {
        HStack {
            // Прогресс-бар
            ProgressView(value: tracker.progressPercent / 100)
                .tint(.blue)

            // Текстовый индикатор (tap для переключения)
            Button(action: { cycleDisplayMode() }) {
                HStack(spacing: 4) {
                    Image(systemName: displayMode.icon)
                        .font(.caption2)
                    Text(progressText)
                        .font(.caption)
                }
                .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(.systemBackground).opacity(0.9))
    }

    var progressText: String {
        switch displayMode {
        case .percent:
            return String(format: "%.1f%%", tracker.progressPercent)
        case .pages:
            let currentPage = tracker.wordsRead / 250 // ~250 слов на страницу
            let totalPages = tracker.totalWords / 250
            return "\(currentPage) / \(totalPages)"
        case .locations:
            return "Loc \(tracker.currentLocation)"
        case .time:
            return tracker.formattedTimeRemaining
        }
    }

    private func cycleDisplayMode() {
        let allModes = ProgressDisplayMode.allCases
        if let index = allModes.firstIndex(of: displayMode) {
            let nextIndex = (index + 1) % allModes.count
            displayMode = allModes[nextIndex]
        }
    }
}
```

---

## 9. Preloading

### 9.1 Исследование оптимального количества

| Источник | Рекомендация |
|----------|--------------|
| Научная статья (ScienceDirect) | "Chapter preloading mechanism" - предзагрузка глав |
| Mobile performance 2025 | "Pre-fetching allows pages to load faster" |
| Практика конкурентов | 2-3 страницы вперёд, 1 назад |

**Рекомендация:** Предзагружать **3 страницы вперёд** и **1 страницу назад** от текущей позиции.

### 9.2 Стратегия preloading

```swift
class PagePreloader {
    private let preloadAhead = 3
    private let preloadBehind = 1

    private var cache: NSCache<NSNumber, PageContent> = {
        let cache = NSCache<NSNumber, PageContent>()
        cache.countLimit = 10 // Максимум 10 страниц в кэше
        return cache
    }()

    private var preloadTasks: [Int: Task<Void, Never>] = [:]

    func preloadPages(around currentPage: Int, totalPages: Int) {
        // Определяем диапазон для предзагрузки
        let startPage = max(0, currentPage - preloadBehind)
        let endPage = min(totalPages - 1, currentPage + preloadAhead)

        // Отменяем задачи для страниц вне диапазона
        for (page, task) in preloadTasks {
            if page < startPage || page > endPage {
                task.cancel()
                preloadTasks.removeValue(forKey: page)
            }
        }

        // Запускаем новые задачи
        for page in startPage...endPage {
            // Пропускаем если уже в кэше или загружается
            if cache.object(forKey: NSNumber(value: page)) != nil { continue }
            if preloadTasks[page] != nil { continue }

            preloadTasks[page] = Task {
                let content = await loadPage(page)
                if !Task.isCancelled {
                    cache.setObject(content, forKey: NSNumber(value: page))
                }
                preloadTasks.removeValue(forKey: page)
            }
        }
    }

    func getPage(_ page: Int) async -> PageContent {
        // Проверяем кэш
        if let cached = cache.object(forKey: NSNumber(value: page)) {
            return cached
        }

        // Ждём если уже загружается
        if let task = preloadTasks[page] {
            await task.value
            if let cached = cache.object(forKey: NSNumber(value: page)) {
                return cached
            }
        }

        // Загружаем синхронно
        let content = await loadPage(page)
        cache.setObject(content, forKey: NSNumber(value: page))
        return content
    }

    private func loadPage(_ page: Int) async -> PageContent {
        // Загрузка контента страницы из EPUB
        // В реальности - парсинг XHTML, рендеринг
        return PageContent(html: "", images: [])
    }

    func clearCache() {
        cache.removeAllObjects()
        for task in preloadTasks.values {
            task.cancel()
        }
        preloadTasks.removeAll()
    }
}

class PageContent: NSObject {
    let html: String
    let images: [URL]

    init(html: String, images: [URL]) {
        self.html = html
        self.images = images
    }
}
```

### 9.3 Lazy loading для изображений

```swift
struct LazyBookImage: View {
    let url: URL
    @State private var image: UIImage?
    @State private var isLoading = false

    var body: some View {
        Group {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else if isLoading {
                ProgressView()
            } else {
                Color.gray.opacity(0.2)
                    .onAppear { loadImage() }
            }
        }
    }

    private func loadImage() {
        isLoading = true
        Task {
            if let data = try? Data(contentsOf: url),
               let uiImage = UIImage(data: data) {
                await MainActor.run {
                    self.image = uiImage
                    self.isLoading = false
                }
            }
        }
    }
}
```

---

## 10. RTL языки и вертикальный текст

### 10.1 RTL (арабский, иврит)

**Требования:**
- EPUB 3.0+
- iOS 6+ / iBooks 3.0+
- CSS `direction: rtl`

**Проблемы:**
- Порядок страниц (должен быть справа налево)
- Выравнивание текста
- Смешанный контент (LTR + RTL)

```css
/* RTL стили для EPUB */
html {
    direction: rtl;
}

body {
    direction: rtl;
    text-align: right;
    unicode-bidi: embed;
}

/* Для смешанного контента */
.ltr-content {
    direction: ltr;
    unicode-bidi: embed;
}
```

### 10.2 Вертикальный текст (японский, китайский)

**Apple Books поддерживает:**
- `writing-mode: vertical-rl` (справа налево, как в японском)
- `writing-mode: vertical-lr` (слева направо)

```css
/* Вертикальный японский текст */
html {
    writing-mode: vertical-rl;
    -webkit-writing-mode: vertical-rl;
    -epub-writing-mode: vertical-rl;
}

body {
    writing-mode: vertical-rl;
    -webkit-writing-mode: vertical-rl;
    line-break: normal;
    -webkit-line-break: normal;
    -epub-line-break: normal;
}
```

**Важно:** Каждый документ EPUB может иметь только один `writing-mode`. Для смешанного контента нужны отдельные файлы.

### 10.3 Рекомендуемые шрифты

| Язык | Рекомендуемые шрифты (iOS) |
|------|---------------------------|
| Японский | Hiragino Kaku ProN, Hiragino Mincho ProN |
| Китайский | PingFang SC, STHeiti |
| Арабский | Geeza Pro, Baghdad |
| Иврит | Arial Hebrew |

### 10.4 Библиотеки с поддержкой

| Библиотека | RTL | Vertical | Примечания |
|------------|-----|----------|------------|
| **Readium Swift** | Да | Да | Рекомендуется |
| **FolioReaderKit** | Да | Частично | RTL Support указан в features |
| **EPUBKit** | Парсинг | Парсинг | Только парсинг, не рендеринг |
| **KOReader** | Да | Нет | Open source, но не iOS native |

### 10.5 Реализация переключения направления

```swift
struct RTLSupportView: View {
    @State var textDirection: TextDirection = .auto

    enum TextDirection: String, CaseIterable {
        case auto = "Авто"
        case ltr = "Слева направо"
        case rtl = "Справа налево"
        case verticalRL = "Вертикально (→)"
        case verticalLR = "Вертикально (←)"
    }

    var body: some View {
        Form {
            Picker("Направление текста", selection: $textDirection) {
                ForEach(TextDirection.allCases, id: \.self) { direction in
                    Text(direction.rawValue).tag(direction)
                }
            }
        }
    }

    func cssForDirection(_ direction: TextDirection) -> String {
        switch direction {
        case .auto:
            return ""
        case .ltr:
            return "direction: ltr; text-align: left;"
        case .rtl:
            return "direction: rtl; text-align: right;"
        case .verticalRL:
            return "writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl;"
        case .verticalLR:
            return "writing-mode: vertical-lr; -webkit-writing-mode: vertical-lr;"
        }
    }
}
```

---

## Recommendations

| # | Рекомендация | Приоритет | Сложность |
|---|--------------|-----------|-----------|
| 1 | Использовать Readium Swift Toolkit как основу | P0 | Средняя |
| 2 | Реализовать оба режима навигации (tap + swipe) с настройкой | P0 | Низкая |
| 3 | Добавить haptic feedback (UIImpactFeedbackGenerator) | P1 | Низкая |
| 4 | Реализовать Page Curl через UIPageViewController | P1 | Средняя |
| 5 | Двухколоночный layout для iPad Landscape | P1 | Средняя |
| 6 | Адаптивный WPM алгоритм для времени чтения | P2 | Средняя |
| 7 | Preloading 3 страниц вперёд | P2 | Низкая |
| 8 | RTL поддержка через CSS | P2 | Низкая |
| 9 | Вертикальный текст для японского/китайского | P3 | Высокая |
| 10 | Custom haptic patterns через Core Haptics | P3 | Средняя |

---

## Next Steps

1. **Интеграция Readium Swift Toolkit** - основа для EPUB рендеринга
2. **Прототип навигации** - tap-зоны + swipe с настройками
3. **Haptic feedback** - базовая реализация
4. **iPad layout** - NavigationSplitView + двухколоночный режим

---

## Sources

### Библиотеки и фреймворки
- [Readium Swift Toolkit](https://github.com/readium/swift-toolkit) - основной toolkit для EPUB
- [FolioReaderKit](https://github.com/FolioReader/FolioReaderKit) - iOS EPUB reader framework
- [EPUBKit](https://github.com/witekbobrowski/EPUBKit) - Swift EPUB parser
- [Auread](https://github.com/jimjatt1999/Auread) - SwiftUI EPUB reader example
- [Pageboy](https://github.com/uias/Pageboy) - UIPageViewController wrapper

### Документация Apple
- [Human Interface Guidelines - Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)
- [Core Haptics Documentation](https://developer.apple.com/documentation/corehaptics/)
- [UIPageViewController](https://developer.apple.com/documentation/uikit/uipageviewcontroller)
- [NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)
- [Apple Books Asset Guide - Text Directions](https://help.apple.com/itc/booksassetguide/en.lproj/itc7e9ec52f7.html)

### Туториалы и статьи
- [Creating Page Curl in SwiftUI (2025)](https://swiftuisnippets.wordpress.com/2025/11/27/creating-a-page-curl-transition-in-swiftui-bridging-uikits-power/)
- [Hacking with Swift - Page Curl Effect](https://www.hackingwithswift.com/example-code/uikit/how-to-create-a-page-curl-effect-using-uipageviewcontroller)
- [Haptic Feedback Guide - Medium](https://medium.com/@mi9nxi/haptic-feedback-in-ios-a-comprehensive-guide-6c491a5f22cb)
- [Core Haptics Tutorial - Kodeco](https://www.kodeco.com/10608020-getting-started-with-core-haptics)
- [NavigationSplitView Guide](https://www.hackingwithswift.com/quick-start/swiftui/how-to-create-a-two-column-or-three-column-layout-with-navigationsplitview)
- [AVAudioPlayer Tutorial](https://www.hackingwithswift.com/example-code/media/how-to-play-sounds-using-avaudioplayer)

### EPUB спецификации
- [EPUB TOC Navigation](https://kb.daisy.org/publishing/docs/navigation/toc.html)
- [EPUB Content Documents 3.0](https://idpf.org/epub/30/spec/epub30-contentdocs.html)
- [W3C Vertical Text Styling](https://www.w3.org/International/articles/vertical-text/)
- [Tategaki Project](https://tategaki.github.io/en/)

### Конкуренты
- [Kobo Gesture Help](https://help.kobo.com/hc/en-us/articles/360017639973-Use-gestures-on-the-touch-screen)
- [Kindle Reading Time Algorithm - Quora](https://www.quora.com/How-does-Amazon-Kindle-calculate-reading-time-time-left-in-the-book-to-finish)

### Performance
- [Chapter Preloading Research - ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0020025512005622)
- [EPUB Optimizer](https://github.com/kiki-le-singe/epub-optimizer)
