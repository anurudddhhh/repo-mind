// =============================================================================
// AI ANALYSIS CONTROLLER
// =============================================================================
// Handles incoming HTTP requests for:
//   - Architecture Summaries (GET /api/analyze/:repoId/architecture)
//   - Bug & Vulnerability Scans (POST /api/analyze/:repoId/bugs)
//   - Technical Documentation (POST /api/analyze/:repoId/docs)
//   - Commit History & Contributor Analytics (GET /api/analyze/:repoId/commits)
//
// Enforces repository ownership and ensures repos are fully indexed before analysis.
// =============================================================================

import type { Request, Response } from 'express';
import '../types';
import { prisma } from '../lib/prisma';
import {
  generateArchitectureSummary,
  detectBugsInRepository,
  generateDocumentation,
} from '../services/analysis.service';
import { analyzeCommitHistory } from '../services/commit.service';
import { logger } from '../lib/logger';

/**
 * GET /api/analyze/:repoId/architecture
 * Query params: ?refresh=true (optional)
 *
 * Returns high-level system architecture, module list, and Mermaid diagram.
 */
export async function getArchitectureSummary(req: Request, res: Response): Promise<void> {
  const { repoId } = req.params;
  const user = req.user!;
  const forceRefresh = req.query.refresh === 'true';

  try {
    // 1. Verify user owns repository
    const repository = await prisma.repository.findFirst({
      where: {
        id: repoId,
        userId: user.id,
      },
    });

    if (!repository) {
      res.status(404).json({
        success: false,
        error: 'Repository not found or access denied',
      });
      return;
    }

    // 2. Verify repository has been indexed
    if (repository.indexingStatus !== 'COMPLETED') {
      res.status(400).json({
        success: false,
        error: 'Repository must be indexed before generating architecture analysis',
      });
      return;
    }

    // 3. Generate or fetch architecture summary
    const summary = await generateArchitectureSummary(repoId, forceRefresh);

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    logger.error('❌ [Analysis Controller] Failed to get architecture summary:', {
      repoId,
      error: error?.message || String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate architecture summary',
      message: error?.message || 'Internal server error',
    });
  }
}

/**
 * POST /api/analyze/:repoId/bugs
 * Query params: ?refresh=true (optional)
 *
 * Scans code chunks for vulnerabilities, memory leaks, and logic flaws.
 */
export async function scanForBugs(req: Request, res: Response): Promise<void> {
  const { repoId } = req.params;
  const user = req.user!;
  const forceRefresh = req.query.refresh === 'true';

  try {
    const repository = await prisma.repository.findFirst({
      where: {
        id: repoId,
        userId: user.id,
      },
    });

    if (!repository) {
      res.status(404).json({
        success: false,
        error: 'Repository not found or access denied',
      });
      return;
    }

    if (repository.indexingStatus !== 'COMPLETED') {
      res.status(400).json({
        success: false,
        error: 'Repository must be indexed before scanning for bugs',
      });
      return;
    }

    const bugResults = await detectBugsInRepository(repoId, forceRefresh);

    res.status(200).json({
      success: true,
      data: bugResults,
    });
  } catch (error: any) {
    logger.error('❌ [Analysis Controller] Failed to scan for bugs:', {
      repoId,
      error: error?.message || String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to scan repository for bugs',
      message: error?.message || 'Internal server error',
    });
  }
}

/**
 * POST /api/analyze/:repoId/docs
 * Body: { filePath?: string } (optional - if omitted, generates full README)
 *
 * Generates technical documentation for a specific file or the entire repository.
 */
export async function getDocumentation(req: Request, res: Response): Promise<void> {
  const { repoId } = req.params;
  const { filePath } = req.body || {};
  const user = req.user!;

  try {
    const repository = await prisma.repository.findFirst({
      where: {
        id: repoId,
        userId: user.id,
      },
    });

    if (!repository) {
      res.status(404).json({
        success: false,
        error: 'Repository not found or access denied',
      });
      return;
    }

    if (repository.indexingStatus !== 'COMPLETED') {
      res.status(400).json({
        success: false,
        error: 'Repository must be indexed before generating documentation',
      });
      return;
    }

    const docs = await generateDocumentation(repoId, filePath);

    res.status(200).json({
      success: true,
      data: docs,
    });
  } catch (error: any) {
    logger.error('❌ [Analysis Controller] Failed to generate documentation:', {
      repoId,
      filePath,
      error: error?.message || String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate documentation',
      message: error?.message || 'Internal server error',
    });
  }
}

/**
 * GET /api/analyze/:repoId/commits
 * Query params: ?refresh=true (optional)
 *
 * Feature 08: Analyzes recent commit history, contributors, and development velocity.
 */
export async function getCommitAnalysis(req: Request, res: Response): Promise<void> {
  const { repoId } = req.params;
  const user = req.user!;
  const forceRefresh = req.query.refresh === 'true';

  try {
    // 1. Verify user owns repository
    const repository = await prisma.repository.findFirst({
      where: {
        id: repoId,
        userId: user.id,
      },
    });

    if (!repository) {
      res.status(404).json({
        success: false,
        error: 'Repository not found or access denied',
      });
      return;
    }

    // 2. Run commit history analysis using user's GitHub access token
    const analysis = await analyzeCommitHistory(
      repoId,
      user.accessToken,
      forceRefresh
    );

    res.status(200).json({
      success: true,
      data: analysis,
    });
  } catch (error: any) {
    logger.error('❌ [Analysis Controller] Failed to analyze commits:', {
      repoId,
      error: error?.message || String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to analyze commit history',
      message: error?.message || 'Internal server error',
    });
  }
}