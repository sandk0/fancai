import React from 'react';

interface TapFeedbackProps {
  debugTapInfo: string | null;
  navigationEnabled: boolean;
  zoneWidthPercent: number;
  isStandalone: boolean;
}

export const TapFeedback: React.FC<TapFeedbackProps> = ({
  debugTapInfo,
  navigationEnabled,
  zoneWidthPercent,
  isStandalone,
}) => {
  if (!import.meta.env.DEV) return null;

  return (
    <>
      {debugTapInfo && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: debugTapInfo.startsWith('ERROR') ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 128, 0, 0.9)',
            color: 'white',
            padding: '12px 20px',
            borderRadius: 8,
            fontSize: 16,
            fontWeight: 'bold',
            zIndex: 99999,
            pointerEvents: 'none',
          }}
        >
          {debugTapInfo}
        </div>
      )}

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
        iOS {navigationEnabled ? `${zoneWidthPercent}%+Tap` : 'Swipe+Center'} {isStandalone ? '[PWA]' : '[Safari]'}
      </div>
    </>
  );
};
