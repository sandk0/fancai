/**
 * AdminMultiNLPSettings - DEPRECATED
 *
 * NLP REMOVAL (December 2025):
 * Multi-NLP system removed for server optimization.
 * Description extraction now via LLM API (LangExtract/Gemini).
 *
 * RAM reduction: 10-12 GB → 2-3 GB
 * Docker image: 2.5 GB → 800 MB
 */

import React from 'react';
import { AlertTriangle, Cpu, ExternalLink } from 'lucide-react';
import type { MultiNLPSettings } from '@/api/admin';

// Re-export for backwards compatibility
export type { MultiNLPSettings };

interface AdminMultiNLPSettingsProps {
  settings: MultiNLPSettings | null;
  setSettings: (settings: MultiNLPSettings | null) => void;
  isLoading: boolean;
  onSave: (settings: MultiNLPSettings) => void;
  isSaving: boolean;
  t: (key: string) => string;
}

export const AdminMultiNLPSettings: React.FC<AdminMultiNLPSettingsProps> = ({
  t
}) => {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Deprecation Notice */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 sm:p-6">
        <div className="flex items-start gap-3 sm:gap-4">
          <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5 sm:mt-1" />
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-amber-800 dark:text-amber-200 mb-2">
              {t('admin.nlpRemovedTitle') || 'NLP System Removed'}
            </h3>
            <p className="text-sm sm:text-base text-amber-700 dark:text-amber-300 mb-3 sm:mb-4">
              {t('admin.nlpRemovedDescription') ||
                'The Multi-NLP system (SpaCy, Natasha, Stanza, GLiNER) has been removed in December 2025 for server optimization. Description extraction is now handled on-demand via LLM API (LangExtract/Google Gemini).'}
            </p>
            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3 sm:gap-4 text-sm">
              <div className="bg-green-100 dark:bg-green-900/30 rounded-lg p-3 min-w-0">
                <div className="font-medium text-green-800 dark:text-green-200 mb-1 truncate">
                  RAM Reduction
                </div>
                <div className="text-green-700 dark:text-green-300 text-xs sm:text-sm">
                  10-12 GB → 2-3 GB (-75%)
                </div>
              </div>
              <div className="bg-green-100 dark:bg-green-900/30 rounded-lg p-3 min-w-0">
                <div className="font-medium text-green-800 dark:text-green-200 mb-1 truncate">
                  Docker Image
                </div>
                <div className="text-green-700 dark:text-green-300 text-xs sm:text-sm">
                  2.5 GB → 800 MB (-68%)
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* LLM Extraction Info */}
      <div className="bg-card rounded-lg p-4 sm:p-6 shadow-xs border border-border">
        <h3 className="text-base sm:text-lg font-medium text-foreground mb-3 sm:mb-4 flex items-center gap-2">
          <Cpu className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
          {t('admin.llmExtractionTitle') || 'LLM-Based Extraction'}
        </h3>
        <div className="space-y-3 sm:space-y-4 text-sm sm:text-base text-muted-foreground">
          <p>
            {t('admin.llmExtractionInfo') ||
              'Descriptions are now extracted on-demand using Google Gemini API when a user navigates to a chapter. This approach:'}
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Reduces server RAM requirements significantly</li>
            <li>Provides higher quality extraction using state-of-the-art LLMs</li>
            <li>Supports Russian → English translation for image generation</li>
            <li>Costs approximately $0.02 per book</li>
          </ul>
          <div className="mt-4">
            <a
              href="https://ai.google.dev/gemini-api"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalLink className="w-4 h-4" />
              Learn more about Google Gemini API
            </a>
          </div>
        </div>
      </div>

      {/* Configuration Note */}
      <div className="bg-muted/50 rounded-lg p-3 sm:p-4 border border-border">
        <p className="text-xs sm:text-sm text-muted-foreground">
          <strong>Configuration:</strong> Set <code className="bg-secondary px-1 rounded-sm">GOOGLE_API_KEY</code> environment variable to enable LLM extraction.
        </p>
      </div>
    </div>
  );
};
