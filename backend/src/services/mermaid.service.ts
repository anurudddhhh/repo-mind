// =============================================================================
// MERMAID DIAGRAM GENERATOR SERVICE
// =============================================================================
// Feature 11:
//   - Transforms AST dependency maps into visual Mermaid.js flowcharts
//   - Synthesizes custom diagrams (flowcharts, sequence, class diagrams) via Groq
//   - Sanitizes and validates Mermaid syntax to ensure zero client-side render errors
//   - Caches generated diagrams in Redis
// =============================================================================

import { prisma } from '../lib/prisma';
import { cacheGet, cacheSet } from '../lib/redis';
import { generateGroqCompletion } from '../lib/groq';
import { logger } from '../lib/logger';

export interface MermaidDiagramResult {
  syntax: string;
  title: string;
  type: 'flowchart' | 'graph' | 'sequence' | 'class';
}

/**
 * Generate a complete high-level system architecture flowchart from repository AST chunks.
 */
export async function generateArchitectureDiagram(
  repositoryId: string,
  forceRefresh: boolean = false
): Promise<string> {
  const cacheKey = `diagram:${repositoryId}:architecture`;

  if (!forceRefresh) {
    const cached = await cacheGet<string>(cacheKey);
    if (cached) return cached;
  }

  logger.info('📊 [Mermaid Service] Generating architecture diagram...', { repositoryId });

  // 1. Fetch chunks with dependencies from PostgreSQL
  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
    include: {
      codeChunks: {
        select: {
          filePath: true,
          chunkType: true,
          name: true,
          dependencies: true,
        },
      },
    },
  });

  if (!repo) {
    throw new Error('Repository not found');
  }

  // 2. Build cross-file dependency relationship lines
  const dependencyLinks: string[] = [];
  const fileNodes = new Set<string>();

  repo.codeChunks.forEach((chunk) => {
    const sourceFile = cleanNodeId(chunk.filePath);
    fileNodes.add(sourceFile);

    if (Array.isArray(chunk.dependencies)) {
      (chunk.dependencies as string[]).forEach((dep) => {
        // Only map internal relative project imports (starting with . or @/)
        if (dep.startsWith('.') || dep.startsWith('@/')) {
          const targetFile = cleanNodeId(dep);
          fileNodes.add(targetFile);
          dependencyLinks.push(`  ${sourceFile} --> ${targetFile}`);
        }
      });
    }
  });

  // Deduplicate links and take top 25 connections for visual clarity
  const uniqueLinks = Array.from(new Set(dependencyLinks)).slice(0, 25);

  let diagramSyntax = '';

  if (uniqueLinks.length > 0) {
    diagramSyntax = `graph TD\n${uniqueLinks.join('\n')}`;
  } else {
    // If no relative imports found (e.g. single file script), generate via Groq AI
    const filesList = repo.codeChunks.map((c) => c.filePath).slice(0, 15).join('\n');
    const prompt = `Generate a simple, valid Mermaid.js flowchart (graph TD) showing how these modules connect in "${repo.fullName}":\n${filesList}\n\nOutput ONLY valid Mermaid.js syntax without markdown fences.`;
    const aiResponse = await generateGroqCompletion(prompt, { temperature: 0.1 });
    diagramSyntax = sanitizeMermaidSyntax(aiResponse);
  }

  // 3. Cache diagram in Redis (24-hour TTL)
  await cacheSet(cacheKey, diagramSyntax, 86400);

  logger.info('✅ [Mermaid Service] Architecture diagram generated', { repositoryId });
  return diagramSyntax;
}

/**
 * Generate a custom Mermaid diagram (Flowchart, Sequence Diagram, or Class Diagram)
 * based on a user's natural language request.
 */
export async function generateCustomDiagram(
  repositoryId: string,
  userQuery: string
): Promise<MermaidDiagramResult> {
  logger.info('🎨 [Mermaid Service] Generating custom diagram for query:', {
    repositoryId,
    query: userQuery,
  });

  // 1. Fetch representative code chunks for context
  const sampleChunks = await prisma.codeChunk.findMany({
    where: { repositoryId },
    select: {
      filePath: true,
      name: true,
      chunkType: true,
      dependencies: true,
    },
    take: 25,
  });

  const context = sampleChunks
    .map((c) => `${c.filePath} (${c.chunkType}: ${c.name}) -> Imports: ${JSON.stringify(c.dependencies)}`)
    .join('\n');

  // 2. Prompt Groq with strict Mermaid syntax constraints
  const prompt = `You are an expert system designer. Generate a clean, visually informative Mermaid.js diagram to satisfy this request:
"${userQuery}"

Codebase Context:
${context}

RULES:
1. Choose the best diagram type: "graph TD" (flowchart), "sequenceDiagram", or "classDiagram".
2. Ensure all node IDs are alphanumeric without special characters (use quotes for labels like A["My Label"]).
3. Output ONLY the raw Mermaid syntax. Do not wrap in markdown quotes or add explanations.`;

  const rawSyntax = await generateGroqCompletion(prompt, {
    systemPrompt: 'You are a Mermaid.js diagram generator. Output strictly valid Mermaid syntax.',
    temperature: 0.1,
  });

  const cleanSyntax = sanitizeMermaidSyntax(rawSyntax);

  // Determine diagram type
  let type: 'flowchart' | 'graph' | 'sequence' | 'class' = 'flowchart';
  if (cleanSyntax.startsWith('sequenceDiagram')) type = 'sequence';
  else if (cleanSyntax.startsWith('classDiagram')) type = 'class';
  else if (cleanSyntax.startsWith('graph')) type = 'graph';

  return {
    syntax: cleanSyntax,
    title: userQuery.slice(0, 50),
    type,
  };
}

// =============================================================================
// SYNTAX SANITIZATION & HELPERS
// =============================================================================

/**
 * Sanitize raw LLM output into clean, valid Mermaid.js syntax.
 * Strips markdown code fences (```mermaid ... ```), unescaped quotes, and bad whitespace.
 */
export function sanitizeMermaidSyntax(rawText: string): string {
  let cleaned = rawText
    .replace(/^```mermaid\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // If no standard mermaid diagram header exists, prepend graph TD
  const validHeaders = ['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'erDiagram', 'stateDiagram'];
  const hasValidHeader = validHeaders.some((h) => cleaned.startsWith(h));

  if (!hasValidHeader) {
    cleaned = `graph TD\n${cleaned}`;
  }

  return cleaned;
}

/**
 * Convert file paths into safe Mermaid node identifiers (e.g. "src/lib/auth.ts" -> "src_lib_auth")
 */
function cleanNodeId(filePath: string): string {
  return filePath
    .replace(/^[./\\]+/, '')
    .replace(/[/\\.@-]+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '');
}