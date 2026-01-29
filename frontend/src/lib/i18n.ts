import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translations directly for offline support
import ruTranslation from '../locales/ru/translation.json';

// Initialize i18n
i18n
  // Detect user language
  .use(LanguageDetector)
  // Pass the i18n instance to react-i18next
  .use(initReactI18next)
  // Init i18next
  .init({
    resources: {
      ru: {
        translation: ruTranslation,
      },
    },
    fallbackLng: 'ru',
    debug: import.meta.env.DEV,

    interpolation: {
      escapeValue: false, // React already safes from xss
    },

    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
