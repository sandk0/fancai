import React from 'react';

export const WebSocketStatus: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <div className="w-2 h-2 rounded-full bg-gray-500" />
      <span className="text-xs text-muted-foreground">Disabled</span>
    </div>
  );
};
