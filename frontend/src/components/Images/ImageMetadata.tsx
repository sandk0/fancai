import React from 'react';
import { useTranslation } from 'react-i18next';

interface ImageMetadataProps {
  title?: string;
  description?: string;
}

export const ImageMetadata: React.FC<ImageMetadataProps> = ({
  title,
  description,
}) => {
  const { t } = useTranslation();

  return (
    <div className="text-white flex-1 min-w-0 max-w-[60%] sm:max-w-[70%]">
      {title && (
        <h3 id="image-modal-title" className="font-semibold truncate">
          {title}
        </h3>
      )}
      {!title && (
        <h3 id="image-modal-title" className="sr-only">
          {t('images.generatedImageAlt')}
        </h3>
      )}
      {description && (
        <p className="text-sm text-white/70 mt-1 line-clamp-2 sm:line-clamp-3">{description}</p>
      )}
    </div>
  );
};
