import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { PageMeta } from '@/components/SEO/PageMeta';
import { notify } from '@/stores/ui';
import { getErrorMessage } from '@/utils/errors';
import { RegistrationForm } from '@/components/Auth/RegistrationForm';

const RegisterPage: React.FC = () => {
  const { register: registerUser, isLoading } = useAuthStore();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleRegister = async (data: { email: string; password: string; fullName: string }) => {
    setSubmitError(null);
    try {
      await registerUser(data.email, data.password, data.fullName);
      notify.success(t('register.success_title'), t('register.success_message'));
      navigate('/library', { replace: true });
    } catch (error) {
      const message = getErrorMessage(error, t('register.error_fallback'));
      // Форма показывает отказ рядом с полями: тост исчезает, а причина
      // («email занят») нужна ровно там, где её будут исправлять.
      setSubmitError(message);
      notify.error(t('register.error_title'), message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-muted pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      <PageMeta title={t('register.page_title')} description={t('register.page_description')} />
      <div className="w-full max-w-md rounded-xl p-6 sm:p-8 shadow-lg bg-background border border-border">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-xl mb-4 bg-accent-600">
            <BookOpen className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="fluid-h2 font-bold text-foreground">
            fancai
          </h1>
        </div>

        <div className="text-center mb-6">
          <h2 className="text-xl font-semibold mb-2 text-foreground">
            {t('register.title')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('register.subtitle')}
          </p>
        </div>

        <RegistrationForm onSubmit={handleRegister} isLoading={isLoading} submitError={submitError} />

        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t('register.has_account')}{' '}
            <Link
              to="/login"
              className="font-semibold text-primary transition-colors hover:underline"
              data-testid="login-link"
            >
              {t('register.login_link')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
