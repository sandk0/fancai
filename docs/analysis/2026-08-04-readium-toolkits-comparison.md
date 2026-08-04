# Сравнение `flutter_readium` / `swift-toolkit` / KMP по кодовым базам

> **Артефакт:** результат §4.3 промпта `docs/prompts/2026-08-04-mobile-native-migration-strategy.md`
> (главный артефакт сессии, требование владельца §8.7 — сравнение по коду до какой-либо сборки).
> **Дата:** 2026-08-04. **Метод:** чтение исходников трёх репозиториев, клонированных в этот день.
> **Правило источников:** каждое утверждение — файл со строками, или пометка `[вывод из кода]` /
> `[допущение]`. Утверждений без источника в документе нет.

---

## §0. Что именно читалось

Клоны сделаны 2026-08-04, HEAD на момент чтения:

| Репозиторий | HEAD | Дата | Версия |
|---|---|---|---|
| `Notalib/flutter_readium` | `2f2ccd69` | 2026-08-04 | `v0.3.3` (0 коммитов после тега) |
| `readium/swift-toolkit` | `d82f44f4` | 2026-07-17 | `3.11.0` |
| `readium/kotlin-toolkit` | `f8e6f93d` | 2026-07-29 | `3.3.0` (тег `3.3.0` — 2026-06-02) |

Замеренные объёмы (строки, `find … -print0 | xargs -0 wc -l`, без `example/` и тестов;
отсутствие дробления `xargs` проверено — по одной строке `total` на язык).

**Базы нормализованы по двум осям, иначе сравнение врёт.** Первая: у прослойки есть
веб-таргет (`flutter_readium/web/src`), которого у мобильного клиента fancai не будет вовсе —
тем более после решения §8.6. Вторая: оба движка рендерят reflowable EPUB через **свой
JavaScript в вебвью**, и его надо считать наравне с инжектируемым TS прослойки, иначе
числитель со скриптами сравнивается со знаменателем без них.

| Артефакт | Строк | Состав |
|---|---|---|
| **Прослойка, мобильный путь** | **38 086** | Dart 15 051 (15 779 − 728 веб-специфики) · Kotlin 12 624 · Swift 8 097 · TS `assets/_helper_scripts` 2 314 (компилируется в `flutterReadiumTools.js`, инжектируется в вебвью на **обеих** мобильных платформах) |
| Прослойка, веб-таргет — fancai не использует | 11 755 | TS `web/src` 7 842 · TS `web/src/__tests__` 3 185 · Dart 728 |
| **`swift-toolkit`, движок iOS** | **51 594** | Swift 49 274 (Shared 20 556 · Navigator 16 015 · LCP 5 202 · Streamer 4 893 · OPDS 933 · Internal 864 · Adapters 811) + свой JS `EPUB/Scripts/src` 2 320. Плюс вендоренный Hypothesis anchoring 3 825 |
| **`kotlin-toolkit`, движок Android** | **68 178** | Kotlin 61 896 (shared 19 447 · navigators 17 916 · navigator 11 911 · lcp 5 315 · streamer 3 703 · adapters 2 867 · opds 737) + JS `assets/_scripts` 6 282 (включая тот же вендоренный anchoring) |

Скомпилированные бандлы движка (`Sources/Navigator/EPUB/Assets/Static/scripts/readium-*.js`,
вывод webpack — `Scripts/webpack.config.js:15`, каталог под `.gitignore`) не считались.
Генерируемого Dart-кода в прослойке нет (`find -name "*.g.dart" -o -name "*.freezed.dart"` → 0):
все 15 779 строк Dart рукописные.

**Вывод по масштабу — и он скромнее, чем звучит промпт §3.4 («~1,6 МБ кода»).** Релевантная
fancai прослойка — **38 086 строк**, то есть **74% от одного swift-toolkit** и **32% от двух
движков вместе** (119 772). Это не тонкая обёртка и не «второй проект размером с движок»:
это самостоятельный слой в три четверти iOS-движка, написанный одним вендором.

Побочная находка, подтверждающая §3: **оба движка вендорят одну и ту же реализацию
Hypothesis anchoring** — `swift-toolkit/Sources/Navigator/EPUB/Scripts/src/vendor/hypothesis/anchoring`
и `kotlin-toolkit/readium/navigator/src/main/assets/_scripts/src/vendor/hypothesis/anchoring`.
Это тот самый `TextQuoteAnchor`, на котором держится перенос подсветки описаний.

Пины upstream проверены самостоятельно, как требует §3.4:

- `flutter_readium/ios/flutter_readium.podspec:19-22` — `ReadiumShared`/`ReadiumStreamer`/`ReadiumNavigator`/`ReadiumOPDS` **`~> 3.9.0`**. По семантике CocoaPods это `>= 3.9.0, < 3.10.0`, то есть 3.10 и 3.11 не подтянутся **никогда**, пока пин не поднимут руками.
- `flutter_readium/android/build.gradle:3` — `ext.readium_version = '3.2.0'`.
- LCP закомментирован в обоих: `podspec:23` (`# s.dependency 'ReadiumLCP', '~> 3.5.0'` — заметьте, **3.5.0**, ещё старше) и `build.gradle:101`. Подтверждает §3.4; по решению §8.5 не имеет значения.

**Лаг от upstream — посчитан, а не оценён** (даты тегов из `git log`):

| Платформа | Пин | Дата пина | Актуально | Дата | Лаг |
|---|---|---|---|---|---|
| iOS | 3.9.0 | 2026-05-12 | 3.11.0 | 2026-07-17 | **66 дней, 2 минорных** |
| Android | 3.2.0 | 2026-05-13 | 3.3.0 | 2026-06-02 | **20 дней, 1 минорный** |

Промпт §3.4 говорил «около двух месяцев» — для iOS точно, для Android завышено втрое.

---

## §1. Расхождения промпта с реальностью (§9.7)

Фиксирую, а не отклоняюсь молча.

| Промпт | Факт | Значимость |
|---|---|---|
| §3.3: swift-toolkit требует «Swift 6.0» | **промпт прав, ранняя правка этого документа была неверна.** `README.md:105-112` — таблица минимумов: для 3.8.0 и `develop` требуется iOS 15.0, **Swift compiler 6.0**, Xcode 16.4. `s.swift_version = '5.10'` в `Support/CocoaPods/ReadiumShared.podspec:18` — объявление языкового режима, а не требование к компилятору; противоречия нет | исправлено |
| §3.4: «Kotlin 2.3.20» у kotlin-toolkit | прослойка собирается на `kotlin_version = '2.3.21'`, AGP `8.13.2`, Java 18 (`android/build.gradle:2,11,43-44`) | низкая |
| §2.1: «`components/Reader/` — 24 компонента, 5 272 строки» | **22 записи** в каталоге, 34 файла рекурсивно, **7 234 строки** `.ts*` включая `Core/`, `ReaderSettingsPanel/`, `__tests__/` | средняя: инвентарь §4.1 в соседнем артефакте должен считаться по факту |
| §2.1: «31 хук, 8 600 строк» | **подтверждено точно**: 31 файл, 8 600 строк | — |
| §3.4: «29 звёзд, pre-1.0 → сигнал bus-factor» | сигнал другой, см. §9: **901 коммит за 6 месяцев**, 4 живых контрибьютора, **все 8 тегов уложились в 46 дней** (v0.1.0 2026-06-20 → v0.3.3 2026-08-04) | **высокая — риск-профиль иной, чем в промпте** |
| §3.4: «отставание ~2 минорных версии» | верно для iOS (66 дней), для Android 1 версия / 20 дней | средняя |
| §3.4: пути `flutter_readium/ios/…` | верны, но репозиторий — **монорепо из двух пакетов**: `flutter_readium/` и `flutter_readium_platform_interface/`. Публичный Dart-API живёт в обоих | средняя: без этого половина API-поверхности не находится |

---

## §2. Ось 1 — поверхность API. Главная таблица

Метод: перечислен публичный API `swift-toolkit/Sources/Navigator` (33 публичных протокола,
26 публичных классов — `grep -rhoE "public (protocol|class)" | sort -u | wc -l`), затем каждая возможность,
релевантная fancai, размечена по фактическому Dart-каналу.

**Вся поверхность Dart → нативный код — это ровно два канала и пять потоков событий**
(`flutter_readium_platform_interface/lib/method_channel_flutter_readium.dart:16-33`,
`flutter_readium/lib/reader_channel.dart`):

- `dk.nota.flutter_readium/main` — **25 методов**: `setLogLevel`, `setCustomHeaders`, `setAudioRecoveryPolicy`, `loadPublication`, `openPublication`, `closePublication`, `getResourceUrl`, `searchInPublication`, `goToLocator`, `goToProgression`, `setDecorationStyle`, `setNarrationSyncEnabled`, `ttsEnable`, `ttsSetPreferences`, `ttsSetVoice`, `ttsGetAvailableVoices`, `audioEnable`, `audioSetPreferences`, `audioSeekBy`, `play`, `pause`, `resume`, `stop`, `next`, `previous`, `dispose`.
- канал виджета — **8 методов**: `go`, `goForward`, `goBackward`, `setPreferences`, `applyDecorations`, `configureSelectionActions`, `notifyUserNavigation`, `dispose` (`reader_channel.dart:57-125`, обработчики — `ReadiumReaderWidget.kt:355-459`, `EPUBReaderView+MethodChannel.swift`).
- `EventChannel` × 5: `text-locator`, `timebased-state`, `error`, `reader-status`, `narration-sync`.

Всё, чего нет в этих 33 методах и 5 потоках, **для Dart не существует**.

| Возможность upstream | Где в upstream | В Dart | Что это значит для fancai |
|---|---|---|---|
| Открытие публикации по HTTP с кастомными заголовками | `Streamer`, `HTTPClient` | ✅ **проброшено** — `setCustomHeaders` | `GET /api/v1/books/{id}/file` с `Authorization: Bearer` работает |
| `Navigator.go(to:)`, `goForward`, `goBackward` | `Navigator.swift:26-49` | ✅ **проброшено** | листание и переход по TOC |
| `currentLocation: Locator?` | `Navigator.swift:18` | ✅ **проброшено** — поток `text-locator` | сохранение/восстановление позиции |
| `Locator` целиком | `Shared/Publication/Locator.swift` | ✅ **проброшено без потерь**, см. §4 | превосходит ожидания |
| `VisualNavigator.goLeft/goRight`, `presentation` | `VisualNavigator.swift:26-40,68-83` | ⚠️ **частично** — RTL решается нативно, `presentation` в Dart недоступен | fancai LTR-only, не критично |
| **`VisualNavigatorDelegate.didTapAt(point:)`** | `VisualNavigator.swift:104` | ❌ **недоступно** | **тап с координатами не доходит до Dart. См. §7** |
| **`InputObservable.addObserver` (tap/click/drag/key)** | `Input/InputObservable.swift:11-22`, `Input/Pointer/*` | ❌ **недоступно** | своя модель жестов невозможна |
| **`DirectionalNavigationAdapter.PointerPolicy`** | `DirectionalNavigationAdapter.swift:38-88` | ❌ **недоступно** — привязан нативно с дефолтами (`EPUBReaderView.swift:229-231`) | **тап-зоны 15% fancai нереализуемы. См. §7** |
| `DecorableNavigator.apply(decorations:in group:)` | `Decorator/DecorableNavigator.swift:20` | ✅ **проброшено** — `applyDecorations(group, …)` | подсветка описаний работает |
| `DecorableNavigator.observeDecorationInteractions` | `Decorator/DecorableNavigator.swift:32` | ⚠️ **частично** — Android любая группа, **iOS только `"user-highlight"`** | см. §5 |
| `OnDecorationActivatedEvent.rect` / `.point` | `Decorator/DecorableNavigator.swift:52-56` | ❌ **недоступно** | привязанный к слову popup невозможен |
| `Decoration.userInfo` | `Decorator/DecorableNavigator.swift:73` | ❌ **недоступно** | обходится кодированием id в строку |
| **`HTMLDecorationTemplate` (произвольный HTML + CSS)** | `EPUB/HTMLDecorationTemplate.swift:33-47` | ❌ **недоступно** | **только 3 стиля. См. §5** |
| **`Configuration.decorationTemplates`** | `EPUB/EPUBNavigatorViewController.swift:86` | ❌ **недоступно** | то же |
| `Decoration.Style.Id` (произвольные стили) | `Decorator/DecorableNavigator.swift:88-131` | ❌ **недоступно** — Dart-`enum` из 3 значений | то же |
| `SelectableNavigator.currentSelection` | `SelectableNavigator.swift:14` | ⚠️ **частично** — приходит как событие, не как свойство | достаточно |
| **`Selection.frame: CGRect?`** | `SelectableNavigator.swift:29` | ❌ **недоступно** | **`SelectionMenu`/`HighlightTooltip` не позиционируются. См. §7** |
| `SelectableNavigatorDelegate.shouldShowMenuForSelection` | `SelectableNavigator.swift:36` | ❌ **недоступно** | нативное меню нельзя подавить в пользу своего |
| `EditingAction` / кастомные действия | `Configuration.editingActions` (`:61`) | ⚠️ **частично** — `SelectionAction{id,title}`, ≤5 на iOS (`reader_selection.dart:65`), на Android вытесняет системные (`:90-93`) | достаточно при редизайне |
| `EPUBPreferences` (27 полей) | `EPUB/Preferences/EPUBPreferences.swift` | ⚠️ **24 из 27**, +4 своих. См. §6 | 5 тем fancai достижимы |
| **`PreferencesEditor` / `Preference` / `RangePreference`** | `Configurable`, `EPUBPreferencesEditor` | ❌ **недоступно** — только плоский value-object | клампинг и шаги придётся писать в Dart |
| **`Configuration.fontFamilyDeclarations`** | `EPUB/EPUBNavigatorViewController.swift:89` | ❌ **недоступно** (`grep` по прослойке — 0) | Inter/Fira Code не зарегистрировать |
| `Configuration.readiumCSSRSProperties` | `EPUB/EPUBNavigatorViewController.swift:94` | ❌ **недоступно** | тонкая типографика недостижима |
| `Configuration.preloadPrevious/NextPositionCount` | `:80-83` | ⚠️ **проброшено, iOS-only** — «kotlin-toolkit не выставляет» (`reader_widget.dart:97`) | асимметрия платформ |
| `Configuration.disablePageTurnsWhileScrolling` | `:64` | ❌ **недоступно** | см. §7 |
| **`ContentService` / `Content` / `ContentTokenizer`** | `Shared/Publication/Services/Content/` | ❌ **недоступно** | текст главы у fancai уже на сервере — не блокер |
| Поиск по публикации | `Publication.search` | ✅ **проброшено** — `searchInPublication` | `SearchPanel.tsx` переносится |
| TTS, аудиокниги, Media Overlays | `PublicationSpeechSynthesizer`, `AudioNavigator` | ✅ **проброшено щедро** (11 из 25 методов канала) | fancai не использует |
| PDF | `PDFNavigatorDelegate` | ✅ проброшено | fancai не использует |
| Readium LCP | `Sources/LCP` (5 202 строки) | ❌ закомментировано | снято решением §8.5 |
| **Инжект произвольного JS** | `EPUBNavigatorDelegate.setupUserScripts` | ❌ **недоступно. См. §3** | ключевой вопрос §11.4 |

**Итог оси.** Проброшено то, что нужно **Nota**: чтение, TTS, аудио, Media Overlays, комиксы.
Не проброшено то, что нужно **приложению со своим UI поверх книги**: жесты, координаты,
шаблоны декораций, рамка выделения, шрифты, редакторы настроек. Асимметрия не случайная —
это форма продукта вендора, и §6 (собственные поля `blackAndWhiteComicMode`,
`preventMOColumnBreaks`) её подтверждает.

---

## §3. Ось 6 — инжект JS в вебвью. Прямой ответ на §11.4

**Вопрос:** можно ли из Dart выполнить произвольный скрипт в вебвью публикации?

### Ответ: нет. Ни документированного пути, ни обходного.

Доказательства, в порядке исключения альтернатив:

1. **`evaluateJavascript` существует на обеих нативных сторонах** и активно используется:
   iOS — `EPUBReaderView+JSBridge.swift:48-50`, Android — `navigators/EpubNavigator.kt:367-376`,
   `ReadiumReaderWidget.kt:484`. Вызовов из прослойки много (`setCSSProperties`,
   `getViewPortSize`, `getPageInformation`, `scrollToPosition`, `setSegmentDuration`).
2. **В Dart — ноль вхождений.** `grep -rn "evaluateJavascript\|evaluateJavaScript\|runJavaScript\|executeScript" --include=*.dart` по обоим пакетам → **пусто**.
3. **Ни один из 33 методов канала не является проходным для JS.** Полный список — §2. Ближайшие
   кандидаты проверены и не подходят: `setDecorationStyle` принимает **два `Decoration.Style`
   для TTS** (`FlutterReadiumPlugin.swift:282-294`: `ttsUtteranceDecorationStyle`,
   `ttsRangeDecorationStyle`), а не шаблон; `applyDecorations` принимает
   `[String]` JSON-декораций (`EPUBReaderView+MethodChannel.swift:96-107`).
4. **Точка инжекта закрыта на уровне видимости Swift.** Скрипты живут в
   `private var userScripts: [WKUserScript]` — **приватной переменной файлового уровня**
   (`EPUBReaderView+JSBridge.swift:6`). Наполняется только `initUserScripts(registrar:)`
   (`:116-211`) фиксированным списком: `flutterReadiumTools.js`, массив ToC-id,
   CSS-инжект, флаги платформы, шим `window.updateNarrationSync`, патч дедупликации декораций.
   Вход в `setupUserScripts` (`:25-46`) — реализация делегата upstream, вызывается навигатором.
   Из Dart в этот список **добавить нечего**.
5. **Обратного канала из JS тоже нет.** Зарегистрирован ровно один
   `WKScriptMessageHandler` с именем `"narrationSync"` (`:32`), и его обработчик принимает
   **только `Bool`**: `guard message.name == "narrationSync", let enabled = message.body as? Bool`
   (`:71-77`). Даже если бы скрипт удалось внедрить, результат некуда вернуть.
6. **Вендор сам считает это нативной возможностью, а не публичным API.** Его собственный
   план `docs/plans/todo/divina-panel-zoom-plan.md:22`: «JS is injectable into the outer frame
   via `readiumViewController.evaluateJavaScript`» — то есть для реализации своей же фичи
   Nota планирует писать Swift, а не Dart.

**В варианте B этот путь открыт полностью:** `EPUBNavigatorDelegate` с методом
`navigator(_:setupUserScripts:)` — публичный протокол upstream, и `evaluateJavaScript` на
`EPUBNavigatorViewController` тоже публичный. Именно этим и пользуется прослойка.

### Но вывод из этого — не тот, которого ждал промпт

Промпт §4.3 формулирует: «Это определяет, переносится ли цепочка 8 стратегий вообще — если
такого канала нет, вариант A теряет ключевую возможность». **Посылка неверна.** Цепочке
8 стратегий инжект JS не нужен, и вот почему.

Все восемь стратегий — **чистый текстовый поиск, возвращающий символьное смещение**
(`frontend/src/utils/text-search/strategies.ts`): `strategyFirst40` (первые 40 символов),
`strategySkip10`, `strategyFirstWords` (5 слов), `strategyFullMatch` (<200 символов),
`strategySkip20`, `strategyMiddle` (50 символов из середины), `strategyFirstSentence`,
`strategyLCS` (наибольшая общая подстрока, порог 70%). Все, кроме LCS, — обёртки над
`indexOfResult` (`:18-22`), то есть `text.indexOf(pattern)`. DOM в поиске не участвует.
DOM нужен только на втором шаге — **обернуть найденный диапазон в `<span>`**
(`useDescriptionHighlighting.ts:208-227,408-429`).

И ровно этот второй шаг Readium делает сам. `rangeFromLocator`
(`swift-toolkit/Sources/Navigator/EPUB/Scripts/src/utils.js:295-344`):

```js
if (text && text.highlight) {
  var root; if (locations && locations.cssSelector) root = document.querySelector(locations.cssSelector);
  if (!root) root = document.body;
  let anchor = new TextQuoteAnchor(root, text.highlight, { prefix: text.before, suffix: text.after });
  return anchor.toRange();
}
```

`TextQuoteAnchor` — вендоренная реализация Hypothesis
(`utils.js:9` → `./vendor/hypothesis/anchoring/types`), и её зависимость —
**`approx-string-match@^1.1.0`** (`Sources/Navigator/EPUB/Scripts/package.json`), то есть
приближённое сопоставление строк по расстоянию редактирования. **Fuzzy-матчинг уже внутри
движка.**

Отсюда переносимая схема, не требующая ни строчки JS:

1. восемь стратегий выполняются **в Dart** над текстом главы (он у fancai уже есть — `Chapter.content` в БД) → символьное смещение;
2. по смещению собирается `Locator` с `text: {before, highlight, after}` — `LocatorText` в Dart есть (`locator.dart:405-411`);
3. `applyDecorations(group, [ReaderDecoration(id, locator, style)])`;
4. Readium резолвит текстовый якорь в DOM-диапазон сам, с fuzzy-допуском.

**Это не деградация, а упрощение.** Восемь стратегий существуют потому, что epub.js не даёт
примитива текстового якоря, и fancai пришлось писать его самому. Readium его даёт. Часть
цепочки (в первую очередь LCS) дублирует то, что `approx-string-match` делает внутри.

`[вывод из кода]` — сколько именно стратегий останется нужно, определяется тем, насколько
текст описания от LLM расходится с текстом книги; это единственное, что код не отвечает
(см. §13).

---

## §4. Ось 2 — модель позиционирования. Потерь нет

Единственная ось, где Dart **богаче** upstream.

| Поле | swift-toolkit | Dart |
|---|---|---|
| `href`, `type`/`mediaType`, `title` | `Locator.swift:13-19` | `locator.dart:72-78` ✅ |
| `locations.fragments`, `progression`, `totalProgression`, `position` | `Locator.swift:139-145` | `locator.dart:294-303` ✅ |
| `text.before` / `highlight` / `after` | `Locator.swift:200-202` | `locator.dart:405-411` ✅ |
| `cssSelector` | внутри `otherLocations` | **явное поле** `locator.dart:306` |
| `domRange` | внутри `otherLocations` | **явное поле** `locator.dart:309` (+ `html/dom_range.dart`) |
| **`partialCfi`** | внутри `otherLocations` | **явное поле** `locator.dart:312` |
| произвольные ключи | `otherLocations: [String: JSONValue]` (`:148`) | `AdditionalProperties` (`locator.dart:61,243`) |

Неизвестные ключи **не теряются на границе канала**: `fromJson` складывает остаток в
`additionalProperties` (`locator.dart:142,289`), `toJson` начинает с `Map.of(additionalProperties)`
(`:147,352`). Round-trip замкнут.

Следствия для fancai:

- трюк `useCFITracking.ts` — хранить scroll-offset рядом с позицией — переносится **как есть**, в `additionalProperties`;
- `partialCfi` первоклассное поле, то есть CFI-совместимость доступна, даже если она уже не нужна (§8.8);
- прослойка сама этим пользуется: `EPUBReaderView.swift:369-373` домешивает `PageInformation` и `tocHref` в `otherLocations` перед отправкой.

**Оценка: паритет с запасом. Ни в A, ни в B здесь нет разницы.**

---

## §5. Ось 3 — Decoration API. Самая большая асимметрия

### Что даёт upstream

`DecorableNavigator` (`Sources/Navigator/Decorator/DecorableNavigator.swift`):

- `apply(decorations:in group:)` — **произвольное число именованных групп** (`:20,42`);
- `supports(decorationStyle:)` (`:26`);
- `observeDecorationInteractions(inGroup:onActivated:)` → `OnDecorationActivatedEvent{decoration, group, **rect**, **point**}` (`:32,45-57`);
- `Decoration{id, locator, style, **userInfo**}` (`:63-79`) — `userInfo` прямо задокументирован как «данные приложения, Readium их не использует»;
- `Decoration.Style{id: Id, config: AnyHashable?}` (`:88-131`) — `Id` это `RawRepresentable` строка, то есть **свои стили регистрируются свободно**; `highlight`/`underline` лишь дефолты;
- `HTMLDecorationTemplate{layout, width, element: (Decoration) -> String, stylesheet: String?}` (`EPUB/HTMLDecorationTemplate.swift:33-47`) — **произвольный HTML на каждую декорацию и произвольный CSS**, с управлением слоем (`Layout`), шириной (`Width`) и z-порядком через `experimentalPositioning` (`:65-67`);
- регистрация — `Configuration.decorationTemplates: [Decoration.Style.Id: HTMLDecorationTemplate]` (`EPUBNavigatorViewController.swift:86`).

### Что доходит до Dart

`ReaderDecoration{id, locator, style}` (`reader_decoration.dart:29-55`) и
`ReaderDecorationStyle{style, tint, isActive}` (`:57-94`), где `style` —
**`enum` ровно из трёх значений** (`:6-14`):

- `highlight` — заливка позади текста;
- `underline` — подчёркивание;
- `spotlight` — заливка **плюс затемнение всего остального текста**.

Отсутствует: `element`, `stylesheet`, `layout`, `width`, свои `Style.Id`, `config`, `userInfo`,
`supports()`, а в событии тапа — `rect` и `point`
(`reader_decoration_interaction.dart:20-56` даёт только `decorationId`, `group`, `type`, `locator`).

### Три конкретных следствия для fancai

**1. Группы работают, но интерактивность групп на iOS — нет.** `applyDecorations(id, …)`
пробрасывает `id` именно как группу: iOS `applyDecorations(decorations, forGroup: identifier)`
(`EPUBReaderView+MethodChannel.swift:97,107`), Android `ReadiumReader.applyDecorations(decorations, groupId)`
(`ReadiumReaderWidget.kt:427,434`). Но подписка на тапы разная:

- **Android** — регистрирует слушателя на **любую** группу по первому обращению:
  `registeredDecorationGroups` + `ensureDecorationListener(navigator, group)`
  (`navigators/EpubNavigator.kt:459-486`);
- **iOS** — **один жёстко зашитый вызов** в конструкторе:
  `observeDecorationInteractions(inGroup: "user-highlight")` (`EPUBReaderView.swift:235-237`),
  с комментарием «We register a global handler on the well-known "user-highlight" group».

fancai нужны минимум три интерактивных слоя — `.description-highlight`, `.entity-mention`,
`.user-annotation` (13/13/11 вхождений в `frontend/src` соответственно). На iOS тапы придут
**только по группе `"user-highlight"`**.

*Обход есть и он дешёвый:* сложить все три вида в одну группу `"user-highlight"`, различая
их по `tint` и по префиксу в `id`. Цена — `applyDecorations` заменяет группу целиком, значит
обновление подсветки сущностей требует переотправки описаний и заметок тем же вызовом.
`[вывод из кода]` для главы это десятки-сотни декораций на вызов. **Неудобство, не блокер.**

**2. Визуальных стилей фактически два, не три.** `spotlight` затемняет весь остальной текст
(`reader_decoration.dart:13`), поэтому для постоянных отметок он непригоден — три
одновременно подсвеченных описания погасят главу. Остаются `highlight` и `underline`,
различаемые `tint`. Сегодня три системы fancai различаются отдельными CSS-классами.
**Деградация оформления, обходится цветом.**

**3. Привязанный к слову popup невозможен.** `rect`/`point` отброшены. Всё, что открывается по
тапу, должно быть bottom sheet, а не якорный тултип. У fancai `DescriptionDrawer.tsx` и
`EntityBottomSheet.tsx` уже sheet — им ничего не нужно. `HighlightTooltip.tsx` — нужен, см. §7.

### Отдельная находка: движок дедуплицирует декорации неправильно, и прослойка это лечит

`EPUBReaderView+JSBridge.swift:171-210` — прослойка внедряет **JS-патч поверх собственного
API движка**: подменяет `window.readium.getDecorations`, чтобы `group.add()` сначала делал
`group.remove(decoration.id)`. Комментарий описывает дефект: при догрузке вебвью spread
переигрывает все сохранённые декорации безусловными `add()` без очистки, `DecorationGroup.add()`
не дедуплицирует по логическому id, и после прыжка по TOC на один id остаётся два DOM-элемента,
а инкрементальный `update()` снимает только первый. Там же `TODO: report upstream`.

Это важно трижды:

- **подтверждает §3.3 «отрезвляющей новости»**: уход с epub.js не убирает класс дефектов «декорации разъезжаются с DOM» — он тот же, просто в другом движке;
- **этот дефект достанется и варианту B** — он в движке, а не в прослойке. Разница лишь в том, что в A патч уже написан за вас, а в B его придётся написать самому (или дождаться upstream);
- показывает реальную глубину прослойки: она не транслирует вызовы, она **правит движок в рантайме**.

---

## §6. Ось 4 — Preferences API. 24 из 27, и пять тем fancai достижимы

`EPUBPreferences` upstream — **27 полей** (`Sources/Navigator/EPUB/Preferences/EPUBPreferences.swift`).
Dart — **28 полей**, из них 24 соответствуют upstream (`reader_epub_preferences.dart:43-141`).

**Отсутствуют в Dart три:** `fit`, `offsetFirstPage`, `theme`.

**Добавлены четыре своих:** `blackAndWhiteComicMode`, `disableSynchronization`,
`firstElementTopMargin`, `preventMOColumnBreaks` — комиксы и Media Overlays, то есть продукт Nota.

Проверка против пяти тем fancai (`ReaderSettingsPanel/config.ts:4-10`): `light` `#FFFFFF`/`#1A1A1A`,
`dark` `#121212`/`#E0E0E0`, `sepia` `#FBF0D9`/`#3D2914`, `night` `#000000`/`#B0B0B0`,
`outdoor` `#FFFEF5`/`#000000`.

**Отсутствие `theme` — не потеря, а преимущество.** Upstream `Theme` — перечисление
(light/dark/sepia), в которое пять тем fancai не влезают в принципе. Dart даёт
`backgroundColor` и `textColor` как произвольные `Color` (`:43,101`) — то есть все пять тем
задаются точными цветами. **Паритет достигается, и более гибким способом.**

Что действительно теряется:

- **`Configuration.fontFamilyDeclarations`** (`EPUBNavigatorViewController.swift:89`) не проброшено — `grep "fontFamilyDeclarations"` по прослойке пуст. `fontFamily` в Dart — просто `String?` (`:49`). fancai предлагает три шрифта (`config.ts:12-16`): `Georgia, serif`, `"Inter", sans-serif`, `"Fira Code", monospace`. Georgia системная, **Inter и Fira Code в вебвью не зарегистрировать** → молчаливый откат на системный шрифт. Потеря небольшая и конкретная: 3 варианта → 1–2.
- **`readiumCSSRSProperties`** (`:94`) не проброшено — тонкая настройка ReadiumCSS недоступна.
- **`PreferencesEditor` / `Preference` / `RangePreference`** не проброшены вовсе: в Dart плоский value-object без `supportedValues`, шагов и клампинга. `ReaderSettingsPanel` придётся валидировать значения сам. Работа на часы, не на дни.

**Оценка: близко к паритету. Самая безболезненная из «дефицитных» осей.**

---

## §7. Ось 5 — события и жесты. Здесь проваливается больше всего

### Что даёт upstream

- `VisualNavigatorDelegate.navigator(_:didTapAt point: CGPoint)` — **тап с координатами** (`VisualNavigator.swift:104`);
- `InputObservable.addObserver(_:)` + `ActivatePointerObserver`, `DragPointerObserver`, `KeyObserver` — **своя модель жестов целиком** (`Input/InputObservable.swift:11-22`, `Input/Pointer/*`);
- `DirectionalNavigationAdapter.PointerPolicy` (`DirectionalNavigationAdapter.swift:38-88`) — `types`, `edges` (горизонт/вертикаль), `ignoreWhileScrolling`, `minimumHorizontalEdgeSize` (дефолт **80**), `horizontalEdgeThresholdPercent` (дефолт **0.3**), вертикальные аналоги, `animatedTransition`, колбэк `onNavigation`. Эффективная зона — `max(80, 0.3 × width)` (`:205-209`);
- `Selection{locator, **frame: CGRect?**}` и `shouldShowMenuForSelection` → «верните false и покажите свой popup по `selection.frame`» (`SelectableNavigator.swift:22-36`);
- `canPerformAction(_:for:)` — валидация действия по выделению (`:52`).

### Что доходит до Dart

Из виджета (`reader_widget.dart:20-35`): `onExternalLinkActivated`, `onTextSelected`,
`onSelectionAction`, `onDecorationInteraction`, `onImageTapped`, `shouldShowControls`,
`selectionActions`, `allowedDefaultActions`, три семантических лейбла, два счётчика preload.

**Колбэка тапа с координатами нет.** Вместо него `shouldShowControls: ValueNotifier<bool>` —
то есть наружу отдаётся уже принятое решение «показать контролы», а не событие.

### Модель жестов зашита в двух местах и они не согласованы

**Нативно** (`EPUBReaderView.swift:227-231`):

```swift
/// This adapter will automatically turn pages when the user taps the screen edges or presses arrow keys.
DirectionalNavigationAdapter(pointerPolicy: .init(types: [.mouse, .touch])).bind(to: readiumViewController)
```

Передан **только** `types`. Остальное — дефолты, значит зона листания = `max(80pt, 30% ширины)`.
На iPhone шириной 390pt это **117pt с каждой стороны**. Отключить или сузить из Dart нельзя:
адаптер привязывается в конструкторе безусловно, `PointerPolicy` в канал не выведен,
`Configuration.disablePageTurnsWhileScrolling` тоже.

**В Dart** (`reader_widget.dart:204-237`) поверх нативного вью лежит `Listener`, который
классифицирует тап **по своей границе 70 логических пикселей**:

```dart
final dx = event.position.dx;
if (dx < 70.0 || ((context.size?.width ?? 0) - dx) < 70.0) {
  _onInteraction();      // edge tap
} else {
  _toggleControls();     // center tap
}
```

Свайп определяется как `event.delta.distance > 3.0` (`:214`).

**Две границы не совпадают: 70pt в Dart против ~117pt нативно.** `[вывод из кода]` тап в полосе
70–117pt классифицируется как «центр» во Flutter и как «край» нативно, то есть **одновременно
переворачивает страницу и переключает контролы**. Это латентный дефект самой прослойки,
не настраиваемый снаружи; его придётся или терпеть, или форкать.

### Три конкретные потери для fancai

**1. Тап-зоны 15% нереализуемы.** `useGestureController.ts:56-58`:
`EDGE_ZONE_IFRAME = 0.15`, `EDGE_ZONE_IOS = 0.15` — «15% edges». Прослойка навязывает 30%/80pt.
Разница вдвое, и она не параметр.

**2. Пользовательская настройка `navigationMode` не может быть исполнена.** У fancai это
не внутренняя деталь, а **переключатель в UI**: `stores/reader.ts:63,139` (`'swipe' | 'tap'`,
дефолт `swipe`), тумблер в `ReaderControls.tsx:180-190` и в `ReaderSettingsPanel.tsx:279-290`,
опции в `config.ts:24-27`. В варианте A edge-tap-листание включено **всегда** и выключить его
из Dart нечем. То есть режим `swipe` (в котором тап по краю листать не должен) **воспроизвести
невозможно**. Это первая найденная возможность, которая сегодня работает у пользователя и
под A не работает совсем.

**3. `SelectionMenu` теряет позиционирование.** `Selection.frame` не проброшен, а
`SelectionMenu.tsx` построен вокруг координат: `position: {x, y}` (`:39`), расчёт
above/below по свободному месту (`:155-178`), `position: fixed` с вычисленными `left`/`top`.
Плюс это не список пунктов, а **панель с редактором заметки**: копирование, 4 стиля
(`none`/`underline`/`bold`/`italic`, `:26-30`), выбор цвета фона и цвета текста, textarea.
Нативное меню принимает только `SelectionAction{id, title}`, ≤5 на iOS (`reader_selection.dart:65`),
а на Android кастомные действия **вытесняют системные целиком** (`:90-93`).

*Обход:* нативный пункт «Заметка» → `onSelectionAction` → Flutter открывает свой bottom sheet
с тем же редактором. Функциональность сохраняется, **якорность теряется**. `HighlightTooltip.tsx`
в текущем виде не переносится и должен стать sheet.

**В варианте B все три пункта — это параметры.** Зоны: `horizontalEdgeThresholdPercent: 0.15`.
Режим `swipe`: не привязывать адаптер либо `edges: []`, либо `addObserver(.tap {…})` со своей
логикой. Меню: вернуть `false` из `shouldShowMenuForSelection` и рисовать своё по `selection.frame`.

---

## §8. Ось 7 — границы платформенного канала

**Троттлинга и батчинга в прослойке нет вообще.** `grep -rn -i "throttle\|debounce\|Timer(\|asyncAfter"`
по нативной части прослойки (за вычетом wakelock) → пусто.

Что происходит на **каждой** смене позиции — `EPUBReaderView.swift:291-309` → `emitOnPageChanged(locator:)` (`:362-374`):

1. `Task.detached(priority: .high)` — новая задача;
2. `await self.getPageInformation()` → **JS-раунд-трип в вебвью**: `window.flutterReadium.getPageInformation()` (`EPUBReaderView+JSBridge.swift:79-88`);
3. `await FlutterReadiumPlugin.instance?.currentTocLinkFromLocator(…)` → проход по **плоскому TOC** (`getFlattenedToC()`);
4. домешивание в `locations.otherLocations`, JSON-кодирование, отправка в `EventChannel`.

Плюс при смене ресурса — переустановка CSS-переменных и, при `preventMOColumnBreaks`,
инжект CSS (`:300-307`).

Оценка. В пагинированном режиме `locationDidChange` срабатывает на переворот страницы —
частота человеческая, стоимость приемлема. `[вывод из кода]` заметная часть цены —
не сериализация, а JS-раунд-трип и проход по TOC на каждом событии; для книги с 554 главами
(текущий прод) плоский TOC сканируется заново каждый переворот.

Для fancai это **не блокер**: `useProgressSync` уже дебаунсит запись прогресса на 5 с
(`.claude/rules/reader.md`), и такой же дебаунс в Dart ставится за минуты. Отмечаю как
характеристику, а не как риск.

Обратное направление — `applyDecorations` передаёт `List<String>` предварительно
сериализованных JSON-декораций (`EPUBReaderView+MethodChannel.swift:98`,
`ReadiumReaderWidget.kt:430-432`), то есть **двойная сериализация**: Dart-объект → JSON-строка →
StandardMessageCodec. На сотнях декораций на главу измеримо, но заведомо дешевле, чем
DOM-обход в epub.js, который делается сейчас.

---

## §9. Ось 8 — качество прослойки

**Метрики (без `example/`):**

| Показатель | `flutter_readium` | swift-toolkit | kotlin-toolkit |
|---|---|---|---|
| `TODO`/`FIXME`/`HACK`/`XXX` | **48** (Kotlin 21, Dart 12, Swift 12, TS 3) | 19 | 33 |
| Комментарии про ограничения/обходы upstream | **50** | — | — |
| Dart-тестов | 9 файлов | — | — |
| GitHub workflows | 11 | — | — |

**Активность (`git log`, за 6 месяцев с 2026-02-04):**

- **901 коммит**;
- контрибьюторы: Daniel Freiling **614**, Morten Sjøgren **230**, SifAa 20, Andreas Lymalm 10, боты 27;
- теги: **все восемь** от `v0.1.0` (2026-06-20) до `v0.3.3` (2026-08-04) — публичная история релизов **46 дней**, релиз примерно каждые 6 дней.

**Это переворачивает риск-профиль из промпта.** 29 звёзд и версия 0.3.3 читались как
«заброшенный pre-1.0». Факт: очень активная разработка при очень короткой публичной истории.
Bus-factor ≈ **2** (не 1), но API молодой и меняется быстро — за 46 дней три минорных версии.
Риск смещается с «проект умрёт» на **«API под вами будет двигаться»**.

**Читаемость — выше ожидаемой.** Комментарии в разобранных файлах объясняют *почему*, а не
*что*: дедупликация декораций с диагнозом дефекта движка и разбором отвергнутых
альтернатив (`EPUBReaderView+JSBridge.swift:171-187`), `WeakScriptHandler` с указанием
разрываемого retain-цикла (`:9-16`), причина явного `nil` вместо `if let` в
`setDecorationStyle` (`FlutterReadiumPlugin.swift:283-286`), деградация вместо падения при
отсутствующих ассетах (`:90-106`).

**Но 50 комментариев про ограничения upstream — это карта того, что не работает,** и она
платформенно асимметрична. Примеры дословно:

- `navigators/EpubNavigator.kt:454-457` — «Image-tap (onImageTapped) is **NOT implemented on Android**… tracked follow-up item»;
- `ReadiumReaderWidget.kt:419-422` — `applyDecorations` «not supported for PDF/comic», потому что в kotlin-toolkit 3.2.0 у этих навигаторов нет `DecorableNavigator`;
- `reader_widget.dart:97` — `preloadPreviousPositionCount` «iOS only. kotlin-toolkit does not expose this»;
- `reader_selection.dart:90-93` — на Android кастомные действия заменяют `ActionMode.Callback` целиком, `allowedDefaultActions` не действует;
- `reader_decoration.dart:72-73` — `isActive` «Ignored on web until decorations are implemented there».

**Вывод оси.** Код, который придётся читать при отладке, — хорошего качества и хорошо
прокомментирован. Проблема не в качестве, а в **количестве и в форме**: 38 086 строк на
мобильном пути (§0), из которых Swift 8 097 и Kotlin 12 624 — тот слой, которого в варианте B
нет вообще, со своим набором из 48 TODO и своей платформенной асимметрией.

---

## §10. Ось 9 — вариант C (KMP). Измеренное ограничение, которое меняет его смысл

**Ключевая проверка: у `kotlin-toolkit` нет KMP-таргетов.**
`grep -rn "kotlin(\"multiplatform\")\|androidTarget\|iosArm64\|jvm()" --include=*.kts` по репозиторию
(без `test-app`) → **пусто**. Каждый модуль — `com.android.library` через
`readium.library-conventions` с блоком `android {}` (`readium/shared/build.gradle.kts:7-12`).

Следствие для варианта C, и оно жёстче, чем предполагает промпт §4.3:

- `readium/shared` — **19 447 строк**, и в них лежат ровно те модели, которые хотелось бы
  шарить: `Publication`, `Locator`, `Link`, `Metadata`. **Расшарить их с iOS нельзя** — это
  Android-библиотека.
- Значит общий KMP-модуль **не может владеть типом позиции**. Он будет владеть *своими* DTO
  fancai, а на каждой платформе конвертировать в `Locator` соответствующего тулкита:
  `ReadiumShared.Locator` на iOS, `org.readium.r2.shared.publication.Locator` на Android.
- А синхронизация прогресса — как раз то, ради чего C и затевается.

Что в C **реально** шарится: HTTP-клиент, модели API fancai, спойлерный шлюз
(`effectiveChapter = max(currentChapter, max_chapter_reached)` — чистая арифметика), кэши и
очередь синхронизации (аналоги `syncQueue.ts` 894 строки, `storageManager.ts` 1 022),
бизнес-правила сущностей и описаний. Что **не** шарится: UI, читалка, и — по факту выше —
модель позиции на границе с читалкой.

Зрелость Jetpack под KMP (Room 2.8.3, DataStore 1.1.7, ViewModel 2.9.4) и ограничения
доступности Compose на iOS — из §3.2 промпта, здесь не перепроверялись:
`[по состоянию на 2026-08-04, не перепроверено в этой сессии]`. Но они и не решают: C
нативен по читалке в любом случае, поэтому ограничения Compose-UI на iOS применимы лишь
настолько, насколько C тянет за собой Compose Multiplatform для остального UI. Если C
ограничить общей бизнес-логикой без общего UI, эти ограничения снимаются, а +15–20 МБ
рантайма Kotlin/Native остаются.

**Оценка оси.** C не даёт того, что от него ждут интуитивно («написать читалку один раз»),
потому что читалка в нём нативная по построению — как и в B. C экономит **офлайн-слой и сеть**,
а не читалку, и делает это ценой того, что тип позиции всё равно живёт дважды.

---

## §11. Ось 10 — стоимость выхода

**Для A — цена форка, если Nota остановится или разойдётся с вами в приоритетах.**
BSD-3 (`flutter_readium/LICENSE`, правообладатель — Royal Danish Library) позволяет форк без
обязательств кроме атрибуции. Но форкается не тонкая обёртка: **38 086 строк на четырёх
языках** на мобильном пути, ещё 11 755 в веб-таргете (§0), и поддерживать это придётся против
проекта, который делает **901 коммит за 6 месяцев**. Ребейз — не разовое событие, а постоянная
статья.

И здесь важнее другое, чем «остановится ли вендор». **Все шесть дефицитов, найденных выше,
лежат в прослойке, а не в движке:**

| Дефицит | Где закрывается | Оценка |
|---|---|---|
| Тап-зоны + отключаемость edge-tap (§7.1, §7.2) | пробросить `PointerPolicy` в канал + проп виджета | десятки строк на каждой платформе |
| `Selection.frame` (§7.3) | добавить поле в payload `onTextSelected` | единицы строк |
| `rect`/`point` в тапе по декорации (§5.3) | добавить поля в `DecorationInteractionEvent` | единицы строк |
| iOS: тапы только по `"user-highlight"` (§5.1) | вынести регистрацию по группе, как уже сделано на Android (`EpubNavigator.kt:459-486`) | десятки строк |
| `decorationTemplates` (§5.2) | новый метод канала + сериализация шаблона | сотни строк, самое дорогое |
| `fontFamilyDeclarations` (§6) | новый метод канала | десятки строк |

То есть **A не упирается в предел движка ни в одном пункте — он упирается в границу канала.**
Это делает форк технически лёгким и стратегически неприятным: вы будете постоянно
дописывать чужой публичный API под себя.

**Отдельно взвесить: PR в upstream вместо форка.** Nota активна, и это выглядит дешевле форка.
Но собственные поля `EPUBPreferences` (`blackAndWhiteComicMode`, `preventMOColumnBreaks`,
`firstElementTopMargin`, `disableSynchronization`), 11 из 25 методов канала под TTS/аудио, и
`docs/nota-comics/` показывают форму продукта: **библиотека для незрячих читателей, комиксы,
аудиокниги с Media Overlays**. Кастомные жесты, кастомная декорация и якорное меню выделения
в этой форме не нужны. `[допущение]` PR будут приниматься медленнее, чем нужно fancai, потому
что конкурируют с чужой дорожной картой.

**Для B — цена второй платформы, но не второго движка.** Читалка в A, B и C — **один и тот же
код** (§0: пины ведут на те же `ReadiumShared`/`ReadiumNavigator` и
`org.readium.kotlin-toolkit:*`). B платит за собственный нативный слой вместо готового и за
вторую реализацию бизнес-логики (это и снимает C). **Но 8 097 + 12 624 — завышенная оценка
этой работы, и вот почему.** Из неё вычитается:

- **маршалинг канала, которого в B не существует в принципе**: `FlutterReadiumPlugin.swift` 959, `PublicationChannel.kt` 556, JSON-конвертеры `ReadiumExtensions.swift` 553 и `ReadiumExtensions.kt` 775, модели ошибок `ReadiumError.swift` 291 + `ReadiumErrors+UserError.swift` 222;
- **функциональность, которой fancai не пользуется**: аудио/TTS/Media Overlays — 1 760 строк Swift (`FlutterAudioNavigator` 918, `FlutterTTSNavigator` 343, `NowPlayingInfoUpdater` 272, `FlutterMediaOverlay` 227) и 3 097 строк Kotlin (`AudiobookNavigator` 968, `PluginMediaService` 691, `TTSNavigator` 620, `SyncAudiobookNavigator` 293, `ComicNavigator` 525), плюс `PDFReaderView.swift` 330.

`[вывод из кода]` то, что в B действительно придётся написать — оболочка EPUB-читалки,
настройки, декорации, жесты и выделение, — заметно меньше половины этих чисел; точная цифра
считается в `docs/analysis/2026-08-04-migration-complexity-assessment.md` по инвентарю §4.1.
Взамен B получает **все десять осей без дефицита** и релизы upstream каждые 5–9 недель
(swift 3.5.0 → 3.11.0: 2025-11-06, 2025-12-17, 2026-02-04, 2026-03-10, 2026-05-12, 2026-07-17)
вместо 66-дневного лага.

**Для C — цена отказа от KMP** — переписать общий модуль на каждую платформу. По §10 общий
модуль и так не покрывает читалку и не владеет позицией, поэтому объём отката меньше, чем
кажется, но и выигрыш меньше.

---

## §12. Что это даёт по двум рискованным переносам §4.2

**Переход 1 — цепочка 8 стратегий → Decoration API. Понятно, что делать.**

1. Восемь стратегий переносятся в Dart **как чистые функции над строкой** — они уже такие
   (`utils/text-search/strategies.ts`, все через `indexOfResult`). DOM им не нужен.
2. Результат — символьное смещение в тексте главы. Текст берётся из `Chapter.content` (БД),
   а не из вебвью, что снимает зависимость от готовности рендера.
3. Из смещения собирается `Locator.text{before, highlight, after}`; Readium резолвит его через
   `TextQuoteAnchor` + `approx-string-match` (§3). Часть цепочки, прежде всего `strategyLCS`,
   становится избыточной — движок делает приближённое сопоставление сам.
4. Требование «не затирать `.user-annotation` и `.entity-mention`» **исчезает как класс**:
   декорации живут в собственных DOM-слоях движка, а не мутируют текст книги. Ни один из трёх
   слоёв fancai больше не оборачивает текстовые узлы, значит и затирать друг друга им нечем.
   Приостановка `ResizeObserver` (`resizeSuppression.ts`) тоже теряет смысл — она лечила
   layout thrash от собственных мутаций DOM.
5. Остаётся **иная** проблема того же класса: дедупликация декораций в движке (§5), уже
   диагностированная и пропатченная в прослойке.
6. Различение трёх слоёв: одна группа `"user-highlight"` (ограничение iOS), три `tint`,
   префикс в `id` вместо `userInfo`.

**Переход 2 — жесты. Понятно, что делать, и понятно, что это стоит.**

- В **B**: `DirectionalNavigationAdapter` с `horizontalEdgeThresholdPercent: 0.15`, либо, для
  режима `swipe`, адаптер не привязывается и используется `addObserver(.tap {…})` со своей
  классификацией зон. Конфликт с edge-swipe «назад» на iOS решается там же, где и в любом
  нативном приложении — `interactivePopGestureRecognizer`; `[допущение]` в этой сессии не
  проверялось.
- В **A**: тап-зоны и отключение edge-tap **недостижимы** (§7.1, §7.2), и это единственная
  найденная уже работающая пользовательская функция, которая под A отсутствует.
- Долгий тап: `DecorationInteractionType.longPress` в Dart есть
  (`reader_decoration_interaction.dart:4-17`), но **только по декорации**, не по произвольной
  точке.
- Выделение: работает в обоих; в A теряется якорность меню (§7.3).

---

## §13. Вердикт

> **Статус на 2026-08-04, после этого документа:** владелец зафиксировал §8.7 как
> **вариант B, последовательный — сначала полноценный iOS, затем Android**; A и C отклонены.
> Запись решения: `docs/plans/2026-08-04-mobile-migration-decisions.md`. Вердикт ниже
> сохранён как **обоснование выбора и протокол того, что было взвешено**: он отвечал на
> вопрос «достаточен ли A», и владелец решил не платить названное в нём условие (форк или
> PR в чужую прослойку с первого дня). Разметка дефицитов A остаётся действующей — она
> задаёт, что именно в B настраивается параметром, а не форком.

Требуемая форма — одна из трёх (§11.2). Даю первую, с названной ценой.

> ### «A достаточен — вот что теряется, и это приемлемо», при одном условии: вариант A означает форк или PR в `flutter_readium` с первого дня, а не после.

Обоснование.

**1. Главный страх промпта не подтвердился.** §11.4 предполагал, что без инжекта JS вариант A
теряет цепочку 8 стратегий. Инжекта JS из Dart **нет** (§3, доказано пятью независимыми
проверками), но цепочка **в нём и не нуждается**: стратегии — текстовый поиск, а DOM-якорение
делает сам движок через `TextQuoteAnchor` с fuzzy-матчингом. Главная фича fancai —
подсветка описаний и сущностей — переносится, причём **проще**, чем работает сейчас.

**2. Ни один дефицит не упирается в предел движка.** Читалка в A, B и C — один код (§0, §11).
Все шесть найденных дефицитов лежат на границе Dart↔нативный код, и каждый закрывается
добавлением метода канала или пропа виджета (таблица §11).

**3. Но одна работающая сегодня функция под A отсутствует полностью:** пользовательская
настройка `navigationMode: 'swipe' | 'tap'` (`stores/reader.ts:63`, тумблеры в
`ReaderControls.tsx:180-190` и `ReaderSettingsPanel.tsx:279-290`). Edge-tap-листание
привязано нативно и безусловно (`EPUBReaderView.swift:229-231`), выключить его из Dart нечем.
Плюс тап-зоны 15% против навязанных 30%/80pt, плюс несогласованность 70pt/117pt внутри самой
прослойки (§7). При решении §8.9 «полный паритет с вебом» это **не косметика** — это
невыполнение принятого требования.

**Почему это всё же не «A не достаточен».** Потому что цена закрытия названа и мала: это
десятки строк на платформу, а не архитектурная переделка, и BSD-3 её разрешает. Честная
формулировка риска A — не «хуже движок» и даже не «1,6 МБ чужого кода», а:

> **между вами и движком стоит 38 086 строк одного вендора, который движется со скоростью
> 901 коммит за полгода и решает не вашу задачу; всё, чего он не пробросил, вы дописываете
> сами и потом ребейзите.**

**Спайк для решения §8.7 не нужен.** Вопрос «достаточен ли A» закрыт по коду. §4.3 разрешает
спайк только в третьей форме вердикта — эта форма не наступила. S1 и S2 в постановке §4.3
(«открывается ли книга», «ложится ли подсветка на Decoration API») уже отвечены выше
утвердительно, читать код было достаточно.

**Ровно один вопрос, которого код не отвечает** — и он не про выбор стека, поэтому не блокирует §8.7:

> Насколько текст описания, извлечённого LLM, расходится с текстом книги настолько, что
> `TextQuoteAnchor` + `approx-string-match` не находит якорь, и сколько из восьми стратегий
> остаётся нужно как предварительный шаг?

Проверяется без мобильного клиента и без устройства: взять существующие 950 описаний из
прод-БД, прогнать против текста соответствующих глав тем же алгоритмом приближённого
сопоставления и посчитать долю промахов. Это работа на стороне бэкенда, в волне 0, и она
полезна независимо от выбора стека — она же показывает, насколько текущая цепочка из восьми
стратегий вообще оправдана.

### Что вердикт НЕ решает

Он отвечает «A технически достаточен», а не «A лучше B». Выбор между A и последовательным B
(§8.7) зависит от того, что владелец готов взять на себя:

- **A** — прикладной код на Dart один раз, плюс постоянный форк/PR-канал в чужую прослойку, плюс 66-дневный лаг фиксов iOS, плюс невыполненный `navigationMode` до первого форка.
- **B-последовательный** — все десять осей без дефицита и прямые релизы upstream, ценой собственного нативного слоя на каждой платформе (верхняя граница 8 097 + 12 624, фактически заметно меньше — см. §11) и второй реализации бизнес-логики. **Довод «веб-читалка живёт вдвое дольше» снят решениями владельца 2026-08-04:** §8.6 изменена (веб живёт до полноценного iOS, дальше отдельное решение), «Конфликт решений» §8.0 распущен — он опирался на пользователей второй платформы, которых по §8.8 нет.
- **C** — экономит офлайн-слой и сеть, но не читалку, и по §10 **не может владеть типом позиции**, потому что `kotlin-toolkit` не имеет KMP-таргетов.

### Вариант B на своих условиях — то, чего §4.3 не спрашивал

Форма вердикта §4.3 («достаточен ли **A**») заставила читать swift-toolkit как эталон для
разметки дефицитов плагина, а не как кандидата. Это перекос рамки, и его надо закрыть: ниже
то, что B даёт и требует сам по себе.

**Порог входа — измерен, а не оценён:**

| Что | Факт |
|---|---|
| Минимумы | iOS **15.0**, Swift compiler **6.0**, Xcode **16.4** (`README.md:105-112`) — то есть строгая конкурентность Swift 6 и `@MainActor` в API навигатора |
| Подключение | **SPM рекомендован**, CocoaPods поддержан, локальный клон/форк документирован (`README.md:117-156`) |
| Референсная интеграция | `TestApp` — **8 011 строк** Swift: библиотека, читалка, закладки, подсветки, оглавление, настройки |
| Playground (новое в 3.9.0) | пока **только два рецепта**, 231 строка (`A01-OpenPublication`, `A02-ReadMetadata`) — заявка на будущее, не готовый онбординг |
| Ломающие изменения 3.9 → 3.11 | **нет**: только добавления и фиксы (`CHANGELOG.md`). `docs/Migration Guide.md` — для мажорных версий |

**Главное: каждый из шести дефицитов A закрыт в B официальным руководством.**
`docs/Guides/Navigator/` — **1 612 строк** ровно по тем осям:

| Дефицит A (§2) | Руководство B | Строк |
|---|---|---|
| Тап-зоны, отключаемость edge-tap, тап с координатами | `Input.md` | 103 |
| Кастомные стили декораций, шаблоны, группы | `Decorations.md` — пятишаговый разбор «Creating a Custom Decoration Style» (`:94-201`) | 255 |
| Подсветка: выделение → декорация → тап | `Highlights.md` — полный пример, включая «Handling Taps» (`:102`) и «Creating a Highlight from a Text Selection» (`:26`) | 309 |
| `fontFamilyDeclarations` | `EPUB Fonts.md` | 119 |
| Полнота Preferences, редакторы | `Preferences.md` | 453 |
| Якорение popup к элементу | `EPUB Image Preview.md` + `Input.md:76` | 47 |

Плюс `docs/Guides/`: `Getting Started.md` 151, `Open Publication.md` 96, `Content.md` 203,
`Search.md` 211, `TTS.md` 187, `Accessibility.md`, `Readium LCP.md` 500, `Navigator/Navigator.md` 180,
`Navigator/SwiftUI.md` 146. Всего **3 066 строк** руководств.

**Два рискованных переноса §4.2 в B — не «требует изучения», а документированные рецепты:**

- **Жесты.** `Input.md:36-46` — `navigator.addObserver(.tap { event in … event.location })`, четыре строки, тап с координатами. Возврат `true` гасит событие для последующих наблюдателей (`:27`), то есть 15%-зоны fancai и режим `swipe` реализуются как свой observer **вместо** `DirectionalNavigationAdapter`, а не поверх него.
- **Якорение.** `Input.md:76` дословно: «`targetElement.frame` gives you the element's on-screen `CGRect` relative to the navigator's view, which you can use to **anchor a popover**». Это ровно та возможность, которую прослойка отбрасывает и без которой `SelectionMenu.tsx` и `HighlightTooltip.tsx` не переносятся (§7.3).

**Что B стоит, и это не снимается руководствами:** epub.js живёт всю фазу iOS, а вместе с ним
живёт WebKit-дефект из handoff 2026-08-07 (события не доходят в засэндбоксенный iframe).
Веб — единственный способ читать до релиза iOS, поэтому это **активный дефект прода**, а не
отложенный техдолг. Прежняя формулировка «веб живёт вдвое дольше, и это главный довод против
B» **снята**: решением 2026-08-04 срок жизни веба привязан к релизу iOS, а не к релизу Android
(`docs/plans/2026-08-04-mobile-migration-decisions.md`).

Числа по трудозатратам и стоимости владения на 3 года — в `docs/plans/2026-08-04-mobile-migration-plan.md`
(§5, §6 промпта). Настоящий документ даёт им техническую базу.

---

## §14. Следующий шаг

**Свести инвентарь §4.1** — таблицу по всем 31 хуку `hooks/epub/` и всем компонентам
`components/Reader/` (по факту **22 записи / 34 файла / 7 234 строки**, а не 24/5 272 — см. §1),
плюс остальной веб-функционал по требованию паритета §8.9, в
`docs/analysis/2026-08-04-migration-complexity-assessment.md`. Разметка колонки «аналог в Readium»
теперь делается **по этому документу**, а не по догадкам: для каждой из десяти осей известно,
что проброшено, что частично и что недоступно.

**Критерий успеха:** ни одной строки в колонке «аналог» без ссылки на раздел этого документа
или на файл со строками в одном из трёх репозиториев.

**Открытая развилка, которую §4.3 разблокировал:** §8.10 (платформенные минимумы). Теперь
измерено: `minSdk 24` — требование **прослойки** (`android/build.gradle:60`), а `kotlin-toolkit`
довольствуется 23; iOS 15.0 требуют и прослойка (`podspec:25`), и upstream. То есть выбор A
стоит одной ступени `minSdk`.
