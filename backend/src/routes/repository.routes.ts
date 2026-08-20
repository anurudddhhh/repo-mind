import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { getRepositories, deleteRepository } from '../controllers/repository.controller';

export const repositoryRoutes = Router();

// GET /api/repositories
repositoryRoutes.get('/', requireAuth, getRepositories);

// DELETE /api/repositories/:id
repositoryRoutes.delete('/:id', requireAuth, deleteRepository);
