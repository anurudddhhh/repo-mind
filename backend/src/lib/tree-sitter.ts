// =============================================================================
// TREE-SITTER WASM PARSER ENGINE
// =============================================================================
// Initializes the web-tree-sitter WebAssembly (WASM) runtime
// and manages language parsers for JavaScript, TypeScript, TSX, Python, and more.
// =============================================================================

import path from 'path';
import fs from 'fs';
import { logger } from './logger';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Parser = require('web-tree-sitter');

// TypeScript interfaces for Web-Tree-Sitter AST nodes
export interface SyntaxNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: SyntaxNode[];
  childCount: number;
  child(index: number): SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
}

export interface Tree {
  rootNode: SyntaxNode;
}

export interface ParserInstance {
  parse(input: string): Tree;
  setLanguage(language: unknown): void;
}

// Map of file extensions/aliases to grammar names
const LANGUAGE_MAP: Record<string, string> = {
  // TypeScript & JavaScript
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',

  // Python
  py: 'python',
  python: 'python',

  // Go & Rust
  go: 'go',
  rs: 'rust',
  rust: 'rust',

  // Java & C/C++
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  cs: 'c_sharp',
  csharp: 'c_sharp',
};

// In-memory cache of initialized parsers: grammarName -> Parser instance
const parsersCache = new Map<string, ParserInstance>();

// Initialization state tracking
let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the core Web-Tree-Sitter WASM engine.
 */
async function initializeTreeSitter(): Promise<void> {
  if (isInitialized) return;

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      logger.info('🌲 [TreeSitter] Initializing WebAssembly runtime...');
      await Parser.init();
      isInitialized = true;
      logger.info('✅ [TreeSitter] WASM runtime initialized successfully');
    } catch (error) {
      logger.error('❌ [TreeSitter] Failed to initialize WASM runtime:', error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Locate the .wasm grammar file for a given language.
 */
function getWasmFilePath(grammarName: string): string {
  try {
    const wasmsPackageDir = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
    const wasmPath = path.join(wasmsPackageDir, 'out', `tree-sitter-${grammarName}.wasm`);
    if (fs.existsSync(wasmPath)) {
      return wasmPath;
    }
  } catch {
    // Fallback path resolution
  }

  return path.join(
    process.cwd(),
    'node_modules',
    'tree-sitter-wasms',
    'out',
    `tree-sitter-${grammarName}.wasm`
  );
}

/**
 * Get or load a Parser instance configured for a specific language.
 */
export async function getParserForLanguage(language: string): Promise<ParserInstance | null> {
  const normalizedLang = language.toLowerCase().trim().replace(/^\./, '');
  const grammarName = LANGUAGE_MAP[normalizedLang];

  if (!grammarName) {
    return null;
  }

  const cachedParser = parsersCache.get(grammarName);
  if (cachedParser) {
    return cachedParser;
  }

  try {
    await initializeTreeSitter();

    const wasmPath = getWasmFilePath(grammarName);

    if (!fs.existsSync(wasmPath)) {
      logger.warn(`⚠️ [TreeSitter] Grammar WASM not found: ${wasmPath}`);
      return null;
    }

    // Load language grammar
    const langObj = await Parser.Language.load(wasmPath);
    const parser: ParserInstance = new Parser();
    parser.setLanguage(langObj);

    parsersCache.set(grammarName, parser);
    logger.debug(`🌲 [TreeSitter] Loaded grammar: ${grammarName}`);

    return parser;
  } catch (error) {
    logger.error(`❌ [TreeSitter] Failed to load parser for language "${grammarName}":`, error);
    return null;
  }
}

/**
 * Parse source code into an AST (Abstract Syntax Tree).
 */
export async function parseSourceCode(
  code: string,
  language: string
): Promise<Tree | null> {
  const parser = await getParserForLanguage(language);
  if (!parser) {
    return null;
  }

  try {
    return parser.parse(code);
  } catch (error) {
    logger.error(`❌ [TreeSitter] Error parsing code (${language}):`, error);
    return null;
  }
}

/**
 * Check if AST parsing is supported for a given file path or language extension.
 */
export function isLanguageSupported(filePathOrLang: string): boolean {
  const ext = filePathOrLang.includes('.')
    ? filePathOrLang.split('.').pop()?.toLowerCase() || ''
    : filePathOrLang.toLowerCase();

  return Boolean(LANGUAGE_MAP[ext]);
}

export default parseSourceCode;