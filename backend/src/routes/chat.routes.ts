// =============================================================================
// CHAT ROUTES (RATE-LIMITED & PROTECTED)
// =============================================================================
// Exposes real-time streaming RAG AI chat with interactive Mermaid diagramming.
//
// All routes are protected by `requireAuth` and `rateLimitAI` (20 req/min).
// =============================================================================

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { rateLimitAI } from '../middleware/rateLimit.middleware';
import { handleChat } from '../controllers/chat.controller';

const chatRouter = Router();

// Streaming chat endpoint (supports both POST and SSE GET stream triggers)
chatRouter.post('/:repositoryId', requireAuth, rateLimitAI, handleChat);
chatRouter.get('/:repositoryId/stream', requireAuth, rateLimitAI, handleChat);

export default chatRouter;