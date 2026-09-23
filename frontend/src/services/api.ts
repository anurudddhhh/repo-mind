// =============================================================================
// REPO-MIND FRONTEND — UNIFIED API SERVICE LAYER
// =============================================================================
// This is the SINGLE source of truth for all backend communication.
// NO component should ever call fetch() or axios directly (except for SSE
// streaming, which requires native fetch — see streamChat and startIndexing).
// =============================================================================

import { api, API_BASE_URL } from '@/lib/api';
import {
  ApiResponse,
  Repository,
  SearchResponse,
  ArchitectureSummary,
  BugDetectionResult,
  DocumentationResult,
  CommitAnalysis,
  User,
  IndexingProgress,
} from '@/types';
import { useAuthStore } from '@/store/useAuthStore';

// =============================================================================
// FILE TREE TYPES (for getRepositoryTree)
// =============================================================================
export interface TreeSymbol {
  name: string;
  type: string;
  lines: string;
}

export interface TreeFileItem {
  filePath: string;
  language: string;
  symbolsCount: number;
  symbols: TreeSymbol[];
}

export interface RepositoryTreeResponse {
  totalFiles: number;
  files: TreeFileItem[];
}

// =============================================================================
// AUTH API
// =============================================================================
export const authApi = {
  /**
   * Get the GitHub OAuth login URL.
   */
  getGithubLoginUrl: (): string => {
    return '/api/auth/github';
  },

  /**
   * Get the currently logged-in user's profile.
   * Returns null if not logged in or token is expired.
   */
  getMe: async (): Promise<User | null> => {
    try {
      const response = await api.get<ApiResponse<User>>('/api/auth/me');
      return response.data.data ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Log the user out by calling the backend and clearing local state.
   */
  logout: async (): Promise<void> => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      useAuthStore.getState().logout();
    }
  },

  /**
   * Get the stored JWT token from Zustand.
   */
  getToken: (): string | null => {
    return useAuthStore.getState().token;
  },
};

// =============================================================================
// REPOSITORY API
// =============================================================================
export const repositoryApi = {
  /**
   * Get all repositories the current user has indexed.
   */
  getRepositories: async (): Promise<Repository[]> => {
    const response = await api.get<ApiResponse<Repository[]>>('/api/repositories');
    return response.data.data ?? [];
  },

  /**
   * Delete a repository and all its associated data.
   */
  deleteRepository: async (repoId: string): Promise<void> => {
    await api.delete(`/api/repositories/${repoId}`);
  },
};

// =============================================================================
// INDEXING API
// =============================================================================
export const indexingApi = {
  /**
   * Start the indexing pipeline for a GitHub repository.
   * Uses native fetch() for SSE streaming support with socket closure resilience.
   */
  startIndexing: async (
    repoUrl: string,
    onProgress?: (event: IndexingProgress) => void
  ): Promise<void> => {
    const token = useAuthStore.getState().token;

    const response = await fetch(`${API_BASE_URL}/api/indexing/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ repoUrl }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Indexing failed with status ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response stream available');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let isCompleted = false;

    try {
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;

        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.substring(6).trim();
              if (!dataStr) continue;

              try {
                const event: IndexingProgress = JSON.parse(dataStr);

                if (event.stage === 'complete' || event.progress === 100) {
                  isCompleted = true;
                }

                if (onProgress) onProgress(event);
              } catch {
                // Skip malformed JSON lines
              }
            }
          }
        }
      }
    } catch (err) {
      // If completion event was already received, ignore trailing network socket closure errors
      if (isCompleted) {
        return;
      }
      throw err;
    }
  },

  /**
   * Check the current indexing status of a repository.
   */
  getIndexingStatus: async (repoId: string): Promise<IndexingProgress | null> => {
    try {
      const response = await api.get<ApiResponse<IndexingProgress>>(
        `/api/indexing/status/${repoId}`
      );
      return response.data.data ?? null;
    } catch {
      return null;
    }
  },
};

// =============================================================================
// SEARCH API
// =============================================================================
export const searchApi = {
  /**
   * Perform a semantic (meaning-based) search across the repository.
   */
  semanticSearch: async (
    repoId: string,
    query: string,
    limit: number = 10
  ): Promise<SearchResponse> => {
    const response = await api.get<ApiResponse<SearchResponse>>(
      `/api/search/${repoId}`,
      { params: { q: query, limit } }
    );
    return response.data.data!;
  },

  /**
   * Search for files and symbols by name.
   */
  fileSearch: async (
    repoId: string,
    query: string
  ): Promise<string[]> => {
    const response = await api.get<ApiResponse<string[]>>(
      `/api/search/${repoId}/files`,
      { params: { q: query } }
    );
    return response.data.data ?? [];
  },

  /**
   * Get the full file tree with AST symbol metadata for a repository.
   */
  getRepositoryTree: async (
    repoId: string
  ): Promise<RepositoryTreeResponse> => {
    const response = await api.get<ApiResponse<RepositoryTreeResponse>>(
      `/api/search/${repoId}/tree`
    );
    return response.data.data!;
  },
};

// =============================================================================
// CHAT API
// =============================================================================
export const chatApi = {
  /**
   * Send a message to the AI chat and stream the response token-by-token.
   */
  streamChat: async (
    repoId: string,
    message: string,
    onChunk: (content: string) => void,
    onStatus?: (message: string) => void,
    onError?: (error: string) => void
  ): Promise<void> => {
    const token = useAuthStore.getState().token;

    const response = await fetch(`${API_BASE_URL}/api/chat/${repoId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Chat failed with status ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response stream available');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let currentEvent = '';

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;

      if (!value) continue;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim();
        } else if (line.startsWith('data: ')) {
          const dataStr = line.substring(6).trim();
          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (currentEvent === 'chunk') {
              onChunk(data.content);
            } else if (currentEvent === 'status' && onStatus) {
              onStatus(data.message);
            } else if (currentEvent === 'error' && onError) {
              onError(data.error);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  },
};

// =============================================================================
// ANALYSIS API
// =============================================================================
export const analysisApi = {
  /**
   * Get or generate an architecture summary for the repository.
   */
  getArchitectureSummary: async (
    repoId: string,
    forceRefresh: boolean = false
  ): Promise<ArchitectureSummary> => {
    const response = await api.get<ApiResponse<ArchitectureSummary>>(
      `/api/analyze/${repoId}/architecture`,
      { params: { refresh: forceRefresh } }
    );
    return response.data.data!;
  },

  /**
   * Run AI-powered bug detection on the repository's code chunks.
   */
  detectBugs: async (
    repoId: string,
    forceRefresh: boolean = false
  ): Promise<BugDetectionResult> => {
    const response = await api.post<ApiResponse<BugDetectionResult>>(
      `/api/analyze/${repoId}/bugs`,
      {},
      { params: { refresh: forceRefresh } }
    );
    return response.data.data!;
  },

  /**
   * Generate technical documentation for the repository or a specific file.
   * Supports forceRefresh parameter to bypass stale/empty cache entries.
   */
  generateDocumentation: async (
    repoId: string,
    filePath?: string,
    forceRefresh: boolean = false
  ): Promise<DocumentationResult> => {
    const response = await api.post<ApiResponse<DocumentationResult>>(
      `/api/analyze/${repoId}/docs`,
      { filePath },
      { params: { refresh: forceRefresh } }
    );
    return response.data.data!;
  },

  /**
   * Analyze commit history, contributors, and development velocity.
   */
  analyzeCommits: async (
    repoId: string,
    forceRefresh: boolean = false
  ): Promise<CommitAnalysis> => {
    const response = await api.get<ApiResponse<CommitAnalysis>>(
      `/api/analyze/${repoId}/commits`,
      { params: { refresh: forceRefresh } }
    );
    return response.data.data!;
  },
};

export default api;