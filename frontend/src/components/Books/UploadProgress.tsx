import React from 'react';
import { X, FileText, Upload, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LoadingSpinner from '@/components/UI/LoadingSpinner';

interface FilePreview {
  title?: string;
  format: string;
  size: string;
}

interface FileWithPreview extends File {
  preview?: FilePreview;
}

interface UploadProgressProps {
  files: FileWithPreview[];
  uploadProgress: Record<string, number>;
  isUploading: boolean;
  onRemoveFile: (fileName: string) => void;
  onAddMoreClick: () => void;
  onStartUpload: () => void;
}

export const UploadProgress: React.FC<UploadProgressProps> = ({
  files,
  uploadProgress,
  isUploading,
  onRemoveFile,
  onAddMoreClick,
  onStartUpload,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {files.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          className="bg-muted rounded-lg p-4 border border-border"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <FileText className="h-8 w-8 text-primary flex-shrink-0" />
              <div className="flex-1">
                <h4 className="font-medium text-card-foreground">
                  {file.preview?.title || file.name}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {file.preview?.format} • {file.preview?.size}
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              {uploadProgress[file.name] !== undefined ? (
                <div className="flex items-center space-x-2">
                  <div className="w-24 bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{
                        width: `${uploadProgress[file.name]}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">
                    {uploadProgress[file.name]}%
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => onRemoveFile(file.name)}
                  className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={t('common.remove')}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      
      <div className="flex justify-between items-center pt-4">
        <button
          onClick={onAddMoreClick}
          className="text-primary hover:text-primary/80 text-sm font-medium"
        >
          {t('upload.addMoreFiles')}
        </button>

        <button
          onClick={onStartUpload}
          disabled={isUploading || files.length === 0}
          className="inline-flex items-center px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isUploading ? (
            <>
              <LoadingSpinner size="sm" className="mr-2" />
              {t('upload.uploadingFiles')}
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              {files.length === 1 ? t('upload.uploadCountOne') : t('upload.uploadCount').replace('{count}', String(files.length))}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export const UploadInfo: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="mt-6 p-4 bg-primary/10 rounded-lg">
      <div className="flex items-start space-x-3">
        <AlertCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="text-primary font-medium mb-1">
            {t('upload.processingInfo')}
          </p>
          <ul className="text-primary/80 space-y-1">
            <li>• {t('upload.infoMetadata')}</li>
            <li>• {t('upload.infoAI')}</li>
            <li>• {t('upload.infoNotification')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
