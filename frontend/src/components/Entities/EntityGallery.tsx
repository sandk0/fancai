import React from 'react';
import { useTranslation } from 'react-i18next';

interface GalleryImage {
    id: string;
    image_url: string;
    description_text?: string;
}

interface Props {
    images: GalleryImage[];
    entityName: string;
    onImageClick?: (image: GalleryImage) => void;
}

export const EntityGallery: React.FC<Props> = ({ images, entityName, onImageClick }) => {
    const { t } = useTranslation();

    if (images.length === 0) return null;

    return (
        <section>
            <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-3 uppercase tracking-wide">
                {t('entities.gallery')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
                {images.map(img => (
                    <button
                        key={img.id}
                        type="button"
                        className="relative aspect-square rounded-lg overflow-hidden group"
                        onClick={() => onImageClick?.(img)}
                        aria-label={`${entityName} — ${img.description_text || t('entities.gallery')}`}
                    >
                        <img
                            src={img.image_url}
                            alt={entityName}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                ))}
            </div>
        </section>
    );
};
