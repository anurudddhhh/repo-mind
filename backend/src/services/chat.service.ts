// Chat Service
// Integrates with Groq API (Llama-3) for RAG-powered chat.
// Streams the AI's response back to the client via SSE.

import { Response } from 'express';
import Groq from 'groq-sdk';
import { prisma } from '@/lib/prisma';
import { searchRepository, SearchResult } from '@/services/search.service';
import { logger } from '@/lib/logger';

// --- Environment validation ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  throw new Error('GROQ_API_KEY is not set in .env');
}

const groq = new Groq({ apiKey: GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'; // Fallback to current model if env missing

/**
 * Handle a chat request: search Pinecone, build prompt, stream response.
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
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 2. Perform Semantic Search to get context
    logger.info('🧠 [Chat] Fetching context for query', { repositoryId });
    sendEvent('status', { message: 'Searching repository...' });
    
    // Get top 5 most relevant code chunks
    const contextChunks = await searchRepository(repositoryId, message, 5);

    // 3. Build the System Prompt with the retrieved context
    const systemPrompt = buildSystemPrompt(contextChunks);

    // 4. Record the user's message in the DB (for history, optionally create session first)
    // For MVP, we'll just create a new session if none exists, or assume a single session.
    // To keep it simple, we'll just create a standalone message or session here.
    const session = await prisma.chatSession.create({
      data: {
        title: message.substring(0, 50) + '...',
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
    logger.info('🧠 [Chat] Streaming Groq response');

    // 5. Call Groq API with streaming enabled
    const stream = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      model: MODEL,
      stream: true,
      temperature: 0.2, // Low temperature for more factual, code-based answers
    });

    // 6. Stream chunks to the client
    let fullResponse = '';
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        sendEvent('chunk', { content });
      }
    }

    // 7. Save the assistant's response to the database
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: fullResponse,
        // Store context used for this response
        contextChunkIds: contextChunks.map(c => c.filePath), 
      },
    });

    sendEvent('done', { message: 'Complete' });
    logger.info('✅ [Chat] Stream complete');

  } catch (error) {
    logger.error('❌ [Chat] Stream failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    sendEvent('error', { error: 'Failed to generate response' });
  } finally {
    res.end();
  }
}

/**
 * Builds the system prompt injecting the retrieved code chunks as context.
 */
function buildSystemPrompt(chunks: SearchResult[]): string {
  if (chunks.length === 0) {
    return `You are Repo-Mind, an AI assistant analyzing a codebase. 
I could not find any specific code snippets relevant to the user's query in the indexed repository. 
Please answer the user's question based on general programming knowledge or ask them to clarify.`;
  }

  let contextString = '--- REPOSITORY CONTEXT ---\n\n';
  
  chunks.forEach((chunk, index) => {
    contextString += `[Snippet ${index + 1}]\n`;
    contextString += `File: ${chunk.filePath} (Lines ${chunk.startLine}-${chunk.endLine})\n`;
    contextString += `Language: ${chunk.language}\n`;
    contextString += `Code:\n\`\`\`${chunk.language}\n${chunk.content}\n\`\`\`\n\n`;
  });

  return `You are Repo-Mind, an expert AI programming assistant. 
You are helping a developer understand their codebase.

Below are snippets of code from the user's repository that are semantically relevant to their question.
Use these snippets to answer their question accurately. 

CRITICAL RULES:
1. ONLY base your answer on the provided context snippets.
2. Do not hallucinate files, functions, or logic that isn't in the context.
3. If the answer is not in the context, explicitly say: "I don't have enough context in the indexed files to answer that."
4. When referencing code, mention the file name (e.g., "In \`src/index.ts\`...").
5. Format code blocks clearly with the correct language tag.

${contextString}`;
}
