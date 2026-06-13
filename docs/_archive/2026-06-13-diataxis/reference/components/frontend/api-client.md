# API Client - BookReader AI

TypeScript клиент для взаимодействия с REST API BookReader AI. Обеспечивает типобезопасность, автоматическое обновление токенов и обработку ошибок.

## Архитектура клиента

### Основные возможности
- **Автоматическая аутентификация** с JWT токенами
- **Типизированные запросы** и ответы
- **Error handling** с retry логикой
- **Request/Response interceptors**
- **File upload** с progress tracking

### Структура
```
APIClient (базовый класс)
├── AuthAPI → аутентификация
├── BooksAPI → управление книгами
├── ImagesAPI → генерация изображений
├── NLPAPI → NLP обработка
└── UsersAPI → профили пользователей
```

---

## Базовый APIClient

**Файл:** `frontend/src/api/client.ts`

```typescript
class APIClient {
  private baseURL: string;
  private axios: AxiosInstance;
  private tokenRefreshPromise: Promise<boolean> | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.axios = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor - добавляем токен
    this.axios.interceptors.request.use((config) => {
      const token = useAuthStore.getState().accessToken;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Response interceptor - обработка ошибок и refresh токенов
    this.axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          // Попытка обновления токена
          if (!this.tokenRefreshPromise) {
            this.tokenRefreshPromise = this.refreshTokens();
          }

          const refreshSuccess = await this.tokenRefreshPromise;
          this.tokenRefreshPromise = null;

          if (refreshSuccess) {
            // Повторяем оригинальный запрос
            const newToken = useAuthStore.getState().accessToken;
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return this.axios(originalRequest);
          }
        }

        return Promise.reject(this.handleAPIError(error));
      }
    );
  }

  private async refreshTokens(): Promise<boolean> {
    try {
      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) return false;

      const response = await axios.post(`${this.baseURL}/auth/refresh`, {
        refresh_token: refreshToken
      });

      const { access_token, refresh_token } = response.data;
      
      useAuthStore.setState({
        accessToken: access_token,
        refreshToken: refresh_token
      });

      return true;
    } catch (error) {
      useAuthStore.getState().logout();
      return false;
    }
  }

  private handleAPIError(error: AxiosError): APIError {
    const response = error.response;
    
    return {
      status: response?.status || 0,
      code: response?.data?.error?.code || 'UNKNOWN_ERROR',
      message: response?.data?.error?.message || error.message,
      details: response?.data?.error?.details
    };
  }
}
```

---

## Специализированные API классы

### BooksAPI
```typescript
export class BooksAPI {
  constructor(private client: APIClient) {}

  async getBooks(params: BookFilters): Promise<BooksResponse> {
    const response = await this.client.get<BooksResponse>('/books', { params });
    return response.data;
  }

  async uploadBook(file: File, onProgress?: (progress: number) => void): Promise<Book> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.client.post<{book: Book}>('/books/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = (progressEvent.loaded / progressEvent.total) * 100;
          onProgress(Math.round(progress));
        }
      }
    });

    return response.data.book;
  }

  async getBookContent(bookId: string, chapter: number): Promise<ChapterContent> {
    const response = await this.client.get<ChapterContent>(
      `/books/${bookId}/chapters/${chapter}`
    );
    return response.data;
  }

  // NEW (October 2025): Get EPUB file for epub.js
  async getBookFile(bookId: string): Promise<ArrayBuffer> {
    const response = await this.client.get(`/books/${bookId}/file`, {
      responseType: 'arraybuffer',
      headers: {
        'Accept': 'application/epub+zip'
      }
    });
    return response.data;
  }

  // Helper to get file URL (for fetch with auth)
  getBookFileUrl(bookId: string): string {
    return `${this.client.baseURL}/books/${bookId}/file`;
  }

  // NEW (October 2025): Reading Progress with CFI support
  async getReadingProgress(bookId: string): Promise<ReadingProgress> {
    const response = await this.client.get<{progress: ReadingProgress}>(
      `/books/${bookId}/progress`
    );
    return response.data.progress;
  }

  // NEW (October 2025): Update progress with CFI and scroll offset
  async updateReadingProgress(
    bookId: string,
    data: {
      reading_location_cfi?: string;
      scroll_offset_percent?: number;
      current_position?: number;
      current_chapter?: number;
      reading_time_minutes?: number;
    }
  ): Promise<ReadingProgress> {
    const response = await this.client.put<{progress: ReadingProgress}>(
      `/books/${bookId}/progress`,
      data
    );
    return response.data.progress;
  }

  // DEPRECATED: Old progress update (pre-October 2025)
  async updateProgress(bookId: string, progress: ReadingProgress): Promise<ReadingProgress> {
    console.warn('updateProgress is deprecated. Use updateReadingProgress instead.');
    const response = await this.client.post<{progress: ReadingProgress}>(
      `/books/${bookId}/progress`,
      progress
    );
    return response.data.progress;
  }

  // NEW (October 2025): Get book locations for progress calculation
  async getBookLocations(bookId: string): Promise<number> {
    const response = await this.client.get<{percentage: number}>(
      `/books/${bookId}/locations`
    );
    return response.data.percentage;
  }

  // NEW (October 2025): Get chapter descriptions with NLP analysis
  async getChapterDescriptions(
    bookId: string,
    chapterNumber: number,
    extract: boolean = false
  ): Promise<ChapterDescriptionsResponse> {
    const response = await this.client.get<ChapterDescriptionsResponse>(
      `/books/${bookId}/chapters/${chapterNumber}/descriptions`,
      { params: { extract } }
    );
    return response.data;
  }
}
```

### ImagesAPI
```typescript
export class ImagesAPI {
  constructor(private client: APIClient) {}

  async generateImage(descriptionId: string, options?: GenerationOptions): Promise<GenerationTask> {
    const response = await this.client.post<{task: GenerationTask}>(
      `/images/generate/description/${descriptionId}`,
      options
    );
    return response.data.task;
  }

  async getBookImages(bookId: string, filters?: ImageFilters): Promise<ImagesResponse> {
    const response = await this.client.get<ImagesResponse>(
      `/images/book/${bookId}`,
      { params: filters }
    );
    return response.data;
  }

  async getGenerationStatus(): Promise<GenerationStatus> {
    const response = await this.client.get<GenerationStatus>('/images/generation/status');
    return response.data;
  }
}
```

---

## TypeScript Types (October 2025 Updates)

### Reading Progress with CFI Support

```typescript
interface ReadingProgress {
  id: string;
  book_id: string;
  user_id: string;
  current_chapter: number;
  current_page: number;
  current_position: number;  // Updated: epub.js percentage (0-100)

  // NEW (October 2025): CFI fields for epub.js
  reading_location_cfi?: string;      // CFI string (e.g., "epubcfi(/6/4!/4/2/16/1:0)")
  scroll_offset_percent?: number;     // Fine-tuned scroll position (0-100)

  reading_time_minutes: number;
  reading_speed_wpm: number;
  last_read_at: string;
  created_at: string;
  updated_at: string;
}
```

### Chapter Descriptions Response

```typescript
interface ChapterDescriptionsResponse {
  chapter: {
    id: string;
    book_id: string;
    chapter_number: number;
    title: string;
  };
  nlp_analysis: {
    descriptions: Description[];
    total_descriptions: number;
    processing_time_ms: number;
  };
}

interface Description {
  id: string;
  chapter_id: string;
  type: 'location' | 'character' | 'atmosphere' | 'object';
  content: string;
  confidence_score: number;
  priority_score: number;
  text_position: number;
  created_at: string;
}
```

### Book File Response

```typescript
// EPUB file is returned as ArrayBuffer
type BookFileResponse = ArrayBuffer;

// Usage with epub.js:
const arrayBuffer: ArrayBuffer = await booksAPI.getBookFile(bookId);
const book = ePub(arrayBuffer);
```

---

## React Hooks для API

### useAPI Hook
```typescript
export const useAPI = () => {
  const apiClient = useMemo(() => {
    return new APIClient(process.env.REACT_APP_API_URL || '/api/v1');
  }, []);

  return {
    auth: new AuthAPI(apiClient),
    books: new BooksAPI(apiClient),
    images: new ImagesAPI(apiClient),
    users: new UsersAPI(apiClient),
    nlp: new NLPAPI(apiClient)
  };
};
```

### Query Hooks (React Query)
```typescript
export const useBooks = (filters: BookFilters) => {
  const { books: booksAPI } = useAPI();
  
  return useQuery({
    queryKey: ['books', filters],
    queryFn: () => booksAPI.getBooks(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useBookContent = (bookId: string, chapter: number) => {
  const { books: booksAPI } = useAPI();
  
  return useQuery({
    queryKey: ['book-content', bookId, chapter],
    queryFn: () => booksAPI.getBookContent(bookId, chapter),
    enabled: !!bookId && chapter > 0,
  });
};

export const useBookUpload = () => {
  const { books: booksAPI } = useAPI();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ file, onProgress }: { file: File; onProgress?: (progress: number) => void }) =>
      booksAPI.uploadBook(file, onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });
};
```

---

## Error Handling

### APIError Types
```typescript
interface APIError {
  status: number;
  code: string;
  message: string;
  details?: any;
}

const API_ERROR_MESSAGES: Record<string, string> = {
  'AUTHENTICATION_FAILED': 'Неверные учетные данные',
  'TOKEN_EXPIRED': 'Сессия истекла, требуется повторный вход',
  'QUOTA_EXCEEDED': 'Превышена квота вашего плана подписки',
  'FILE_TOO_LARGE': 'Файл слишком большой',
  'UNSUPPORTED_FORMAT': 'Неподдерживаемый формат файла'
};

export const getErrorMessage = (error: APIError): string => {
  return API_ERROR_MESSAGES[error.code] || error.message;
};
```

---

## WebSocket Integration

### Real-time Updates
```typescript
class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(token: string) {
    const wsUrl = `${process.env.REACT_APP_WS_URL}/ws?token=${token}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onclose = () => {
      this.handleReconnect();
    };
  }

  private handleMessage(message: WebSocketMessage) {
    switch (message.type) {
      case 'image_generation_complete':
        useImagesStore.getState().updateImageStatus(message.data);
        break;
      case 'book_processing_complete':
        useBooksStore.getState().updateBookStatus(message.data);
        break;
    }
  }
}
```

---

## Заключение

API клиент BookReader AI обеспечивает:

- **Типобезопасность** всех API взаимодействий
- **Автоматическое управление токенами** и аутентификацией
- **Graceful error handling** с retry механизмами
- **Performance optimizations** через React Query
- **Real-time updates** через WebSocket
- **Developer experience** с хуками и утилитами