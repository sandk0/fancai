# Исследование интеграции fancai с ЛитРес и электронными библиотеками

**Дата:** 4 февраля 2026  
**Версия:** 1.0  
**Статус:** Завершено  
**Автор:** AI-аналитик (Claude Opus 4.5)

---

## Содержание

1. [Executive Summary](#1-executive-summary)
2. [Детальный анализ ЛитРес](#2-детальный-анализ-литрес)
3. [Обзор других российских библиотек](#3-обзор-других-российских-библиотек)
4. [Стандарты и протоколы](#4-стандарты-и-протоколы)
5. [Open-source решения и инструменты](#5-open-source-решения-и-инструменты)
6. [Конкурентный анализ](#6-конкурентный-анализ)
7. [Юридический анализ и карта рисков](#7-юридический-анализ-и-карта-рисков)
8. [Техническая архитектура интеграций](#8-техническая-архитектура-интеграций)
9. [Альтернативные подходы](#9-альтернативные-подходы)
10. [Идеи для улучшения UX](#10-идеи-для-улучшения-ux)
11. [Дорожная карта реализации](#11-дорожная-карта-реализации)
12. [Приложения](#12-приложения)

---

## 1. Executive Summary

### Ключевые выводы

**ЛитРес — единственная крупная российская платформа с документированным Partner API.** Однако это B2B API, требующее подписания контракта и не предназначенное для самостоятельной регистрации разработчиков. Прямая интеграция «подключи аккаунт и читай» технически возможна, но юридически и организационно сложна.

**Ни одна другая крупная российская платформа (MyBook, Bookmate/Яндекс Книги, Author.Today) не предлагает публичного API** для сторонних разработчиков.

**OPDS — наиболее реалистичный путь для MVP.** Универсальный протокол для каталогов электронных книг, поддерживаемый многими ридерами и серверами (Calibre, Flibusta, публичные каталоги).

### Главные рекомендации

| Приоритет | Действие | Срок | Риск |
|-----------|---------|------|------|
| **P0 (MVP)** | OPDS-клиент + загрузка из облачных хранилищ | 2-4 нед. | Низкий |
| **P1** | Email-импорт (send-to-fancai) + Telegram-бот | 3-5 нед. | Низкий |
| **P2** | Партнёрство с ЛитРес (подать заявку) | 2-6 мес. | Средний |
| **P3** | Calibre-интеграция + расширение для браузера | 4-8 нед. | Низкий |

---

## 2. Детальный анализ ЛитРес

### 2.1 Публичное API

#### CataLit 2.0 — REST API для клиентских программ

**Статус:** Существует и задокументировано  
**Документация:** https://docs.litres.ru/public/6424296.html  
**Последнее обновление документации:** 21 мая 2024  
**Формат:** REST API, HTTP+JSON

**Возможности API (CataLit 2.0):**
- Получение списка произведений, авторов и жанров
- Скачивание ознакомительных фрагментов книг
- Авторизация пользователя (логин/пароль, Facebook, OAuth, OpenID)
- Действия от имени пользователя (покупки, пополнение счёта, корзина)
- Запрос состояния аккаунта (счёт, подписки, **купленные книги**)
- **Скачивание приобретённых книг** в различных форматах
- Сохранение и получение закладок, заметок и выделений
- Получение доли со всех продаж (партнёрская модель)

> **Важно:** Это API создано для разработчиков клиентского ПО, а НЕ для партнёрских магазинов. Это именно то, что нужно для fancai — создать клиентское приложение, через которое пользователь авторизуется и получает доступ к своим книгам.

**Требования для доступа:**
- Регистрация как партнёр: https://www.litres.ru/pages/reader_partner/
- Получение секретного ключа разработчика и ID приложения
- Контакт: partners@litres.ru
- Без ключа: ограниченное количество запросов, затем блокировка

#### Partner API — интерфейс для партнёрских магазинов

**Статус:** Существует, подробно задокументировано  
**Документация:** https://docs.litres.ru/public/1247015.html  
**Версия:** 1.105 (обновлено 1 июня 2020)

**Три схемы подключения:**

| Схема | Описание | Доступ к каталогу | Аудиокниги | Сложность |
|-------|----------|-------------------|------------|-----------|
| **#1** | Полная самостоятельность — партнёр получает файлы и ведёт продажи | 50-67% каталога | Нет | Высокая |
| **#2** | Каталог у партнёра, файлы с серверов ЛитРес | 100% каталога | Да | Средняя |
| **#3** | Всё на стороне ЛитРес, партнёр только продвигает | 100% каталога | Да | Низкая |

**Ключевые endpoints:**

| Endpoint | Описание |
|----------|----------|
| `GET /get_fresh_book/` | Список новых/обновлённых книг (XML) |
| `GET /get_the_book/` | Скачивание файла книги |
| Уведомления о продажах | Регистрация покупок партнёром |
| Обложки | Скачивание обложек (JPG/PNG, различные размеры) |
| Фрагменты | Ознакомительные фрагменты для предпросмотра |
| Жанры | Дерево жанров ЛитРес |

**Аутентификация:**
- SHA-256 подпись (timestamp + secret_key + checkpoint)
- Partner ID (4-буквенный код, выдаётся при подключении)
- Протокол HTTPS обязателен

**Доступные форматы книг:**

| Тип | Форматы |
|-----|---------|
| Электронные тексты (type=0) | FB2, EPUB, MOBI, TXT, RTF, HTML, PDF (A4/A6), FB3, iOS.EPUB |
| Аудиокниги (type=1) | MP3, M4B, MP4 |
| PDF-книги (type=4) | PDF |
| Английские книги с Adobe DRM (type=11) | EPUB, PDF (защищённые) |
| Подкасты (type=22, 23) | MP3 |

### 2.2 Партнёрская программа

**Типы партнёрства:**

1. **Реферальная программа** (affiliates)
   - Комиссия: до 15-25% от продаж
   - Cookie: 30 дней
   - Регистрация через Admitad или напрямую
   - Инструменты: реферальные ссылки, виджеты, баннеры
   - **Не подходит для глубокой интеграции**

2. **Технологическое партнёрство** (для ридеров)
   - Полный доступ к API
   - Ключи для DRM-дешифрации
   - Revenue sharing
   - Примеры: PocketBook, ONYX BOOX, FBReader
   - **Требует подписания контракта и юридического лица**

3. **Партнёрский магазин** (White Label)
   - Полная витрина ЛитРес под брендом партнёра
   - Схемы #1, #2, #3 (см. выше)
   - **Не подходит для fancai — мы не магазин**

### 2.3 OPDS

**Статус: ЛитРес НЕ поддерживает OPDS**

- Нет публичного OPDS-каталога
- API использует собственный XML-формат
- FBReader интегрирован через проприетарный API, а не OPDS
- Экспериментальные проекты на GitHub (`opds_search_service`) — неофициальные

### 2.4 DRM-защита

| Тип контента | Система DRM | Возможность чтения в стороннем ридере |
|-------------|-------------|---------------------------------------|
| Русские книги (type=0) | **ЛитРес DRM (Soft DRM)** | Только через партнёрские приложения с DRM-ключами |
| Английские книги (type=11) | **Adobe DRM (ADEPT)** | Через Adobe Digital Editions или Adobe-совместимые ридеры |
| Аудиокниги (type=1) | **Проприетарная защита** | Только через официальные приложения |
| PDF-книги (type=4) | **Проприетарная защита** | Аналогично |

**ЛитРес DRM (Soft DRM) — подробности:**
- Не требует от пользователя Adobe ID или специальных программ
- Книга «привязывается» к устройству и учётной записи
- Позволяет читать на нескольких устройствах пользователя
- Использует AES-шифрование с привязкой к аккаунту
- **Для поддержки в fancai необходимо партнёрство с ЛитРес и получение DRM-ключей**

**Adobe DRM — для английских книг:**
- Требует Adobe ID
- Скачивается `.acsm` файл → расшифровывается через Adobe Digital Editions
- Ограничение: 3 скачивания для иностранных книг, 6 для русских
- Для поддержки нужен сертификат от Harman (бывший Adobe Content Server)

### 2.5 Как интегрируются PocketBook, ONYX BOOX, FBReader

**Модель интеграции:**
1. Подписание B2B контракта с ЛитРес
2. Получение Partner ID, секретных ключей, DRM-ключей
3. Интеграция каталога через Partner API
4. Пользователь авторизуется в ЛитРес через приложение партнёра
5. Просмотр каталога, покупка, скачивание — всё внутри приложения
6. DRM-дешифрация на устройстве с использованием полученных ключей
7. Партнёр получает комиссию с продаж

**FBReader — подробности:**
- Официальная интеграция с ЛитРес (источник: https://fbreader.org/en/litres)
- Android: полный функционал — просмотр, покупка, скачивание
- Desktop: просмотр и покупка
- iOS: **только просмотр каталога и доступ к уже купленным книгам** (политика App Store запрещает покупки в обход Apple IAP)
- При покупке через FBReader — комиссия разработчику

### 2.6 Ключевой вывод по ЛитРес

**CataLit 2.0 API — это именно то, что нужно для fancai.** Оно позволяет:
- Авторизовать пользователя ЛитРес
- Получить список купленных книг
- Скачать книги в нужном формате (EPUB, FB2)
- Работать с закладками и заметками

**Но:** требуется регистрация как партнёр-разработчик и получение ключей. Это не самостоятельная регистрация — нужно написать на partners@litres.ru и пройти согласование.

---

## 3. Обзор других российских библиотек

### Сводная таблица

| Платформа | Публичное API | OPDS | DRM | Форматы | GitHub-инструменты | Юр. статус |
|-----------|:------------:|:----:|-----|---------|:------------------:|:----------:|
| **ЛитРес** | **Да** (B2B) | Нет | Custom + Adobe | FB2, EPUB, MOBI, PDF, MP3 | **Да** (litresapi) | Легальный |
| **MyBook** | Нет | Нет | Неизвестен | Неизвестен | Нет (используют litresapi) | Легальный |
| **Bookmate / Яндекс Книги** | Нет | Нет | Проприетарный Яндекс | Неизвестен | Только downloaders | Легальный |
| **Author.Today** | Неофициальный | Нет | Минимальный | Web, FB2 (через тулзы) | Есть (community) | Легальный |
| **Ridero** | Нет (для авторов) | Нет | N/A | N/A | Нет | Легальный |
| **Flibusta** | **Да** (OPDS) | **Да** | Нет | FB2, EPUB, MOBI | **Много** | **Нелегальный** |
| **LiveLib** | Нет | Нет | N/A | N/A (метаданные) | Scrapers | Легальный |

### 3.1 MyBook (mybook.ru)

**Описание:** Подписочный сервис электронных книг (аналог Scribd для России).

**API:** Публичное API отсутствует. Нет документации для разработчиков.

**Интересный факт:** MyBook использует ЛитРес как поставщика контента. На GitHub у MyBook есть организация (https://github.com/mybook) с проектом `litresapi` — Python-обёртка для API ЛитРес.

**Интеграция:** Невозможна без B2B-партнёрства. Контент поступает от ЛитРес, поэтому интеграция с ЛитРес покрывает значительную часть каталога MyBook.

### 3.2 Bookmate / Яндекс Книги (Строки)

**Описание:** Международный сервис подписки на книги, с 2022 года — часть экосистемы Яндекс.

**Текущий статус (февраль 2026):**
- Bookmate в России → ребрендинг в «Яндекс Книги» / «Строки»
- Интеграция в подписку Яндекс.Плюс (399 руб./мес., 100 руб. для подписчиков Плюс)
- Доступен через приложение Яндекс.Музыка и голосовой ассистент Алиса
- 170 000+ электронных и аудиокниг
- Февраль 2024: Яндекс NV продал российские активы за $5.2 млрд консорциуму (включая фонд при поддержке Лукойл)

**API:** Публичное API отсутствует.

**GitHub-инструменты:**
- `kettle017/RU_Bookmate_downloader` (111 stars) — скачивание книг
- `ilyakharlamov/bookmate_downloader` (81 stars, MIT) — скачивание EPUB

**Интеграция:** Только через B2B-партнёрство с Яндекс. Публичного пути нет.

### 3.3 Author.Today (author.today)

**Описание:** Самиздат-платформа для авторов. Фантастика, фэнтези, ЛитРПГ и другие жанры.

**API:** Официального API нет, но существует неофициальное community API, которое использует приложение ATReader Pro (доступно в App Store).

**ATReader Pro:** Неофициальное iOS-приложение от независимого разработчика:
- Использует «официальный публичный API» Author.Today (со слов разработчика)
- Импорт из «Моей библиотеки» Author.Today
- Чтение и прослушивание онлайн/офлайн
- Ограничение: API для поиска книг не найдено (только по ID)
- Источник: https://apps.apple.com/ru/app/atreader-pro/id6746457868

**GitHub-инструменты:**
- `Ae-Mc/AuthorTodayToFB2Converter` (11 stars, MIT) — конвертация в FB2
- `vraestoren/author_today.py` (2 stars) — Web-API обёртка
- `stepan163s/yandex-book-api` (14 stars) — API для Яндекс Книг

**Интеграция:** Возможна через неофициальное API (как сделал ATReader Pro), но нет гарантий стабильности.

### 3.4 Flibusta (flibusta.is)

**Описание:** Крупнейшая теневая библиотека русскоязычных книг.

**Статус (февраль 2026):**
- Домен: flibusta.is (Исландия)
- Заблокирована в РФ на уровне провайдеров (с 2009 года)
- Доступ через VPN/Tor
- Сообщество активно

**OPDS-каталог:** Да — http://flibusta.is/opds  
**DRM:** Нет  
**Форматы:** FB2, EPUB, MOBI, PDF

**GitHub-инструменты (наиболее популярные):**
- `zlsl/flibusta` (191 stars, GPL-2.0) — фронтенд для архивов
- `petrovvlad/freeLib` (189 stars, GPL-3.0) — каталогизатор
- `soldatov-ss/flibusta-telegram-bot` (97 stars) — Telegram-бот для поиска
- `ryzed/flibusta-calibre-opds-store` (59 stars, GPL-3.0) — плагин Calibre
- `ynhhoJ/flibusta-api` (26 stars, MIT) — TypeScript API

**Юридические риски: КРИТИЧЕСКИЕ.** Нарушение авторских прав. Категорически не рекомендуется для коммерческой интеграции.

### 3.5 LiveLib (livelib.ru)

**Описание:** Социальная сеть для книголюбов (аналог Goodreads для русскоязычной аудитории).

**API:** Публичное API отсутствует.

**Полезность для fancai:** Источник метаданных — рецензии, рейтинги, рекомендации. Не предоставляет файлы книг.

**GitHub-инструменты:**
- `Amadeus-/Livelib.ru-Metadata` — плагин метаданных для Calibre
- `KonH/LivelibExport` — экспорт прочитанных книг в CSV
- `PHermanov/LiveLibIsbnParser` — парсинг ISBN из профиля

### 3.6 Другие платформы

| Платформа | Тип | API | Релевантность для fancai |
|-----------|-----|-----|-------------------------|
| **Wildberries** | Маркетплейс | Seller API (не для читателей) | Низкая |
| **Ozon** | Маркетплейс | Seller API | Низкая |
| **Google Play Books** | Магазин | Google Books API (метаданные) | Средняя (метаданные) |
| **Самлиб (samlib.ru)** | Самиздат | Нет API | Низкая |
| **iKnigi.net** | Электронная библиотека | OPDS каталог | Средняя |
| **CoolLib.net** | Электронная библиотека | OPDS каталог | Средняя |

---

## 4. Стандарты и протоколы

### 4.1 OPDS (Open Publication Distribution System)

**OPDS 1.2 (стабильная версия, ноябрь 2018):**
- Формат: XML на основе Atom + Dublin Core метаданные
- Content-Type: `application/atom+xml;profile=opds-catalog`
- Спецификация: https://specs.opds.io/opds-1.2.html
- GitHub: https://github.com/opds-community/specs

**OPDS 2.0 (черновик):**
- Формат: JSON-LD + schema.org
- Ограниченное принятие на данный момент
- GitHub: https://github.com/opds-community/drafts

**Два типа каналов:**
- **Navigation Feeds** — навигация по структуре каталога
- **Acquisition Feeds** — обнаружение и получение книг

**Методы аутентификации:**
1. HTTP Basic Authentication (наиболее распространённый)
2. OAuth 2.0 (реже)
3. API Key через Basic Auth (username:apikey)
4. Без аутентификации (публичные каталоги)

**Известные OPDS-каталоги (русскоязычные):**
- Flibusta: http://flibusta.is/opds
- iKnigi: https://iknigi.net/opds
- CoolLib: https://coollib.net/opds
- FBSearch: https://fbsearch.ru/opds/

**Известные OPDS-каталоги (международные):**
- Project Gutenberg: https://m.gutenberg.org/ebooks.opds/
- Internet Archive: http://bookserver.archive.org/catalog/
- Feedbooks: http://www.feedbooks.com/catalog.atom
- Standard Ebooks: https://standardebooks.org/opds

**Лучшие библиотеки:**

Python:
| Библиотека | Stars | Описание | Лицензия |
|-----------|-------|----------|----------|
| `feedparser` | 2000+ | Парсинг OPDS 1.x (Atom) | BSD |
| `petr-prikryl/OPDS-ABS` | 42 | **FastAPI OPDS-сервер** (лучший референс!) | — |
| `mitshel/sopds` | 225 | Django OPDS-сервер | — |
| `internetarchive/bookserver` | 130 | Production OPDS (Internet Archive) | — |

TypeScript/JavaScript:
| Библиотека | Stars | Описание | Лицензия |
|-----------|-------|----------|----------|
| `NYPL-Simplified/opds-feed-parser` | 11 | JS OPDS парсер (NYPL) | — |
| `KartoffelChipss/opds-ts` | 1 | TypeScript OPDS (генерация + парсинг) | MIT |
| `GitbookIO/node-opds` | 22 | Node.js генерация/парсинг | Apache-2.0 |
| `edrlab/r2-opds-js` | 8 | Readium OPDS компонент | — |

### 4.2 Readium LCP (Licensed Content Protection)

**Что это:** Открытый стандарт DRM, ISO/IEC 23078-2:2024, разработан EDRLab.

**Принцип работы:**
1. Пользователь получает `.lcpl` файл (JSON-лицензия)
2. Лицензия содержит зашифрованный ключ контента и парольную фразу пользователя
3. Ридер расшифровывает контент используя парольную фразу
4. После скачивания сервер не нужен

**Стоимость:** Годовая сертификация (контактировать EDRLab: https://www.edrlab.org/)  
**Сложность:** Средняя-высокая  
**Применимость в России:** Не распространён. Российские сервисы используют проприетарный DRM.

**Серверная реализация:** `readium/readium-lcp-server` (94 stars, Go)  
**Клиенты:** Kotlin (Android), Swift (iOS), TypeScript (Thorium Reader)

**Рекомендация:** Рассмотреть как альтернативу Adobe DRM для будущего, но не для MVP.

### 4.3 Adobe DRM (Content Server)

**Статус:** В июле 2025 Adobe передал платформу eBook компании Harman (дочерняя Samsung).

**Стоимость:** $10 000-50 000+/год (исторически), контактировать Harman.  
**Процесс получения сертификата:** 3-6 месяцев минимум.  
**Сложность:** Высокая.

**Кто использует в России:** ЛитРес (для английских книг), PocketBook.

**Рекомендация:** Избегать для MVP. Рассмотреть только при наличии прямых требований от крупных издателей.

### 4.4 ONIX for Books

**Что это:** XML-стандарт обмена метаданными книг в цепочке поставок (издатель → дистрибутор → магазин).

**Релевантность для fancai:** Низкая. ONIX нужен только если fancai станет дистрибутором. Для чтения достаточно метаданных из EPUB (OPF) и OPDS.

---

## 5. Open-source решения и инструменты

### 5.1 Инструменты для ЛитРес

| Репозиторий | Stars | Язык | Лицензия | Обновление | Описание |
|-------------|:-----:|------|----------|:----------:|----------|
| **[MyBook/litresapi](https://github.com/MyBook/litresapi)** | 19 | Python | BSD-3 | Сен 2022 | **Официальная обёртка Partner API от MyBook** |
| [fennr/litres_download](https://github.com/fennr/litres_download) | 19 | Python | MIT | Окт 2025 | Скачивание купленных книг |
| [pensnarik/litres-downloader](https://github.com/pensnarik/litres-downloader) | 18 | Python | — | Апр 2023 | Скачивание купленных книг |
| [SaBog/litres-pdf](https://github.com/SaBog/litres-pdf) | 14 | Python | — | Сен 2025 | Скачивание подписочных книг как PDF |
| [kiltum/litres-backup](https://github.com/kiltum/litres-backup) | 14 | Python | — | Сен 2017 | Бэкап библиотеки |
| [mak-alex/litres-backup](https://github.com/mak-alex/litres-backup) | 13 | Go | — | Ноя 2021 | Бэкап библиотеки |
| [beauxarts/fedorov](https://github.com/beauxarts/fedorov) | 3 | Go | AGPL-3.0 | **Фев 2026** | Локальная офлайн-библиотека ЛитРес |
| [fabrikant/litres_downloader](https://github.com/fabrikant/litres_downloader) | 6 | Python | GPL-3.0 | Мар 2025 | Скачивание книг |

**Ключевой инструмент: MyBook/litresapi**
```python
from litresapi import LitresApi

api = LitresApi(secret_key='your-key', partner_id='ZZZZ')
books = api.get_fresh_book(start_date=datetime(2015, 7, 19))

book = next(books)
print(book['@external_id'])  # UUID книги
print(book['title-info']['author']['first-name'])
```
- Установка: `pip install litresapi`
- BSD-3-Clause — **можно использовать коммерчески**
- Но: не обновлялся с 2022, может потребовать доработки

**Интеграции ЛитРес в крупных проектах (найдено через grep.app):**
- **Calibre** — плагин магазина ЛитРес (`calibre/gui2/store/stores/litres_plugin.py`)
- **Calibre-Web Automated** — провайдер метаданных ЛитРес (`cps/metadata_provider/litres.py`)
- **FBReaderJ** — утилиты авторизации ЛитРес
- **CoolReader** — Android-плагин ЛитРес

### 5.2 OPDS-серверы и клиенты

| Репозиторий | Stars | Язык | Описание |
|-------------|:-----:|------|----------|
| [janeczku/calibre-web](https://github.com/janeczku/calibre-web) | 16 486 | Python | Веб-интерфейс Calibre с OPDS |
| [readest/readest](https://github.com/readest/readest) | 16 982 | TypeScript | Современный ридер с OPDS |
| [edrlab/thorium-reader](https://github.com/edrlab/thorium-reader) | 2 563 | TypeScript | Readium Desktop с OPDS 1.2/2.0 |
| [koreader/koreader](https://github.com/koreader/koreader) | 24 700 | Lua | Ридер для e-ink с OPDS |
| [seblucas/cops](https://github.com/seblucas/cops) | 1 480 | PHP | Calibre OPDS PHP Server |
| [steinarb/opds-reader](https://github.com/steinarb/opds-reader) | 57 | Python | Calibre OPDS-клиент плагин |
| [shemanaev/inpxer](https://github.com/shemanaev/inpxer) | 40 | Go | OPDS-сервер для .inpx библиотек |

### 5.3 Инструменты для других платформ

| Репозиторий | Stars | Платформа | Описание |
|-------------|:-----:|----------|----------|
| [kettle017/RU_Bookmate_downloader](https://github.com/kettle017/RU_Bookmate_downloader) | 111 | Bookmate | Скачивание книг |
| [ilyakharlamov/bookmate_downloader](https://github.com/ilyakharlamov/bookmate_downloader) | 81 | Bookmate | EPUB downloader (MIT) |
| [Ae-Mc/AuthorTodayToFB2Converter](https://github.com/Ae-Mc/AuthorTodayToFB2Converter) | 11 | Author.Today | Конвертация в FB2 (MIT) |
| [stepan163s/yandex-book-api](https://github.com/stepan163s/yandex-book-api) | 14 | Яндекс Книги | API-обёртка |

---

## 6. Конкурентный анализ

### 6.1 Как другие ридеры решают импорт книг

| Возможность | PocketBook | ONYX BOOX | FBReader | Moon+ | ReadEra | Kindle | Apple Books | Kobo | Libby |
|-------------|:---------:|:--------:|:-------:|:----:|:------:|:-----:|:----------:|:---:|:----:|
| **OPDS** | **Да** | Да (через приложения) | **Да** | **Да** | Нет | Нет | Нет | Ограниченно | N/A |
| **ЛитРес** | **Встроен** | **Встроен** | **Встроен** | Нет | Нет | Нет | Нет | Нет | N/A |
| **Облачные хранилища** | Dropbox | Dropbox, GDrive, OneDrive | Нет | GDrive, Dropbox, OneDrive, WebDAV | GDrive (Pro) | Нет | iCloud | Нет | N/A |
| **Email-импорт** | **Да** | **Да** | Нет | Нет | Нет | **Да** | Нет | Нет | N/A |
| **Adobe DRM** | **Да** | **Да** | **Да** | **Да** | **Да** | Нет | Нет | **Да** | Да |
| **Readium LCP** | **Да** (2025+) | Нет | Нет | Нет | Нет | Нет | Нет | Нет | Нет |
| **Библиотечная интеграция** | Да (Libby) | Через приложения | Нет | Нет | Нет | Нет | Нет | OverDrive | **Основная функция** |
| **Open Source** | Нет | Нет | **Да** | Нет | Нет | Нет | Нет | Нет | Нет |

### 6.2 Лучшие практики

**Send-to-Kindle модель (email-импорт):**
- Каждое устройство/аккаунт имеет уникальный email
- Пользователь пересылает файл на этот email
- Сервис конвертирует и доставляет на устройство
- Список одобренных отправителей для безопасности

**PocketBook Cloud модель:**
- 5 ГБ бесплатного хранения
- Синхронизация книг, позиций чтения, закладок, заметок
- Кроссплатформенная: e-reader, iOS, Android, веб

**Libby/OverDrive модель (библиотечная интеграция):**
- OAuth 2.0 для авторизации
- Пользователь вводит номер библиотечной карточки + PIN
- Сервис валидирует через ILS библиотеки
- Возвращает access token для API-запросов

### 6.3 UX-паттерны

**Визуальное различие книг из разных источников:**
- Иконки/бейджи источника на обложке
- Секции библиотеки (Мои книги / OverDrive / Облако)
- Метаданные с указанием источника
- Иконка облака для не скачанных книг

**Лучший подход для fancai:** Единая библиотека с фильтрацией по источнику и субтильными иконками.

---

## 7. Юридический анализ и карта рисков

### 7.1 Карта рисков

| # | Категория | Риск | Вероятность | Влияние | Митигация |
|---|----------|------|:-----------:|:-------:|-----------|
| 1 | **Юридический** | Использование неофициального API ЛитРес — нарушение ToS, блокировка | Высокая | Критическое | Получить официальный партнёрский доступ |
| 2 | **Юридический** | Интеграция с Flibusta — нарушение авторских прав | Высокая | Критическое | Не интегрировать. Предоставить OPDS-клиент — пользователь сам решает |
| 3 | **Юридический** | Обход DRM (даже для личного пользования) — ст.1299 ГК РФ | Высокая | Высокое | Не обходить DRM. Использовать только легальные API |
| 4 | **Юридический** | Хранение OAuth-токенов — ФЗ-152 о персональных данных | Средняя | Среднее | Шифрование токенов, политика конфиденциальности, согласие пользователя |
| 5 | **Технический** | ЛитРес изменит API без уведомления | Средняя | Высокое | Мониторинг, автотесты, fallback на ручную загрузку |
| 6 | **Технический** | Rate limiting от ЛитРес при большом количестве пользователей | Средняя | Среднее | Кэширование, очереди, экспоненциальный backoff |
| 7 | **Бизнесовый** | ЛитРес откажет в партнёрстве | Средняя | Высокое | Иметь альтернативный план (OPDS, облака, email-импорт) |
| 8 | **Бизнесовый** | Revenue sharing невыгоден для fancai | Низкая | Среднее | Переговоры, альтернативные модели монетизации |
| 9 | **Репутационный** | Ассоциация с пиратством если поддержать нелегальные OPDS-каталоги | Средняя | Высокое | OPDS-клиент без предустановленных нелегальных каталогов |
| 10 | **Технический** | DRM-защищённые книги нечитаемы в fancai без ключей | Высокая | Критическое | Партнёрство с ЛитРес или поддержка только DRM-free контента |

### 7.2 Юридические аспекты

**Авторское право (Россия):**
- Ст.1270 ГК РФ: Воспроизведение и распространение произведений — исключительное право автора
- Ст.1273 ГК РФ: Свободное воспроизведение в личных целях разрешено, **кроме** случаев обхода технических средств защиты
- Ст.1299 ГК РФ: Обход DRM запрещён даже в личных целях

**Как это влияет на fancai:**
- fancai КАК РИДЕР — легален (пользователь сам загружает свои файлы)
- Интеграция с OPDS-каталогами — легальна (каталог = интерфейс, не контент)
- Скачивание DRM-free книг из легальных источников — легально
- Обход DRM ЛитРес — НЕЛЕГАЛЬНО
- Скачивание с Flibusta — нелегально (пиратский контент)

**PocketBook/ONYX BOOX прецедент:** Эти устройства легально интегрированы с ЛитРес через партнёрские соглашения. Они не обходят DRM — получают ключи дешифрации от ЛитРес по контракту.

**Рекомендации:**
1. Получить официальное партнёрство с ЛитРес
2. Поддерживать только DRM-free форматы без партнёрства
3. OPDS-клиент предоставлять без предустановленных нелегальных каталогов
4. Не реализовывать функции обхода DRM

---

## 8. Техническая архитектура интеграций

### 8.1 Backend (FastAPI)

**Паттерн: Адаптер (Strategy Pattern)**

```python
# app/services/integrations/base.py
from abc import ABC, abstractmethod
from typing import AsyncIterator
from dataclasses import dataclass

@dataclass
class ExternalBook:
    external_id: str
    provider: str  # "litres", "opds", "calibre"
    title: str
    author: str
    cover_url: str | None
    formats: list[str]  # ["epub", "fb2", "pdf"]
    is_downloadable: bool
    metadata: dict

class BookProvider(ABC):
    """Базовый адаптер для провайдера книг."""
    
    @abstractmethod
    async def authenticate(self, credentials: dict) -> str:
        """Авторизация, возвращает токен."""
        ...
    
    @abstractmethod
    async def get_user_books(self, token: str) -> AsyncIterator[ExternalBook]:
        """Список книг пользователя."""
        ...
    
    @abstractmethod
    async def download_book(self, token: str, book_id: str, format: str) -> bytes:
        """Скачивание книги."""
        ...


# app/services/integrations/litres_provider.py
class LitresProvider(BookProvider):
    """Адаптер для ЛитРес CataLit 2.0 API."""
    ...

# app/services/integrations/opds_provider.py
class OpdsProvider(BookProvider):
    """Универсальный OPDS-клиент."""
    ...

# app/services/integrations/calibre_provider.py
class CalibreProvider(BookProvider):
    """Адаптер для Calibre Content Server (OPDS)."""
    ...
```

### 8.2 Модели данных (SQLAlchemy)

```python
# app/models/integration.py
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime, JSON, Enum
from sqlalchemy.orm import relationship
from app.core.database import Base

class ConnectedAccount(Base):
    __tablename__ = "connected_accounts"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    provider = Column(String(50), nullable=False)  # "litres", "opds_custom", "calibre"
    
    # Зашифрованные credentials
    encrypted_token = Column(String(1024))
    encrypted_refresh_token = Column(String(1024))
    token_expires_at = Column(DateTime)
    
    # Метаданные провайдера
    provider_user_id = Column(String(255))
    provider_username = Column(String(255))
    provider_metadata = Column(JSON)  # доп. данные (URL каталога для OPDS и т.д.)
    
    # Статус
    status = Column(Enum("active", "expired", "error", "disconnected"), default="active")
    last_sync_at = Column(DateTime)
    last_error = Column(String(1024))
    
    # Связи
    user = relationship("User", back_populates="connected_accounts")
    external_books = relationship("ExternalBook", back_populates="account")


class ExternalBook(Base):
    __tablename__ = "external_books"
    
    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey("connected_accounts.id"), nullable=False)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=True)  # если импортирована
    
    external_id = Column(String(255), nullable=False)
    provider = Column(String(50), nullable=False)
    
    title = Column(String(500))
    author = Column(String(500))
    cover_url = Column(String(1024))
    available_formats = Column(JSON)  # ["epub", "fb2"]
    
    # Статус импорта
    import_status = Column(
        Enum("available", "importing", "imported", "failed", "unavailable"),
        default="available"
    )
    imported_at = Column(DateTime)
    
    # Метаданные из внешнего сервиса
    external_metadata = Column(JSON)
    
    # Связи
    account = relationship("ConnectedAccount", back_populates="external_books")
    book = relationship("Book")
```

### 8.3 API Endpoints

```python
# app/routers/integrations.py

# === Управление аккаунтами ===
POST   /api/v1/integrations/connect/{provider}
# Body: { "credentials": {...} } или OAuth redirect
# Response: { "account_id": 1, "status": "active", "books_count": 42 }

DELETE /api/v1/integrations/disconnect/{provider}
# Отключение аккаунта, удаление токенов

GET    /api/v1/integrations/accounts
# Список подключённых аккаунтов с информацией о последней синхронизации

# === Синхронизация ===
POST   /api/v1/integrations/sync/{provider}
# Запуск синхронизации списка книг (Celery task)
# Response: { "task_id": "abc123", "status": "started" }

GET    /api/v1/integrations/sync/{provider}/status
# Статус текущей синхронизации

# === Книги из внешних источников ===
GET    /api/v1/integrations/books
# Все книги из всех подключённых аккаунтов
# Query: ?provider=litres&status=available&page=1&limit=20

GET    /api/v1/integrations/books/{provider}/{external_id}
# Детали конкретной книги из внешнего сервиса

POST   /api/v1/integrations/import/{provider}/{external_id}
# Импорт книги в библиотеку fancai
# Body: { "format": "epub" }
# Response: { "book_id": 123, "status": "importing" }

# === OPDS-каталоги ===
POST   /api/v1/integrations/opds/catalogs
# Добавить OPDS-каталог
# Body: { "url": "http://...", "name": "My Calibre", "auth": {...} }

GET    /api/v1/integrations/opds/catalogs
# Список добавленных OPDS-каталогов

GET    /api/v1/integrations/opds/catalogs/{id}/browse
# Навигация по OPDS-каталогу
# Query: ?path=/new&page=1

GET    /api/v1/integrations/opds/catalogs/{id}/search
# Поиск по OPDS-каталогу
# Query: ?q=Пушкин
```

### 8.4 Frontend (React)

**UX-паттерн подключения аккаунтов:**
```
Настройки → Подключённые аккаунты → [+ Подключить]
→ Выбор сервиса (ЛитРес / OPDS / Calibre / Облако)
→ Авторизация (OAuth / логин-пароль / URL каталога)
→ Синхронизация библиотеки
→ Книги появляются в общей библиотеке с иконкой источника
```

**Компоненты:**
- `ConnectedAccountsPage` — управление подключёнными аккаунтами
- `ProviderSelector` — выбор провайдера
- `OpdsCatalogBrowser` — навигация по OPDS-каталогам
- `ExternalBookCard` — карточка книги с иконкой источника и кнопкой «Импортировать»
- `SyncStatusBadge` — индикатор статуса синхронизации
- `ImportProgressBar` — прогресс импорта книги

---

## 9. Альтернативные подходы

### 9.1 OPDS-клиент (рекомендуется для MVP)

**Преимущества:**
- Стандартный протокол, множество совместимых источников
- Не требует партнёрства с конкретными сервисами
- Calibre, публичные библиотеки, пользовательские серверы
- Простая реализация (XML-парсинг)

**Реализация:**
- Backend: `feedparser` для парсинга Atom/OPDS
- Frontend: навигация по каталогу, поиск, скачивание
- Аутентификация: HTTP Basic Auth + OAuth

**Ограничения:**
- ЛитРес не поддерживает OPDS
- Только DRM-free контент
- Качество каталогов варьируется

### 9.2 Email-импорт (send-to-fancai)

**По модели Kindle Send-to-Kindle:**
- Каждый пользователь получает уникальный email: `user123@import.fancai.ru`
- Пользователь пересылает книгу на этот email
- Backend обрабатывает вложение, парсит, добавляет в библиотеку

**Реализация:**
- Входящая почта: AWS SES, Mailgun, или собственный SMTP
- Обработка: Celery task → парсинг EPUB/FB2 → добавление в библиотеку
- Безопасность: whitelist отправителей, проверка формата, лимит размера

**Оценка:** Средняя сложность, 2-3 недели. Очень удобно для пользователей.

### 9.3 Telegram-бот

**Концепция:**
- Бот `@fancai_import_bot` в Telegram
- Пользователь отправляет файл книги боту
- Бот загружает книгу в библиотеку fancai
- Интеграция с Telegram Login для привязки аккаунта

**Реализация:**
- `python-telegram-bot` или `aiogram`
- Webhook для получения файлов
- Привязка Telegram ID к аккаунту fancai

**Оценка:** Низкая сложность, 1-2 недели. Очень органично для российской аудитории.

### 9.4 Облачные хранилища

**Yandex Disk, Google Drive, Dropbox, iCloud:**
- Пользователь указывает папку в облаке
- fancai мониторит папку на появление новых книг
- Автоматический импорт новых файлов

**Реализация:**
- OAuth 2.0 для каждого сервиса
- Webhook/polling для отслеживания изменений
- Celery tasks для фоновой синхронизации

**Оценка:** Средняя сложность, 3-4 недели на каждый сервис. Яндекс Диск — приоритет для российской аудитории.

### 9.5 Браузерное расширение

**Концепция:**
- Расширение для Chrome/Firefox
- При скачивании книги с любого сайта — предложение «Открыть в fancai»
- Перехватывает .epub/.fb2 файлы

**Оценка:** Средняя сложность, 2-3 недели. Нишевое решение для десктопных пользователей.

### 9.6 Calibre-интеграция

**Концепция:**
- Calibre Content Server предоставляет OPDS-каталог
- fancai подключается как OPDS-клиент
- Пользователь управляет библиотекой в Calibre, читает в fancai

**Реализация:** Покрывается OPDS-клиентом (п. 9.1). Дополнительно можно:
- Автообнаружение Calibre в локальной сети (mDNS/Bonjour)
- Инструкция по настройке Calibre для пользователей

**Оценка:** Минимальная дополнительная работа если OPDS-клиент уже реализован.

---

## 10. Идеи для улучшения UX

### 10.1 Обогащение метаданных

- Автоматический поиск обложек через Google Books API, Open Library API, LiveLib
- Дополнение аннотаций из внешних источников
- Рейтинги и рецензии из LiveLib (парсинг)
- Автоматическая классификация по жанрам (AI)

### 10.2 Умный поиск книг

- Поиск одновременно по нескольким OPDS-каталогам
- Агрегация результатов с дедупликацией
- Показ где книга доступна (и в каком формате)

### 10.3 Отслеживание авторов

- Подписка на авторов в подключённых библиотеках
- Уведомления о новых книгах
- «Автор выпустил новую книгу на ЛитРес / Author.Today»

### 10.4 Интеграция с LiveLib

- Импорт списка «хочу прочитать» из LiveLib
- Синхронизация прогресса чтения
- Отображение рейтингов и рецензий на странице книги

### 10.5 Экспорт из других ридеров

- Импорт прогресса чтения из Kindle (Clippings.txt)
- Импорт закладок/заметок из PocketBook Cloud
- Импорт статистики чтения

### 10.6 Социальные функции

- «Что читают друзья» (через подключённые аккаунты)
- Рекомендации на основе похожих библиотек
- Публичные коллекции с книгами из внешних источников

---

## 11. Дорожная карта реализации

### Этап 1: MVP (2-4 недели)

| # | Задача | Сложность | Приоритет |
|---|--------|-----------|-----------|
| 1.1 | OPDS-клиент (навигация, поиск, скачивание) | Средняя | P0 |
| 1.2 | UI для добавления OPDS-каталогов с аутентификацией | Средняя | P0 |
| 1.3 | Предустановленные каталоги (Project Gutenberg, Standard Ebooks) | Низкая | P0 |
| 1.4 | Backend: модели ConnectedAccount, ExternalBook | Средняя | P0 |
| 1.5 | Backend: API endpoints для интеграций | Средняя | P0 |
| 1.6 | Иконки источников в библиотеке | Низкая | P0 |

**Результат:** Пользователь может подключить OPDS-каталог (например, свой Calibre сервер) и скачивать книги в fancai.

### Этап 2: Расширение (4-8 недель)

| # | Задача | Сложность | Приоритет |
|---|--------|-----------|-----------|
| 2.1 | Email-импорт (send-to-fancai) | Средняя | P1 |
| 2.2 | Telegram-бот для импорта | Низкая | P1 |
| 2.3 | Интеграция с Яндекс Диск | Средняя | P1 |
| 2.4 | Интеграция с Google Drive | Средняя | P1 |
| 2.5 | **Подать заявку на партнёрство с ЛитРес** | — | P1 |
| 2.6 | Обогащение метаданных (Google Books API, Open Library) | Средняя | P2 |
| 2.7 | Браузерное расширение | Средняя | P2 |

**Результат:** Множественные способы импорта книг. Заявка на партнёрство с ЛитРес отправлена.

### Этап 3: Зрелость (8-16 недель)

| # | Задача | Сложность | Приоритет |
|---|--------|-----------|-----------|
| 3.1 | Интеграция с ЛитРес CataLit 2.0 (при одобрении партнёрства) | Высокая | P2 |
| 3.2 | Dropbox, OneDrive интеграция | Средняя | P2 |
| 3.3 | Интеграция с LiveLib (метаданные, рецензии) | Средняя | P3 |
| 3.4 | Автоматический мониторинг облачных папок | Средняя | P3 |
| 3.5 | Readium LCP (если потребуется DRM) | Высокая | P3 |
| 3.6 | Неофициальная интеграция с Author.Today (через публичное API) | Средняя | P3 |

**Результат:** Полноценная экосистема импорта книг. При одобрении ЛитРес — бесшовная интеграция с крупнейшей российской библиотекой.

### Зависимости и блокеры

| Блокер | Влияет на | Митигация |
|--------|-----------|-----------|
| Ответ ЛитРес на заявку | Этап 3.1 | Альтернативные способы импорта (OPDS, облака) |
| Требования по юридическому лицу в РФ | Партнёрство с ЛитРес | Оформление ИП/ООО |
| DRM-ключи от ЛитРес | Чтение DRM-книг | Поддержка только DRM-free контента |

---

## 12. Приложения

### 12.1 Ссылки на документацию ЛитРес

| Документ | URL |
|----------|-----|
| CataLit 2.0 (аннотация) | https://docs.litres.ru/public/6424296.html |
| Partner API | https://docs.litres.ru/public/1247015.html |
| ЛитРес DRM | https://docs.litres.ru/public/6425428.html |
| API для реферальных партнёров | https://docs.litres.ru/public/1246494.html |
| Партнёрская программа | https://www.litres.ru/o-kompanii/partneram/usloviya/ |
| Заявка на партнёрство | https://www.litres.ru/pages/reader_partner/ |
| English Partner API | https://docs.litres.ru/public/Interface-to-connect-partners-to-LitRes-book-store_39059890.html |
| DRM FAQ | https://www.litres.ru/cms/2165/ |
| Партнёрские инструменты | https://www.litres.ru/cms/5666/ |

### 12.2 GitHub-репозитории (полный список)

**ЛитРес:**
- https://github.com/MyBook/litresapi — Python API wrapper (BSD-3)
- https://github.com/fennr/litres_download — Downloader (MIT)
- https://github.com/beauxarts/fedorov — Offline library (AGPL-3.0)
- https://github.com/SaBog/litres-pdf — PDF downloader
- https://github.com/pensnarik/litres-downloader — Downloader
- https://github.com/fabrikant/litres_downloader — Downloader (GPL-3.0)
- https://github.com/mak-alex/litres-backup — Backup (Go)
- https://github.com/kiltum/litres-backup — Backup (Python)

**OPDS:**
- https://github.com/petr-prikryl/OPDS-ABS — **FastAPI OPDS** (лучший референс)
- https://github.com/mitshel/sopds — Django OPDS server
- https://github.com/internetarchive/bookserver — Internet Archive OPDS
- https://github.com/janeczku/calibre-web — Calibre Web + OPDS
- https://github.com/steinarb/opds-reader — Calibre OPDS client plugin
- https://github.com/NYPL-Simplified/opds-feed-parser — JS OPDS parser
- https://github.com/KartoffelChipss/opds-ts — TypeScript OPDS (MIT)
- https://github.com/shemanaev/inpxer — Go OPDS server (MIT)

**Ридеры с OPDS:**
- https://github.com/readest/readest — Modern reader (16.9k stars)
- https://github.com/edrlab/thorium-reader — Readium Desktop (2.5k stars)
- https://github.com/koreader/koreader — E-ink reader (24.7k stars)

**Другие платформы:**
- https://github.com/kettle017/RU_Bookmate_downloader — Bookmate (111 stars)
- https://github.com/ilyakharlamov/bookmate_downloader — Bookmate EPUB (MIT)
- https://github.com/Ae-Mc/AuthorTodayToFB2Converter — Author.Today (MIT)
- https://github.com/stepan163s/yandex-book-api — Яндекс Книги
- https://github.com/zlsl/flibusta — Flibusta frontend (191 stars)

**DRM:**
- https://github.com/readium/readium-lcp-server — Readium LCP server (Go)
- https://github.com/readium/lcp-specs — LCP specifications

### 12.3 Контакты для партнёрства

| Сервис | Контакт |
|--------|---------|
| ЛитРес (партнёрство) | partners@litres.ru |
| ЛитРес (общий) | litres@litres.ru |
| EDRLab (Readium LCP) | https://www.edrlab.org/ |
| Harman (Adobe DRM) | https://www.adobe.com/uk/solutions/ebook/content-server.html |

### 12.4 OPDS-спецификации

| Документ | URL |
|----------|-----|
| OPDS 1.2 (стабильная) | https://specs.opds.io/opds-1.2.html |
| OPDS 2.0 (черновик) | https://drafts.opds.io/opds-2.0.html |
| GitHub спецификаций | https://github.com/opds-community/specs |
| Каталог OPDS-каталогов | http://opdshome.uo1.net/ |

---

**Дата завершения исследования:** 4 февраля 2026  
**Общее время исследования:** ~15 минут (5 параллельных агентов + прямые поиски)  
**Источники:** Официальная документация ЛитРес, GitHub, web search, grep.app
