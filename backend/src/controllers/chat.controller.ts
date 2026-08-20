// Chat Controller
// Exposes the RAG chat functionality via an HTTP endpoint.

import type { Request, Response } from 'express';
import '../types';
import { prisma } from '../lib/prisma';
import { streamChatResponse } from '../services/chat.service';

/**
 * POST /api/chat/:repositoryId
 * Body: { message: string }
 */
export async function handleChat(req: Request, res: Response): Promise<void> {
  const { repositoryId } = req.params;
  const { message } = req.body;
  const user = req.user!;

  if (!message || typeof message !== 'string') {
    res.status(400).json({ success: false, error: 'message is required' });
    return;
  }

  try {
    // 1. Verify the user has access to this repository
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

    // 2. Verify the repository is actually indexed
    if (repository.indexingStatus !== 'COMPLETED') {
      res.status(400).json({
        success: false,
        error: 'Repository is not fully indexed yet',
      });
      return;
    }

    // 3. Hand off to the Chat Service to stream the SSE response
    await streamChatResponse(repository.id, user.id, message, res);
    
    // Note: streamChatResponse handles res.writeHead, res.write, and res.end().
  } catch (error) {
    // If headers are already sent (SSE started), we can't send a 500 JSON response.
    // The service handles sending an 'error' event to the stream instead.
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to process chat request',
      });
    }
  }
}
