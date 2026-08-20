// File Chunking Service (MVP — line-based splitting)
// Splits source files into overlapping chunks for embedding.
// Phase 2 will replace this with AST-aware semantic chunking.

import { GitHubFileContent } from '../lib/github';
import { logger } from '../lib/logger';

// --- Configuration ---
const CHUNK_SIZE_LINES = 60;    // Lines per chunk
const CHUNK_OVERLAP_LINES = 10; // Overlap between consecutive chunks
const MIN_CHUNK_LINES = 5;      // Skip tiny trailing chunks

// --- Types ---

/** A chunk of code ready for embedding */
export interface ChunkData {
  /** Unique ID: repoId_filePath_chunkIndex */
  id: string;
  /** The text content of this chunk */
  content: string;
  /** File path relative to repo root */
  filePath: string;
  /** 0-based index of this chunk within its file */
  chunkIndex: number;
  /** 1-based start line in the original file */
  startLine: number;
  /** 1-based end line in the original file */
  endLine: number;
  /** Language detected from file extension */
  language: string;
  /** Repository ID (for Pinecone metadata filtering) */
  repositoryId: string;
}

/**
 * Chunk all files from a repository into embeddable pieces.
 * Returns a flat array of chunks from all files.
 */
export function chunkRepositoryFiles(
  files: GitHubFileContent[],
  repositoryId: string
): ChunkData[] {
  const allChunks: ChunkData[] = [];

  for (const file of files) {
    // Skip empty files
    if (!file.content.trim()) continue;

    const fileChunks = chunkSingleFile(file, repositoryId);
    allChunks.push(...fileChunks);
  }

  logger.info('✂️ [Chunking] Complete', {
    totalFiles: files.length,
    totalChunks: allChunks.length,
    avgChunksPerFile: files.length > 0
      ? (allChunks.length / files.length).toFixed(1)
      : 0,
  });

  return allChunks;
}

/**
 * Split a single file into overlapping chunks.
 * Each chunk gets a context header with file path and line range.
 */
function chunkSingleFile(
  file: GitHubFileContent,
  repositoryId: string
): ChunkData[] {
  const lines = file.content.split('\n');
  const chunks: ChunkData[] = [];

  // Small files → single chunk, no splitting needed
  if (lines.length <= CHUNK_SIZE_LINES) {
    chunks.push({
      id: buildChunkId(repositoryId, file.path, 0),
      content: buildChunkContent(file.path, lines, 1, lines.length, file.language),
      filePath: file.path,
      chunkIndex: 0,
      startLine: 1,
      endLine: lines.length,
      language: file.language || 'unknown',
      repositoryId,
    });
    return chunks;
  }

  // Larger files → sliding window with overlap
  let chunkIndex = 0;
  for (let start = 0; start < lines.length; start += CHUNK_SIZE_LINES - CHUNK_OVERLAP_LINES) {
    const end = Math.min(start + CHUNK_SIZE_LINES, lines.length);
    const chunkLines = lines.slice(start, end);

    // Skip tiny trailing fragments
    if (chunkLines.length < MIN_CHUNK_LINES && chunkIndex > 0) break;

    const startLine = start + 1;  // Convert to 1-based
    const endLine = end;

    chunks.push({
      id: buildChunkId(repositoryId, file.path, chunkIndex),
      content: buildChunkContent(file.path, chunkLines, startLine, endLine, file.language),
      filePath: file.path,
      chunkIndex,
      startLine,
      endLine,
      language: file.language || 'unknown',
      repositoryId,
    });

    chunkIndex++;

    // If we've reached the end, stop
    if (end >= lines.length) break;
  }

  return chunks;
}

/**
 * Build the text content for a chunk.
 * Includes a header with file path and line range so the AI
 * has context about WHERE this code comes from.
 */
function buildChunkContent(
  filePath: string,
  lines: string[],
  startLine: number,
  endLine: number,
  language: string | null
): string {
  const header = `// File: ${filePath} (lines ${startLine}-${endLine})`;
  const code = lines.join('\n');
  return `${header}\n${code}`;
}

/**
 * Generate a deterministic chunk ID.
 * Format: repoId_filePath_chunkIndex
 * Using a consistent ID means re-indexing the same file overwrites
 * old vectors instead of creating duplicates.
 */
function buildChunkId(
  repositoryId: string,
  filePath: string,
  chunkIndex: number
): string {
  // Replace slashes and dots for cleaner IDs
  const sanitizedPath = filePath.replace(/[/\\\.]/g, '_');
  return `${repositoryId}_${sanitizedPath}_${chunkIndex}`;
}
