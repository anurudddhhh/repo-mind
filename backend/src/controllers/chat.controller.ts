// Chat Controller
// Exposes the RAG chat functionality via an HTTP endpoint with self-healing status checks.

import type { Request, Response } from 'express';
import '../types';
import { prisma } from '../lib/prisma';
import { streamChatResponse } from '../services/chat.service';
import { logger } from '../lib/logger';
import { IndexingStatus } from '@prisma/client';

/**
 * POST /api/chat/:repositoryId
 * Body: { message: string }
 */
export async function handleChat(req: Request, res: Response): Promise<void> {
  const { repositoryId } = req.params;
  const { message } = req.body;
  const user = req.user!;

  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ success: false, error: 'A valid text message is required' });
    return;
  }

  try {
    // 1. Verify user access to the repository
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

    // 2. Verify indexing status with automatic fallback self-healing
    if (repository.indexingStatus !== IndexingStatus.COMPLETED) {
      // Check if AST code chunks actually exist in Postgres (resilience fallback)
      const chunkCount = await prisma.codeChunk.count({
        where: { repositoryId: repository.id },
      });

      if (chunkCount > 0) {
        // Chunks exist — self-heal repository status to COMPLETED
        await prisma.repository.update({
          where: { id: repository.id },
          data: { indexingStatus: IndexingStatus.COMPLETED },
        });
        logger.info('🔄 [Chat] Self-healed repository indexingStatus to COMPLETED', {
          repositoryId: repository.id,
          chunksFound: chunkCount,
        });
      } else {
        logger.warn('⚠️ [Chat] Blocked chat request: Repository not indexed', {
          repositoryId: repository.id,
          status: repository.indexingStatus,
        });
        res.status(400).json({
          success: false,
          error: 'Repository is still indexing. Please wait a few seconds and try again.',
        });
        return;
      }
    }

    // 3. Stream RAG Chat response via SSE
    await streamChatResponse(repository.id, user.id, message.trim(), res);
  } catch (error) {
    logger.error('❌ [Chat] Error in chat controller', {
      error: error instanceof Error ? error.message : String(error),
      repositoryId,
      userId: user.id,
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to process chat request',
      });
    }
  }
}