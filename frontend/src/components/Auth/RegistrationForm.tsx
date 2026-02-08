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
}

export function RegistrationForm({ onSubmit, isLoading }: RegistrationFormProps) {
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

  const handleFormSubmit = async (data: RegisterFormData) => {
    await onSubmit({ email: data.email, password: data.password, fullName: data.fullName });
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <div role="alert" aria-live="assertive" className="sr-only">
        {errors.fullName && <span>{errors.fullName.message}</span>}
        {errors.email && <span>{errors.email.message}</span>}
        {errors.password && <span>{errors.password.message}</span>}
        {errors.confirmPassword && <span>{errors.confirmPassword.message}</span>}
        {errors.acceptTerms && <span>{errors.acceptTerms.message}</span>}
      </div>

      <Input
        {...register('fullName')}
        label={t('register.name_label')}
        placeholder={t('register.name_placeholder')}
        leftIcon={<User />}
        error={errors.fullName?.message}
        inputSize="md"
        autoComplete="name"
        required
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
      >
        {t('register.submit')}
      </Button>
    </form>
  );
}
