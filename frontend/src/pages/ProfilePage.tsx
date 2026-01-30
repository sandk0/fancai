 
/**
 * ProfilePage - Modern redesign with shadcn UI components
 *
 * Features:
 * - Gradient hero section with large avatar
 * - User stats cards (books read, time spent, achievements)
 * - Editable profile information
 * - Reading goals tracking
 * - Subscription plan info
 * - Fully theme-aware (Light/Dark/Sepia)
 * - Responsive design
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/utils/errors';
import {
  User,
  Mail,
  Calendar,
  Shield,
  BookOpen,
  Clock,
  Award,
  Edit2,
  Save,
  X,
  Camera,
  Sparkles,
  TrendingUp,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { booksAPI } from '@/api/books';
import { authAPI } from '@/api/auth';
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import toast from 'react-hot-toast';

// Helper function to calculate achievements
function calculateAchievements(totalBooks: number, streak: number) {
  let earned = 0;
  if (totalBooks >= 1) earned++; // First book
  if (streak >= 7) earned++; // 7 day streak
  if (totalBooks >= 10) earned++; // 10 books
  // Add more achievement logic as needed
  return { earned, total: 6 };
}

const ProfilePage: React.FC = () => {
   const { t } = useTranslation();
   const { user } = useAuthStore();
   const queryClient = useQueryClient();
   const [isEditing, setIsEditing] = useState(false);
   const [editedName, setEditedName] = useState(user?.full_name || '');

  // Fetch user statistics
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['user-statistics'],
    queryFn: () => booksAPI.getUserStatistics(),
  });

   // Update profile mutation
   const updateProfileMutation = useMutation({
     mutationFn: (data: { full_name?: string }) => authAPI.updateProfile(data),
     onSuccess: () => {
       toast.success(t('profile.update_success'));
       queryClient.invalidateQueries({ queryKey: ['current-user'] });
       setIsEditing(false);
     },
     onError: (error: Error | { response?: { data?: { detail?: string } } }) => {
       toast.error(getErrorMessage(error, t('profile.update_error')));
     },
   });

   // Calculate stats from API data
   const stats = useMemo(() => {
     if (!statsData?.statistics) {
       return [
         { label: t('profile.stats.books_read'), value: '0', icon: BookOpen, color: 'text-primary' },
         { label: t('profile.stats.hours_reading'), value: '0', icon: Clock, color: 'text-primary' },
         { label: t('profile.stats.achievements'), value: '0', icon: Award, color: 'text-primary' },
       ];
     }

     const s = statsData.statistics;
     const totalHours = Math.round((s.total_reading_time_minutes || 0) / 60);
     const achievements = calculateAchievements(s.total_books || 0, s.reading_streak_days || 0);

     return [
       { label: t('profile.stats.books_read'), value: String(s.total_books || 0), icon: BookOpen, color: 'text-primary' },
       { label: t('profile.stats.hours_reading'), value: String(totalHours), icon: Clock, color: 'text-primary' },
       { label: t('profile.stats.achievements'), value: String(achievements.earned), icon: Award, color: 'text-primary' },
     ];
   }, [statsData, t]);

   // Calculate reading goals
   const readingGoals = useMemo(() => {
     if (!statsData?.statistics) {
       return [
         { label: t('profile.goals.monthly'), current: 0, target: 5, unit: t('profile.units.books') },
         { label: t('profile.goals.daily'), current: 0, target: 60, unit: t('profile.units.minutes') },
       ];
     }

     const s = statsData.statistics;
     const booksInProgress = s.books_in_progress || 0;
     // Используем унифицированную метрику из API
     // Формула на бэкенде: total_minutes / days_with_reading_activity
     const avgMinutesPerDay = s.avg_minutes_per_day || 0;

     return [
       { label: t('profile.goals.monthly'), current: booksInProgress, target: 5, unit: t('profile.units.books') },
       { label: t('profile.goals.daily'), current: avgMinutesPerDay, target: 60, unit: t('profile.units.minutes') },
     ];
   }, [statsData, t]);

  const handleSave = () => {
    if (editedName.trim() && editedName !== user?.full_name) {
      updateProfileMutation.mutate({ full_name: editedName.trim() });
    } else {
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditedName(user?.full_name || '');
    setIsEditing(false);
  };

   if (statsLoading) {
     return (
       <div className="flex items-center justify-center min-h-64">
         <LoadingSpinner size="lg" text={t('profile.loading')} />
       </div>
     );
   }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Hero Section with Avatar */}
      <div className="relative mb-12 overflow-hidden rounded-xl">
        {/* Gradient Background */}
        <div className="absolute inset-0 opacity-50 bg-gradient-to-br from-primary to-primary/50" />

        {/* Content */}
        <div className="relative px-8 py-12">
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Avatar */}
            <div className="relative group">
              <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full flex items-center justify-center border-4 border-white/20 shadow-2xl transition-transform group-hover:scale-105 bg-primary">
                <span className="text-5xl font-bold text-primary-foreground">
                  {user?.full_name ? user.full_name.charAt(0).toUpperCase() : user?.email.charAt(0).toUpperCase()}
                </span>
              </div>

              {/* Upload Avatar Button */}
              <button
                className="absolute bottom-0 right-0 p-2 rounded-full bg-card border border-border shadow-lg transition-all hover:scale-110 min-h-[44px] min-w-[44px] flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => console.log('Upload avatar')}
                aria-label="Upload profile photo"
              >
                <Camera className="w-5 h-5 text-primary" aria-hidden="true" />
              </button>
            </div>

            {/* User Info */}
            <div className="flex-1 text-center md:text-left">
              {isEditing ? (
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="text-3xl font-bold px-4 py-2 rounded-xl border-2 bg-background border-primary text-foreground"
                  />
                  <button
                    onClick={handleSave}
                    className="p-2 rounded-lg transition-all hover:scale-110 bg-primary min-h-[44px] min-w-[44px] flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label="Save name"
                  >
                    <Save className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
                  </button>
                  <button
                    onClick={handleCancel}
                    className="p-2 rounded-lg border-2 transition-all hover:scale-110 bg-background border-border min-h-[44px] min-w-[44px] flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label="Cancel editing"
                  >
                    <X className="w-5 h-5 text-foreground" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 mb-3 justify-center md:justify-start">
                  <h1 className="fluid-h2 font-bold text-primary-foreground">
                    {user?.full_name || 'User'}
                  </h1>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
                    aria-label="Edit name"
                  >
                    <Edit2 className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="flex flex-col md:flex-row gap-4 text-primary-foreground/90 mb-4">
                <div className="flex items-center gap-2 justify-center md:justify-start min-w-0">
                  <Mail className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate max-w-[200px] sm:max-w-none">{user?.email}</span>
                </div>
                <div className="flex items-center gap-2 justify-center md:justify-start">
                  <Calendar className="w-4 h-4" />
                  <span>Зарегистрирован: {new Date().toLocaleDateString('ru-RU')}</span>
                </div>
              </div>

               {/* Subscription Badge */}
               <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/20 backdrop-blur-sm">
                 <Sparkles className="w-4 h-4 text-yellow-300" />
                 <span className="font-semibold text-primary-foreground">{t('profile.plan_free')}</span>
                 {user?.is_admin && (
                   <>
                     <div className="w-1 h-1 rounded-full bg-white/50" />
                     <Shield className="w-4 h-4 text-green-300" />
                     <span className="font-semibold text-primary-foreground">{t('profile.admin')}</span>
                   </>
                 )}
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {stats.map((stat, index) => (
          <div
            key={index}
            className="p-6 rounded-xl border-2 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl bg-card border-border"
          >
            <div className="flex items-center justify-between mb-4">
              <stat.icon className={cn('w-10 h-10', stat.color)} />
              <span className="text-3xl font-bold text-foreground">
                {stat.value}
              </span>
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {stat.label}
            </p>
          </div>
        ))}
      </div>

       {/* Reading Goals */}
       <div className="mb-12">
         <div className="flex items-center gap-3 mb-6">
           <Target className="w-6 h-6 text-primary" />
           <h2 className="fluid-h3 font-bold text-foreground">
             {t('profile.goals_title')}
           </h2>
         </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {readingGoals.map((goal, index) => (
            <div
              key={index}
              className="p-6 rounded-xl border-2 bg-card border-border"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-foreground">
                  {goal.label}
                </h3>
                <span className="text-sm font-medium text-muted-foreground">
                  {goal.current} / {goal.target} {goal.unit}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="relative h-3 rounded-full overflow-hidden bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-primary"
                  style={{
                    width: `${(goal.current / goal.target) * 100}%`,
                  }}
                />
              </div>

               <div className="mt-2 flex items-center gap-2">
                 <TrendingUp className="w-4 h-4 text-primary" />
                 <span className="text-sm text-muted-foreground">
                   {Math.round((goal.current / goal.target) * 100)}% {t('profile.completed')}
                 </span>
               </div>
            </div>
          ))}
        </div>
      </div>

       {/* Profile Information */}
       <div className="p-8 rounded-xl border-2 bg-card border-border">
         <div className="flex items-center gap-3 mb-6">
           <User className="w-6 h-6 text-primary" />
           <h2 className="fluid-h3 font-bold text-foreground">
             {t('profile.info_title')}
           </h2>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
           {/* Full Name */}
           <div>
             <label className="block text-sm font-medium mb-2 text-muted-foreground">
               {t('profile.full_name')}
             </label>
             <div className="px-4 py-3 rounded-xl border-2 bg-muted border-border text-foreground">
               {user?.full_name || t('profile.not_specified')}
             </div>
           </div>

           {/* Email */}
           <div>
             <label className="block text-sm font-medium mb-2 text-muted-foreground">
               {t('profile.email')}
             </label>
             <div className="px-4 py-3 rounded-xl border-2 bg-muted border-border text-foreground truncate">
               {user?.email}
             </div>
           </div>

           {/* Account Type */}
           <div>
             <label className="block text-sm font-medium mb-2 text-muted-foreground">
               {t('profile.account_type')}
             </label>
             <div className="px-4 py-3 rounded-xl border-2 bg-muted border-border text-foreground">
               {user?.is_admin ? t('profile.admin_role') : t('profile.user_role')}
             </div>
           </div>

           {/* Member Since */}
           <div>
             <label className="block text-sm font-medium mb-2 text-muted-foreground">
               {t('profile.registration_date')}
             </label>
             <div className="px-4 py-3 rounded-xl border-2 bg-muted border-border text-foreground">
               {new Date().toLocaleDateString('ru-RU', {
                 year: 'numeric',
                 month: 'long',
                 day: 'numeric'
               })}
             </div>
           </div>
         </div>
       </div>
    </div>
  );
};

export default ProfilePage;
