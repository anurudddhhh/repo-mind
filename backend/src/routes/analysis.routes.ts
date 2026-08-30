// =============================================================================
// AI ANALYSIS ROUTES
// =============================================================================
// Defines HTTP endpoints for AI-driven code analysis:
//   - GET  /api/analyze/:repoId/architecture  -> System architecture summary & diagram
//   - POST /api/analyze/:repoId/bugs          -> Bug & vulnerability detection
//   - POST /api/analyze/:repoId/docs          -> Technical documentation generator
//
// All routes are protected by the `requireAuth` middleware.
// =============================================================================

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  getArchitectureSummary,
  scanForBugs,
  getDocumentation,
} from '../controllers/analysis.controller';

const analysisRouter = Router();

// 1. Feature 05: Architecture Summary & Mermaid Diagram
analysisRouter.get('/:repoId/architecture', requireAuth, getArchitectureSummary);

// 2. Feature 06: Bug & Vulnerability Scan
analysisRouter.post('/:repoId/bugs', requireAuth, scanForBugs);

// 3. Feature 07: AI Technical Documentation & README Generator
analysisRouter.post('/:repoId/docs', requireAuth, getDocumentation);

export default analysisRouter;