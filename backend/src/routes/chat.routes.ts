// Chat Routes
// POST /api/chat/:repositoryId → Stream RAG chat response via SSE

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { handleChat } from '../controllers/chat.controller';

const chatRouter = Router();

chatRouter.post('/:repositoryId', requireAuth, handleChat);

export default chatRouter;
