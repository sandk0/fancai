/**
 * Заглушка вместо `localforage` в браузерном бандле.
 *
 * `localforage` приезжает единственным путём — через `epubjs/src/store.js`,
 * то есть ради офлайн-хранилища самой epub.js (`Book.store()`). Приложение
 * им не пользуется: офлайн-кэш глав сделан на Dexie
 * (`src/services/chapterCache.ts`), а `store()` не вызывается нигде.
 *
 * Пакет весит около 64 КБ и ехал в бандл мёртвым грузом. Алиас
 * в `vite.config.ts` подменяет его этим модулем.
 *
 * Заглушка **шумная намеренно**: любой реальный вызов падает с внятным
 * сообщением. Тихо возвращать `undefined` нельзя — тогда включённое
 * когда-нибудь хранилище epub.js молча перестало бы работать.
 *
 * Если офлайн-хранилище epub.js однажды понадобится — снять алиас,
 * а не дописывать сюда реализацию.
 */

const unavailable = (method: string) => (): never => {
  throw new Error(
    `localforage.${method}() вызван, но пакет заменён заглушкой: офлайн-хранилище ` +
      'epub.js в приложении не используется (кэш глав — Dexie). ' +
      'Снимите алиас localforage в vite.config.ts, если оно понадобилось.'
  );
};

const localforage = {
  config: unavailable('config'),
  createInstance: unavailable('createInstance'),
  defineDriver: unavailable('defineDriver'),
  getItem: unavailable('getItem'),
  setItem: unavailable('setItem'),
  removeItem: unavailable('removeItem'),
  clear: unavailable('clear'),
  length: unavailable('length'),
  key: unavailable('key'),
  keys: unavailable('keys'),
  iterate: unavailable('iterate'),
  ready: unavailable('ready'),
  setDriver: unavailable('setDriver'),
  driver: unavailable('driver'),
  supports: () => false,
  INDEXEDDB: 'asyncStorage',
  WEBSQL: 'webSQLStorage',
  LOCALSTORAGE: 'localStorageWrapper',
};

export default localforage;
