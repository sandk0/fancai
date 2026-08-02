/**
 * Заглушка вместо `@xmldom/xmldom` в браузерном бандле.
 *
 * epub.js обращается к пакету ровно в одном виде — `_xmldom.DOMParser` —
 * и только в трёх ветках: когда глобального `DOMParser` нет (Node),
 * когда явно передан `forceXMLDom`, и в сериализаторе под IE (`Trident`).
 * Ни одна из них в этом приложении недостижима: код исполняется только
 * в браузере, `forceXMLDom` нигде не передаётся, а React 19 в IE не работает.
 *
 * Поэтому весь парсер (десятки килобайт) ехал в чанк `ReaderPage` мёртвым
 * грузом. Алиас в `vite.config.ts` подменяет его этим модулем, который
 * отдаёт нативные реализации.
 *
 * Если однажды понадобится настоящий парсер (SSR, воркер без DOM,
 * `forceXMLDom`) — снять алиас, а не расширять заглушку.
 */

export const DOMParser = globalThis.DOMParser;
export const XMLSerializer = globalThis.XMLSerializer;

export default { DOMParser, XMLSerializer };
