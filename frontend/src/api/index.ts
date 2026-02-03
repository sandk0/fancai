// Main API exports

export { apiClient as default } from './client';
export { authAPI } from './auth';
export { booksAPI } from './books';
export { descriptionsAPI } from './descriptions';
export { healthAPI } from './health';
export { imagesAPI } from './images';
export { pushAPI } from './push';
export { readingSessionsAPI } from './readingSessions';

// Re-export client for direct usage
export { apiClient } from './client';