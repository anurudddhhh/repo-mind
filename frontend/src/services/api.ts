// =============================================================================
// REPO-MIND FRONTEND - API SERVICE LAYER
// =============================================================================
// This is the SINGLE source of truth for all backend communication.
// NO component should ever call fetch() or axios directly.
// ALL API calls go through this file.
//
// Why? Because if our backend URL changes, or we add authentication headers,
// or we want to add logging — we change it in ONE place, not in 50 components.
//
// Think of this like a dedicated phone operator:
// Components say "I need data" → API service makes the actual call
// =============================================================================

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  ApiResponse,
  Repository,
  GitHubRepository,
  SearchResponse,
  IndexingProgress,
  ArchitectureSummary,
  BugDetectionResult,
  DocumentationResult,
  CommitAnalysis,
  User,
} from '@/types';

// =============================================================================
// AXIOS INSTANCE CONFIGURATION
// =============================================================================
// We create a single configured axios instance instead of using axios directly.
// This instance automatically:
// 1. Prepends the base URL to every request
// 2. Sends cookies with every request (for authentication)
// 3. Sets Content-Type header to JSON for every request
// =============================================================================

const apiClient: AxiosInstance = axios.create({
  // During development, Next.js proxies /api/* to our backend (via next.config.mjs)
  // In production, this would be our deployed backend URL
  baseURL: '/api',

  // withCredentials: true sends cookies with cross-origin requests
  // This is how our JWT session cookie gets sent to the backend
  withCredentials: true,

  headers: {
    'Content-Type': 'application/json',
  },

  // Timeout after 30 seconds (AI responses can take a while)
  timeout: 30000,
});


// =============================================================================
// REQUEST INTERCEPTOR
// =============================================================================
// Interceptors run on EVERY request/response automatically.
// This request interceptor runs BEFORE every API call is sent.
// We use it to attach the JWT token from localStorage to every request.
// =============================================================================

apiClient.interceptors.request.use(
  (config) => {
    // localStorage is only available in the browser, not during SSR
    // typeof check prevents crashes when this runs on the server
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('repo_mind_token');

      if (token) {
        // Attach it as a Bearer token in the Authorization header
        // The backend middleware reads this to identify the user
        config.headers.Authorization = `Bearer ${token}`;
      }
    }

    return config;
  },
  (error) => Promise.reject(error)
);


// =============================================================================
// RESPONSE INTERCEPTOR
// =============================================================================
// This runs AFTER every response comes back from the backend.
// We use it to handle global errors like 401 (unauthorized = logged out).
// =============================================================================

apiClient.interceptors.response.use(
  // If response is successful, just return it as-is
  (response: AxiosResponse) => response,

  // If response has an error status code:
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      // 401 = Unauthorized. The user's session has expired.
      // Clear their token and redirect to login page.
      localStorage.removeItem('repo_mind_token');
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);


// =============================================================================
// AUTH API CALLS
// =============================================================================

export const authApi = {
  /**
   * Get the GitHub OAuth login URL from our backend.
   * Redirects the user to GitHub to authorize our app.
   */
  getGithubLoginUrl: (): string => {
    return `/api/auth/github`;
  },

  /**
   * Get the currently logged-in user's profile.
   * Returns null if not logged in.
   */
  getMe: async (): Promise<User | null> => {
    try {
      const response = await apiClient.get<ApiResponse<User>>('/auth/me');
      return response.data.data ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Log the user out by clearing their session.
   */
  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('repo_mind_token');
    }
  },

  /**
   * Store the JWT token received after OAuth callback.
   */
  setToken: (token: string): void => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('repo_mind_token', token);
    }
  },

  /**
   * Get the stored JWT token.
   */
  getToken: (): string | null => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('repo_mind_token');
    }
    return null;
  },
};


// =============================================================================
// REPOSITORY API CALLS
// =============================================================================

export const repositoryApi = {
  /**
   * Get all repositories the user has added to Repo-Mind.
   */
  getRepositories: async (): Promise<Repository[]> => {
    const response = await apiClient.get<ApiResponse<Repository[]>>('/repos');
    return response.data.data ?? [];
  },

  /**
   * Get a single repository by ID.
   */
  getRepository: async (repoId: string): Promise<Repository | null> => {
    const response = await apiClient.get<ApiResponse<Repository>>(`/repos/${repoId}`);
    return response.data.data ?? null;
  },

  /**
   * Add a new repository to Repo-Mind by owner/name.
   */
  addRepository: async (owner: string, name: string): Promise<Repository> => {
    const response = await apiClient.post<ApiResponse<Repository>>('/repos', {
      owner,
      name,
    });
    return response.data.data!;
  },

  /**
   * Delete a repository from Repo-Mind.
   */
  deleteRepository: async (repoId: string): Promise<void> => {
    await apiClient.delete(`/repos/${repoId}`);
  },

  /**
   * Search the user's GitHub repositories (not yet added to Repo-Mind).
   * Used when the user wants to browse and add a new repo.
   */
  searchGithubRepos: async (query: string): Promise<GitHubRepository[]> => {
    const response = await apiClient.get<ApiResponse<GitHubRepository[]>>(
      `/repos/github/search?q=${encodeURIComponent(query)}`
    );
    return response.data.data ?? [];
  },
};


// =============================================================================
// INDEXING API CALLS
// =============================================================================

export const indexingApi = {
  /**
   * Start the indexing pipeline for a repository.
   * Returns an EventSource for SSE progress updates.
   *
   * SSE (Server-Sent Events) is a one-way stream from server to browser.
   * Think of it like subscribing to live updates — the server pushes
   * progress messages as it processes the repository.
   */
  startIndexing: (repoId: string): EventSource => {
    const token = typeof window !== 'undefined'
      ? localStorage.getItem('repo_mind_token')
      : '';
    const url = `/api/repos/${repoId}/index?token=${token}`;
    return new EventSource(url);
  },

  /**
   * Check the current indexing status of a repository.
   */
  getIndexingStatus: async (repoId: string): Promise<IndexingProgress> => {
    const response = await apiClient.get<ApiResponse<IndexingProgress>>(
      `/repos/${repoId}/index/status`
    );
    return response.data.data!;
  },
};


// =============================================================================
// SEARCH API CALLS
// =============================================================================

export const searchApi = {
  /**
   * Perform a semantic search across the repository's codebase.
   * Returns code chunks ranked by semantic similarity to the query.
   */
  semanticSearch: async (
    repoId: string,
    query: string,
    limit: number = 10
  ): Promise<SearchResponse> => {
    const response = await apiClient.get<ApiResponse<SearchResponse>>(
      `/search/${repoId}?q=${encodeURIComponent(query)}&limit=${limit}`
    );
    return response.data.data!;
  },

  /**
   * Search for files and directories by name/path.
   */
  fileSearch: async (
    repoId: string,
    query: string
  ): Promise<string[]> => {
    const response = await apiClient.get<ApiResponse<string[]>>(
      `/search/${repoId}/files?q=${encodeURIComponent(query)}`
    );
    return response.data.data ?? [];
  },
};


// =============================================================================
// CHAT API CALLS
// =============================================================================

export const chatApi = {
  /**
   * Start a streaming chat session with the repository.
   * Returns an EventSource that streams AI response tokens word-by-word.
   *
   * This is how we achieve the "ChatGPT-like" streaming effect.
   * Instead of waiting for the full response, words arrive one by one.
   */
  streamChat: (
    repoId: string,
    message: string,
    conversationHistory: Array<{ role: string; content: string }>
  ): EventSource => {
    const token = typeof window !== 'undefined'
      ? localStorage.getItem('repo_mind_token')
      : '';
    const params = new URLSearchParams({
      message,
      history: JSON.stringify(conversationHistory),
      token: token ?? '',
    });
    return new EventSource(`/api/chat/${repoId}/stream?${params.toString()}`);
  },
};


// =============================================================================
// ANALYSIS API CALLS
// =============================================================================

export const analysisApi = {
  /**
   * Generate an architecture summary for the repository.
   * Returns a high-level overview with a Mermaid.js diagram.
   */
  getArchitectureSummary: async (repoId: string): Promise<ArchitectureSummary> => {
    const response = await apiClient.get<ApiResponse<ArchitectureSummary>>(
      `/analyze/${repoId}/architecture`
    );
    return response.data.data!;
  },

  /**
   * Run AI-powered bug detection on the repository.
   */
  detectBugs: async (repoId: string): Promise<BugDetectionResult> => {
    const response = await apiClient.post<ApiResponse<BugDetectionResult>>(
      `/analyze/${repoId}/bugs`
    );
    return response.data.data!;
  },

  /**
   * Generate documentation for the repository or a specific file.
   */
  generateDocumentation: async (
    repoId: string,
    filePath?: string
  ): Promise<DocumentationResult> => {
    const response = await apiClient.post<ApiResponse<DocumentationResult>>(
      `/analyze/${repoId}/docs`,
      { filePath }
    );
    return response.data.data!;
  },

  /**
   * Analyze the commit history and contributor activity.
   */
  analyzeCommits: async (repoId: string): Promise<CommitAnalysis> => {
    const response = await apiClient.get<ApiResponse<CommitAnalysis>>(
      `/analyze/${repoId}/commits`
    );
    return response.data.data!;
  },
};


// =============================================================================
// DEFAULT EXPORT
// =============================================================================
// Export the raw client too in case any service needs direct access
export default apiClient;