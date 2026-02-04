/**
 * NotFoundPage - Modern 404 page with gradient design
 *
 * Features:
 * - Large animated 404 text
 * - Gradient effects
 * - Quick navigation links
 * - Search suggestion
 * - Fully theme-aware (uses semantic CSS classes)
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Library, Upload, Search, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageMeta } from '@/components/SEO/PageMeta';

const NotFoundPage: React.FC = () => {
   const { t } = useTranslation();
   const navigate = useNavigate();

   const quickLinks = [
     {
       icon: Home,
       label: t('notFound.home'),
       path: '/',
       color: 'text-blue-600',
     },
     {
       icon: Library,
       label: t('notFound.library'),
       path: '/library',
       color: 'text-purple-600',
     },
     {
       icon: Upload,
       label: t('notFound.upload'),
       onClick: () => {
         navigate('/library');
         // TODO: trigger upload modal
       },
       color: 'text-green-600',
     },
   ];

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <PageMeta title={t('notFound.page_title')} description={t('notFound.page_description')} />
      <div className="max-w-2xl mx-auto text-center">
        {/* 404 Animation */}
        <div className="relative mb-8">
          {/* Gradient Background */}
          <div className="absolute inset-0 blur-3xl opacity-30 bg-gradient-radial from-primary to-transparent" />

          {/* 404 Text */}
          <h1 className="relative text-7xl sm:text-9xl md:text-[12rem] font-black mb-4 bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent">
            404
          </h1>
        </div>

         {/* Title */}
         <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">
           {t('notFound.title')}
         </h2>

         {/* Description */}
         <p className="text-lg mb-8 text-muted-foreground">
           {t('notFound.description')}
         </p>

         {/* Search Box */}
         <div className="max-w-md mx-auto mb-12">
           <div className="relative">
             <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
             <input
               type="text"
               placeholder={t('notFound.search_placeholder')}
               className="w-full pl-12 pr-4 py-3 rounded-xl border-2 transition-all focus:outline-hidden focus:ring-2 bg-background border-border text-foreground focus:ring-ring"
               onKeyDown={(e) => {
                 if (e.key === 'Enter' && e.currentTarget.value) {
                   navigate(`/library?search=${encodeURIComponent(e.currentTarget.value)}`);
                 }
               }}
             />
           </div>
           <p className="text-xs mt-2 text-muted-foreground">
             {t('notFound.search_hint')}
           </p>
         </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {quickLinks.map((link, index) => (
            <button
              key={index}
              onClick={() => (link.onClick ? link.onClick() : navigate(link.path!))}
              className={cn(
                'group p-6 rounded-xl border-2 transition-all hover:scale-105 hover:shadow-lg',
                'bg-background border-border'
              )}
            >
              <link.icon className={cn('w-8 h-8 mx-auto mb-3', link.color)} />
              <div className="font-semibold text-foreground">{link.label}</div>
            </button>
          ))}
        </div>

         {/* Back to Home Button */}
         <button
           onClick={() => navigate('/')}
           className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-semibold text-lg transition-all hover:scale-105 shadow-lg bg-primary text-primary-foreground hover:bg-primary/90"
         >
           <Home className="w-5 h-5" />
           <span>{t('notFound.go_home')}</span>
           <ArrowRight className="w-5 h-5" />
         </button>

         {/* Help Text */}
         <p className="mt-8 text-sm text-muted-foreground">
           {t('notFound.help_text')}{' '}
           <button
             onClick={() => navigate('/settings')}
             className="underline hover:no-underline text-primary"
           >
             {t('notFound.contact_support')}
           </button>
         </p>
      </div>
    </div>
  );
};

export default NotFoundPage;
