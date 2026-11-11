// Indexing Controller
// Orchestrates the streaming repo indexing pipeline:
// GitHub fetch → Filter binaries → Micro-batched AST parse → Postgres insert → Pinecone embed → Memory flush
// Memory safe for 512 MB RAM cloud environments (Render Free Tier).

import type { Request, Response } from 'express';
import '../types';
import { prisma } from '../lib/prisma';
import { createGitHubClient } from '../lib/github';
import { chunkRepositoryFiles } from '../services/chunking.service';
import { embedAndStoreChunks } from '../services/embedding.service';
import { deleteVectorsByRepository } from '../lib/pinecone';
import { logger } from '../lib/logger';
import { ChunkType, IndexingStatus } from '@prisma/client';

// Extensions and directories to strictly ignore during AST parsing
const IGNORED_EXTENSIONS = new Set([
  'wasm', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'svg', 'pdf', 'zip', 'gz',
  'tgz', 'mp4', 'woff', 'woff2', 'ttf', 'eot', 'map', 'min.js', 'min.css'
]);

const IGNORED_PATHS = [
  'node_modules/', '.next/', 'dist/', 'build/', 'coverage/', '.git/',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
];

// Number of source files processed per memory-flush iteration
const FILE_BATCH_SIZE = 5;

/**
 * POST /api/indexing/start
 * Body: { repoUrl: "https://github.com/owner/repo" }
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

  // --- Set up SSE Headers ---
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Ensure headers are immediately flushed over HTTP
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let repositoryId: string | null = null;

  const sendEvent = (data: {
    stage: string;
    message: string;
    progress: number;
    filesProcessed?: number;
    totalFiles?: number;
  }) => {
    if (!res.writableEnded) {
      const payload = repositoryId ? { ...data, repositoryId } : data;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  // Immediate keep-alive ping to open SSE socket
  res.write(': ping\n\n');

  // Send periodic SSE keep-alive heartbeat every 5 seconds
  const keepAliveInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, 5000);

  try {
    // --- Stage 1: Fetch repo info from GitHub ---
    sendEvent({ stage: 'fetching', message: 'Fetching repository info...', progress: 5 });

    const github = createGitHubClient(user.accessToken);
    const repoInfo = await github.getRepoInfo(owner, cleanRepoName);

    // Find existing repository
    const existingRepo = await prisma.repository.findFirst({
      where: {
        OR: [
          { githubRepoId: BigInt(repoInfo.id) },
          { userId: user.id, fullName: repoInfo.fullName },
        ],
      },
    });

    let repository;
    if (existingRepo) {
      repository = await prisma.repository.update({
        where: { id: existingRepo.id },
        data: {
          userId: user.id,
          owner: repoInfo.owner,
          name: repoInfo.name,
          fullName: repoInfo.fullName,
          description: repoInfo.description,
          isPrivate: repoInfo.isPrivate,
          defaultBranch: repoInfo.defaultBranch,
          cloneUrl: `https://github.com/${repoInfo.fullName}.git`,
          indexingStatus: IndexingStatus.PROCESSING,
        },
      });
    } else {
      repository = await prisma.repository.create({
        data: {
          userId: user.id,
          githubRepoId: BigInt(repoInfo.id),
          owner: repoInfo.owner,
          name: repoInfo.name,
          fullName: repoInfo.fullName,
          description: repoInfo.description,
          isPrivate: repoInfo.isPrivate,
          defaultBranch: repoInfo.defaultBranch,
          cloneUrl: `https://github.com/${repoInfo.fullName}.git`,
          indexingStatus: IndexingStatus.PROCESSING,
        },
      });
    }

    repositoryId = repository.id;

    // Create IndexingJob
    const job = await prisma.indexingJob.create({
      data: {
        repositoryId: repository.id,
        status: 'PROCESSING',
      },
    });

    sendEvent({ stage: 'fetching', message: 'Downloading repository files...', progress: 10 });

    // --- Stage 2: Fetch all source files & filter binaries ---
    const rawFiles = await github.getRepositoryFiles(owner, cleanRepoName);
    
    const files = rawFiles.filter((f) => {
      const ext = f.path.split('.').pop()?.toLowerCase() || '';
      if (IGNORED_EXTENSIONS.has(ext)) return false;
      if (IGNORED_PATHS.some((p) => f.path.includes(p))) return false;
      return true;
    });

    sendEvent({
      stage: 'fetching',
      message: `Found ${files.length} indexable code files`,
      progress: 20,
      totalFiles: files.length,
    });

    if (files.length === 0) {
      await prisma.indexingJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await prisma.repository.update({
        where: { id: repository.id },
        data: { indexingStatus: IndexingStatus.COMPLETED, lastIndexedAt: new Date() },
      });
      sendEvent({ stage: 'complete', message: 'No indexable code files found', progress: 100 });
      return;
    }

    // --- Stage 3: Clear old repository vectors & database chunks ---
    sendEvent({ stage: 'embedding', message: 'Preparing clean index state...', progress: 25 });
    await deleteVectorsByRepository(repository.id).catch(() => {});
    await prisma.codeChunk.deleteMany({ where: { repositoryId: repository.id } });

    // --- Stage 4: Micro-batched File Parsing, DB Insertion & Embedding ---
    let totalChunksCreated = 0;
    let totalVectorsStored = 0;

    for (let i = 0; i < files.length; i += FILE_BATCH_SIZE) {
      const fileBatch = files.slice(i, i + FILE_BATCH_SIZE);
      const processedFilesCount = Math.min(i + FILE_BATCH_SIZE, files.length);

      // Progress calculation: 25% -> 95%
      const currentProgress = 25 + Math.round((processedFilesCount / files.length) * 70);

      sendEvent({
        stage: 'parsing',
        message: `Processing files (${processedFilesCount}/${files.length})...`,
        progress: currentProgress,
        filesProcessed: processedFilesCount,
        totalFiles: files.length,
      });

      // Parse AST chunks for current batch only
      const batchChunks = await chunkRepositoryFiles(fileBatch, repository.id);

      if (batchChunks.length > 0) {
        totalChunksCreated += batchChunks.length;

        // 1. Store batch chunks in Postgres
        await prisma.codeChunk.createMany({
          data: batchChunks.map((chunk) => ({
            pineconeId: chunk.id,
            repositoryId: repository.id,
            filePath: chunk.filePath,
            chunkType: chunk.chunkType as ChunkType,
            name: chunk.name.substring(0, 250),
            content: chunk.content,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            language: chunk.language,
            dependencies: chunk.dependencies || [],
          })),
        });

        // 2. Embed and store batch vectors in Pinecone
        const storedBatchVectors = await embedAndStoreChunks(batchChunks);
        totalVectorsStored += storedBatchVectors;
      }

      // Yield V8 event loop for 50ms so Garbage Collector reclaims memory between file batches
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // --- Stage 5: Finalize status in PostgreSQL ---
    sendEvent({ stage: 'storing', message: 'Finalizing database state...', progress: 98 });

    await prisma.repository.update({
      where: { id: repository.id },
      data: {
        indexingStatus: IndexingStatus.COMPLETED,
        lastIndexedAt: new Date(),
      },
    });

    await prisma.indexingJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        totalFiles: files.length,
        chunksCreated: totalChunksCreated,
      },
    });

    // --- Done ---
    sendEvent({
      stage: 'complete',
      message: `Indexed ${files.length} files (${totalChunksCreated} chunks stored)`,
      progress: 100,
    });

    logger.info('✅ [Indexing] Repository streaming pipeline completed', {
      repoId: repository.id,
      files: files.length,
      chunks: totalChunksCreated,
      vectors: totalVectorsStored,
    });
  } catch (error) {
    logger.error('❌ [Indexing] Pipeline failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (repositoryId) {
      await prisma.repository.update({
        where: { id: repositoryId },
        data: { indexingStatus: IndexingStatus.FAILED },
      }).catch(() => {});
    }

    sendEvent({
      stage: 'error',
      message: error instanceof Error ? error.message : 'Indexing failed',
      progress: 0,
    });
  } finally {
    clearInterval(keepAliveInterval);
    if (!res.writableEnded) {
      res.end();
    }
  }
}

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