// Indexing Routes
// POST /api/indexing/start       → Start indexing a repo (SSE response)
// GET  /api/indexing/status/:id  → Check indexing job status

import { Router } from 'express';
import { requireAuth } from '@/middleware/auth.middleware';
import { startIndexing, getIndexingStatus } from '@/controllers/indexing.controller';

const indexingRouter = Router();

// Both routes require authentication
indexingRouter.post('/start', requireAuth, startIndexing);
indexingRouter.get('/status/:repositoryId', requireAuth, getIndexingStatus);

export default indexingRouter;
