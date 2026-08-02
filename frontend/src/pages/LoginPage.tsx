/**
 * LoginPage - Mobile-first centered login form
 *
 * Features:
 * - Mobile-first centered design
 * - Touch-friendly inputs (44px minimum)
 * - Password visibility toggle
 * - Loading state on submit button
 * - Error handling with toast notifications
 * - Uses CSS custom properties from Phase 1
 */

import React, { useState, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Mail, Lock, Eye, EyeOff, BookOpen } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/utils/errors';
import { notify } from '@/stores/ui';
import { Input } from '@/components/UI/Input';
import { Button } from '@/components/UI/button';
import { PageMeta } from '@/components/SEO/PageMeta';

function createLoginSchema(t: (key: string) => string) {
  return z.object({
    email: z.string().email(t('login.validation.email_invalid')),
    password: z.string().min(6, t('login.validation.password_min')),
  });
}

type LoginFormData = z.infer<ReturnType<typeof createLoginSchema>>;

const LoginPage: React.FC = () => {
  const [showPassword, setShowPassword] = useState(false);
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const loginSchema = useMemo(() => createLoginSchema(t), [t]);

  const from = (location.state as { from?: string })?.from || '/library';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      await login(data.email, data.password);
      notify.success(t('login.success_title'), t('login.success_message'));
      navigate(from, { replace: true });
    } catch (error) {
      notify.error(t('login.error_title'), getErrorMessage(error, t('login.error_fallback')));
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword((prev) => !prev);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8 bg-background pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2rem)]"
    >
      <PageMeta title={t('login.page_title')} description={t('login.page_description')} />
      <div className="w-full max-w-sm">
        {/* Logo/Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-xl mb-4 bg-accent-600">
            <BookOpen className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="fluid-h2 font-bold text-foreground">
            fancai
          </h1>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-center mb-6 text-foreground">
          {t('login.title')}
        </h2>

        {/* Login Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Screen reader announcement for form errors */}
          <div role="alert" aria-live="assertive" className="sr-only">
            {errors.email && <span>{errors.email.message}</span>}
            {errors.password && <span>{errors.password.message}</span>}
          </div>

          {/* Email Input */}
          <Input
            {...register('email')}
            type="email"
            label={t('login.email_label')}
            placeholder="your@email.com"
            leftIcon={<Mail />}
            error={errors.email?.message}
            autoComplete="email"
            inputSize="md"
            required
          />

          {/* Password Input */}
          <Input
            {...register('password')}
            type={showPassword ? 'text' : 'password'}
            label={t('login.password_label')}
            placeholder="********"
            leftIcon={<Lock />}
            error={errors.password?.message}
            autoComplete="current-password"
            inputSize="md"
            required
            rightIcon={
              <button
                type="button"
                onClick={togglePasswordVisibility}
                className="flex items-center justify-center focus:outline-hidden text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showPassword ? t('login.hide_password') : t('login.show_password')}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            }
          />

          {/* Forgot Password Link */}
          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-sm font-medium transition-colors hover:underline text-primary"
            >
              {t('login.forgot_password')}
            </Link>
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            isLoading={isLoading}
            loadingText={t('login.submitting')}
          >
            {t('login.submit')}
          </Button>
        </form>

        {/* Register Link */}
        <p className="mt-8 text-center text-sm text-muted-foreground">
          {t('login.no_account')}{' '}
          <Link
            to="/register"
            className="font-semibold transition-colors hover:underline text-primary"
          >
            {t('login.register_link')}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
