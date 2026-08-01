// Theme initialization — prevents FOUC (Flash of Unstyled Content)
// Must load synchronously in <head> before page renders
(function () {
  try {
    var theme = localStorage.getItem('app-theme');
    if (theme === 'system' || !theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    // Set data-theme attribute for CSS custom properties
    document.documentElement.setAttribute('data-theme', theme);

    // Set class for Tailwind compatibility
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (theme === 'sepia') {
      document.documentElement.classList.add('sepia');
    }

    // Set color-scheme for native elements (scrollbars, inputs, etc.)
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  } catch {
    // localStorage или DOM недоступны (приватный режим, ранний вызов) —
    // тема остаётся дефолтной, инициализация не должна ронять страницу.
  }

  // Activate preloaded font stylesheet when ready
  var fontLink = document.getElementById('font-preload');
  if (fontLink) {
    fontLink.onload = function () {
      fontLink.onload = null;
      fontLink.rel = 'stylesheet';
    };
  }
})();
