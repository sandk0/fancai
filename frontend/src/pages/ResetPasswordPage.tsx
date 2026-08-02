import React, { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { Helmet } from 'react-helmet-async';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Lock, BookOpen, CheckCircle2, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/UI/Input';
import { Button } from '@/components/UI/button';
import { PageMeta } from '@/components/SEO/PageMeta';
import { PasswordStrengthIndicator } from '@/components/Auth/PasswordStrength';
import { authAPI } from '@/api/auth';
import { getErrorMessage } from '@/utils/errors';
import { notify } from '@/stores/ui';
import { cn } from '@/lib/utils';

function createResetPasswordSchema(t: (key: string) => string) {
  return z
    .object({
      password: z
        .string()
        .min(12, t('register.validation.password_min'))
        .regex(/[a-z]/, t('register.validation.password_lowercase'))
        .regex(/[A-Z]/, t('register.validation.password_uppercase'))
        .regex(/\d/, t('register.validation.password_digit'))
        .regex(/[^a-zA-Z0-9]/, t('register.validation.password_special')),
      confirmPassword: z.string().min(1, t('register.validation.confirm_required')),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('register.validation.passwords_mismatch'),
      path: ['confirmPassword'],
    });
}

type ResetPasswordFormData = z.infer<ReturnType<typeof createResetPasswordSchema>>;

function PasswordToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex items-center justify-center',
        'min-h-[44px] min-w-[44px]',
        'text-muted-foreground',
        'hover:text-foreground',
        'transition-colors duration-200',
        'focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2',
        'rounded-md'
      )}
      aria-label={show ? t('register.hide_password') : t('register.show_password')}
    >
      {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
    </button>
  );
}

const ResetPasswordPage: React.FC = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);
  const { t } = useTranslation();

  const token = useMemo(
    () => new URLSearchParams(window.location.search).get('token'),
    []
  );

  const schema = useMemo(() => createResetPasswordSchema(t), [t]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, touchedFields },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  const password = watch('password');

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) return;
    setIsLoading(true);
    try {
      await authAPI.resetPassword(token, data.password);
      setIsSuccess(true);
    } catch (error) {
      setIsError(true);
      notify.error(
        t('reset_password.invalid_token_title'),
        getErrorMessage(error, t('reset_password.invalid_token_description'))
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-background pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2rem)]">
      {/* OWASP: Prevent token leakage via Referer header */}
      <Helmet>
        <meta name="referrer" content="no-referrer" />
      </Helmet>
      <PageMeta
        title={t('reset_password.page_title')}
        description={t('reset_password.page_description')}
      />
      <div className="w-full max-w-sm">
        {/* Logo/Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-xl mb-4 bg-accent-600">
            <BookOpen className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="fluid-h2 font-bold text-foreground">fancai</h1>
        </div>

        {/* No token state */}
        {!token && (
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <AlertTriangle className="w-12 h-12 text-warning" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              {t('reset_password.no_token_title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('reset_password.no_token_description')}
            </p>
            <Link
              to="/forgot-password"
              className="inline-block mt-4 text-sm font-semibold text-primary hover:underline transition-colors"
            >
              {t('reset_password.request_new_link')}
            </Link>
          </div>
        )}

        {/* Success state */}
        {token && isSuccess && (
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <CheckCircle2 className="w-12 h-12 text-success" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              {t('reset_password.success_title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('reset_password.success_description')}
            </p>
            <Link
              to="/login"
              className="inline-block mt-4"
            >
              <Button variant="primary" size="lg" className="w-full">
                {t('reset_password.go_to_login')}
              </Button>
            </Link>
          </div>
        )}

        {/* Error state */}
        {token && isError && !isSuccess && (
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <AlertTriangle className="w-12 h-12 text-destructive" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              {t('reset_password.invalid_token_title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('reset_password.invalid_token_description')}
            </p>
            <Link
              to="/forgot-password"
              className="inline-block mt-4"
            >
              <Button variant="primary" size="lg" className="w-full">
                {t('reset_password.request_new_link')}
              </Button>
            </Link>
          </div>
        )}

        {/* Form state */}
        {token && !isSuccess && !isError && (
          <>
            <h2 className="text-xl font-semibold text-center mb-2 text-foreground">
              {t('reset_password.title')}
            </h2>
            <p className="text-sm text-muted-foreground text-center mb-6">
              {t('reset_password.description')}
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div role="alert" aria-live="assertive" className="sr-only">
                {errors.password && <span>{errors.password.message}</span>}
                {errors.confirmPassword && <span>{errors.confirmPassword.message}</span>}
              </div>

              <div>
                <Input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  label={t('reset_password.password_label')}
                  placeholder={t('reset_password.password_placeholder')}
                  leftIcon={<Lock />}
                  rightIcon={
                    <PasswordToggle
                      show={showPassword}
                      onToggle={() => setShowPassword(!showPassword)}
                    />
                  }
                  error={touchedFields.password && errors.password ? errors.password.message : undefined}
                  inputSize="md"
                  autoComplete="new-password"
                  required
                />
                <PasswordStrengthIndicator password={password || ''} />
              </div>

              <Input
                {...register('confirmPassword')}
                type={showConfirmPassword ? 'text' : 'password'}
                label={t('reset_password.confirm_label')}
                placeholder={t('reset_password.confirm_placeholder')}
                leftIcon={<Lock />}
                rightIcon={
                  <PasswordToggle
                    show={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
                  />
                }
                error={errors.confirmPassword?.message}
                inputSize="md"
                autoComplete="new-password"
                required
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full mt-6"
                isLoading={isLoading}
                loadingText={t('reset_password.submitting')}
              >
                {t('reset_password.submit')}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordPage;
