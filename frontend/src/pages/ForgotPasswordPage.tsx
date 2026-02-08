import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Mail, BookOpen, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/UI/Input';
import { Button } from '@/components/UI/button';
import { PageMeta } from '@/components/SEO/PageMeta';
import { authAPI } from '@/api/auth';
import { getErrorMessage } from '@/utils/errors';
import { notify } from '@/stores/ui';

function createForgotPasswordSchema(t: (key: string) => string) {
  return z.object({
    email: z.string().email(t('login.validation.email_invalid')),
  });
}

type ForgotPasswordFormData = z.infer<ReturnType<typeof createForgotPasswordSchema>>;

const ForgotPasswordPage: React.FC = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation();

  const schema = useMemo(() => createForgotPasswordSchema(t), [t]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsLoading(true);
    try {
      await authAPI.requestPasswordReset(data.email);
      setIsSubmitted(true);
    } catch (error) {
      notify.error(
        t('forgot_password.title'),
        getErrorMessage(error, t('forgot_password.description'))
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-background pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      <PageMeta
        title={t('forgot_password.page_title')}
        description={t('forgot_password.page_description')}
      />
      <div className="w-full max-w-sm">
        {/* Logo/Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-xl mb-4 bg-accent-600">
            <BookOpen className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="fluid-h2 font-bold text-foreground">fancai</h1>
        </div>

        {isSubmitted ? (
          /* Success state */
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <CheckCircle2 className="w-12 h-12 text-success" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              {t('forgot_password.success_title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('forgot_password.success_description')}
            </p>
            <Link
              to="/login"
              className="inline-block mt-4 text-sm font-semibold text-primary hover:underline transition-colors"
            >
              {t('forgot_password.back_to_login')}
            </Link>
          </div>
        ) : (
          /* Form state */
          <>
            <h2 className="text-xl font-semibold text-center mb-2 text-foreground">
              {t('forgot_password.title')}
            </h2>
            <p className="text-sm text-muted-foreground text-center mb-6">
              {t('forgot_password.description')}
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div role="alert" aria-live="assertive" className="sr-only">
                {errors.email && <span>{errors.email.message}</span>}
              </div>

              <Input
                {...register('email')}
                type="email"
                label={t('forgot_password.email_label')}
                placeholder="your@email.com"
                leftIcon={<Mail />}
                error={errors.email?.message}
                autoComplete="email"
                inputSize="md"
                required
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                isLoading={isLoading}
                loadingText={t('forgot_password.submitting')}
              >
                {t('forgot_password.submit')}
              </Button>
            </form>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              <Link
                to="/login"
                className="font-semibold transition-colors hover:underline text-primary"
              >
                {t('forgot_password.back_to_login')}
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
