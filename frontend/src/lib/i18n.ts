import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Русский нужен на первом кадре: язык принудительно задан ниже, и без
// его ресурсов интерфейс мигнёт ключами. Английский грузится лениво —
// в бандле это 51 КБ, которые при `lng: 'ru'` никто не читает.
import ruTranslation from '../locales/ru/translation.json';

const LAZY_LANGUAGES: Record<string, () => Promise<{ default: object }>> = {
  en: () => import('../locales/en/translation.json'),
};

async function ensureBundle(language: string): Promise<void> {
  const base = language.split('-')[0];
  const load = LAZY_LANGUAGES[base];
  if (!load || i18n.hasResourceBundle(base, 'translation')) return;

  const { default: resources } = await load();
  i18n.addResourceBundle(base, 'translation', resources, true, true);
}

// Initialize i18n
i18n
  // Detect user language
  .use(LanguageDetector)
  // Pass the i18n instance to react-i18next
  .use(initReactI18next)
  // Init i18next
  .init({
    lng: 'ru', // Force Russian language by default (temporary until language switcher is ready)
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

// Догружаем ресурсы при переключении языка. Пока переключателя нет,
// ветка не выполняется вовсе, но и удалять её нельзя: без неё
// `changeLanguage('en')` тихо покажет русские строки.
i18n.on('languageChanged', (language) => {
  void ensureBundle(language);
});

export default i18n;
