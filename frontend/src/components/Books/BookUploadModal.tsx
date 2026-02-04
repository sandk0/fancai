import React, { useState, useRef } from 'react';
import { X, BookOpen } from 'lucide-react';
import { m, AnimatePresence } from 'motion/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { booksAPI } from '@/api/books';
import { useUIStore } from '@/stores/ui';
import { bookKeys, getCurrentUserId } from '@/hooks/api/queryKeys';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/utils/errors';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Z_INDEX } from '@/lib/zIndex';
import { logger } from '@/lib/logger';
import { FileDropzone } from './FileDropzone';
import { UploadProgress, UploadInfo } from './UploadProgress';

interface BookUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess?: () => void;
}

interface FileWithPreview extends File {
  preview?: {
    title?: string;
    author?: string;
    format: string;
    size: string;
  };
}

const SUPPORTED_FORMATS = ['.epub', '.fb2'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const BookUploadModal: React.FC<BookUploadModalProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
}) => {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { notify } = useUIStore();
  const { t } = useTranslation();

  useFocusTrap(isOpen, modalRef);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      logger.debug('[MUTATION] Upload mutation called with file:', file);

      if (!file) {
        throw new Error('No file provided to upload mutation');
      }

      logger.debug('[MUTATION] File details:', {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
      });

      const formData = new FormData();
      formData.append('file', file);

      logger.debug('[MUTATION] FormData entries:');
      for (const [key, value] of formData.entries()) {
        logger.debug(`  ${key}:`, value);
      }

      logger.debug('[MUTATION] Calling booksAPI.uploadBook...');

      try {
        const result = await booksAPI.uploadBook(formData, {
          onUploadProgress: (progressEvent) => {
            const progress = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total || 1)
            );
            logger.debug(`[MUTATION] Upload progress: ${progress}%`);
            setUploadProgress(prev => ({
              ...prev,
              [file.name]: progress,
            }));
          },
        });

        logger.debug('[MUTATION] Upload completed successfully! Response:', result);
        return result;
      } catch (error) {
        logger.error('[MUTATION] Upload failed with error:', error);
        throw error;
      }
    },
    onSuccess: async (data, file) => {
      logger.debug('[MUTATION] onSuccess called with data:', data);
      notify.success(t('upload.uploadComplete'), t('upload.uploadSuccess').replace('{title}', data.book.title));
      setTimeout(() => {
        onClose();
      }, 1500);
      setUploadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[file.name];
        return newProgress;
      });
      setFiles(prev => prev.filter(f => f.name !== file.name));

      const userId = getCurrentUserId();
      logger.debug('[MUTATION] Invalidating book queries with immediate refetch for userId:', userId);
      await queryClient.invalidateQueries({
        queryKey: bookKeys.all(userId),
        refetchType: 'all',
      });
      logger.debug('[MUTATION] Book queries invalidated and refetched');

      if (onUploadSuccess) {
        logger.debug('[MUTATION] Calling onUploadSuccess callback...');
        onUploadSuccess();
      }

      if (data.task_id) {
        notify.info(t('upload.processingStarted'), t('upload.analyzingContent').replace('{title}', data.book.title));
      }
    },
    onError: (error: Error | { response?: { data?: { detail?: string } } }, file) => {
      logger.error('[MUTATION] onError called with error:', error);
      notify.error(t('upload.uploadFailed'), getErrorMessage(error, t('upload.uploadFailedDesc')));
      setUploadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[file.name];
        return newProgress;
      });
    },
  });

  const validateFile = (file: File): string | null => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!SUPPORTED_FORMATS.includes(extension)) {
      return t('upload.unsupportedFormat').replace('{formats}', SUPPORTED_FORMATS.join(', '));
    }

    if (file.size > MAX_FILE_SIZE) {
      return t('upload.fileTooLargeDesc').replace('{size}', String(MAX_FILE_SIZE / (1024 * 1024)));
    }

    return null;
  };

  const generatePreview = async (file: File): Promise<FileWithPreview> => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    const sizeFormatted = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    
    const fileWithPreview = Object.assign(file, {
      preview: {
        title: file.name.replace(/\.(epub|fb2)$/i, ''),
        format: extension.toUpperCase().slice(1),
        size: sizeFormatted,
      },
    } as FileWithPreview);
    
    return fileWithPreview;
  };

  const handleFiles = async (fileList: FileList) => {
    const validFiles: File[] = [];
    const errors: string[] = [];

    Array.from(fileList).forEach(file => {
      const error = validateFile(file);
      if (error) {
        errors.push(`${file.name}: ${error}`);
      } else {
        validFiles.push(file);
      }
    });

    if (errors.length > 0) {
      notify.error(t('upload.fileValidationFailed'), errors.join('\n'));
    }

    if (validFiles.length > 0) {
      const filesWithPreviews = await Promise.all(
        validFiles.map(generatePreview)
      );
      setFiles(prev => [...prev, ...filesWithPreviews]);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      handleFiles(droppedFiles);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles) {
      handleFiles(selectedFiles);
    }
  };

  const startUpload = () => {
    files.forEach(file => {
      uploadMutation.mutate(file);
    });
  };

  const removeFile = (fileName: string) => {
    setFiles(prev => prev.filter(f => f.name !== fileName));
  };

  const handleClose = () => {
    if (uploadMutation.isPending) {
      notify.warning(t('upload.uploadInProgress'), t('upload.uploadInProgressDesc'));
      return;
    }
    setFiles([]);
    setUploadProgress({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto"
        style={{ zIndex: Z_INDEX.modalOverlay }}
        onClick={handleClose}
      />
      <div
        className="fixed inset-0 flex items-center justify-center pointer-events-none"
        style={{ zIndex: Z_INDEX.modal }}
      >
        <m.div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-modal-title"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative bg-card rounded-xl shadow-2xl max-w-lg sm:max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center space-x-3">
              <BookOpen className="h-6 w-6 text-primary" aria-hidden="true" />
              <h2
                id="upload-modal-title"
                className="text-xl font-semibold text-card-foreground"
              >
                {t('upload.uploadBooks')}
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground rounded-lg transition-colors"
              disabled={uploadMutation.isPending}
              aria-label={t('common.close')}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
            {files.length === 0 && (
              <FileDropzone
                dragActive={dragActive}
                supportedFormats={SUPPORTED_FORMATS}
                maxFileSize={MAX_FILE_SIZE}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onBrowseClick={() => fileInputRef.current?.click()}
              />
            )}

            {files.length > 0 && (
              <UploadProgress
                files={files}
                uploadProgress={uploadProgress}
                isUploading={uploadMutation.isPending}
                onRemoveFile={removeFile}
                onAddMoreClick={() => fileInputRef.current?.click()}
                onStartUpload={startUpload}
              />
            )}

            <UploadInfo />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={SUPPORTED_FORMATS.join(',')}
            onChange={handleFileInput}
            className="hidden"
            aria-label={t('upload.chooseFiles')}
          />
        </m.div>
      </div>
    </AnimatePresence>
  );
};
