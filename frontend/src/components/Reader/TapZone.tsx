import React from 'react';

interface TapZoneProps {
  testId: string;
  style: React.CSSProperties;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  ariaLabel: string;
  role?: string;
}

export const TapZone: React.FC<TapZoneProps> = ({
  testId,
  style,
  onTouchStart,
  onTouchEnd,
  onClick,
  ariaLabel,
  role = 'button',
}) => (
  <div
    data-testid={testId}
    style={style}
    onTouchStart={onTouchStart}
    onTouchEnd={onTouchEnd}
    onClick={onClick}
    aria-label={ariaLabel}
    role={role}
    tabIndex={-1}
  />
);
