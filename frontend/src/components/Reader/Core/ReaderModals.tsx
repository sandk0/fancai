import React from 'react';
import type { BookDetail, GeneratedImage } from '@/types/api';
import type { EntityNetworkResponse } from '@/types/entity';
import type { Selection } from '@/hooks/epub/useTextSelection';
import type { NavItem } from '@/types/epub';
import { ImageModal } from '@/components/Images/ImageModal';
import { BookInfo } from '../BookInfo';
import { EntityDrawer } from '@/components/Entities/EntityDrawer';
import { SelectionMenu } from '../SelectionMenu';
import { TocSidebar } from '../TocSidebar';
import { PositionConflictDialog } from '../PositionConflictDialog';

interface PositionData {
  cfi: string;
  progress: number;
  lastReadAt: Date;
}

interface LocalPositionData {
  cfi: string;
  progress: number;
  savedAt: Date;
}

interface ReaderModalsProps {
  imageModal: {
    isOpen: boolean;
    selectedImage: GeneratedImage | null;
    onClose: () => void;
    onImageRegenerated: (url: string) => void;
  };
  bookInfo: {
    isOpen: boolean;
    onClose: () => void;
    metadata: BookDetail | null;
  };
  entityDrawer: {
    isOpen: boolean;
    onClose: () => void;
    network: EntityNetworkResponse | undefined;
    isLoading: boolean;
    currentChapter: number;
    maxChapterReached: number;
    currentCFI: string;
  };
  selection: {
    data: Selection | null;
    onCopy: () => void;
    onClose: () => void;
  };
  toc: {
    isOpen: boolean;
    onClose: () => void;
    items: NavItem[];
    currentHref: string;
    onChapterClick: (href: string) => void;
  };
  positionConflict: {
    data: {
      serverPosition: PositionData;
      localPosition: LocalPositionData;
    } | null;
    onUseServer: () => void;
    onUseLocal: () => void;
  };
}

export const ReaderModals: React.FC<ReaderModalsProps> = ({
  imageModal,
  bookInfo,
  entityDrawer,
  selection,
  toc,
  positionConflict,
}) => {
  return (
    <>
      {positionConflict.data && (
        <PositionConflictDialog
          serverPosition={positionConflict.data.serverPosition}
          localPosition={positionConflict.data.localPosition}
          onUseServer={positionConflict.onUseServer}
          onUseLocal={positionConflict.onUseLocal}
        />
      )}

      {imageModal.isOpen && imageModal.selectedImage && (
        <ImageModal
          imageUrl={imageModal.selectedImage.image_url}
          title={imageModal.selectedImage.description?.type || 'Generated Image'}
          description={imageModal.selectedImage.description?.text || imageModal.selectedImage.description?.content || ''}
          imageId={imageModal.selectedImage.id}
          descriptionData={imageModal.selectedImage.description ? {
            id: imageModal.selectedImage.description.id,
            type: imageModal.selectedImage.description.type,
            content: imageModal.selectedImage.description.text || imageModal.selectedImage.description.content,
            confidence_score: 0,
            priority_score: imageModal.selectedImage.description.priority_score,
          } : undefined}
          isOpen={imageModal.isOpen}
          onClose={imageModal.onClose}
          onImageRegenerated={imageModal.onImageRegenerated}
        />
      )}

      {bookInfo.isOpen && bookInfo.metadata && (
        <BookInfo
          metadata={bookInfo.metadata}
          isOpen={bookInfo.isOpen}
          onClose={bookInfo.onClose}
        />
      )}

      <EntityDrawer
        isOpen={entityDrawer.isOpen}
        onClose={entityDrawer.onClose}
        entities={entityDrawer.network?.entities || {}}
        edges={entityDrawer.network?.edges || []}
        currentChapter={entityDrawer.currentChapter}
        maxChapterReached={entityDrawer.maxChapterReached}
        currentCFI={entityDrawer.currentCFI}
        isLoading={entityDrawer.isLoading}
      />

      <SelectionMenu
        selection={selection.data}
        onCopy={selection.onCopy}
        onClose={selection.onClose}
      />

      <TocSidebar
        toc={toc.items}
        currentHref={toc.currentHref}
        onChapterClick={toc.onChapterClick}
        isOpen={toc.isOpen}
        onClose={toc.onClose}
      />
    </>
  );
};
