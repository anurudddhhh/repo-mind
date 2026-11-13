import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { deleteVectorsByRepository } from '../lib/pinecone';
import { IndexingStatus } from '@prisma/client';
import '../types';

/**
 * GET /api/repositories
 * Returns all repositories for the current user with cache-busting headers
 * and automatic status reconciliation.
 */
export async function getRepositories(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user!;

    // Strictly prevent HTTP 304 browser/proxy caching
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    const repositories = await prisma.repository.findMany({
      where: {
        userId: user.id,
      },
      include: {
        _count: {
          select: { codeChunks: true },
        },
        indexingJobs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const THIRTY_SECONDS_AGO = new Date(Date.now() - 30 * 1000);

    const safeRepositories = await Promise.all(
      repositories.map(async (repo) => {
        let status = repo.indexingStatus;
        const latestJob = repo.indexingJobs[0];
        const chunkCount = repo._count.codeChunks;

        if (status === IndexingStatus.PROCESSING) {
          // Condition 1: Job explicitly completed
          if (latestJob?.status === 'COMPLETED' || chunkCount > 0) {
            // Check if there is a job actively started in the last 30 seconds
            const isActivelyStreaming = latestJob && latestJob.startedAt > THIRTY_SECONDS_AGO && latestJob.status === 'PROCESSING';

            if (!isActivelyStreaming && chunkCount > 0) {
              status = IndexingStatus.COMPLETED;

              // Async update DB flag to COMPLETED
              prisma.repository
                .update({
                  where: { id: repo.id },
                  data: {
                    indexingStatus: IndexingStatus.COMPLETED,
                    lastIndexedAt: new Date(),
                  },
                })
                .catch(() => {});
            }
          }
        }

        const { indexingJobs, _count, ...repoData } = repo;

        return {
          ...repoData,
          indexingStatus: status,
          githubRepoId: repo.githubRepoId.toString(),
        };
      })
    );

    res.json({
      success: true,
      data: safeRepositories,
    });
  } catch (error) {
    logger.error('❌ [Repository] Error fetching repositories', {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user?.id,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch repositories',
    });
  }
}

/**
 * DELETE /api/repositories/:id
 * Deletes a repository and its associated vectors.
 */
export async function deleteRepository(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user!;
    const { id } = req.params;

    // Check if repo exists and belongs to user
    const repo = await prisma.repository.findUnique({
      where: { id },
    });

    if (!repo) {
      res.status(404).json({ success: false, error: 'Repository not found' });
      return;
    }

    if (repo.userId !== user.id) {
      res.status(403).json({ success: false, error: 'Unauthorized to delete this repository' });
      return;
    }

    logger.info('🗑️ [Repository] Initiating deletion', { repoId: id, fullName: repo.fullName });

    // 1. Delete vectors from Pinecone
    try {
      await deleteVectorsByRepository(id);
    } catch (vectorError) {
      logger.error('⚠️ [Repository] Failed to delete vectors, proceeding with DB deletion', {
        error: vectorError instanceof Error ? vectorError.message : String(vectorError),
      });
    }

    // 2. Delete from Database
    await prisma.repository.delete({
      where: { id },
    });

    logger.info('✅ [Repository] Deletion successful', { repoId: id });
    res.json({ success: true, message: 'Repository deleted successfully' });
  } catch (error) {
    logger.error('❌ [Repository] Error deleting repository', {
      error: error instanceof Error ? error.message : String(error),
      repoId: req.params.id,
      userId: req.user?.id,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to delete repository',
    });
  }
}