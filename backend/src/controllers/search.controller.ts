// =============================================================================
// SEARCH CONTROLLER
// =============================================================================
// Exposes:
//   1. Semantic Vector Search (POST /api/search/:repositoryId)
//   2. Fast Structured File Search (GET /api/search/:repositoryId/files?q=...)
//   3. Repository File Tree Explorer (GET /api/search/:repositoryId/tree)
// =============================================================================

import type { Request, Response } from 'express';
import '../types';
import { prisma } from '../lib/prisma';
import { searchRepository } from '../services/search.service';
import { logger } from '../lib/logger';

/**
 * POST or GET /api/search/:repositoryId
 * Body/Query: { query: string, topK?: number }
 *
 * Feature 03: Semantic vector similarity search via Pinecone.
 */
export async function handleSearch(req: Request, res: Response): Promise<void> {
  const { repositoryId } = req.params;
  const query = (req.body?.query || req.query?.q) as string;
  const topK = req.body?.topK ? parseInt(req.body.topK, 10) : req.query?.limit ? parseInt(req.query.limit as string, 10) : 5;
  const user = req.user!;

  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'Query string (q or query) is required' });
    return;
  }

  try {
    // 1. Verify access
    const repository = await prisma.repository.findFirst({
      where: {
        id: repositoryId,
        userId: user.id,
      },
    });

    if (!repository) {
      res.status(404).json({ success: false, error: 'Repository not found or access denied' });
      return;
    }

    if (repository.indexingStatus !== 'COMPLETED') {
      res.status(400).json({
        success: false,
        error: 'Repository is not fully indexed yet',
      });
      return;
    }

    // 2. Perform vector search
    const results = await searchRepository(repository.id, query, topK);

    res.json({
      success: true,
      data: {
        query,
        totalResults: results.length,
        results,
      },
    });
  } catch (error: any) {
    logger.error('❌ [Search Controller] Semantic search failed:', {
      repositoryId,
      query,
      error: error?.message || String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to perform semantic search',
      message: error?.message || 'Internal server error',
    });
  }
}

/**
 * GET /api/search/:repositoryId/files?q=...&type=...&lang=...
 *
 * Feature 09: Fast structured file and symbol lookup on PostgreSQL CodeChunk table.
 */
export async function searchFiles(req: Request, res: Response): Promise<void> {
  const { repositoryId } = req.params;
  const query = (req.query.q as string || '').trim();
  const chunkType = req.query.type as string | undefined;
  const language = req.query.lang as string | undefined;
  const user = req.user!;

  try {
    // 1. Verify access
    const repository = await prisma.repository.findFirst({
      where: {
        id: repositoryId,
        userId: user.id,
      },
    });

    if (!repository) {
      res.status(404).json({ success: false, error: 'Repository not found or access denied' });
      return;
    }

    // 2. Query CodeChunk table for matching files & symbols
    const chunks = await prisma.codeChunk.findMany({
      where: {
        repositoryId,
        ...(query
          ? {
              OR: [
                { filePath: { contains: query, mode: 'insensitive' } },
                { name: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(chunkType ? { chunkType: chunkType as any } : {}),
        ...(language ? { language: { equals: language, mode: 'insensitive' } } : {}),
      },
      select: {
        filePath: true,
        chunkType: true,
        name: true,
        startLine: true,
        endLine: true,
        language: true,
      },
      take: 100,
      orderBy: { filePath: 'asc' },
    });

    // Extract unique file paths for standard frontend file search
    const matchingFilePaths = Array.from(new Set(chunks.map((c) => c.filePath)));

    res.status(200).json({
      success: true,
      data: matchingFilePaths,
      symbols: chunks, // Detailed AST symbols for rich explorers
    });
  } catch (error: any) {
    logger.error('❌ [Search Controller] File search failed:', {
      repositoryId,
      query,
      error: error?.message || String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to search files',
      message: error?.message || 'Internal server error',
    });
  }
}

/**
 * GET /api/search/:repositoryId/tree
 *
 * Feature 09: Builds repository file & directory hierarchy with chunk metadata.
 */
export async function getRepositoryTree(req: Request, res: Response): Promise<void> {
  const { repositoryId } = req.params;
  const user = req.user!;

  try {
    const repository = await prisma.repository.findFirst({
      where: {
        id: repositoryId,
        userId: user.id,
      },
    });

    if (!repository) {
      res.status(404).json({ success: false, error: 'Repository not found or access denied' });
      return;
    }

    // Retrieve all chunks grouped by file
    const chunks = await prisma.codeChunk.findMany({
      where: { repositoryId },
      select: {
        filePath: true,
        language: true,
        chunkType: true,
        name: true,
        startLine: true,
        endLine: true,
      },
      orderBy: { filePath: 'asc' },
    });

    // Group into structured file tree metadata
    const fileMap = new Map<string, { filePath: string; language: string; symbolsCount: number; symbols: any[] }>();

    chunks.forEach((chunk) => {
      const existing = fileMap.get(chunk.filePath);
      if (existing) {
        existing.symbolsCount += 1;
        existing.symbols.push({ name: chunk.name, type: chunk.chunkType, lines: `${chunk.startLine}-${chunk.endLine}` });
      } else {
        fileMap.set(chunk.filePath, {
          filePath: chunk.filePath,
          language: chunk.language,
          symbolsCount: 1,
          symbols: [{ name: chunk.name, type: chunk.chunkType, lines: `${chunk.startLine}-${chunk.endLine}` }],
        });
      }
    });

    res.status(200).json({
      success: true,
      data: {
        totalFiles: fileMap.size,
        files: Array.from(fileMap.values()),
      },
    });
  } catch (error: any) {
    logger.error('❌ [Search Controller] Failed to fetch repository tree:', {
      repositoryId,
      error: error?.message || String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch repository tree',
      message: error?.message || 'Internal server error',
    });
  }
}