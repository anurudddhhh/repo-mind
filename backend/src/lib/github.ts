// ============================================================
// GITHUB API CLIENT
// ============================================================
// Provides a clean interface to the GitHub REST API using Octokit.
// Used by the indexing pipeline to:
//   1. Fetch repository metadata (name, description, default branch)
//   2. Get the file tree (list all files in a repo)
//   3. Download individual file contents
//
// Each user gets their OWN Octokit instance authenticated with
// their personal GitHub access token (from OAuth). This means:
//   - We can access their private repos
//   - API rate limits are per-user (5,000 req/hour for authenticated)
//   - If a user revokes access, only their requests fail
//
// USAGE:
//   import { createGitHubClient } from './github';
//   const github = createGitHubClient(user.accessToken);
//   const files = await github.getRepositoryFiles('owner', 'repo');
// ============================================================

import { Octokit } from '@octokit/rest';
import { logger } from './logger';

// ============================================================
// CONFIGURATION
// ============================================================

// File extensions we consider "indexable" source code.
// We skip binary files (images, compiled code, etc.) because:
//   1. They can't be meaningfully chunked or embedded
//   2. They waste Pinecone storage and embedding API calls
//   3. They would produce garbage search results
const SUPPORTED_EXTENSIONS = new Set([
  // JavaScript / TypeScript
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  // Python
  '.py', '.pyi',
  // Java / Kotlin
  '.java', '.kt', '.kts',
  // C / C++
  '.c', '.h', '.cpp', '.hpp', '.cc', '.hh',
  // C#
  '.cs',
  // Go
  '.go',
  // Rust
  '.rs',
  // Ruby
  '.rb',
  // PHP
  '.php',
  // Swift
  '.swift',
  // Shell
  '.sh', '.bash', '.zsh',
  // Web
  '.html', '.css', '.scss', '.less', '.vue', '.svelte',
  // Data / Config (often contain useful context)
  '.json', '.yaml', '.yml', '.toml', '.xml',
  // Documentation
  '.md', '.mdx', '.txt', '.rst',
  // SQL
  '.sql',
  // Docker / CI
  '.dockerfile',
  // GraphQL
  '.graphql', '.gql',
  // Prisma
  '.prisma',
]);

// Maximum file size to download (in bytes).
// Files larger than this are skipped to avoid:
//   1. Memory issues when processing large files
//   2. Wasting embedding tokens on generated/minified code
//   3. Hitting GitHub API payload limits
const MAX_FILE_SIZE_BYTES = 500_000; // 500 KB

// Directories to always skip — these contain dependencies,
// build output, or other non-source files.
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
  '.idea',
  '.vscode',
  'coverage',
  '.nyc_output',
  '.cache',
  '.turbo',
  'out',
  '.output',
  'target',        // Rust/Java build output
  'bin',           // Compiled binaries
  'obj',           // .NET build output
  '.gradle',
  '.mvn',
]);

// Files to always skip (exact match on filename)
const IGNORED_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
  '.DS_Store',
  'Thumbs.db',
]);

// ============================================================
// TYPES
// ============================================================

/**
 * Represents a single file fetched from a GitHub repository.
 * This is what the indexing pipeline receives for chunking.
 */
export interface GitHubFileContent {
  /** File path relative to repo root, e.g. "src/index.ts" */
  path: string;
  /** The actual file content as a UTF-8 string */
  content: string;
  /** Git blob SHA — unique identifier for this file version */
  sha: string;
  /** File size in bytes */
  size: number;
  /** Programming language inferred from extension, e.g. "typescript" */
  language: string | null;
}

/**
 * Basic repository metadata from GitHub.
 */
export interface GitHubRepoInfo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  owner: string;
  isPrivate: boolean;
  defaultBranch: string;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  size: number; // in KB
}

/**
 * A tree entry from the GitHub Git Trees API.
 * Represents a single file or directory in the repo.
 */
interface GitTreeEntry {
  path?: string;
  mode?: string;
  type?: string;  // 'blob' (file) or 'tree' (directory)
  sha?: string;
  size?: number;
  url?: string;
}

// ============================================================
// LANGUAGE DETECTION
// ============================================================
// Maps file extensions to human-readable language names.
// Used for metadata when storing chunks in Pinecone.
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python', '.pyi': 'python',
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp', '.hh': 'cpp',
  '.cs': 'csharp',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.html': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.vue': 'vue', '.svelte': 'svelte',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml', '.xml': 'xml',
  '.md': 'markdown', '.mdx': 'markdown', '.txt': 'text', '.rst': 'rst',
  '.sql': 'sql',
  '.dockerfile': 'dockerfile',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.prisma': 'prisma',
};

/**
 * Infer the programming language from a file extension.
 * Returns null if the extension is not recognized.
 */
function getLanguageFromPath(filePath: string): string | null {
  const ext = '.' + filePath.split('.').pop()?.toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || null;
}

/**
 * Check if a file path has a supported (indexable) extension.
 */
function isSupportedFile(filePath: string): boolean {
  const ext = '.' + filePath.split('.').pop()?.toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Check if any directory component in the path is in the ignore list.
 * e.g. "node_modules/express/index.js" → true (skip it)
 */
function isIgnoredPath(filePath: string): boolean {
  const parts = filePath.split('/');

  // Check if the filename itself is ignored
  const fileName = parts[parts.length - 1];
  if (IGNORED_FILES.has(fileName)) return true;

  // Check if any directory in the path is ignored
  for (const part of parts.slice(0, -1)) {
    if (IGNORED_DIRECTORIES.has(part)) return true;
  }

  return false;
}

// ============================================================
// GITHUB CLIENT CLASS
// ============================================================
// We wrap Octokit in a class so we can:
//   1. Attach the user's token once, reuse for all calls
//   2. Add consistent error handling and logging
//   3. Add filtering logic (skip binaries, ignored dirs, etc.)
//   4. Keep the interface clean for the indexing pipeline
// ============================================================
export class GitHubClient {
  private octokit: Octokit;

  constructor(accessToken: string) {
    // Create an Octokit instance authenticated with this user's token.
    // All API calls through this instance will use this token.
    this.octokit = new Octokit({
      auth: accessToken,
      // Custom User-Agent is required by GitHub API guidelines
      userAgent: 'repo-mind/1.0.0',
    });
  }

  // ──────────────────────────────────────────────────────
  // getRepoInfo — Fetch repository metadata
  // ──────────────────────────────────────────────────────
  // Used when a user adds a repo to index. We store this
  // metadata in our PostgreSQL Repository table.
  // ──────────────────────────────────────────────────────
  async getRepoInfo(owner: string, repo: string): Promise<GitHubRepoInfo> {
    try {
      logger.info('📂 [GitHub] Fetching repo info', { owner, repo });

      const { data } = await this.octokit.repos.get({ owner, repo });

      return {
        id: data.id,
        name: data.name,
        fullName: data.full_name,
        description: data.description,
        owner: data.owner.login,
        isPrivate: data.private,
        defaultBranch: data.default_branch,
        language: data.language,
        stargazersCount: data.stargazers_count,
        forksCount: data.forks_count,
        size: data.size, // in KB
      };
    } catch (error) {
      this.handleGitHubError(error, `getRepoInfo(${owner}/${repo})`);
      throw error; // Re-throw after logging
    }
  }

  // ──────────────────────────────────────────────────────
  // getRepositoryFiles — Fetch all indexable files
  // ──────────────────────────────────────────────────────
  // This is the MAIN method used by the indexing pipeline.
  //
  // HOW IT WORKS:
  //   1. Uses the Git Trees API to get the ENTIRE file tree
  //      in a SINGLE API call (recursive=true).
  //      This is much faster than listing each directory separately.
  //   2. Filters out non-source files, ignored dirs, and large files
  //   3. Downloads each remaining file's content
  //   4. Returns an array of GitHubFileContent objects
  //
  // WHY Git Trees API instead of Contents API?
  //   - Contents API: 1 API call per directory. A repo with 100
  //     directories = 100 API calls. Hits rate limits fast.
  //   - Git Trees API: 1 API call for the ENTIRE tree. Always
  //     exactly 1 call regardless of repo size.
  // ──────────────────────────────────────────────────────
  async getRepositoryFiles(
    owner: string,
    repo: string,
    branch?: string
  ): Promise<GitHubFileContent[]> {
    try {
      // Step 1: Determine which branch to index
      const targetBranch = branch || (await this.getDefaultBranch(owner, repo));
      logger.info('🌳 [GitHub] Fetching file tree', { owner, repo, branch: targetBranch });

      // Step 2: Get the entire file tree in one API call
      const { data: treeData } = await this.octokit.git.getTree({
        owner,
        repo,
        tree_sha: targetBranch,
        recursive: 'true', // Must be string 'true', not boolean
      });

      // Step 3: Filter to only indexable source files
      const indexableEntries = (treeData.tree as GitTreeEntry[]).filter((entry) => {
        // Must be a file (blob), not a directory (tree)
        if (entry.type !== 'blob') return false;
        if (!entry.path) return false;

        // Skip ignored directories and files
        if (isIgnoredPath(entry.path)) return false;

        // Skip unsupported file types
        if (!isSupportedFile(entry.path)) return false;

        // Skip files that are too large
        if (entry.size && entry.size > MAX_FILE_SIZE_BYTES) {
          logger.debug('⏩ [GitHub] Skipping large file', {
            path: entry.path,
            size: entry.size,
            maxSize: MAX_FILE_SIZE_BYTES,
          });
          return false;
        }

        return true;
      });

      logger.info('📊 [GitHub] File tree filtered', {
        totalEntries: treeData.tree.length,
        indexableFiles: indexableEntries.length,
        truncated: treeData.truncated, // true if repo has 100k+ files
      });

      if (treeData.truncated) {
        logger.warn('⚠️ [GitHub] Tree was truncated — repo has too many files. Some files may be missing.');
      }

      // Step 4: Download content for each indexable file
      // We process files in batches to avoid overwhelming the GitHub API
      const files: GitHubFileContent[] = [];
      const BATCH_SIZE = 10; // Process 10 files at a time

      for (let i = 0; i < indexableEntries.length; i += BATCH_SIZE) {
        const batch = indexableEntries.slice(i, i + BATCH_SIZE);

        const batchResults = await Promise.allSettled(
          batch.map((entry) =>
            this.getFileContent(owner, repo, entry.path!, targetBranch)
          )
        );

        // Collect successful downloads, log failures
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          if (result.status === 'fulfilled' && result.value) {
            files.push(result.value);
          } else if (result.status === 'rejected') {
            logger.warn('⚠️ [GitHub] Failed to fetch file', {
              path: batch[j].path,
              error: result.reason?.message || String(result.reason),
            });
          }
        }

        // Log progress for large repos
        if (indexableEntries.length > 20) {
          const processed = Math.min(i + BATCH_SIZE, indexableEntries.length);
          logger.info(`📥 [GitHub] Downloaded ${processed}/${indexableEntries.length} files`);
        }
      }

      logger.info('✅ [GitHub] Repository files fetched', {
        owner,
        repo,
        totalFiles: files.length,
      });

      return files;
    } catch (error) {
      this.handleGitHubError(error, `getRepositoryFiles(${owner}/${repo})`);
      throw error;
    }
  }

  // ──────────────────────────────────────────────────────
  // getFileContent — Download a single file's content
  // ──────────────────────────────────────────────────────
  // Uses the Contents API to get a file's content as a
  // Base64-encoded string, then decodes it to UTF-8.
  //
  // WHY Base64? GitHub's API returns file content as Base64
  // to safely transport binary data over JSON. For text files,
  // we decode it back to readable text.
  // ──────────────────────────────────────────────────────
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<GitHubFileContent | null> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      // The API can return a file OR a directory listing.
      // We only want files (which have `content` and `type: 'file'`).
      if (Array.isArray(data) || data.type !== 'file' || !data.content) {
        return null;
      }

      // Decode Base64 content to UTF-8 string
      const content = Buffer.from(data.content, 'base64').toString('utf-8');

      return {
        path: data.path,
        content,
        sha: data.sha,
        size: data.size,
        language: getLanguageFromPath(data.path),
      };
    } catch (error) {
      logger.debug('⚠️ [GitHub] Failed to fetch file content', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return null; // Return null instead of throwing — caller handles gracefully
    }
  }

  // ──────────────────────────────────────────────────────
  // getDefaultBranch — Get the repo's default branch name
  // ──────────────────────────────────────────────────────
  // Most repos use 'main' or 'master', but some use custom
  // names. We always check rather than assuming.
  // ──────────────────────────────────────────────────────
  private async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const { data } = await this.octokit.repos.get({ owner, repo });
    return data.default_branch;
  }

  // ──────────────────────────────────────────────────────
  // Error Handler
  // ──────────────────────────────────────────────────────
  // Translates GitHub API errors into clear, actionable messages.
  // GitHub returns different status codes for different problems:
  //   401 = Bad token (user needs to re-authenticate)
  //   403 = Rate limited OR repo access denied
  //   404 = Repo doesn't exist OR user can't access it
  //   422 = Invalid request (bad branch name, etc.)
  // ──────────────────────────────────────────────────────
  private handleGitHubError(error: unknown, context: string): void {
    if (error instanceof Error && 'status' in error) {
      const status = (error as { status: number }).status;
      const message = error.message;

      switch (status) {
        case 401:
          logger.error(`❌ [GitHub] Authentication failed in ${context}`, {
            status,
            hint: 'User access token may be expired or revoked. User needs to re-login.',
          });
          break;
        case 403:
          if (message.includes('rate limit')) {
            logger.error(`⏱️ [GitHub] Rate limit exceeded in ${context}`, {
              status,
              hint: 'Wait for rate limit reset or reduce API call frequency.',
            });
          } else {
            logger.error(`🚫 [GitHub] Access denied in ${context}`, {
              status,
              hint: 'User may not have access to this repository.',
            });
          }
          break;
        case 404:
          logger.error(`🔍 [GitHub] Not found in ${context}`, {
            status,
            hint: 'Repository may not exist or user lacks access.',
          });
          break;
        case 422:
          logger.error(`⚠️ [GitHub] Invalid request in ${context}`, {
            status,
            message,
          });
          break;
        default:
          logger.error(`❌ [GitHub] API error in ${context}`, {
            status,
            message,
          });
      }
    } else {
      logger.error(`❌ [GitHub] Unexpected error in ${context}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================
// Creates a GitHubClient instance for a specific user.
// This is the primary export — other files should use this
// instead of instantiating GitHubClient directly.
//
// USAGE:
//   const github = createGitHubClient(user.accessToken);
//   const repoInfo = await github.getRepoInfo('owner', 'repo');
// ============================================================
export function createGitHubClient(accessToken: string): GitHubClient {
  if (!accessToken) {
    throw new Error('GitHub access token is required to create a client');
  }
  return new GitHubClient(accessToken);
}
