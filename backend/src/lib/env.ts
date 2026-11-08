import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from backend directory OR parent directory
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });

if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
  throw new Error('❌ Critical environment variables are missing (JWT_SECRET or DATABASE_URL).');
}