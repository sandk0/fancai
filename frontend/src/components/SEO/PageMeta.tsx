import { Helmet } from 'react-helmet-async';

interface PageMetaProps {
  title: string;
  description?: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  jsonLd?: Record<string, unknown>;
}

export function PageMeta({ 
  title, 
  description, 
  image, 
  url, 
  type = 'website',
  noindex = false,
  jsonLd
}: PageMetaProps) {
  const fullTitle = `${title} | fancai`;
  return (
    <Helmet>
      <title>{fullTitle}</title>
      {/*
        Единственный владелец `<meta name="description">` — этот компонент.
        Статический тег из index.html удалён намеренно: react-helmet-async 3
        на React 19 отдаёт хостинг тегов самому React, а тот не схлопывает
        свой тег со статическим — в head оказывались два разных описания
        (e2e ловил это strict mode violation'ом). Оставлять только
        статический нельзя: он один на все маршруты и убивает пер-страничное
        описание. PageMeta подключён на всех 16 страницах.
      */}
      {description && <meta name="description" content={description} />}

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      {description && <meta property="og:description" content={description} />}
      {image && <meta property="og:image" content={image} />}
      {url && <meta property="og:url" content={url} />}
      <meta property="og:type" content={type} />
      
      {/* Twitter Cards */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      {description && <meta name="twitter:description" content={description} />}
      {image && <meta name="twitter:image" content={image} />}
      
      {/* Canonical URL */}
      {url && <link rel="canonical" href={url} />}
      
      {/* Robots */}
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      
      {/* JSON-LD Structured Data */}
      {jsonLd && (
        <script type="application/ld+json">
          {JSON.stringify(jsonLd)}
        </script>
      )}
    </Helmet>
  );
}
