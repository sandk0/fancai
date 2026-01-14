# 🚀 Быстрые исправления мобильной UX - Чеклист

**Дата:** 2025-12-24
**Статус:** Ready for implementation

---

## ⚡ Критические исправления (2 часа работы)

### 1. Button Component (`/components/UI/button.tsx`)

```diff
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      size: {
-       default: "h-10 px-4 py-2",
+       default: "h-11 px-4 py-2 text-base",
-       sm: "h-9 rounded-md px-3",
+       sm: "h-10 rounded-md px-3 text-base",
-       lg: "h-11 rounded-md px-8",
+       lg: "h-12 rounded-md px-8 text-lg",
-       icon: "h-10 w-10",
+       icon: "h-11 w-11",
      },
    },
  }
)
```

**Причина:** Apple HIG требует минимум 44x44px для touch targets

---

### 2. Input iOS Zoom Prevention

#### Header Search (`/components/Layout/Header.tsx` Line 81)
```diff
<input
  type="text"
  placeholder={t('nav.searchBooks')}
- className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white dark:bg-gray-700 dark:border-gray-600 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
+ className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white dark:bg-gray-700 dark:border-gray-600 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-base"
/>
```

#### Library Search (`/components/Library/LibrarySearch.tsx` Line 59)
```diff
<input
  type="text"
  value={searchQuery}
  onChange={(e) => onSearchChange(e.target.value)}
  placeholder="Поиск по названию, автору, жанру..."
- className="w-full pl-12 pr-4 py-3 rounded-xl border-2 transition-all focus:outline-none focus:ring-2"
+ className="w-full pl-12 pr-4 py-3 rounded-xl border-2 transition-all focus:outline-none focus:ring-2 text-base"
  style={{
    backgroundColor: 'var(--bg-primary)',
    borderColor: 'var(--border-color)',
    color: 'var(--text-primary)',
  }}
/>
```

#### ImageModal Custom Input (`/components/Images/ImageModal.tsx` Line 236)
```diff
<input
  type="text"
  value={customPrompt}
  onChange={(e) => setCustomPrompt(e.target.value)}
  placeholder={t('images.stylePlaceholder')}
- className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
+ className="w-full px-3 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none text-base"
  disabled={isRegenerating}
/>
```

**Причина:** iOS Safari автоматически зумит viewport при focus на input с font-size < 16px

---

### 3. Dropdown Menu Items (`/components/UI/dropdown-menu.tsx`)

#### DropdownMenuItem (Line 84)
```diff
<DropdownMenuPrimitive.Item
  ref={ref}
  className={cn(
-   "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
+   "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-3 text-base outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:bg-accent/80",
    inset && "pl-8",
    className
  )}
  {...props}
/>
```

#### DropdownMenuSubTrigger (Line 28)
```diff
<DropdownMenuPrimitive.SubTrigger
  ref={ref}
  className={cn(
-   "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
+   "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-3 text-base outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:bg-accent/80",
    inset && "pl-8",
    className
  )}
  {...props}
>
```

**Причина:** 24px height критически мало для пальцев, нужно минимум 44px

---

### 4. Slider Thumb (`/components/UI/slider.tsx`)

```diff
<SliderPrimitive.Root
  ref={ref}
  className={cn(
    "relative flex w-full touch-none select-none items-center",
    className
  )}
  {...props}
>
  <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
    <SliderPrimitive.Range className="absolute h-full bg-primary" />
  </SliderPrimitive.Track>
- <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
+ <SliderPrimitive.Thumb className="block h-8 w-8 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
</SliderPrimitive.Root>
```

#### ReaderSettings Custom Slider (`/components/Settings/ReaderSettings.tsx` Line 280-301)
```diff
<style dangerouslySetInnerHTML={{
  __html: `
  .slider::-webkit-slider-thumb {
    appearance: none;
-   height: 20px;
-   width: 20px;
+   height: 32px;
+   width: 32px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    border: 2px solid #ffffff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .slider::-moz-range-thumb {
-   height: 20px;
-   width: 20px;
+   height: 32px;
+   width: 32px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    border: 2px solid #ffffff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
  `
}} />
```

**Причина:** 20px thumb невозможно точно схватить пальцем

---

### 5. Modal Body Scroll Lock

#### BookUploadModal (`/components/Books/BookUploadModal.tsx`)

Добавить после Line 254:
```typescript
// Prevent body scroll on mobile
React.useEffect(() => {
  if (!isOpen) return;

  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';

  return () => {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, scrollY);
  };
}, [isOpen]);
```

#### ImageModal - добавить safe area (`/components/Images/ImageModal.tsx` Line 138-142)

```diff
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
  style={{
    paddingTop: 'env(safe-area-inset-top)',
    paddingBottom: 'env(safe-area-inset-bottom)',
+   paddingLeft: 'env(safe-area-inset-left)',
+   paddingRight: 'env(safe-area-inset-right)',
  }}
  onClick={onClose}
>
```

Исправить body scroll (Line 120):
```diff
React.useEffect(() => {
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showRegenerateOptions) {
        setShowRegenerateOptions(false);
      } else {
        onClose();
      }
    }
  };

  if (isOpen) {
    document.addEventListener('keydown', handleEscape);
-   document.body.style.overflow = 'hidden';
+   const scrollY = window.scrollY;
+   document.body.style.position = 'fixed';
+   document.body.style.top = `-${scrollY}px`;
+   document.body.style.width = '100%';
  }

  return () => {
    document.removeEventListener('keydown', handleEscape);
-   document.body.style.overflow = 'unset';
+   document.body.style.position = '';
+   document.body.style.top = '';
+   document.body.style.width = '';
+   if (isOpen) {
+     window.scrollTo(0, parseInt(document.body.style.top || '0') * -1);
+   }
  };
}, [isOpen, onClose, showRegenerateOptions]);
```

**Причина:** iOS Safari игнорирует `overflow: hidden` на body

---

### 6. Notification Close Button (`/components/UI/NotificationContainer.tsx`)

```diff
<button
  type="button"
  onClick={() => removeNotification(notification.id)}
- className="ml-4 flex-shrink-0 text-current opacity-60 hover:opacity-80 transition-opacity"
+ className="ml-4 flex-shrink-0 text-current opacity-60 hover:opacity-80 transition-opacity p-2"
+ aria-label="Закрыть уведомление"
>
  <X className="w-4 h-4" />
</button>
```

**Причина:** 16px иконка без padding = невозможно нажать

---

## 🔥 Высокий приоритет (4 часа работы)

### 7. Header Buttons (`/components/Layout/Header.tsx`)

#### Hamburger Menu (Line 56-62)
```diff
<button
  type="button"
- className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
+ className="lg:hidden p-3 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 active:bg-gray-200"
  onClick={() => setSidebarOpen(!sidebarOpen)}
+ aria-label="Открыть меню"
>
  <Menu className="w-6 h-6" />
</button>
```

#### Upload Button (Line 92-102)
```diff
<button
  type="button"
  onClick={() => setShowUploadModal(true)}
- className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white transition-all hover:scale-105"
+ className="inline-flex items-center gap-2 px-4 py-3 text-base font-medium rounded-lg text-white transition-all hover:scale-105 active:scale-100"
  style={{
    backgroundColor: 'var(--accent-color)',
  }}
>
  <Upload className="w-4 h-4" />
  <span className="hidden sm:block">{t('nav.uploadBook')}</span>
</button>
```

#### User Avatar (Line 111-129)
```diff
<button
  type="button"
  className="flex items-center justify-center rounded-full border-2 p-0.5 transition-all hover:scale-105"
  style={{
    borderColor: 'var(--border-color)',
    backgroundColor: 'transparent',
  }}
  onClick={() => setShowUserMenu(!showUserMenu)}
+ aria-label="Открыть меню пользователя"
>
  <span className="sr-only">{t('nav.openUserMenu')}</span>
  <div
-   className="w-9 h-9 rounded-full flex items-center justify-center"
+   className="w-11 h-11 rounded-full flex items-center justify-center"
    style={{
      backgroundColor: 'var(--accent-color)',
    }}
  >
    <span className="text-sm font-medium text-white">
      {user?.full_name ? user.full_name.charAt(0).toUpperCase() : user?.email.charAt(0).toUpperCase()}
    </span>
  </div>
</button>
```

---

### 8. Sidebar Navigation (`/components/Layout/Sidebar.tsx`)

#### Mobile Sidebar (Line 163-185)
```diff
<Link
  key={item.name}
  to={item.href}
  onClick={handleLinkClick}
  className={cn(
-   'group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors',
+   'group flex items-center px-3 py-3 text-base font-medium rounded-md transition-colors active:bg-primary-200 dark:active:bg-primary-800',
    isActive
      ? 'bg-primary-100 dark:bg-primary-900 text-primary-900 dark:text-primary-100'
      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
  )}
>
```

#### Desktop Sidebar (Line 88-109) - аналогично
```diff
- 'group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors',
+ 'group flex items-center px-2 py-2.5 text-sm font-medium rounded-md transition-colors active:bg-primary-200 dark:active:bg-primary-800',
```

---

### 9. Modal Close Buttons

#### ImageModal (Line 204-210)
```diff
<button
  onClick={onClose}
- className="p-2 text-white hover:bg-white/20 rounded-lg transition-colors"
+ className="p-3 text-white hover:bg-white/20 rounded-lg transition-colors active:bg-white/30"
  title={t('images.close')}
+ aria-label="Закрыть изображение"
>
  <X className="h-5 w-5" />
</button>
```

Применить тот же паттерн к другим кнопкам в header (zoom, share, download):
```diff
- className="p-2 text-white hover:bg-white/20 rounded-lg transition-colors"
+ className="p-3 text-white hover:bg-white/20 rounded-lg transition-colors active:bg-white/30"
```

#### BookUploadModal (Line 281-287)
```diff
<button
  onClick={handleClose}
- className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg transition-colors"
+ className="p-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg transition-colors active:text-gray-700"
  disabled={uploadMutation.isPending}
+ aria-label="Закрыть окно загрузки"
>
  <X className="h-5 w-5" />
</button>
```

---

### 10. Card Touch Feedback (`/components/Library/BookCard.tsx`)

#### Grid View (Line 63-69)
```diff
<div
  className={cn(
-   "group cursor-pointer relative transition-all duration-300 hover:-translate-y-2",
+   "group cursor-pointer relative transition-all duration-300 hover:-translate-y-2 active:scale-95",
    !isClickable && "pointer-events-none"
  )}
  onClick={isClickable ? onClick : undefined}
>
```

#### List View (Line 169-179)
```diff
<div
  className={cn(
-   "group cursor-pointer p-4 rounded-2xl border-2 hover:shadow-lg transition-all duration-300",
+   "group cursor-pointer p-4 rounded-2xl border-2 hover:shadow-lg transition-all duration-300 active:scale-98 active:opacity-90",
    !isClickable && "pointer-events-none"
  )}
  onClick={isClickable ? onClick : undefined}
  style={{
    backgroundColor: 'var(--bg-primary)',
    borderColor: 'var(--border-color)',
  }}
>
```

---

### 11. Notification Responsive Positioning (`/components/UI/NotificationContainer.tsx`)

```diff
- <div className="fixed top-20 right-4 z-50 space-y-2 max-w-sm w-full">
+ <div className="fixed top-20 right-4 md:right-4 left-4 md:left-auto z-50 space-y-2 max-w-sm w-full md:w-auto" style={{
+   paddingTop: 'env(safe-area-inset-top, 0px)',
+   paddingRight: 'env(safe-area-inset-right, 16px)',
+   paddingLeft: 'env(safe-area-inset-left, 16px)',
+ }}>
```

---

## 📋 Тестирование

После внесения изменений протестировать на:

### iOS Safari
- [ ] Input focus не вызывает автозум
- [ ] Все кнопки легко нажимаются пальцем
- [ ] Modal scroll lock работает корректно
- [ ] Safe area учитывается на iPhone с notch

### Android Chrome
- [ ] Touch targets достаточного размера
- [ ] Dropdown меню удобны для навигации
- [ ] Slider легко перетаскивается

### Desktop
- [ ] Hover states работают корректно
- [ ] Keyboard navigation функционирует
- [ ] Увеличенные размеры не ломают layout

---

## ⏱️ Оценка времени

- **Критические исправления:** 2 часа
- **Высокий приоритет:** 4 часа
- **Тестирование:** 2 часа
- **Итого:** ~8 часов (1 рабочий день)

---

## 📝 Checklist перед commit

- [ ] Все критические исправления внесены
- [ ] `npm run type-check` проходит
- [ ] `npm run lint` проходит
- [ ] Мануальное тестирование на iOS Safari
- [ ] Мануальное тестирование на Android Chrome
- [ ] Desktop regression тест
- [ ] Lighthouse Mobile Score >85

---

**Создано:** Frontend Development Agent v2.0
**Последнее обновление:** 2025-12-24
