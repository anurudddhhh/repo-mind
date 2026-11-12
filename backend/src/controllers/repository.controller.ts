import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { deleteVectorsByRepository } from '../lib/pinecone';
import { IndexingStatus } from '@prisma/client';
import '../types';

/**
 * GET /api/repositories
 * Returns all repositories for the current user with strict IndexingJob validation.
 */
export async function getRepositories(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user!;
    
    const repositories = await prisma.repository.findMany({
      where: {
        userId: user.id,
      },
      include: {
        indexingJobs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const TEN_MINUTES_AGO = new Date(Date.now() - 10 * 60 * 1000);

    const safeRepositories = await Promise.all(
      repositories.map(async (repo) => {
        let status = repo.indexingStatus;
        const latestJob = repo.indexingJobs[0];

        if (status === IndexingStatus.PROCESSING && latestJob) {
          // Case 1: Job actually finished completely
          if (latestJob.status === 'COMPLETED') {
            status = IndexingStatus.COMPLETED;
            prisma.repository
              .update({
                where: { id: repo.id },
                data: {
                  indexingStatus: IndexingStatus.COMPLETED,
                  lastIndexedAt: latestJob.completedAt || new Date(),
                },
              })
              .catch(() => {});
          } 
          // Case 2: Job crashed or timed out (>10 minutes ago)
          else if (latestJob.startedAt < TEN_MINUTES_AGO) {
            status = IndexingStatus.FAILED;
            prisma.repository
              .update({
                where: { id: repo.id },
                data: { indexingStatus: IndexingStatus.FAILED },
              })
              .catch(() => {});
          }
        }

        const { indexingJobs, ...repoData } = repo;

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