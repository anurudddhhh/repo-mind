// =============================================================================
// RETRIEVAL EVALUATION RUNNER
// =============================================================================
// Measures how well the search pipeline retrieves the correct source files
// for a set of known questions about the Repo-Mind codebase.
//
// USAGE:
//   cd backend
//   $env:NODE_OPTIONS="--max-old-space-size=2048"
//   npx ts-node src/eval/run-eval.ts <repositoryId>
//
// OUTPUT:
//   - Per-question pass/fail with matched files
//   - Overall hit@1, hit@3, hit@5 percentages
//   - Per-category breakdown (auth, chunking, search, etc.)
// =============================================================================

import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../../..', '.env') });

import { readFileSync } from 'fs';
import { join } from 'path';
import { searchRepository, SearchResult } from '../services/search.service';
// ─── Type Definitions ────────────────────────────────────────────────────────

interface EvalQuestion {
  id: number;
  question: string;
  expectedFiles: string[];
  category: string;
}

interface EvalDataset {
  description: string;
  repository: string;
  questions: EvalQuestion[];
}

interface QuestionResult {
  id: number;
  question: string;
  category: string;
  expectedFiles: string[];
  returnedFiles: string[];
  hitAt1: boolean;
  hitAt3: boolean;
  hitAt5: boolean;
  topScore: number;
}

interface CategoryScore {
  total: number;
  hit1: number;
  hit3: number;
  hit5: number;
}

// ─── Path Normalization ──────────────────────────────────────────────────────
// File paths may differ slightly between the dataset and indexed chunks
// (e.g., leading slashes, backslashes on Windows). This normalizes both
// sides so matching is reliable.

function normalizePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase();
}

function isFileMatch(expected: string, actual: string): boolean {
  const normExpected = normalizePath(expected);
  const normActual = normalizePath(actual);

  // Exact match after normalization
  if (normExpected === normActual) return true;

  // Suffix match: expected "backend/src/lib/jwt.ts" should match
  // indexed path "src/lib/jwt.ts" or "backend/src/lib/jwt.ts"
  if (normActual.endsWith(normExpected) || normExpected.endsWith(normActual)) {
    return true;
  }

  // Basename match as last resort (e.g., "jwt.ts" matches "backend/src/lib/jwt.ts")
  const expectedBase = normExpected.split('/').pop();
  const actualBase = normActual.split('/').pop();
  if (expectedBase && actualBase && expectedBase === actualBase) {
    return true;
  }

  return false;
}

// ─── Hit Detection ───────────────────────────────────────────────────────────
// Checks if ANY of the expected files appear in the top-K results.
// A "hit" means the search system successfully retrieved at least one
// relevant file for the given question.

function checkHit(
  results: SearchResult[],
  expectedFiles: string[],
  topK: number
): boolean {
  const topResults = results.slice(0, topK);

  return expectedFiles.some((expected) =>
    topResults.some((result) => isFileMatch(expected, result.filePath))
  );
}

// ─── Main Runner ─────────────────────────────────────────────────────────────

async function runEvaluation(repositoryId: string): Promise<void> {
  // 1. Load the dataset
  const datasetPath = join(__dirname, 'eval-dataset.json');
  let dataset: EvalDataset;

  try {
    const raw = readFileSync(datasetPath, 'utf-8');
    dataset = JSON.parse(raw) as EvalDataset;
  } catch (error) {
    console.error(
      '❌ Failed to load eval-dataset.json:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }

  const questions = dataset.questions;
  console.log('\n' + '='.repeat(70));
  console.log('  REPO-MIND RETRIEVAL EVALUATION');
  console.log('='.repeat(70));
  console.log(`  Repository ID : ${repositoryId}`);
  console.log(`  Dataset       : ${dataset.repository}`);
  console.log(`  Questions     : ${questions.length}`);
  console.log('='.repeat(70) + '\n');

  // 2. Run each question through the real search pipeline
  const results: QuestionResult[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const progress = `[${i + 1}/${questions.length}]`;

    process.stdout.write(`${progress} Searching: "${q.question.slice(0, 55)}..." `);

    try {
      // Fetch top 5 results using the same function the chat and search features use
      await new Promise((resolve) => setTimeout(resolve, 500));
      const searchResults = await searchRepository(repositoryId, q.question, 5);

      const returnedFiles = searchResults.map((r) => r.filePath);
      const hitAt1 = checkHit(searchResults, q.expectedFiles, 1);
      const hitAt3 = checkHit(searchResults, q.expectedFiles, 3);
      const hitAt5 = checkHit(searchResults, q.expectedFiles, 5);

      const status = hitAt5 ? '✅' : '❌';
      console.log(status);

      results.push({
        id: q.id,
        question: q.question,
        category: q.category,
        expectedFiles: q.expectedFiles,
        returnedFiles,
        hitAt1,
        hitAt3,
        hitAt5,
        topScore: searchResults[0]?.score ?? 0,
      });
    } catch (error) {
      console.log('⚠️  ERROR');
      console.error(
        `   ${error instanceof Error ? error.message : String(error)}`
      );

      results.push({
        id: q.id,
        question: q.question,
        category: q.category,
        expectedFiles: q.expectedFiles,
        returnedFiles: [],
        hitAt1: false,
        hitAt3: false,
        hitAt5: false,
        topScore: 0,
      });
    }
  }

  // 3. Calculate overall metrics
  const total = results.length;
  const totalHit1 = results.filter((r) => r.hitAt1).length;
  const totalHit3 = results.filter((r) => r.hitAt3).length;
  const totalHit5 = results.filter((r) => r.hitAt5).length;

  // 4. Calculate per-category metrics
  const categoryMap = new Map<string, CategoryScore>();

  for (const r of results) {
    const existing = categoryMap.get(r.category) || {
      total: 0,
      hit1: 0,
      hit3: 0,
      hit5: 0,
    };
    existing.total += 1;
    if (r.hitAt1) existing.hit1 += 1;
    if (r.hitAt3) existing.hit3 += 1;
    if (r.hitAt5) existing.hit5 += 1;
    categoryMap.set(r.category, existing);
  }

  // 5. Print detailed per-question results
  console.log('\n' + '='.repeat(70));
  console.log('  DETAILED RESULTS');
  console.log('='.repeat(70));

  for (const r of results) {
    const status = r.hitAt5 ? '✅' : '❌';
    console.log(`\n  ${status} Q${r.id}: ${r.question}`);
    console.log(`     Category  : ${r.category}`);
    console.log(`     Expected  : ${r.expectedFiles.join(', ')}`);
    console.log(`     Retrieved : ${r.returnedFiles.slice(0, 5).join(', ') || '(none)'}`);
    console.log(`     Top Score : ${r.topScore.toFixed(3)}`);
    console.log(`     Hit@1=${r.hitAt1}  Hit@3=${r.hitAt3}  Hit@5=${r.hitAt5}`);
  }

  // 6. Print summary
  console.log('\n' + '='.repeat(70));
  console.log('  OVERALL HIT RATES');
  console.log('='.repeat(70));
  console.log(`  Hit@1 : ${totalHit1}/${total}  (${((totalHit1 / total) * 100).toFixed(1)}%)`);
  console.log(`  Hit@3 : ${totalHit3}/${total}  (${((totalHit3 / total) * 100).toFixed(1)}%)`);
  console.log(`  Hit@5 : ${totalHit5}/${total}  (${((totalHit5 / total) * 100).toFixed(1)}%)`);

  // 7. Print per-category breakdown
  console.log('\n' + '='.repeat(70));
  console.log('  PER-CATEGORY BREAKDOWN');
  console.log('='.repeat(70));
  console.log(
    `  ${'Category'.padEnd(12)} ${'Total'.padStart(5)} ${'Hit@1'.padStart(7)} ${'Hit@3'.padStart(7)} ${'Hit@5'.padStart(7)}`
  );
  console.log('  ' + '-'.repeat(42));

  for (const [category, score] of Array.from(categoryMap.entries()).sort()) {
    const pct1 = ((score.hit1 / score.total) * 100).toFixed(0);
    const pct3 = ((score.hit3 / score.total) * 100).toFixed(0);
    const pct5 = ((score.hit5 / score.total) * 100).toFixed(0);
    console.log(
      `  ${category.padEnd(12)} ${String(score.total).padStart(5)} ${`${score.hit1} (${pct1}%)`.padStart(7)} ${`${score.hit3} (${pct3}%)`.padStart(7)} ${`${score.hit5} (${pct5}%)`.padStart(7)}`
    );
  }

  console.log('\n' + '='.repeat(70));
  console.log('  Save these numbers! Re-run after search improvements to compare.');
  console.log('='.repeat(70) + '\n');
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

const repositoryId = process.argv[2];

if (!repositoryId) {
  console.error('\n❌ Usage: npx ts-node src/eval/run-eval.ts <repositoryId>');
  console.error('   Find your repositoryId from the database (Prisma Studio or Neon).\n');
  process.exit(1);
}

runEvaluation(repositoryId)
  .then(() => {
    console.log('✅ Evaluation complete.');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(
      '❌ Evaluation failed:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  });