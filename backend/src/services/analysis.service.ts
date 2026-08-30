// =============================================================================
// AI CODE ANALYSIS SERVICE
// =============================================================================
// Powers:
//   - Feature 05: Architecture Summary & Module Breakdown
//   - Feature 06: Bug & Vulnerability Detection
//   - Feature 07: AI Technical Documentation Generator
//
// Uses AST metadata from the database and executes structured prompts via Groq.
// Caches all outputs in Redis (Layer 1) and PostgreSQL AnalysisResult (Layer 2).
// =============================================================================

import { AnalysisType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { cacheGet, cacheSet } from '../lib/redis';
import { generateGroqJSON, generateGroqCompletion } from '../lib/groq';
import { logger } from '../lib/logger';

// --- Type Definitions matching Frontend Types ---

export interface ModuleInfo {
  name: string;
  path: string;
  description: string;
  exports: string[];
}

export interface ArchitectureSummary {
  overview: string;
  modules: ModuleInfo[];
  dependencies: string[];
  techStack: string[];
  diagram: string;
}

export interface BugReport {
  severity: 'low' | 'medium' | 'high' | 'critical';
  filePath: string;
  line: number | null;
  description: string;
  suggestion: string;
  codeSnippet: string | null;
}

export interface BugDetectionResult {
  bugs: BugReport[];
  summary: string;
  totalIssues: number;
}

export interface DocumentationResult {
  documentation: string;
  filePath: string;
  generatedAt: string;
}

// =============================================================================
// FEATURE 05: ARCHITECTURE SUMMARY GENERATION
// =============================================================================

/**
 * Generate or retrieve a high-level architectural summary of a repository.
 */
export async function generateArchitectureSummary(
  repositoryId: string,
  forceRefresh: boolean = false
): Promise<ArchitectureSummary> {
  const cacheKey = `analysis:${repositoryId}:architecture`;

  // 1. Check Redis Cache
  if (!forceRefresh) {
    const cached = await cacheGet<ArchitectureSummary>(cacheKey);
    if (cached) {
      logger.info('⚡ [Analysis] Architecture summary retrieved from Redis cache', { repositoryId });
      return cached;
    }

    // 2. Check Database Cache (AnalysisResult table)
    const dbRecord = await prisma.analysisResult.findUnique({
      where: {
        repositoryId_analysisType: {
          repositoryId,
          analysisType: AnalysisType.ARCHITECTURE,
        },
      },
    });

    if (dbRecord && dbRecord.result) {
      const result = dbRecord.result as unknown as ArchitectureSummary;
      await cacheSet(cacheKey, result, 86400); // 24hr Redis TTL
      return result;
    }
  }

  logger.info('🏗️ [Analysis] Generating new architecture summary...', { repositoryId });

  // 3. Gather AST Context from Database
  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
    include: {
      codeChunks: {
        select: {
          filePath: true,
          chunkType: true,
          name: true,
          dependencies: true,
          language: true,
        },
      },
    },
  });

  if (!repo) {
    throw new Error('Repository not found');
  }

  // Aggregate files and cross-file dependencies
  const fileSummary = repo.codeChunks.reduce((acc, chunk) => {
    if (!acc[chunk.filePath]) {
      acc[chunk.filePath] = {
        language: chunk.language,
        elements: [],
        dependencies: new Set<string>(),
      };
    }
    acc[chunk.filePath].elements.push(`${chunk.chunkType}: ${chunk.name}`);
    if (Array.isArray(chunk.dependencies)) {
      (chunk.dependencies as string[]).forEach((d) => acc[chunk.filePath].dependencies.add(d));
    }
    return acc;
  }, {} as Record<string, { language: string; elements: string[]; dependencies: Set<string> }>);

  const contextPrompt = Object.entries(fileSummary)
    .slice(0, 40) // Limit to top 40 files to stay comfortably within token limits
    .map(([file, info]) => {
      return `File: ${file} (${info.language})
  Elements: ${info.elements.slice(0, 10).join(', ')}
  Imports: ${Array.from(info.dependencies).slice(0, 8).join(', ')}`;
    })
    .join('\n\n');

  // 4. Prompt Groq for Structured Architecture Analysis
  const prompt = `Analyze this codebase structure and return a comprehensive architectural summary in JSON format.

Repository: ${repo.fullName}
Primary Language: ${repo.language || 'Unknown'}

Codebase AST Structure:
${contextPrompt}

You MUST respond with a JSON object strictly following this schema:
{
  "overview": "A 2-3 paragraph executive summary of the system architecture, design patterns, and main data flow.",
  "techStack": ["List", "of", "frameworks", "and", "libraries", "detected"],
  "dependencies": ["List", "of", "key", "third-party", "dependencies"],
  "modules": [
    {
      "name": "Module Name (e.g. Auth Service, UI Layer)",
      "path": "Directory or primary file path",
      "description": "What this module handles and its architectural role",
      "exports": ["Key functions or classes it exposes"]
    }
  ],
  "diagram": "graph TD;\\n  Client --> API;\\n  API --> DB;"
}`;

  const result = await generateGroqJSON<ArchitectureSummary>(prompt, {
    systemPrompt:
      'You are a Principal Software Architect. Provide deep, accurate, structured technical insights in valid JSON.',
    temperature: 0.1,
  });

  // Ensure diagram fallback
  if (!result.diagram) {
    result.diagram = 'graph TD;\n  App[Application] --> Core[Core Engine];';
  }

  // 5. Store in PostgreSQL AnalysisResult table
  await prisma.analysisResult.upsert({
    where: {
      repositoryId_analysisType: {
        repositoryId,
        analysisType: AnalysisType.ARCHITECTURE,
      },
    },
    create: {
      repositoryId,
      analysisType: AnalysisType.ARCHITECTURE,
      result: result as any,
      summary: result.overview.slice(0, 250),
    },
    update: {
      result: result as any,
      summary: result.overview.slice(0, 250),
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });

  // 6. Cache in Redis
  await cacheSet(cacheKey, result, 86400);

  logger.info('✅ [Analysis] Architecture summary generated & cached', { repositoryId });
  return result;
}

// =============================================================================
// FEATURE 06: BUG DETECTION & VULNERABILITY ANALYSIS
// =============================================================================

/**
 * Scan repository code chunks for bugs, logic errors, and security issues.
 */
export async function detectBugsInRepository(
  repositoryId: string,
  forceRefresh: boolean = false
): Promise<BugDetectionResult> {
  const cacheKey = `analysis:${repositoryId}:bugs`;

  if (!forceRefresh) {
    const cached = await cacheGet<BugDetectionResult>(cacheKey);
    if (cached) return cached;

    const dbRecord = await prisma.analysisResult.findUnique({
      where: {
        repositoryId_analysisType: {
          repositoryId,
          analysisType: AnalysisType.BUGS,
        },
      },
    });

    if (dbRecord && dbRecord.result) {
      const result = dbRecord.result as unknown as BugDetectionResult;
      await cacheSet(cacheKey, result, 86400);
      return result;
    }
  }

  logger.info('🐞 [Analysis] Running bug & vulnerability scan...', { repositoryId });

  // Fetch sample of critical functional code chunks
  const chunks = await prisma.codeChunk.findMany({
    where: {
      repositoryId,
      chunkType: { in: ['FUNCTION', 'METHOD', 'COMPONENT', 'CLASS'] },
    },
    take: 15,
    orderBy: { createdAt: 'desc' },
  });

  if (chunks.length === 0) {
    return {
      bugs: [],
      summary: 'No functional code blocks found to analyze.',
      totalIssues: 0,
    };
  }

  const codeSnippets = chunks
    .map(
      (c) =>
        `// File: ${c.filePath} (Lines ${c.startLine}-${c.endLine})\n// ${c.chunkType}: ${c.name}\n${c.content.slice(0, 1000)}`
    )
    .join('\n\n--------------------\n\n');

  const prompt = `Review the following code excerpts from the repository for bugs, logic flaws, memory leaks, unhandled exceptions, and security vulnerabilities.

Code to review:
${codeSnippets}

Respond strictly in JSON matching this schema:
{
  "summary": "Brief 1-2 sentence overview of code quality and risk level.",
  "totalIssues": 0,
  "bugs": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "filePath": "relative/file/path",
      "line": 42,
      "description": "Clear explanation of the bug or vulnerability",
      "suggestion": "How to fix the issue",
      "codeSnippet": "The problematic line or block"
    }
  ]
}`;

  const result = await generateGroqJSON<BugDetectionResult>(prompt, {
    systemPrompt:
      'You are a Senior Security Auditor and Code Quality Reviewer. Identify real, actionable issues.',
    temperature: 0.1,
  });

  result.totalIssues = result.bugs.length;

  // Persist to DB & Redis
  await prisma.analysisResult.upsert({
    where: {
      repositoryId_analysisType: {
        repositoryId,
        analysisType: AnalysisType.BUGS,
      },
    },
    create: {
      repositoryId,
      analysisType: AnalysisType.BUGS,
      result: result as any,
      summary: result.summary,
    },
    update: {
      result: result as any,
      summary: result.summary,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });

  await cacheSet(cacheKey, result, 86400);

  logger.info('✅ [Analysis] Bug analysis complete', {
    repositoryId,
    issuesFound: result.totalIssues,
  });

  return result;
}

// =============================================================================
// FEATURE 07: AI DOCUMENTATION GENERATOR
// =============================================================================

/**
 * Generate technical markdown documentation for the repository or a specific file.
 */
export async function generateDocumentation(
  repositoryId: string,
  filePath?: string
): Promise<DocumentationResult> {
  const cacheKey = `analysis:${repositoryId}:docs:${filePath || 'full'}`;

  const cached = await cacheGet<DocumentationResult>(cacheKey);
  if (cached) return cached;

  logger.info('📝 [Analysis] Generating technical documentation...', {
    repositoryId,
    filePath: filePath || 'entire repo',
  });

  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repo) throw new Error('Repository not found');

  let codeContext = '';

  if (filePath) {
    // Specific file docs
    const chunks = await prisma.codeChunk.findMany({
      where: { repositoryId, filePath },
      orderBy: { startLine: 'asc' },
    });
    codeContext = chunks.map((c) => c.content).join('\n\n');
  } else {
    // Overview repository docs
    const chunks = await prisma.codeChunk.findMany({
      where: { repositoryId },
      take: 20,
    });
    codeContext = chunks.map((c) => `// ${c.filePath}\n${c.name} (${c.chunkType})`).join('\n');
  }

  const prompt = filePath
    ? `Write comprehensive developer documentation for the file "${filePath}".
Explain its exports, purpose, functions, parameters, and provide usage examples in Markdown.

Source Content:
${codeContext}`
    : `Generate a production-grade README and technical architectural guide for "${repo.fullName}".
Include:
- Project Overview
- Key Features
- Architecture & Design Patterns
- Setup & Development Instructions

Context:
${codeContext}`;

  const markdownDocs = await generateGroqCompletion(prompt, {
    systemPrompt:
      'You are a Technical Writer creating clear, elegant, and comprehensive documentation in GitHub Flavored Markdown.',
    temperature: 0.2,
  });

  const result: DocumentationResult = {
    documentation: markdownDocs,
    filePath: filePath || 'README.md',
    generatedAt: new Date().toISOString(),
  };

  // Cache in DB if generating full repository documentation
  if (!filePath) {
    await prisma.analysisResult.upsert({
      where: {
        repositoryId_analysisType: {
          repositoryId,
          analysisType: AnalysisType.DOCUMENTATION,
        },
      },
      create: {
        repositoryId,
        analysisType: AnalysisType.DOCUMENTATION,
        result: result as any,
        summary: `Generated documentation for ${repo.fullName}`,
      },
      update: {
        result: result as any,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  }

  await cacheSet(cacheKey, result, 86400);

  logger.info('✅ [Analysis] Documentation generated successfully', { repositoryId });
  return result;
}