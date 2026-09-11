// =============================================================================
// SEARCH ROUTES
// =============================================================================
// Exposes:
//   - GET  /api/search/:repositoryId/files  -> Fast structured file & symbol search
//   - GET  /api/search/:repositoryId/tree   -> Repository directory & symbol tree
//   - GET  /api/search/:repositoryId        -> Semantic vector search (query param)
//   - POST /api/search/:repositoryId        -> Semantic vector search (JSON body)
//
// All routes are protected by the `requireAuth` middleware.
// =============================================================================

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  handleSearch,
  searchFiles,
  getRepositoryTree,
} from '../controllers/search.controller';

const searchRouter = Router();

// 1. Feature 09: Fast structured file & symbol search
searchRouter.get('/:repositoryId/files', requireAuth, searchFiles);

// 2. Feature 09: Full repository file tree & AST symbol structure
searchRouter.get('/:repositoryId/tree', requireAuth, getRepositoryTree);

// 3. Feature 03: Semantic vector search (supports both GET and POST formats)
searchRouter.get('/:repositoryId', requireAuth, handleSearch);
searchRouter.post('/:repositoryId', requireAuth, handleSearch);

export default searchRouter;