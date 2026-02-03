export const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

export const scaleOnHover = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
};

export function getGreeting(t: (key: string) => string): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return t('home.greeting_morning');
  if (hour >= 12 && hour < 17) return t('home.greeting_afternoon');
  if (hour >= 17 && hour < 22) return t('home.greeting_evening');
  return t('home.greeting_night');
}
