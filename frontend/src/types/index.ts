// =============================================================================
// REPO-MIND FRONTEND - SHARED TYPE DEFINITIONS
// =============================================================================
// These types mirror our backend types and define the shape of data
// flowing between the frontend and backend API.
// Having them here gives us TypeScript autocomplete everywhere in the UI.
// =============================================================================


// =============================================================================
// USER TYPES
// =============================================================================

export interface User {
  id: string;
  githubId: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
}


// =============================================================================
// REPOSITORY TYPES
// =============================================================================

export interface Repository {
  id: string;
  userId: string;
  githubRepoId: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  isIndexed: boolean;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
}


// =============================================================================
// CHAT TYPES
// =============================================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface ChatSession {
  id: string;
  repositoryId: string;
  messages: ChatMessage[];
  createdAt: Date;
}


// =============================================================================
// SEARCH TYPES
// =============================================================================

export interface SearchResult {
  filePath: string;
  chunkType: string;
  name: string;
  content: string;
  score: number;
  startLine: number;
  endLine: number;
  language: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalResults: number;
}


// =============================================================================
// INDEXING TYPES
// =============================================================================

export interface IndexingProgress {
  stage: 'fetching' | 'parsing' | 'embedding' | 'storing' | 'complete' | 'error';
  message: string;
  progress: number;
  filesProcessed?: number;
  totalFiles?: number;
}


// =============================================================================
// API RESPONSE TYPES
// =============================================================================

/**
 * Standard wrapper for all API responses from our backend.
 * Every fetch call will return data in this shape.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}


// =============================================================================
// ANALYSIS TYPES
// =============================================================================

export interface ArchitectureSummary {
  overview: string;
  modules: Module[];
  dependencies: string[];
  techStack: string[];
  diagram: string;
}

export interface Module {
  name: string;
  path: string;
  description: string;
  exports: string[];
}

export interface BugReport {
  severity: 'low' | 'medium' | 'high' | 'critical';
  filePath: string;
  line: number | null;
  description: string;
  suggestion: string;
  codeSnippet: string | null;
}

export interface BugDetectionResult {
  bugs: BugReport[];
  summary: string;
  totalIssues: number;
}

export interface DocumentationResult {
  documentation: string;
  filePath: string;
  generatedAt: string;
}

export interface CommitAnalysis {
  summary: string;
  recentCommits: Commit[];
  contributors: Contributor[];
  activityLevel: 'low' | 'medium' | 'high';
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface Contributor {
  username: string;
  avatarUrl: string;
  commits: number;
}


// =============================================================================
// DIAGRAM TYPES
// =============================================================================

export interface MermaidDiagram {
  syntax: string;
  title: string;
  type: 'flowchart' | 'graph' | 'sequence';
}