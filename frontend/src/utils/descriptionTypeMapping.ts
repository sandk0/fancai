import type { CachedDescription } from '@/services/db'
import type { DescriptionType } from '@/types/api'

export const API_TO_CACHE_TYPE: Record<DescriptionType, CachedDescription['type']> = {
  location: 'setting',
  character: 'character',
  atmosphere: 'scene',
  object: 'object',
  action: 'action',
}

export const CACHE_TO_API_TYPE: Record<CachedDescription['type'], DescriptionType> = {
  setting: 'location',
  character: 'character',
  scene: 'atmosphere',
  object: 'object',
  action: 'action',
}

export const DEFAULT_CACHE_TYPE: CachedDescription['type'] = 'scene'
export const DEFAULT_API_TYPE: DescriptionType = 'atmosphere'
