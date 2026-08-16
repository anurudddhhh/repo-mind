// =============================================================================
// REPO-MIND BACKEND - SHARED TYPE DEFINITIONS
// =============================================================================
// This file defines TypeScript interfaces and types used across the entire
// backend. Think of interfaces as "blueprints" — they describe the exact
// shape of data objects without implementing any logic.
//
// By centralizing types here, we ensure consistency across all files.
// If a User object changes, we update it in ONE place, not everywhere.
// =============================================================================


// =============================================================================
// USER TYPES
// =============================================================================

/**
 * Represents a user stored in our PostgreSQL database.
 * This matches our Prisma schema User model exactly.
 */
export interface User {
  id: string;
  githubId: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  accessToken: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The payload stored inside our JWT token.
 * When a user makes a request, we decode the JWT to get this data.
 */
export interface JWTPayload {
  userId: string;
  githubId: string;
  username: string;
  iat?: number;
  exp?: number;
}


// =============================================================================
// REPOSITORY TYPES
// =============================================================================

/**
 * Represents a GitHub repository stored in our database.
 */
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
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Represents a single file retrieved from the GitHub API.
 */
export interface GitHubFile {
  path: string;
  content: string;
  sha: string;
  size: number;
  language: string | null;
}


// =============================================================================
// AST & CHUNKING TYPES
// =============================================================================

/**
 * Represents a single semantic chunk extracted from code via Tree-sitter AST.
 * A chunk is a meaningful unit of code (function, class, method).
 * This is what gets embedded and stored in Pinecone.
 */
export interface CodeChunk {
  id: string;
  repositoryId: string;
  filePath: string;
  chunkType: ChunkType;
  name: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  dependencies: string[];
  metadata: Record<string, unknown>;
}

/**
 * The type of AST node a chunk represents.
 */
export type ChunkType =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'module'
  | 'export';

/**
 * A node in our dependency graph.
 * Maps which files import which other files.
 */
export interface DependencyNode {
  filePath: string;
  imports: string[];
  exports: string[];
  language: string;
}


// =============================================================================
// VECTOR / EMBEDDING TYPES
// =============================================================================

/**
 * A code chunk WITH its vector embedding attached.
 * This is what gets stored in Pinecone.
 */
export interface EmbeddedChunk extends CodeChunk {
  embedding: number[];
}

/**
 * A search result returned from Pinecone vector search.
 */
export interface SearchResult {
  chunk: CodeChunk;
  score: number;
}


// =============================================================================
// CHAT & AI TYPES
// =============================================================================

/**
 * A single message in a chat conversation.
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * The request body sent to our chat endpoint.
 */
export interface ChatRequest {
  repositoryId: string;
  message: string;
  conversationHistory?: ChatMessage[];
}

/**
 * Context retrieved from Pinecone to augment the AI prompt.
 */
export interface RetrievedContext {
  chunks: SearchResult[];
  totalTokensEstimate: number;
}


// =============================================================================
// API RESPONSE TYPES
// =============================================================================

/**
 * Standard API response wrapper.
 * Every endpoint returns data in this shape for consistency.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Indexing progress update sent via SSE during repository indexing.
 */
export interface IndexingProgress {
  stage: 'fetching' | 'parsing' | 'embedding' | 'storing' | 'complete' | 'error';
  message: string;
  progress: number;
  filesProcessed?: number;
  totalFiles?: number;
}


// =============================================================================
// EXPRESS REQUEST EXTENSION
// =============================================================================
// By default, Express's Request object doesn't know about our custom
// properties like `user`. We extend it here to add TypeScript support.

declare global {
  namespace Express {
    interface Request {
      user?: User;
      token?: string;
    }
  }
}