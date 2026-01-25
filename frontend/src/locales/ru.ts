/**
 * Русская локализация для fancai
 * Russian translations for fancai
 */

export const ru = {
  // Общие элементы / Common elements
  common: {
    loading: 'Загрузка...',
    error: 'Ошибка',
    success: 'Успешно',
    cancel: 'Отмена',
    save: 'Сохранить',
    delete: 'Удалить',
    edit: 'Редактировать',
    close: 'Закрыть',
    back: 'Назад',
    next: 'Далее',
    previous: 'Предыдущая',
    search: 'Поиск',
    filter: 'Фильтры',
    noResults: 'Ничего не найдено',
    refresh: 'Обновить',
    retry: 'Повторить',
  },

  // Аутентификация / Authentication
  auth: {
    // Login page
    welcomeBack: 'Добро пожаловать!',
    signIn: 'Войти',
    signingIn: 'Вход...',
    loginSuccess: 'Вы успешно вошли в систему.',
    loginFailed: 'Ошибка входа',
    checkCredentials: 'Проверьте данные и попробуйте снова.',
    loginTitle: 'Добро пожаловать',
    loginSubtitle: 'Войдите, чтобы продолжить чтение с AI-иллюстрациями',
    dontHaveAccount: 'Нет аккаунта?',
    signUpHere: 'Зарегистрируйтесь здесь',

    // Register page
    createAccount: 'Создать аккаунт',
    creatingAccount: 'Создание аккаунта...',
    accountCreated: 'Аккаунт создан!',
    accountCreatedMessage: 'Добро пожаловать в fancai. Загрузите первую книгу!',
    registrationFailed: 'Ошибка регистрации',
    registerTitle: 'Создать аккаунт',
    registerSubtitle: 'Присоединяйтесь к fancai и открывайте книги с AI-иллюстрациями',
    alreadyHaveAccount: 'Уже есть аккаунт?',
    signInHere: 'Войдите здесь',
    termsAgreement: 'Создавая аккаунт, вы соглашаетесь с нашими',
    termsOfService: 'Условиями использования',
    and: 'и',
    privacyPolicy: 'Политикой конфиденциальности',

    // Form fields
    email: 'Email адрес',
    emailPlaceholder: 'Введите ваш email',
    password: 'Пароль',
    passwordPlaceholder: 'Введите ваш пароль',
    createPassword: 'Создайте пароль',
    fullName: 'Полное имя',
    fullNameOptional: 'Полное имя (необязательно)',
    fullNamePlaceholder: 'Введите ваше полное имя',
    confirmPassword: 'Подтвердите пароль',
    confirmPasswordPlaceholder: 'Подтвердите ваш пароль',

    // Validation errors
    invalidEmail: 'Неправильный email адрес',
    passwordTooShort: 'Пароль должен содержать минимум 6 символов',
    passwordsDontMatch: 'Пароли не совпадают',
    nameTooShort: 'Имя должно содержать минимум 2 символа',
  },

  // Главная страница / Home page
  home: {
    welcomeTitle: 'Добро пожаловать, {name}!',
    welcomeSubtitle: 'Продолжите читать с AI-генерацией изображений, которая оживляет ваши книги.',
    browseLibrary: 'Моя библиотека',
    browseLibraryDesc: 'Откройте вашу персональную коллекцию загруженных книг',
    uploadBook: 'Загрузить книгу',
    uploadBookDesc: 'Добавить EPUB или FB2 файлы в вашу библиотеку',
    aiGallery: 'AI Галерея',
    aiGalleryDesc: 'Просмотреть сгенерированные изображения и иллюстрации',
    readingProgress: 'Прогресс чтения',
    noBooksInProgress: 'Пока нет книг в процессе чтения',
    startReading: 'Начать читать →',
    aiFeatures: 'AI-Функции',
    smartExtraction: 'Умное извлечение описаний',
    smartExtractionDesc: 'Автоматически определяет локации, персонажей и сцены',
    imageGeneration: 'Генерация изображений',
    imageGenerationDesc: 'Создает красивые иллюстрации из описаний книг',
    readingAnalytics: 'Аналитика чтения',
    readingAnalyticsDesc: 'Отслеживайте ваш прогресс и привычки чтения',
  },

  // Библиотека / Library
  library: {
    title: 'Моя библиотека',
    booksCount: '{count} книг в вашей коллекции',
    oneBook: '1 книга в вашей коллекции',
    noBooksTitle: 'Пока нет книг',
    noBooksDesc: 'Загрузите ваш первый EPUB или FB2 файл, чтобы начать читать с AI-иллюстрациями',
    uploadFirstBook: 'Загрузить первую книгу',
    searchPlaceholder: 'Поиск в ваших книгах...',
    filters: 'Фильтры',
    filtersComingSoon: 'Фильтры скоро будут доступны',
    uploadBook: 'Загрузить книгу',
    chapters: 'глав',
    oneChapter: 'глава',
    processing: 'Обрабатывается',
    readingProgress: '{percent}% прочитано',
    noResultsTitle: 'Ничего не найдено',
    noResultsDesc: 'Нет книг, соответствующих запросу "{query}"',
    clearSearch: 'Очистить поиск',
  },

  // Читалка / Reader
  reader: {
    loading: 'Загрузка книги...',
    loadingChapter: 'Загрузка главы...',
    error: 'Ошибка при загрузке книги',
    chapter: 'Глава {num}',
    chapterLabel: 'Глава',
    page: 'Страница {num} из {total}',
    progress: 'Прогресс',
    tableOfContents: 'Содержание',
    settings: 'Настройки',
    quickSettings: 'Быстрые настройки',
    bookmarks: 'Закладки',
    textSettings: 'Настройки текста',
    fontSize: 'Размер шрифта',
    fontFamily: 'Шрифт',
    lineHeight: 'Межстрочный интервал',
    theme: 'Тема',
    themeLight: 'Светлая',
    themeDark: 'Темная',
    themeSepia: 'Сепия',
    addBookmark: 'Добавить закладку',
    removeBookmark: 'Удалить закладку',
    noDescriptions: 'Нет описаний для этой главы',
    generatingImages: 'Генерируем изображения...',
    imageGenerated: 'Изображение сгенерировано',
    clickToView: 'Нажмите, чтобы увеличить',

    // Navigation
    previous: 'Назад',
    next: 'Далее',
    navigationHint: 'Используйте клавиши ← → для навигации',

    // Authentication
    authRequired: 'Требуется аутентификация',
    authRequiredDesc: 'Пожалуйста, войдите в систему для доступа к этой книге. Используйте test@example.com / testpassword123',
    goToLogin: 'Перейти к входу',

    // Errors
    chapterNotFound: 'Глава не найдена',
    chapterNotFoundDesc: 'Запрошенная глава не может быть загружена.',
    goBack: 'Вернуться назад',

    // Image generation
    imageGeneration: 'Генерация изображения',
    generatingImageDesc: 'Генерируем изображение для этого описания...',
    imageCreated: 'Изображение создано за {time}с',
    imageExists: 'Изображение существует',
    imageExistsDesc: 'Изображение для этого описания уже существует',
    generationFailed: 'Генерация не удалась',
    generationFailedDesc: 'Не удалось сгенерировать изображение. Пожалуйста, попробуйте позже.',
    descriptionNotFound: 'Описание не найдено',

    // Image modal
    generatedImage: 'Сгенерированное изображение',
    descriptionType: '{type} описание',
  },

  // Изображения / Images
  images: {
    title: 'AI Галерея',
    allImages: 'Все изображения',
    byBook: 'По книгам',
    byType: 'По типам',
    download: 'Скачать',
    delete: 'Удалить',
    regenerate: 'Пересоздать',
    location: 'Локация',
    character: 'Персонаж',
    atmosphere: 'Атмосфера',
    noImages: 'Пока нет изображений',
    noImagesDesc: 'Начните читать книгу, и AI создаст иллюстрации для вас',
    generatedOn: 'Создано: {date}',
    fromBook: 'Из книги: {title}',
    readBook: 'Читать книгу',
    aiGeneratedImages: 'AI-сгенерированные изображения',
    chapters: 'Главы',
    progress: 'Прогресс',
    genre: 'Жанр',
    unknown: 'Неизвестно',
    invalidBook: 'Неправильная книга',
    bookIdRequired: 'Требуется ID книги',
    loadingBookInfo: 'Загрузка информации о книге...',
    bookNotFound: 'Книга не найдена',
    bookNotFoundDesc: 'Запрошенная книга не может быть загружена',
    goBackToLibrary: 'Вернуться в библиотеку',

    // Image Modal
    zoomIn: 'Увеличить',
    zoomOut: 'Уменьшить',
    share: 'Поделиться',
    close: 'Закрыть',
    regenerateImage: 'Пересоздать изображение',
    customStyle: 'Пользовательский стиль (необязательно)',
    stylePlaceholder: 'например, "акварельный стиль", "темное фэнтези", "фотореалистичный"...',
    generating: 'Генерация...',
    cancel: 'Отмена',
    regenerating: 'Пересоздаем изображение...',
    regeneratingTime: 'Это может занять 10-30 секунд',
    loadingImage: 'Загрузка изображения...',
    regenerationError: 'Ошибка пересоздания',
    missingImageId: 'Невозможно пересоздать изображение: отсутствует ID',
    imageRegenerated: 'Изображение пересоздано',
    newImageGenerated: 'Новое изображение создано за {time}с',
    regenerationFailed: 'Ошибка пересоздания',
    regenerationFailedDesc: 'Не удалось пересоздать изображение. Попробуйте снова.',
    generatedImageAlt: 'Сгенерированное изображение',
    shareTitle: 'fancai - Сгенерированное изображение',
    shareText: 'Изображение, созданное из описания в книге',
  },

  // Загрузка книг / Book upload
  upload: {
    title: 'Загрузить книгу',
    uploadBooks: 'Загрузить книги',
    dragDrop: 'Перетащите файл сюда или кликните для выбора',
    dragDropHere: 'Перетащите книги сюда',
    orClickBrowse: 'или кликните для выбора файлов',
    acceptedFormats: 'Принимаются: EPUB, FB2',
    maxSize: 'Максимальный размер: {size}MB',
    supports: 'Поддерживаются',
    maxSizeLabel: 'Макс размер',
    uploading: 'Загружаем...',
    uploadingFiles: 'Загрузка...',
    processing: 'Обрабатываем книгу...',
    processingStarted: 'Обработка начата',
    analyzingContent: 'Анализируем содержимое "{title}" для поиска описаний...',
    success: 'Книга успешно загружена!',
    uploadComplete: 'Загрузка завершена',
    uploadSuccess: '"{title}" успешно загружена!',
    error: 'Ошибка при загрузке',
    uploadFailed: 'Ошибка загрузки',
    uploadFailedDesc: 'Не удалось загрузить книгу',
    uploadInProgress: 'Идет загрузка',
    uploadInProgressDesc: 'Пожалуйста, дождитесь завершения загрузки',
    invalidFormat: 'Неподдерживаемый формат файла',
    unsupportedFormat: 'Неподдерживаемый формат. Используйте: {formats}',
    fileTooLarge: 'Файл слишком большой',
    fileTooLargeDesc: 'Файл слишком большой. Максимальный размер {size}MB',
    selectFile: 'Выбрать файл',
    chooseFiles: 'Выбрать файлы',
    addMoreFiles: 'Добавить еще файлы',
    uploadCount: 'Загрузить {count} книг',
    uploadCountOne: 'Загрузить 1 книгу',
    fileValidationFailed: 'Ошибка валидации файлов',
    processingInfo: 'Информация об обработке',
    processingInfoItems: [
      'Книги автоматически обрабатываются для извлечения метаданных и глав',
      'AI извлечет описания и сгенерирует изображения в фоновом режиме',
      'Вы получите уведомление, когда обработка завершится',
    ],
  },

  // Профиль / Profile
  profile: {
    title: 'Профиль',
    personalInfo: 'Личная информация',
    email: 'Email',
    fullName: 'Полное имя',
    memberSince: 'С нами с {date}',
    statistics: 'Статистика',
    booksRead: 'Прочитано книг',
    imagesGenerated: 'Создано изображений',
    readingTime: 'Время чтения',
    subscription: 'Подписка',
    currentPlan: 'Текущий план',
    upgradePlan: 'Улучшить план',
    freeplan: 'Бесплатный',
    premium: 'Премиум',
    ultimate: 'Ультимейт',
  },

  // Настройки / Settings
  settings: {
    title: 'Настройки',
    general: 'Общие',
    appearance: 'Внешний вид',
    reading: 'Чтение',
    notifications: 'Уведомления',
    privacy: 'Конфиденциальность',
    language: 'Язык',
    darkMode: 'Темная тема',
    autoSave: 'Автосохранение прогресса',
    emailNotifications: 'Email уведомления',
    saveChanges: 'Сохранить изменения',
    changesSaved: 'Изменения сохранены',
  },

  // Административная панель / Admin dashboard
  admin: {
    title: 'Панель администратора',
    subtitle: 'Управление системой и конфигурация',
    accessDenied: 'Доступ запрещен',
    accessDeniedDesc: 'Для доступа к этой странице необходимы права администратора.',

    overview: 'Обзор',
    multiNlpSettings: 'Настройки Multi-NLP',
    parsing: 'Парсинг',
    entities: 'Сущности',
    images: 'Изображения',
    system: 'Система',
    users: 'Пользователи',

    // Loading states
    loadingDashboard: 'Загрузка панели администратора...',
    loadingMultiNlp: 'Загрузка настроек multi-NLP...',
    loadingParsing: 'Загрузка настроек парсинга...',

    // Overview stats
    totalUsers: 'Всего пользователей',
    totalBooks: 'Всего книг',
    descriptions: 'Описания',
    generatedImages: 'Сгенерировано изображений',
    failedToLoadStats: 'Не удалось загрузить статистику системы',

    // Multi-NLP Settings
    globalNlpConfig: 'Глобальная конфигурация NLP',
    processingMode: 'Режим обработки',
    processingModeSingle: 'Один процессор',
    processingModeParallel: 'Параллельная обработка',
    processingModeSequential: 'Последовательная обработка',
    processingModeEnsemble: 'Ансамбль (голосование)',
    processingModeAdaptive: 'Адаптивный (AI-управляемый)',
    processingModeHint: 'Режим ансамбля комбинирует результаты от нескольких процессоров',

    defaultProcessor: 'Процессор по умолчанию',
    ensembleThreshold: 'Порог голосования ансамбля',
    ensembleThresholdHint: 'Минимальное согласие между процессорами',

    // Processor settings
    spacySettings: 'Настройки процессора spaCy',
    natashaSettings: 'Настройки процессора Natasha',
    stanzaSettings: 'Настройки процессора Stanza',

    enableSpacy: 'Включить spaCy',
    enableNatasha: 'Включить Natasha',
    enableStanza: 'Включить Stanza',

    model: 'Модель',
    confidenceThreshold: 'Порог уверенности',
    weight: 'Вес',
    characterDetectionBoost: 'Усиление обнаружения персонажей',
    literaryPatterns: 'Литературные паттерны',
    literaryBoost: 'Литературное усиление',
    morphologyAnalysis: 'Морфологический анализ',
    syntaxAnalysis: 'Синтаксический анализ',
    namedEntityRecognition: 'Распознавание именованных сущностей',

    // Parsing settings
    parsingConfig: 'Конфигурация парсинга',
    maxConcurrentTasks: 'Макс. одновременных задач',
    timeoutMinutes: 'Таймаут (минуты)',

    priorityWeights: 'Веса приоритетов',
    freeUsers: 'Бесплатные пользователи',
    premiumUsers: 'Премиум пользователи',
    ultimateUsers: 'Ultimate пользователи',

    // Buttons and actions
    saving: 'Сохранение...',
    saveMultiNlpSettings: 'Сохранить настройки Multi-NLP',
    saveSettings: 'Сохранить настройки',

    // Success/Error messages
    settingsSaved: 'Настройки сохранены',
    multiNlpUpdated: 'Настройки Multi-NLP успешно обновлены',
    parsingUpdated: 'Настройки парсинга успешно обновлены',
    imageUpdated: 'Настройки генерации изображений успешно обновлены',
    systemUpdated: 'Системные настройки успешно обновлены',
    saveFailed: 'Ошибка сохранения',

    imageSettings: 'Настройки генерации изображений будут доступны здесь.',
    systemSettings: 'Настройки конфигурации системы будут доступны здесь.',
    userManagement: 'Интерфейс управления пользователями будет доступен здесь.',

    loadingDuplicates: 'Загрузка дубликатов...',
    failedToLoadDuplicates: 'Не удалось загрузить дубликаты',
    noDuplicatesFound: 'Дубликаты не найдены. Все сущности уникальны.',
    duplicateGroups: 'Групп дубликатов',
    extraEntities: 'лишних сущностей',
    selectMasterEntity: 'Выберите главную сущность (остальные будут объединены в неё):',
    mergeEntities: 'Объединить',
    mergeSuccess: 'Объединение выполнено',
    mergeFailed: 'Ошибка объединения',
    mergeError: 'Ошибка',
  },

  // Ошибки / Errors
  errors: {
    notFound: 'Страница не найдена',
    notFoundDesc: 'Страница, которую вы ищете, не существует.',
    goHome: 'На главную',
    serverError: 'Ошибка сервера',
    serverErrorDesc: 'Что-то пошло не так на сервере.',
    networkError: 'Ошибка сети',
    networkErrorDesc: 'Проверьте ваше интернет соединение.',
    unauthorized: 'Не авторизован',
    unauthorizedDesc: 'Пожалуйста, войдите, чтобы продолжить.',
    forbidden: 'Доступ запрещен',
    forbiddenDesc: 'У вас нет прав для доступа к этой странице.',
  },

  // Уведомления / Notifications
  notifications: {
    bookUploaded: 'Книга загружена',
    bookUploadedDesc: '{title} успешно добавлена в библиотеку',
    imageGenerated: 'Изображение создано',
    imageGeneratedDesc: 'Новое изображение для {book}',
    chapterCompleted: 'Глава завершена',
    chapterCompletedDesc: 'Вы завершили главу {num}',
    bookCompleted: 'Книга прочитана',
    bookCompletedDesc: 'Поздравляем! Вы дочитали {title}',
  },

  // Функции / Features
  features: {
    aiPoweredGeneration: 'AI-генерация изображений',
    epubFb2Support: 'Поддержка EPUB и FB2',
    customizableReading: 'Настраиваемый процесс чтения',
    progressTracking: 'Отслеживание прогресса',
    bookmarks: 'Закладки и заметки',
    darkMode: 'Темная тема',
    offlineReading: 'Оффлайн чтение',
    multiDevice: 'Синхронизация между устройствами',
  },

  // Удаление книги / Book deletion modal
  deleteModal: {
    title: 'Удаление книги',
    confirmText: 'Вы уверены, что хотите удалить эту книгу?',
    warningTitle: 'Это действие необратимо!',
    warningChapters: 'Все главы книги будут удалены',
    warningImages: 'Все сгенерированные изображения будут удалены',
    warningProgress: 'Прогресс чтения будет потерян',
    deleting: 'Удаление...',
  },

  // Кнопки и действия / Buttons and actions
  actions: {
    upload: 'Загрузить',
    download: 'Скачать',
    delete: 'Удалить',
    edit: 'Редактировать',
    save: 'Сохранить',
    cancel: 'Отмена',
    confirm: 'Подтвердить',
    retry: 'Повторить',
    refresh: 'Обновить',
    viewAll: 'Посмотреть все',
    readMore: 'Читать далее',
    readBook: 'Читать книгу',
    continueReading: 'Продолжить чтение',
    startReading: 'Начать читать',
    goBack: 'Назад',
    goHome: 'На главную',
    share: 'Поделиться',
    export: 'Экспортировать',
    import: 'Импортировать',
  },

  // Навигация и header / Navigation and header
  nav: {
    searchBooks: 'Поиск книг...',
    uploadBook: 'Загрузить книгу',
    openMenu: 'Открыть меню',
    openUserMenu: 'Открыть меню пользователя',
    profile: 'Профиль',
    settings: 'Настройки',
    signOut: 'Выйти',
    switchTheme: 'Переключить на {theme} тему',
    lightMode: 'светлую',
    darkMode: 'темную',
    sepiaMode: 'сепия',

    // Sidebar navigation items
    home: 'Главная',
    myLibrary: 'Моя библиотека',
    generatedImages: 'Изображения',
    readingStats: 'Статистика',
    adminDashboard: 'Панель администратора',
    user: 'Пользователь',
    freePlan: 'Бесплатный план',
  },

  // Страница книги / Book page
  bookPage: {
    notFound: 'Книга не найдена',
    notFoundDesc: 'Запрошенная книга не найдена или у вас нет доступа к ней.',
    backToLibrary: 'Вернуться в библиотеку',
    chapters: 'глав',
    chapter: 'глава',
    pages: 'страниц',
    readTime: 'ч чтения',
    readingProgress: 'Прогресс чтения',
    continueReading: 'Продолжить чтение',
    startReading: 'Начать чтение',
    viewImages: 'Просмотр изображений',
    description: 'Описание',
    chaptersList: 'Главы',
    words: 'слов',
    minRead: 'мин',
    descriptions: 'описаний',
  },

  // Настройки читалки / Reader settings
  readerSettings: {
    fontSettings: 'Настройки шрифта',
    fontSize: 'Размер шрифта',
    lineHeight: 'Межстрочный интервал',
    fontFamily: 'Семейство шрифтов',

    // Line height options
    tight: 'Узкий',
    normal: 'Обычный',
    loose: 'Широкий',

    // Font categories
    serifFonts: 'Шрифты с засечками',
    sansSerifFonts: 'Рубленые шрифты',
    monospaceFonts: 'Моноширинные шрифты',

    // Theme settings
    themeSettings: 'Настройки темы',
    light: 'Светлая',
    dark: 'Темная',
    sepia: 'Сепия',
    lightDesc: 'Чистый белый фон',
    darkDesc: 'Приятный для глаз',
    sepiaDesc: 'Теплый тон, как у бумаги',

    // Preview
    preview: 'Предпросмотр',
    sampleText: 'Образец текста',
    sampleParagraph1: 'Съешь ещё этих мягких французских булок, да выпей же чаю. Это предложение содержит все буквы русского алфавита и часто используется для тестирования шрифтов.',
    sampleQuote: '«Чтение для ума — то же, что физические упражнения для тела.» - Джозеф Аддисон',
    sampleParagraph2: 'Широкая электрификация южных губерний даст мощный толчок подъёму сельского хозяйства. Эта классическая панграмма также используется для демонстрации шрифтов.',

    // Advanced settings
    advancedSettings: 'Расширенные настройки',
    maxWidth: 'Максимальная ширина текста',
    pageMargin: 'Отступы страницы',

    // Width options
    narrow: 'Узкая',
    medium: 'Средняя',
    wide: 'Широкая',

    // Margin options
    minimal: 'Минимальные',
    standard: 'Стандартные',
    spacious: 'Просторные',

    // Actions
    resetToDefaults: 'Сбросить настройки',
    settingsReset: 'Настройки сброшены',
    settingsResetDesc: 'Настройки читалки восстановлены по умолчанию',

    // Navigation settings
    navigation: 'Навигация',
    navigationMode: 'Режим навигации',
    navigationModeSwipe: 'Свайп',
    navigationModeTap: 'Тап',
    navigationModeSwipeDesc: 'Листайте пальцем влево/вправо',
    navigationModeTapDesc: 'Нажимайте по краям экрана',
    navigationModeNote: 'На iOS используется только свайп',

    // Display settings
    display: 'Дисплей',
    keepScreenOn: 'Не выключать экран',
    screenWillStayOn: 'Экран не будет гаснуть',
    activatesWhileReading: 'Активируется при чтении',
    screenWillTurnOff: 'Экран будет гаснуть',

    // Theme
    theme: 'Тема',
    typography: 'Типографика',
    layout: 'Макет',
    textWidth: 'Ширина текста',
    margins: 'Отступы',
  },
} as const;

export type TranslationKey = typeof ru;
export default ru;
