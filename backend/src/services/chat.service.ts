// =============================================================================
// RAG CHAT SERVICE WITH CITATIONS & INTERACTIVE MERMAID DIAGRAM INTEGRATION
// =============================================================================
// Feature 04, 11 & Citations:
//   - Performs semantic vector retrieval on Pinecone for code context
//   - Automatically detects diagram/visualization requests and synthesizes Mermaid graphs
//   - Streams responses in real-time token-by-token via Server-Sent Events (SSE)
//   - Sends structured citation metadata linking answers to source files & line ranges
//   - Records conversation sessions and messages in PostgreSQL
// =============================================================================

import type { Response } from 'express';
import { prisma } from '../lib/prisma';
import { getGroqClient } from '../lib/groq';
import { searchRepository } from './search.service';
import type { SearchResult } from './search.service';
import { generateCustomDiagram } from './mermaid.service';
import { logger } from '../lib/logger';

const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

// ─── Citation Types ──────────────────────────────────────────────────────────

/**
 * A single citation entry mapping a reference number to its source location.
 * Sent to the frontend via the `citations` SSE event.
 */
export interface CitationEntry {
  ref: number;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  snippetPreview: string;
}

// ─── SSE Event Types (zero `any`) ────────────────────────────────────────────

type SSEEvent =
  | { event: 'status'; data: { message: string } }
  | { event: 'chunk'; data: { content: string } }
  | { event: 'citations'; data: { citations: CitationEntry[] } }
  | { event: 'done'; data: { message: string } }
  | { event: 'error'; data: { error: string } };

// ─── Main Streaming Handler ──────────────────────────────────────────────────

/**
 * Handle a streaming chat request:
 * 1. Perform semantic vector search for code context.
 * 2. Build numbered citations from retrieved chunks.
 * 3. Check if a Mermaid diagram should be synthesized.
 * 4. Stream Groq completion tokens back via SSE with inline citation markers.
 */
export async function streamChatResponse(
  repositoryId: string,
  userId: string,
  message: string,
  res: Response
): Promise<void> {
  // 1. Setup SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (payload: SSEEvent): void => {
    res.write(`event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`);
  };

  try {
    // 2. Perform Semantic Search to get context
    logger.info('🧠 [Chat] Fetching context for query', { repositoryId, query: message });
    sendEvent({ event: 'status', data: { message: 'Searching repository...' } });

    const contextChunks = await searchRepository(repositoryId, message, 5);

    // 3. Build Citation Map (Feature: Citations)
    //    Each chunk gets a reference number [1], [2], [3]...
    //    The frontend uses this map to render clickable source badges.
    const citations: CitationEntry[] = contextChunks.map((chunk, index) => ({
      ref: index + 1,
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language: chunk.language,
      snippetPreview: chunk.content.slice(0, 120).replace(/\n/g, ' ').trim(),
    }));

    // Send citations to frontend BEFORE streaming text
    if (citations.length > 0) {
      sendEvent({ event: 'citations', data: { citations } });
    }

    // 4. Check for Visual Diagram Request (Feature 11)
    const isDiagramRequested = checkIfDiagramRequested(message);
    let mermaidBlock = '';

    if (isDiagramRequested) {
      sendEvent({ event: 'status', data: { message: 'Generating interactive architecture diagram...' } });
      try {
        const diagramResult = await generateCustomDiagram(repositoryId, message);
        mermaidBlock = `\n\n\`\`\`mermaid\n${diagramResult.syntax}\n\`\`\`\n\n`;
      } catch (diagError) {
        logger.warn('⚠️ [Chat] Failed to generate custom diagram, falling back to text-only', {
          error: diagError instanceof Error ? diagError.message : String(diagError),
        });
      }
    }

    // 5. Build System Prompt with Numbered Context & Citation Instructions
    const systemPrompt = buildSystemPrompt(contextChunks, isDiagramRequested);

    // 6. Create or locate Chat Session in PostgreSQL
    const session = await prisma.chatSession.create({
      data: {
        title: message.substring(0, 50),
        userId,
        repositoryId,
        messages: {
          create: {
            role: 'USER',
            content: message,
          },
        },
      },
    });

    sendEvent({ event: 'status', data: { message: 'Generating response...' } });
    logger.info('🧠 [Chat] Streaming Groq response', { model: MODEL });

    // If diagram was generated, stream diagram block first
    if (mermaidBlock) {
      sendEvent({ event: 'chunk', data: { content: mermaidBlock } });
    }

    // 7. Call Groq API with streaming enabled
    const groq = getGroqClient();
    const stream = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      model: MODEL,
      stream: true,
      temperature: 0.1,
    });

    // 8. Stream text chunks
    let fullResponse = mermaidBlock;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        sendEvent({ event: 'chunk', data: { content } });
      }
    }

    // 9. Save assistant's response to database
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: fullResponse,
        contextChunkIds: contextChunks.map((c) => c.filePath),
      },
    });

    sendEvent({ event: 'done', data: { message: 'Complete' } });
    logger.info('✅ [Chat] Stream complete');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ [Chat] Stream failed', { error: errorMessage });
    sendEvent({ event: 'error', data: { error: 'Failed to generate response' } });
  } finally {
    res.end();
  }
}

// ─── Diagram Detection ───────────────────────────────────────────────────────

/**
 * Detect if the user is asking for a visual flowchart, sequence diagram, or architecture graph.
 */
function checkIfDiagramRequested(query: string): boolean {
  const visualKeywords = [
    'diagram',
    'flowchart',
    'mermaid',
    'visualize',
    'visualization',
    'architecture',
    'flow',
    'sequence diagram',
    'class diagram',
    'show me how',
    'chart',
    'graph',
  ];
  const lower = query.toLowerCase();
  return visualKeywords.some((k) => lower.includes(k));
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

/**
 * Builds the system prompt injecting retrieved code chunks as NUMBERED context.
 * Each chunk is labeled [1], [2], [3]... so the LLM can cite them inline.
 */
function buildSystemPrompt(chunks: SearchResult[], diagramIncluded: boolean): string {
  let contextString = '--- NUMBERED REPOSITORY CONTEXT ---\n\n';

  if (chunks.length === 0) {
    contextString += 'No specific code chunks matched. Answer using high-level engineering reasoning.';
  } else {
    chunks.forEach((chunk, index) => {
      const ref = index + 1;
      contextString += `[${ref}] File: ${chunk.filePath} (Lines ${chunk.startLine}-${chunk.endLine})\n`;
      contextString += `    Language: ${chunk.language}\n`;
      contextString += `    Code:\n\`\`\`${chunk.language}\n${chunk.content}\n\`\`\`\n\n`;
    });
  }

  return `You are Repo-Mind, an expert AI programming assistant and software architect.
You help developers understand, query, and visualize their codebases.

Below are numbered snippets of code from the user's repository that are semantically relevant to their question:
${contextString}

STRICT FORMATTING INSTRUCTIONS (ALWAYS FOLLOW):
1. NEVER use Markdown pipe tables (do NOT use | Column 1 | Column 2 |). Tables look unreadable in streaming chat windows.
2. ALWAYS use structured bullet points and bold section headers instead of tables.
   For example, instead of a table, write:
   ### Layer Name
   - **Key Files**: \`src/file.js\`, \`src/app.js\`
   - **Description**: Concise explanation of what happens.
3. Keep explanations clean, spacious, and developer-friendly with proper paragraph breaks.
4. For code examples, format them with fenced markdown code blocks specifying the language.

CITATION INSTRUCTIONS (CRITICAL):
5. When you reference or describe logic from a specific numbered snippet above, you MUST include the reference number in square brackets immediately after the relevant statement.
   Example: "The OAuth callback exchanges the authorization code for an access token [1] and then generates a JWT [2]."
6. Use the exact format [1], [2], [3] etc. matching the snippet numbers above.
7. Cite at least one source for every factual claim about the codebase. If you are unsure which snippet supports a claim, cite the most relevant one.
8. Do NOT fabricate reference numbers that do not exist in the numbered context above.
${
  diagramIncluded
    ? '9. An interactive Mermaid.js diagram has already been generated above. Provide a concise textual explanation walking through the visual flow.'
    : ''
}`;
}