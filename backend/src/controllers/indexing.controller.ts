// Indexing Controller
// Orchestrates the full repo indexing pipeline:
// GitHub fetch → chunk → embed → store in Pinecone
// Streams progress to the client via SSE.

import type { Request, Response } from 'express';
import '@/types';
import { prisma } from '@/lib/prisma';
import { createGitHubClient } from '@/lib/github';
import { chunkRepositoryFiles } from '@/services/chunking.service';
import { embedAndStoreChunks } from '@/services/embedding.service';
import { deleteVectorsByRepository } from '@/lib/pinecone';
import { logger } from '@/lib/logger';

/**
 * POST /api/indexing/start
 * Body: { repoUrl: "https://github.com/owner/repo" }
 *
 * Starts indexing a repository. Creates a DB record, then
 * streams SSE progress events as each stage completes.
 */
export async function startIndexing(req: Request, res: Response): Promise<void> {
  const { repoUrl } = req.body;
  const user = req.user!;

  // --- Validate input ---
  if (!repoUrl || typeof repoUrl !== 'string') {
    res.status(400).json({ success: false, error: 'repoUrl is required' });
    return;
  }

  // Parse "owner/repo" from URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/\s#?]+)/);
  if (!match) {
    res.status(400).json({ success: false, error: 'Invalid GitHub repository URL' });
    return;
  }
  const [, owner, repoName] = match;
  const cleanRepoName = repoName.replace(/\.git$/, '');

  // --- Set up SSE ---
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  const sendEvent = (data: {
    stage: string;
    message: string;
    progress: number;
    filesProcessed?: number;
    totalFiles?: number;
  }) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // --- Stage 1: Fetch repo info from GitHub ---
    sendEvent({ stage: 'fetching', message: 'Fetching repository info...', progress: 5 });

    const github = createGitHubClient(user.accessToken);
    const repoInfo = await github.getRepoInfo(owner, cleanRepoName);

    // --- Create or update Repository record ---
    const repository = await prisma.repository.upsert({
      where: {
        userId_fullName: {
          userId: user.id,
          fullName: repoInfo.fullName,
        },
      },
      update: {
        description: repoInfo.description,
        isPrivate: repoInfo.isPrivate,
        defaultBranch: repoInfo.defaultBranch,
      },
      create: {
        userId: user.id,
        githubRepoId: BigInt(repoInfo.id),
        owner: repoInfo.owner,
        name: repoInfo.name,
        fullName: repoInfo.fullName,
        description: repoInfo.description,
        isPrivate: repoInfo.isPrivate,
        defaultBranch: repoInfo.defaultBranch,
        cloneUrl: `https://github.com/${repoInfo.fullName}.git`,
      },
    });

    // --- Create IndexingJob ---
    const job = await prisma.indexingJob.create({
      data: {
        repositoryId: repository.id,
        status: 'PROCESSING',
      },
    });

    sendEvent({ stage: 'fetching', message: 'Downloading repository files...', progress: 10 });

    // --- Stage 2: Fetch all source files ---
    const files = await github.getRepositoryFiles(owner, cleanRepoName);
    sendEvent({
      stage: 'fetching',
      message: `Found ${files.length} indexable files`,
      progress: 25,
      totalFiles: files.length,
    });

    if (files.length === 0) {
      await prisma.indexingJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      sendEvent({ stage: 'complete', message: 'No indexable files found', progress: 100 });
      res.end();
      return;
    }

    // --- Stage 3: Chunk files ---
    sendEvent({ stage: 'parsing', message: 'Chunking files...', progress: 35 });
    const chunks = chunkRepositoryFiles(files, repository.id);
    sendEvent({
      stage: 'parsing',
      message: `Created ${chunks.length} chunks from ${files.length} files`,
      progress: 50,
    });

    // --- Stage 4: Clear old vectors (for re-indexing) ---
    sendEvent({ stage: 'embedding', message: 'Clearing old embeddings...', progress: 55 });
    await deleteVectorsByRepository(repository.id);

    // --- Stage 5: Embed and store ---
    sendEvent({ stage: 'embedding', message: 'Generating embeddings...', progress: 60 });

    const storedCount = await embedAndStoreChunks(chunks, (processed, total) => {
      const embeddingProgress = 60 + Math.round((processed / total) * 30); // 60% → 90%
      sendEvent({
        stage: 'embedding',
        message: `Embedded ${processed}/${total} chunks`,
        progress: embeddingProgress,
        filesProcessed: processed,
        totalFiles: total,
      });
    });

    // --- Stage 6: Update DB records ---
    sendEvent({ stage: 'storing', message: 'Updating database...', progress: 95 });

    await prisma.indexingJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        totalFiles: files.length,
        chunksCreated: chunks.length,
      },
    });

    await prisma.repository.update({
      where: { id: repository.id },
      data: {
        indexingStatus: 'COMPLETED',
        lastIndexedAt: new Date(),
      },
    });

    // --- Done ---
    sendEvent({
      stage: 'complete',
      message: `Indexed ${files.length} files (${storedCount} vectors stored)`,
      progress: 100,
    });

    logger.info('✅ [Indexing] Repository indexed successfully', {
      repoId: repository.id,
      files: files.length,
      chunks: chunks.length,
      vectors: storedCount,
    });

    res.end();
  } catch (error) {
    logger.error('❌ [Indexing] Pipeline failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    sendEvent({
      stage: 'error',
      message: error instanceof Error ? error.message : 'Indexing failed',
      progress: 0,
    });

    res.end();
  }
}

/**
 * GET /api/indexing/status/:repositoryId
 * Returns the latest indexing job status for a repository.
 */
export async function getIndexingStatus(req: Request, res: Response): Promise<void> {
  const { repositoryId } = req.params;

  const job = await prisma.indexingJob.findFirst({
    where: { repositoryId },
    orderBy: { startedAt: 'desc' },
  });

  if (!job) {
    res.status(404).json({ success: false, error: 'No indexing job found' });
    return;
  }

  res.json({
    success: true,
    data: {
      id: job.id,
      status: job.status,
      totalFiles: job.totalFiles,
      chunksCreated: job.chunksCreated,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
  });
}
