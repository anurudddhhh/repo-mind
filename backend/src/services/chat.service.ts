// =============================================================================
// RAG CHAT SERVICE WITH INTERACTIVE MERMAID DIAGRAM INTEGRATION
// =============================================================================
// Feature 04 & Feature 11:
//   - Performs semantic vector retrieval on Pinecone for code context
//   - Automatically detects diagram/visualization requests and synthesizes Mermaid graphs
//   - Streams responses in real-time token-by-token via Server-Sent Events (SSE)
//   - Records conversation sessions and messages in PostgreSQL
// =============================================================================

import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { getGroqClient } from '../lib/groq';
import { searchRepository, SearchResult } from './search.service';
import { generateCustomDiagram } from './mermaid.service';
import { logger } from '../lib/logger';

const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

/**
 * Handle a streaming chat request:
 * 1. Perform semantic vector search for code context.
 * 2. Check if a Mermaid diagram should be synthesized.
 * 3. Stream Groq completion tokens back via SSE.
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

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 2. Perform Semantic Search to get context
    logger.info('🧠 [Chat] Fetching context for query', { repositoryId, query: message });
    sendEvent('status', { message: 'Searching repository...' });

    const contextChunks = await searchRepository(repositoryId, message, 5);

    // 3. Check for Visual Diagram Request (Feature 11)
    const isDiagramRequested = checkIfDiagramRequested(message);
    let mermaidBlock = '';

    if (isDiagramRequested) {
      sendEvent('status', { message: 'Generating interactive architecture diagram...' });
      try {
        const diagramResult = await generateCustomDiagram(repositoryId, message);
        mermaidBlock = `\n\n\`\`\`mermaid\n${diagramResult.syntax}\n\`\`\`\n\n`;
      } catch (diagError) {
        logger.warn('⚠️ [Chat] Failed to generate custom diagram, falling back to text-only', { diagError });
      }
    }

    // 4. Build System Prompt with Context
    const systemPrompt = buildSystemPrompt(contextChunks, isDiagramRequested);

    // 5. Create or locate Chat Session in PostgreSQL
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

    sendEvent('status', { message: 'Generating response...' });
    logger.info('🧠 [Chat] Streaming Groq response', { model: MODEL });

    // If diagram was generated, stream diagram block first
    if (mermaidBlock) {
      sendEvent('chunk', { content: mermaidBlock });
    }

    // 6. Call Groq API with streaming enabled
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

    // 7. Stream text chunks
    let fullResponse = mermaidBlock;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        sendEvent('chunk', { content });
      }
    }

    // 8. Save assistant's response to database
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: fullResponse,
        contextChunkIds: contextChunks.map((c) => c.filePath),
      },
    });

    sendEvent('done', { message: 'Complete' });
    logger.info('✅ [Chat] Stream complete');
  } catch (error: any) {
    logger.error('❌ [Chat] Stream failed', {
      error: error?.message || String(error),
    });
    sendEvent('error', { error: 'Failed to generate response' });
  } finally {
    res.end();
  }
}

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

/**
 * Builds the system prompt injecting retrieved code chunks as context.
 */
function buildSystemPrompt(chunks: SearchResult[], diagramIncluded: boolean): string {
  let contextString = '--- REPOSITORY CONTEXT ---\n\n';

  if (chunks.length === 0) {
    contextString += 'No specific code chunks matched. Answer using high-level engineering reasoning.';
  } else {
    chunks.forEach((chunk, index) => {
      contextString += `[Snippet ${index + 1}]\n`;
      contextString += `File: ${chunk.filePath} (Lines ${chunk.startLine}-${chunk.endLine})\n`;
      contextString += `Language: ${chunk.language}\n`;
      contextString += `Code:\n\`\`\`${chunk.language}\n${chunk.content}\n\`\`\`\n\n`;
    });
  }

  return `You are Repo-Mind, an expert AI programming assistant and software architect.
You help developers understand, query, and visualize their codebases.

Below are snippets of code from the user's repository that are semantically relevant to their question:
${contextString}

STRICT FORMATTING INSTRUCTIONS (ALWAYS FOLLOW):
1. NEVER use Markdown pipe tables (do NOT use | Column 1 | Column 2 |). Tables look unreadable in streaming chat windows.
2. ALWAYS use structured bullet points and bold section headers instead of tables.
   For example, instead of a table, write:
   ### Layer Name
   - **Key Files**: \`src/file.js\`, \`src/app.js\`
   - **Description**: Concise explanation of what happens.
3. Mention real file paths when discussing logic (e.g., "In \`src/auth.ts\`...").
4. Keep explanations clean, spacious, and developer-friendly with proper paragraph breaks.
${
  diagramIncluded
    ? '5. An interactive Mermaid.js diagram has already been generated above. Provide a concise textual explanation walking through the visual flow.'
    : '5. For code examples, format them with fenced markdown code blocks specifying the language.'
}`;
}