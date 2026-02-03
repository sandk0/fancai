import { useState, useCallback } from 'react';
import type { DialogVariant } from './Dialog';

interface UseDialogState {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm?: () => void | Promise<void>;
  variant: DialogVariant;
}

interface UseDialogReturn {
  dialogProps: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    description: string;
    onConfirm?: () => void | Promise<void>;
    variant: DialogVariant;
  };
  showDialog: (options: {
    title: string;
    description: string;
    onConfirm?: () => void | Promise<void>;
    variant?: DialogVariant;
  }) => void;
  hideDialog: () => void;
}

export function useDialog(): UseDialogReturn {
  const [state, setState] = useState<UseDialogState>({
    isOpen: false,
    title: '',
    description: '',
    variant: 'default',
  });

  const showDialog = useCallback(
    (options: {
      title: string;
      description: string;
      onConfirm?: () => void | Promise<void>;
      variant?: DialogVariant;
    }) => {
      setState({
        isOpen: true,
        title: options.title,
        description: options.description,
        onConfirm: options.onConfirm,
        variant: options.variant || 'default',
      });
    },
    []
  );

  const hideDialog = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return {
    dialogProps: {
      isOpen: state.isOpen,
      onClose: hideDialog,
      title: state.title,
      description: state.description,
      onConfirm: state.onConfirm,
      variant: state.variant,
    },
    showDialog,
    hideDialog,
  };
}
