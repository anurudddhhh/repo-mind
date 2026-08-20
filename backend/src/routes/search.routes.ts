// Search Routes
// POST /api/search/:repositoryId → Perform semantic search on a repo

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { handleSearch } from '../controllers/search.controller';

const searchRouter = Router();

searchRouter.post('/:repositoryId', requireAuth, handleSearch);

export default searchRouter;
