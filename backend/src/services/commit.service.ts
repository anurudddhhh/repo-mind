// =============================================================================
// COMMIT HISTORY & CONTRIBUTOR ANALYSIS SERVICE
// =============================================================================
// Feature 08:
//   - Fetches recent commit logs from GitHub via Octokit
//   - Aggregates contributor statistics and activity metrics
//   - Uses Groq AI to synthesize changelogs and identify project velocity
//   - Caches results in Redis and PostgreSQL (AnalysisResult table)
// =============================================================================

import { Octokit } from '@octokit/rest';
import { AnalysisType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { cacheGet, cacheSet } from '../lib/redis';
import { generateGroqJSON } from '../lib/groq';
import { logger } from '../lib/logger';

// --- Type Definitions matching Frontend Types ---

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface Contributor {
  username: string;
  avatarUrl: string;
  commits: number;
}

export interface CommitAnalysis {
  summary: string;
  recentCommits: Commit[];
  contributors: Contributor[];
  activityLevel: 'low' | 'medium' | 'high';
}

/**
 * Fetch, analyze, and summarize commit activity for a repository.
 *
 * @param repositoryId - Target repository DB ID
 * @param accessToken - User's GitHub OAuth token
 * @param forceRefresh - Whether to bypass cache and re-analyze
 */
export async function analyzeCommitHistory(
  repositoryId: string,
  accessToken: string,
  forceRefresh: boolean = false
): Promise<CommitAnalysis> {
  const cacheKey = `analysis:${repositoryId}:commits`;

  // 1. Check Redis Cache
  if (!forceRefresh) {
    const cached = await cacheGet<CommitAnalysis>(cacheKey);
    if (cached) {
      logger.info('⚡ [Commit Service] Commit analysis retrieved from Redis cache', { repositoryId });
      return cached;
    }

    // 2. Check Database Cache (AnalysisResult table)
    const dbRecord = await prisma.analysisResult.findUnique({
      where: {
        repositoryId_analysisType: {
          repositoryId,
          analysisType: AnalysisType.COMMIT_HISTORY,
        },
      },
    });

    if (dbRecord && dbRecord.result) {
      const result = dbRecord.result as unknown as CommitAnalysis;
      await cacheSet(cacheKey, result, 86400); // 24hr Redis TTL
      return result;
    }
  }

  logger.info('🔍 [Commit Service] Fetching commit logs from GitHub...', { repositoryId });

  // 3. Find repository info from database
  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repo) {
    throw new Error('Repository not found');
  }

  const octokit = new Octokit({
    auth: accessToken,
    userAgent: 'repo-mind/1.0.0',
  });

  // 4. Fetch up to 30 recent commits from GitHub REST API
  let rawCommits: any[] = [];
  try {
    const { data } = await octokit.repos.listCommits({
      owner: repo.owner,
      repo: repo.name,
      per_page: 30,
    });
    rawCommits = data;
  } catch (error: any) {
    logger.error('❌ [Commit Service] Failed to fetch commits from GitHub:', {
      owner: repo.owner,
      repo: repo.name,
      error: error?.message || String(error),
    });
    throw new Error(`GitHub API Error: ${error?.message || 'Failed to fetch commits'}`);
  }

  if (rawCommits.length === 0) {
    return {
      summary: 'No commits found in this repository.',
      recentCommits: [],
      contributors: [],
      activityLevel: 'low',
    };
  }

  // 5. Structure Commits & Aggregate Contributors
  const contributorMap = new Map<string, { username: string; avatarUrl: string; commits: number }>();
  const recentCommits: Commit[] = [];

  for (const item of rawCommits) {
    const sha = item.sha.slice(0, 7); // Short 7-character commit SHA
    const message = item.commit.message.split('\n')[0]; // First line of commit message
    const authorName = item.author?.login || item.commit.author?.name || 'Unknown';
    const avatarUrl = item.author?.avatar_url || 'https://github.com/ghost.png';
    const date = item.commit.author?.date || new Date().toISOString();
    const url = item.html_url;

    recentCommits.push({
      sha,
      message,
      author: authorName,
      date,
      url,
    });

    // Update contributor tally
    const existing = contributorMap.get(authorName);
    if (existing) {
      existing.commits += 1;
    } else {
      contributorMap.set(authorName, {
        username: authorName,
        avatarUrl,
        commits: 1,
      });
    }
  }

  const contributors: Contributor[] = Array.from(contributorMap.values()).sort(
    (a, b) => b.commits - a.commits
  );

  // 6. Generate AI Insights via Groq
  const commitLogText = recentCommits
    .slice(0, 20)
    .map((c) => `- [${c.date.slice(0, 10)}] ${c.author}: ${c.message}`)
    .join('\n');

  const prompt = `Analyze this recent Git commit history for repository "${repo.fullName}".

Recent Commits:
${commitLogText}

Total Recent Commits: ${recentCommits.length}
Unique Active Contributors: ${contributors.length}

Respond in JSON strictly following this schema:
{
  "summary": "A 2-3 paragraph summary detailing the recent development velocity, primary work areas (features, fixes, refactoring), and contributor collaboration patterns.",
  "activityLevel": "high" | "medium" | "low"
}`;

  const aiInsights = await generateGroqJSON<{ summary: string; activityLevel: 'low' | 'medium' | 'high' }>(
    prompt,
    {
      systemPrompt:
        'You are an Engineering Manager analyzing Git activity and team development velocity.',
      temperature: 0.1,
    }
  );

  const finalAnalysis: CommitAnalysis = {
    summary: aiInsights.summary,
    activityLevel: aiInsights.activityLevel || 'medium',
    recentCommits,
    contributors,
  };

  // 7. Store in PostgreSQL AnalysisResult
  await prisma.analysisResult.upsert({
    where: {
      repositoryId_analysisType: {
        repositoryId,
        analysisType: AnalysisType.COMMIT_HISTORY,
      },
    },
    create: {
      repositoryId,
      analysisType: AnalysisType.COMMIT_HISTORY,
      result: finalAnalysis as any,
      summary: finalAnalysis.summary.slice(0, 250),
    },
    update: {
      result: finalAnalysis as any,
      summary: finalAnalysis.summary.slice(0, 250),
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });

  // 8. Cache in Redis
  await cacheSet(cacheKey, finalAnalysis, 86400);

  logger.info('✅ [Commit Service] Commit analysis completed & cached', {
    repositoryId,
    commitsCount: recentCommits.length,
    contributorsCount: contributors.length,
  });

  return finalAnalysis;
}