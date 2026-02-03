import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import { logger } from '@/lib/logger';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  redirectTo?: string;
}

const AuthGuard: React.FC<AuthGuardProps> = ({
  children,
  requireAuth = true,
  redirectTo = '/login'
}) => {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    logger.debug('🛡️ AuthGuard mounted:', { isAuthenticated, isLoading, userEmail: user?.email });
    // ✅ FIX: Don't call loadUserFromStorage here - it's already called in onRehydrateStorage
    // This was causing infinite re-renders
  }, [isAuthenticated, isLoading, user?.email]);

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="large" text="Checking authentication..." />
      </div>
    );
  }

  // If authentication is required but user is not authenticated
  if (requireAuth && !isAuthenticated) {
    return (
      <Navigate 
        to={redirectTo} 
        state={{ from: location.pathname }} 
        replace 
      />
    );
  }

  // If authentication is not required but user is authenticated (login/register pages)
  if (!requireAuth && isAuthenticated) {
    const from = (location.state as { from?: string })?.from || '/library';
    return <Navigate to={from} replace />;
  }

  return <>{children}</>;
};

export default AuthGuard;