import axiosInstance from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import type {
  ApiResponse,
  Repository,
  IndexingProgress,
  SearchResult,
  ArchitectureSummary,
  BugDetectionResult,
  DocumentationResult,
  CommitAnalysis,
} from '@/types';

// ─── Citation Types ──────────────────────────────────────────────────────────

export interface CitationEntry {
  ref: number;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  snippetPreview: string;
}

// ─── Repository Tree Types ───────────────────────────────────────────────────

export interface TreeSymbol {
  type: string;
  name: string;
  lines: string | number;
}

export interface TreeFileEntry {
  filePath: string;
  language: string;
  symbols?: TreeSymbol[];
}

export interface RepositoryTreeResponse {
  totalFiles: number;
  files: TreeFileEntry[];
}

/** @deprecated Kept for backward compatibility */
export interface RepositoryTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: RepositoryTreeNode[];
  symbols?: Array<{
    name: string;
    type: string;
    line: number;
  }>;
}

// ─── SSE Stream Callback Interface ───────────────────────────────────────────

export interface ChatStreamCallbacks {
  onChunk?: (data: { content: string }) => void;
  onStatus?: (data: { message: string }) => void;
  onCitations?: (data: { citations: CitationEntry[] }) => void;
  onError?: (data: { error: string }) => void;
  onDone?: () => void;
}

// ─── Auth API ────────────────────────────────────────────────────────────────

export const authApi = {
  getMe: async () => {
    const response = await axiosInstance.get<ApiResponse>('/auth/me');
    return response.data;
  },
  logout: async () => {
    const response = await axiosInstance.post<ApiResponse>('/auth/logout');
    return response.data;
  },
};

// ─── Repository API (Cache-Busted) ───────────────────────────────────────────

export const repositoryApi = {
  getRepositories: async (): Promise<Repository[]> => {
    const response = await axiosInstance.get<ApiResponse<Repository[]>>('/repositories', {
      params: { _t: Date.now() },
    });
    return response.data.data ?? [];
  },
  deleteRepository: async (id: string) => {
    const response = await axiosInstance.delete<ApiResponse>(`/repositories/${id}`);
    return response.data;
  },
};

// ─── Indexing API ────────────────────────────────────────────────────────────

export const indexingApi = {
  startIndexing: async (
    githubUrl: string,
    onProgress: (progress: IndexingProgress) => void
  ) => {
    const token = useAuthStore.getState().token;
    const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

    const response = await fetch(`${baseURL}/indexing/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ repoUrl: githubUrl, githubUrl }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message =
        typeof errorData === 'object' &&
        errorData !== null &&
        'message' in errorData &&
        typeof (errorData as { message: unknown }).message === 'string'
          ? (errorData as { message: string }).message
          : 'Failed to start indexing';
      throw new Error(message);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('ReadableStream not supported');

    const decoder = new TextDecoder();
    let buffer = '';
    let lastRepositoryId: string | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed: unknown = JSON.parse(line.slice(6));
              if (
                typeof parsed === 'object' &&
                parsed !== null &&
                'stage' in parsed &&
                'message' in parsed &&
                'progress' in parsed
              ) {
                const data = parsed as IndexingProgress & { repositoryId?: string };
                if (data.repositoryId) {
                  lastRepositoryId = data.repositoryId;
                }
                onProgress(data);
              }
            } catch {
              // Ignore partial JSON chunks
            }
          }
        }
      }
    } catch (streamError) {
      if (!lastRepositoryId) {
        throw streamError;
      }

      const MAX_POLL_ATTEMPTS = 90;
      const POLL_INTERVAL_MS = 4000;

      for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        try {
          const statusRes = await axiosInstance.get<
            ApiResponse<{
              id: string;
              status: string;
              totalFiles: number | null;
              chunksCreated: number | null;
            }>
          >(`/indexing/status/${lastRepositoryId}`);

          const job = statusRes.data.data;

          if (!job) continue;

          if (job.status === 'COMPLETED') {
            onProgress({
              stage: 'complete',
              message: `Indexed ${job.totalFiles ?? 0} files (${job.chunksCreated ?? 0} chunks stored)`,
              progress: 100,
            } as IndexingProgress);
            return;
          }

          if (job.status === 'FAILED') {
            throw new Error('Indexing job failed on the server');
          }

          const estimatedProgress = Math.min(95, 60 + attempt);
          onProgress({
            stage: 'embedding',
            message: `Connection recovering… server still processing (attempt ${attempt})`,
            progress: estimatedProgress,
          } as IndexingProgress);
        } catch (pollError) {
          if (
            pollError instanceof Error &&
            pollError.message === 'Indexing job failed on the server'
          ) {
            throw pollError;
          }
        }
      }

      throw new Error(
        'Indexing is still running on the server but exceeded the polling timeout. Please refresh the page in a few minutes.'
      );
    }
  },

  getStatus: async (repositoryId: string) => {
    const response = await axiosInstance.get<ApiResponse<IndexingProgress>>(
      `/indexing/status/${repositoryId}`
    );
    return response.data;
  },
};

// ─── Search API ──────────────────────────────────────────────────────────────

export const searchApi = {
  searchRepository: async (repositoryId: string, query: string) => {
    const response = await axiosInstance.post<ApiResponse<SearchResult[]>>(
      `/search/${repositoryId}`,
      { query }
    );
    return response.data;
  },

  searchFiles: async (repositoryId: string, query: string) => {
    const response = await axiosInstance.get<ApiResponse<SearchResult[]>>(
      `/search/${repositoryId}/files`,
      { params: { query } }
    );
    return response.data;
  },

  getRepositoryTree: async (
    repositoryId: string
  ): Promise<RepositoryTreeResponse | null> => {
    const response = await axiosInstance.get<ApiResponse<RepositoryTreeResponse>>(
      `/search/${repositoryId}/tree`
    );
    return response.data.data ?? null;
  },

  getTree: async (
    repositoryId: string
  ): Promise<RepositoryTreeResponse | null> => {
    const response = await axiosInstance.get<ApiResponse<RepositoryTreeResponse>>(
      `/search/${repositoryId}/tree`
    );
    return response.data.data ?? null;
  },
};

// ─── Chat API ────────────────────────────────────────────────────────────────

export const chatApi = {
  streamChat: async (
    repositoryId: string,
    message: string,
    callbacks: ChatStreamCallbacks
  ) => {
    const token = useAuthStore.getState().token;
    const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

    const response = await fetch(`${baseURL}/chat/${repositoryId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const messageText =
        typeof errorData === 'object' &&
        errorData !== null &&
        'message' in errorData &&
        typeof (errorData as { message: unknown }).message === 'string'
          ? (errorData as { message: string }).message
          : 'Failed to send message';
      throw new Error(messageText);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('ReadableStream not supported');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const rawEvent of events) {
        if (!rawEvent.trim()) continue;

        let eventType = 'chunk';
        let eventData = '';

        const lines = rawEvent.split('\n');
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6).trim();
          }
        }

        if (!eventData) continue;

        try {
          const parsed: unknown = JSON.parse(eventData);

          switch (eventType) {
            case 'status':
              if (
                typeof parsed === 'object' &&
                parsed !== null &&
                'message' in parsed &&
                typeof (parsed as { message: unknown }).message === 'string'
              ) {
                callbacks.onStatus?.({ message: (parsed as { message: string }).message });
              }
              break;
            case 'citations':
              if (
                typeof parsed === 'object' &&
                parsed !== null &&
                'citations' in parsed &&
                Array.isArray((parsed as { citations: unknown }).citations)
              ) {
                callbacks.onCitations?.({
                  citations: (parsed as { citations: CitationEntry[] }).citations,
                });
              }
              break;
            case 'chunk':
              if (
                typeof parsed === 'object' &&
                parsed !== null &&
                'content' in parsed &&
                typeof (parsed as { content: unknown }).content === 'string'
              ) {
                callbacks.onChunk?.({ content: (parsed as { content: string }).content });
              }
              break;
            case 'error':
              if (
                typeof parsed === 'object' &&
                parsed !== null &&
                'error' in parsed &&
                typeof (parsed as { error: unknown }).error === 'string'
              ) {
                callbacks.onError?.({ error: (parsed as { error: string }).error });
              }
              break;
            case 'done':
              callbacks.onDone?.();
              break;
          }
        } catch {
          // Ignore partial JSON blocks
        }
      }
    }
  },
};

// ─── Analysis API ────────────────────────────────────────────────────────────

export const analysisApi = {
  getArchitectureSummary: async (
    repositoryId: string,
    forceRefresh: boolean = false
  ): Promise<ArchitectureSummary | null> => {
    const response = await axiosInstance.get<ApiResponse<ArchitectureSummary>>(
      `/analyze/${repositoryId}/architecture`,
      { params: { forceRefresh, _t: Date.now() } }
    );
    return response.data.data ?? null;
  },

  detectBugs: async (
    repositoryId: string,
    forceRefresh: boolean = false
  ): Promise<BugDetectionResult | null> => {
    const response = await axiosInstance.post<ApiResponse<BugDetectionResult>>(
      `/analyze/${repositoryId}/bugs`,
      {},
      { params: { forceRefresh } }
    );
    return response.data.data ?? null;
  },

  scanForBugs: async (
    repositoryId: string,
    forceRefresh: boolean = false
  ): Promise<BugDetectionResult | null> => {
    return analysisApi.detectBugs(repositoryId, forceRefresh);
  },

  getDocumentation: async (
    repositoryId: string,
    filePath?: string,
    forceRefresh: boolean = false
  ): Promise<DocumentationResult | null> => {
    const response = await axiosInstance.post<ApiResponse<DocumentationResult>>(
      `/analyze/${repositoryId}/docs`,
      { filePath },
      { params: { forceRefresh } }
    );
    return response.data.data ?? null;
  },

  generateDocumentation: async (
    repositoryId: string,
    filePath?: string,
    forceRefresh: boolean = false
  ): Promise<DocumentationResult | null> => {
    return analysisApi.getDocumentation(repositoryId, filePath, forceRefresh);
  },

  getCommitAnalysis: async (
    repositoryId: string,
    forceRefresh: boolean = false
  ): Promise<CommitAnalysis | null> => {
    const response = await axiosInstance.get<ApiResponse<CommitAnalysis>>(
      `/analyze/${repositoryId}/commits`,
      { params: { forceRefresh, _t: Date.now() } }
    );
    return response.data.data ?? null;
  },

  analyzeCommits: async (
    repositoryId: string,
    forceRefresh: boolean = false
  ): Promise<CommitAnalysis | null> => {
    return analysisApi.getCommitAnalysis(repositoryId, forceRefresh);
  },

  getArchitecture: async (
    repositoryId: string
  ): Promise<ArchitectureSummary | null> => {
    return analysisApi.getArchitectureSummary(repositoryId, false);
  },

  scanBugs: async (
    repositoryId: string
  ): Promise<BugDetectionResult | null> => {
    return analysisApi.detectBugs(repositoryId, false);
  },

  getDocs: async (
    repositoryId: string,
    filePath?: string
  ): Promise<DocumentationResult | null> => {
    return analysisApi.getDocumentation(repositoryId, filePath, false);
  },

  getCommits: async (
    repositoryId: string
  ): Promise<CommitAnalysis | null> => {
    return analysisApi.getCommitAnalysis(repositoryId, false);
  },
};