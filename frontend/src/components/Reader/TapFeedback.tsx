import React from 'react';

interface TapFeedbackProps {
  navigationEnabled: boolean;
  zoneWidthPercent: number;
  isStandalone: boolean;
}

export const TapFeedback: React.FC<TapFeedbackProps> = ({
  navigationEnabled,
  zoneWidthPercent,
  isStandalone,
}) => {
  if (!import.meta.env.DEV) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: navigationEnabled ? 'rgba(0, 128, 0, 0.8)' : 'rgba(59, 130, 246, 0.8)',
        color: 'white',
        padding: '6px 12px',
        borderRadius: 4,
        fontSize: 11,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      iOS {navigationEnabled ? `${zoneWidthPercent}%+Tap` : 'Swipe+Center'}{' '}
      {isStandalone ? '[PWA]' : '[Safari]'}
    </div>
  );
};
