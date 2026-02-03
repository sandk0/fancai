import React from 'react';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FileDropzoneProps {
  dragActive: boolean;
  supportedFormats: string[];
  maxFileSize: number;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onBrowseClick: () => void;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  dragActive,
  supportedFormats,
  maxFileSize,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onBrowseClick,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-6 sm:p-12 text-center transition-colors ${
        dragActive
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-primary/60'
      }`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 className="text-lg font-medium text-card-foreground mb-2">
        {t('upload.dragDropHere')}
      </h3>
      <p className="text-muted-foreground mb-4">
        {t('upload.orClickBrowse')}
      </p>
      <button
        onClick={onBrowseClick}
        className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
      >
        <Upload className="h-4 w-4 mr-2" />
        {t('upload.chooseFiles')}
      </button>
      <p className="text-sm text-muted-foreground mt-4">
        {t('upload.supports')}: {supportedFormats.join(', ')} • {t('upload.maxSizeLabel')}: {maxFileSize / (1024 * 1024)}MB
      </p>
    </div>
  );
};
