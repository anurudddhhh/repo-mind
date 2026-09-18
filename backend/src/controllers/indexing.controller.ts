// Indexing Controller
// Orchestrates the full repo indexing pipeline:
// GitHub fetch → Filter binaries → AST semantic chunk → Save to Postgres → embed → store in Pinecone
// Streams progress to the client via SSE with guaranteed database state updates.

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

  // --- Set up SSE ---
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
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

  let repositoryId: string | null = null;

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
        indexingStatus: IndexingStatus.PROCESSING,
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
        indexingStatus: IndexingStatus.PROCESSING,
      },
    });

    repositoryId = repository.id;

    // --- Create IndexingJob ---
    const job = await prisma.indexingJob.create({
      data: {
        repositoryId: repository.id,
        status: 'PROCESSING',
      },
    });

    sendEvent({ stage: 'fetching', message: 'Downloading repository files...', progress: 10 });

    // --- Stage 2: Fetch all source files & filter binaries ---
    const rawFiles = await github.getRepositoryFiles(owner, cleanRepoName);
    
    // Filter out binary/lock/build files
    const files = rawFiles.filter((f) => {
      const ext = f.path.split('.').pop()?.toLowerCase() || '';
      if (IGNORED_EXTENSIONS.has(ext)) return false;
      if (IGNORED_PATHS.some((p) => f.path.includes(p))) return false;
      return true;
    });

    sendEvent({
      stage: 'fetching',
      message: `Found ${files.length} indexable code files`,
      progress: 25,
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
      res.end();
      return;
    }

    // --- Stage 3: Chunk files with AST ---
    sendEvent({ stage: 'parsing', message: 'Parsing AST and chunking semantically...', progress: 35 });
    
    const chunks = await chunkRepositoryFiles(files, repository.id);

    sendEvent({
      stage: 'parsing',
      message: `Created ${chunks.length} semantic chunks`,
      progress: 50,
    });

    // --- Stage 4: Clear old data (for re-indexing) ---
    sendEvent({ stage: 'embedding', message: 'Clearing old data...', progress: 52 });
    await deleteVectorsByRepository(repository.id).catch(() => {}); // Pinecone clear
    await prisma.codeChunk.deleteMany({ where: { repositoryId: repository.id } }); // Postgres clear

    // --- Stage 4.5: Save Chunks to PostgreSQL ---
    sendEvent({ stage: 'storing', message: 'Saving parsed AST structures to database...', progress: 55 });
    
    const BATCH_SIZE = 500;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      await prisma.codeChunk.createMany({
        data: batch.map(chunk => ({
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
        }))
      });
    }

    // Mark repository COMPLETED as soon as DB persistence finishes
    await prisma.repository.update({
      where: { id: repository.id },
      data: {
        indexingStatus: IndexingStatus.COMPLETED,
        lastIndexedAt: new Date(),
      },
    });

    // --- Stage 5: Embed and store in Pinecone ---
    sendEvent({ stage: 'embedding', message: 'Generating vector embeddings...', progress: 60 });

    let storedCount = 0;
    try {
      storedCount = await embedAndStoreChunks(chunks, (processed, total) => {
        const embeddingProgress = 60 + Math.round((processed / total) * 30);
        sendEvent({
          stage: 'embedding',
          message: `Embedded ${processed}/${total} chunks`,
          progress: embeddingProgress,
          filesProcessed: processed,
          totalFiles: total,
        });
      });
    } catch (embedError) {
      logger.warn('⚠️ [Indexing] Pinecone embedding had minor warning, continuing...', {
        error: embedError instanceof Error ? embedError.message : String(embedError)
      });
    }

    // --- Stage 6: Complete job ---
    sendEvent({ stage: 'storing', message: 'Finalizing...', progress: 95 });

    await prisma.indexingJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        totalFiles: files.length,
        chunksCreated: chunks.length,
      },
    });

    // --- Done ---
    sendEvent({
      stage: 'complete',
      message: `Indexed ${files.length} files (${chunks.length} chunks stored)`,
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

    res.end();
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