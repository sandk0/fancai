import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';

type PasswordStrengthLevel = 'weak' | 'medium' | 'strong';

interface PasswordCriteria {
  minLength: boolean;
  hasLowercase: boolean;
  hasUppercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

function getPasswordStrength(password: string): {
  strength: PasswordStrengthLevel;
  criteria: PasswordCriteria;
  score: number;
} {
  const criteria: PasswordCriteria = {
    minLength: password.length >= 12,
    hasLowercase: /[a-z]/.test(password),
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecial: /[^a-zA-Z0-9]/.test(password),
  };

  const score = Object.values(criteria).filter(Boolean).length;

  let strength: PasswordStrengthLevel;
  if (score <= 2) {
    strength = 'weak';
  } else if (score <= 4) {
    strength = 'medium';
  } else {
    strength = 'strong';
  }

  return { strength, criteria, score };
}

interface PasswordStrengthIndicatorProps {
  password: string;
}

export function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
  const { t } = useTranslation();
  const { strength, criteria, score } = useMemo(
    () => getPasswordStrength(password),
    [password]
  );

  if (!password) return null;

  const strengthConfig = {
    weak: {
      label: t('register.strength.weak'),
      barClass: 'bg-destructive',
      textClass: 'text-destructive',
    },
    medium: {
      label: t('register.strength.medium'),
      barClass: 'bg-warning',
      textClass: 'text-warning',
    },
    strong: {
      label: t('register.strength.strong'),
      barClass: 'bg-success',
      textClass: 'text-success',
    },
  };

  const config = strengthConfig[strength];

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-1">
        {[1, 2, 3].map((level) => (
          <div
            key={level}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              score >= level * 2 - 1 || (level === 1 && score >= 1)
                ? config.barClass
                : 'bg-border'
            }`}
          />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${config.textClass}`}>
          {config.label}
        </span>
      </div>

      <div className="grid grid-cols-1 xs:grid-cols-2 gap-1 xs:gap-1.5">
        <CriteriaItem met={criteria.minLength} label={t('register.criteria.min_length')} />
        <CriteriaItem met={criteria.hasNumber} label={t('register.criteria.digit')} />
        <CriteriaItem met={criteria.hasLowercase} label={t('register.criteria.lowercase')} />
        <CriteriaItem met={criteria.hasSpecial} label={t('register.criteria.special')} />
        <CriteriaItem met={criteria.hasUppercase} label={t('register.criteria.uppercase')} />
      </div>
    </div>
  );
}

function CriteriaItem({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {met ? (
        <Check className="size-3.5 shrink-0 text-success" />
      ) : (
        <X className="size-3.5 shrink-0 text-muted-foreground/50" />
      )}
      <span className={`text-xs ${met ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
        {label}
      </span>
    </div>
  );
}
