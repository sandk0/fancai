import { useState, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
} from 'lucide-react';
import { Input } from '@/components/UI/Input';
import { Button } from '@/components/UI/button';
import { Checkbox } from '@/components/UI/Checkbox';
import { PasswordStrengthIndicator } from './PasswordStrength';
import { cn } from '@/lib/utils';

type RegisterFormData = z.infer<ReturnType<typeof createRegisterSchema>>;

function createRegisterSchema(t: (key: string) => string) {
  return z
    .object({
      fullName: z.string().min(2, t('register.validation.name_min')),
      email: z.string().email(t('register.validation.email_invalid')),
      password: z
        .string()
        .min(12, t('register.validation.password_min'))
        .regex(/[a-z]/, t('register.validation.password_lowercase'))
        .regex(/[A-Z]/, t('register.validation.password_uppercase'))
        .regex(/\d/, t('register.validation.password_digit'))
        .regex(/[^a-zA-Z0-9]/, t('register.validation.password_special')),
      confirmPassword: z.string().min(1, t('register.validation.confirm_required')),
      acceptTerms: z.boolean().refine((val) => val === true, {
        message: t('register.validation.terms_required'),
      }),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('register.validation.passwords_mismatch'),
      path: ['confirmPassword'],
    });
}

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

interface RegistrationFormProps {
  onSubmit: (data: { email: string; password: string; fullName: string }) => Promise<void>;
  isLoading: boolean;
  /**
   * Ошибка от сервера (занятый email и т.п.). Приходит сверху: сам запрос
   * делает страница, а показывать отказ надо здесь, рядом с полями.
   */
  submitError?: string | null;
}

export function RegistrationForm({ onSubmit, isLoading, submitError }: RegistrationFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { t } = useTranslation();

  const registerSchema = useMemo(() => createRegisterSchema(t), [t]);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, touchedFields },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    mode: 'onBlur',
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
    },
  });

  const password = watch('password');

  // Один видимый блок на обе категории отказа: zod-валидация и ответ сервера.
  // До этого валидация жила в sr-only, а серверная ошибка — только в тосте.
  const formError =
    errors.fullName?.message ??
    errors.email?.message ??
    errors.password?.message ??
    errors.confirmPassword?.message ??
    errors.acceptTerms?.message ??
    submitError ??
    null;

  const handleFormSubmit = async (data: RegisterFormData) => {
    await onSubmit({ email: data.email, password: data.password, fullName: data.fullName });
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      {formError && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="register-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </div>
      )}

      <Input
        {...register('fullName')}
        label={t('register.name_label')}
        placeholder={t('register.name_placeholder')}
        leftIcon={<User />}
        error={errors.fullName?.message}
        inputSize="md"
        autoComplete="name"
        required
        data-testid="register-fullname"
      />

      <Input
        {...register('email')}
        type="email"
        label={t('register.email_label')}
        placeholder="your@email.com"
        leftIcon={<Mail />}
        error={errors.email?.message}
        inputSize="md"
        autoComplete="email"
        required
        data-testid="register-email"
      />

      <div>
        <Input
          {...register('password')}
          type={showPassword ? 'text' : 'password'}
          label={t('register.password_label')}
          placeholder={t('register.password_placeholder')}
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
          data-testid="register-password"
        />
        <PasswordStrengthIndicator password={password || ''} />
      </div>

      <Input
        {...register('confirmPassword')}
        type={showConfirmPassword ? 'text' : 'password'}
        label={t('register.confirm_password_label')}
        placeholder={t('register.confirm_password_placeholder')}
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
        data-testid="register-confirm-password"
      />

      <Controller
        name="acceptTerms"
        control={control}
        render={({ field }) => (
          <Checkbox
            checked={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            label={t('register.accept_terms')}
            variant={errors.acceptTerms ? 'error' : 'default'}
            errorMessage={errors.acceptTerms?.message}
            required
            data-testid="register-terms"
          />
        )}
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        isLoading={isLoading}
        loadingText={t('register.submitting')}
        className="w-full mt-6"
        disabled={isLoading}
        data-testid="register-submit"
      >
        {t('register.submit')}
      </Button>
    </form>
  );
}
