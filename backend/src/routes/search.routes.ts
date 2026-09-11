// =============================================================================
// SEARCH ROUTES (RATE-LIMITED & PROTECTED)
// =============================================================================
// Exposes:
//   - GET  /api/search/:repositoryId/files  -> Fast structured file & symbol search
//   - GET  /api/search/:repositoryId/tree   -> Repository directory & symbol tree
//   - GET  /api/search/:repositoryId        -> Semantic vector search (query param)
//   - POST /api/search/:repositoryId        -> Semantic vector search (JSON body)
//
// All routes are protected by `requireAuth` and `rateLimitStandard` (60 req/min).
// =============================================================================

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { rateLimitStandard } from '../middleware/rateLimit.middleware';
import {
  handleSearch,
  searchFiles,
  getRepositoryTree,
} from '../controllers/search.controller';

const searchRouter = Router();

// 1. Feature 09: Fast structured file & symbol search
searchRouter.get('/:repositoryId/files', requireAuth, rateLimitStandard, searchFiles);

// 2. Feature 09: Full repository file tree & AST symbol structure
searchRouter.get('/:repositoryId/tree', requireAuth, rateLimitStandard, getRepositoryTree);

// 3. Feature 03: Semantic vector search (supports both GET and POST formats)
searchRouter.get('/:repositoryId', requireAuth, rateLimitStandard, handleSearch);
searchRouter.post('/:repositoryId', requireAuth, rateLimitStandard, handleSearch);

export default searchRouter;