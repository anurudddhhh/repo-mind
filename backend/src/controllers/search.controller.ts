// Search Controller
// Exposes the semantic search functionality via an HTTP endpoint.

import type { Request, Response } from 'express';
import '@/types';
import { prisma } from '../lib/prisma';
import { searchRepository } from '../services/search.service';

/**
 * POST /api/search/:repositoryId
 * Body: { query: string, topK?: number }
 */
export async function handleSearch(req: Request, res: Response): Promise<void> {
  const { repositoryId } = req.params;
  const { query, topK = 5 } = req.body;
  const user = req.user!;

  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'query is required' });
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

    // 3. Perform the search
    const results = await searchRepository(repository.id, query, topK);

    res.json({
      success: true,
      data: {
        query,
        results,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to perform semantic search',
    });
  }
}
