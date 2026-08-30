// =============================================================================
// AST-BASED SEMANTIC CHUNKING & DEPENDENCY EXTRACTION SERVICE
// =============================================================================
// Slices source code into intelligent, syntactically meaningful units:
//   - Functions & Arrow Functions (FUNCTION / COMPONENT)
//   - Classes & Methods (CLASS / METHOD)
//   - TypeScript Interfaces & Types (INTERFACE / TYPE)
//   - Import blocks (IMPORT_BLOCK)
//
// Extract file-level import and require statements to build a cross-file
// dependency graph stored directly in the database.
// =============================================================================

import { GitHubFileContent } from '../lib/github';
import { logger } from '../lib/logger';
import { parseSourceCode, isLanguageSupported, SyntaxNode } from '../lib/tree-sitter';

// --- Fallback & Limit Configurations ---
const FALLBACK_CHUNK_SIZE_LINES = 60;
const FALLBACK_OVERLAP_LINES = 10;
const MIN_CHUNK_LINES = 3;
const MAX_CHUNK_LINES = 150; // Break overly large single functions into sub-chunks

/**
 * Standard Chunk Types matching Prisma's ChunkType enum
 */
export type ChunkType =
  | 'FUNCTION'
  | 'CLASS'
  | 'METHOD'
  | 'INTERFACE'
  | 'TYPE'
  | 'COMPONENT'
  | 'MODULE'
  | 'IMPORT_BLOCK'
  | 'OTHER';

/**
 * A semantic code chunk ready for embedding and database storage
 */
export interface ChunkData {
  /** Unique ID: repoId_filePath_chunkIndex */
  id: string;
  /** Semantic type of the code block */
  chunkType: ChunkType;
  /** Name of the function, class, interface, or module */
  name: string;
  /** The formatted source code of this chunk */
  content: string;
  /** File path relative to repo root */
  filePath: string;
  /** 0-based sequence index within its file */
  chunkIndex: number;
  /** 1-based start line in original file */
  startLine: number;
  /** 1-based end line in original file */
  endLine: number;
  /** Programming language detected */
  language: string;
  /** Dependencies or symbols imported/used */
  dependencies: string[];
  /** Repository ID foreign key */
  repositoryId: string;
}

/**
 * Chunk all files from a repository into semantic AST pieces with dependency tracking.
 */
export async function chunkRepositoryFiles(
  files: GitHubFileContent[],
  repositoryId: string
): Promise<ChunkData[]> {
  const allChunks: ChunkData[] = [];

  for (const file of files) {
    if (!file.content || !file.content.trim()) continue;

    try {
      const fileChunks = await chunkSingleFile(file, repositoryId);
      allChunks.push(...fileChunks);
    } catch (error) {
      logger.warn(`⚠️ [Chunking] AST parsing failed for ${file.path}, falling back to line chunking`, {
        error: error instanceof Error ? error.message : String(error),
      });
      const fallbackChunks = fallbackLineChunking(file, repositoryId);
      allChunks.push(...fallbackChunks);
    }
  }

  logger.info('✂️ [Chunking] Semantic AST chunking complete', {
    totalFiles: files.length,
    totalChunks: allChunks.length,
    avgChunksPerFile: files.length > 0 ? (allChunks.length / files.length).toFixed(1) : 0,
  });

  return allChunks;
}

/**
 * Chunk a single file using AST analysis, falling back to line chunking if needed.
 */
export async function chunkSingleFile(
  file: GitHubFileContent,
  repositoryId: string
): Promise<ChunkData[]> {
  const language = file.language || inferLanguageFromPath(file.path);

  // Check if AST parsing is supported for this language
  if (!isLanguageSupported(language)) {
    return fallbackLineChunking(file, repositoryId);
  }

  const tree = await parseSourceCode(file.content, language);
  if (!tree || !tree.rootNode) {
    return fallbackLineChunking(file, repositoryId);
  }

  // 1. Extract file-level dependencies (imports/requires/from statements)
  const fileDependencies = extractDependencies(tree.rootNode, file.content, language);

  // 2. Extract semantic code blocks
  const semanticNodes = extractSemanticNodes(tree.rootNode, file.content, language);

  // If no functions/classes were found (e.g. simple configuration or single script), use fallback
  if (semanticNodes.length === 0) {
    const lineChunks = fallbackLineChunking(file, repositoryId);
    // Even fallback chunks benefit from having file-level dependencies attached!
    return lineChunks.map((c) => ({ ...c, dependencies: fileDependencies }));
  }

  // Convert AST nodes to structured ChunkData objects
  const chunks: ChunkData[] = [];
  let chunkIndex = 0;

  for (const node of semanticNodes) {
    const linesCount = node.endLine - node.startLine + 1;

    // Attach extracted file dependencies to each semantic chunk
    const chunkDeps = Array.from(new Set([...node.dependencies, ...fileDependencies]));

    // If an individual function/class is excessively long (> 150 lines), split it into sub-chunks
    if (linesCount > MAX_CHUNK_LINES) {
      const subChunks = splitLargeNode(node, file, repositoryId, chunkIndex);
      // Map dependencies onto sub-chunks
      chunks.push(...subChunks.map((sc) => ({ ...sc, dependencies: chunkDeps })));
      chunkIndex += subChunks.length;
    } else {
      chunks.push({
        id: buildChunkId(repositoryId, file.path, chunkIndex),
        chunkType: node.chunkType,
        name: node.name,
        content:
          buildChunkHeader(file.path, node.name, node.chunkType, node.startLine, node.endLine) +
          '\n' +
          node.content,
        filePath: file.path,
        chunkIndex,
        startLine: node.startLine,
        endLine: node.endLine,
        language,
        dependencies: chunkDeps,
        repositoryId,
      });
      chunkIndex++;
    }
  }

  return chunks;
}

// =============================================================================
// DEPENDENCY EXTRACTION
// =============================================================================

/**
 * Traverse the AST to scan for all imported modules or external requirements
 */
function extractDependencies(
  rootNode: SyntaxNode,
  sourceCode: string,
  language: string
): string[] {
  const dependencies: string[] = [];

  function visit(node: SyntaxNode) {
    const type = node.type;

    // ─────────────────────────────────────────────────────────────
    // JS / TS Dependency Matching
    // ─────────────────────────────────────────────────────────────
    if (['typescript', 'javascript', 'tsx'].includes(language.toLowerCase())) {
      // 1. ES Import statement: import x from 'y';
      if (type === 'import_statement') {
        const sourceNode = node.childForFieldName('source') || node.children.find((c) => c.type === 'string');
        if (sourceNode) {
          const cleaned = sourceNode.text.replace(/['"`]/g, '').trim();
          if (cleaned) dependencies.push(cleaned);
        }
      }

      // 2. Dynamic Import expression: import('y')
      if (type === 'import_expression') {
        const sourceNode = node.children.find((c) => c.type === 'string');
        if (sourceNode) {
          const cleaned = sourceNode.text.replace(/['"`]/g, '').trim();
          if (cleaned) dependencies.push(cleaned);
        }
      }

      // 3. require calls: const x = require('y')
      if (type === 'call_expression') {
        const functionNode = node.childForFieldName('function') || node.children[0];
        if (functionNode && functionNode.text === 'require') {
          const argsNode = node.childForFieldName('arguments') || node.children.find((c) => c.type === 'arguments');
          if (argsNode) {
            const firstArg = argsNode.children.find((c) => c.type === 'string');
            if (firstArg) {
              const cleaned = firstArg.text.replace(/['"`]/g, '').trim();
              if (cleaned) dependencies.push(cleaned);
            }
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Python Dependency Matching
    // ─────────────────────────────────────────────────────────────
    if (language.toLowerCase() === 'python') {
      // 1. Direct Python imports: import os, sys
      if (type === 'import_statement') {
        node.children.forEach((child) => {
          if (child.type === 'dotted_name') {
            dependencies.push(child.text.trim());
          }
        });
      }

      // 2. Python from imports: from datetime import datetime
      if (type === 'import_from_statement') {
        const moduleNode = node.childForFieldName('module') || node.children.find((c) => c.type === 'dotted_name');
        if (moduleNode) {
          dependencies.push(moduleNode.text.trim());
        }
      }
    }

    // Traverse all children to catch imported modules nested or inline
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  }

  visit(rootNode);

  // Return unique, sorted dependencies
  return Array.from(new Set(dependencies)).sort();
}

// =============================================================================
// AST NODE EXTRACTION & TRAVERSAL
// =============================================================================

interface ExtractedNode {
  chunkType: ChunkType;
  name: string;
  content: string;
  startLine: number;
  endLine: number;
  dependencies: string[];
}

/**
 * Traverse the AST to locate all target declarations (functions, classes, types, etc.)
 */
function extractSemanticNodes(
  rootNode: SyntaxNode,
  sourceCode: string,
  language: string
): ExtractedNode[] {
  const nodes: ExtractedNode[] = [];

  // Helper to extract exact text for a node range
  const getNodeText = (node: SyntaxNode): string => {
    return sourceCode.slice(node.startIndex, node.endIndex);
  };

  /**
   * Recursive visitor traversing top-level and class-level nodes
   */
  function visit(node: SyntaxNode) {
    const nodeType = node.type;

    // ─────────────────────────────────────────────────────────────
    // JavaScript / TypeScript / TSX Declarations
    // ─────────────────────────────────────────────────────────────
    if (['typescript', 'javascript', 'tsx'].includes(language.toLowerCase())) {
      // 1. Function Declarations: function foo() {}
      if (nodeType === 'function_declaration' || nodeType === 'generator_function_declaration') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : 'anonymousFunction';
        const isComp = isComponentName(name);

        nodes.push({
          chunkType: isComp ? 'COMPONENT' : 'FUNCTION',
          name,
          content: getNodeText(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          dependencies: [],
        });
        return; // Don't descend inside function body
      }

      // 2. Variable declarations with arrow functions or function expressions:
      //    const handleClick = () => {} | const Header: React.FC = () => {}
      if (nodeType === 'lexical_declaration' || nodeType === 'variable_declaration') {
        const declarator = node.children.find((c: SyntaxNode) => c.type === 'variable_declarator');
        if (declarator) {
          const init = declarator.childForFieldName('value');
          if (init && (init.type === 'arrow_function' || init.type === 'function_expression')) {
            const nameNode = declarator.childForFieldName('name');
            const name = nameNode ? nameNode.text : 'anonymousFunction';
            const isComp = isComponentName(name);

            nodes.push({
              chunkType: isComp ? 'COMPONENT' : 'FUNCTION',
              name,
              content: getNodeText(node),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              dependencies: [],
            });
            return;
          }
        }
      }

      // 3. Class Declarations: class UserService {}
      if (nodeType === 'class_declaration' || nodeType === 'class') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : 'AnonymousClass';

        nodes.push({
          chunkType: 'CLASS',
          name,
          content: getNodeText(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          dependencies: [],
        });
        return;
      }

      // 4. Interface Declarations: interface UserProfile {}
      if (nodeType === 'interface_declaration') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : 'AnonymousInterface';

        nodes.push({
          chunkType: 'INTERFACE',
          name,
          content: getNodeText(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          dependencies: [],
        });
        return;
      }

      // 5. Type Alias Declarations: type Status = 'active' | 'inactive';
      if (nodeType === 'type_alias_declaration') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : 'AnonymousType';

        nodes.push({
          chunkType: 'TYPE',
          name,
          content: getNodeText(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          dependencies: [],
        });
        return;
      }

      // 6. Export statement wrappers: export const foo = ...
      if (nodeType === 'export_statement') {
        const declaration = node.childForFieldName('declaration');
        if (declaration) {
          visit(declaration);
          return;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Python Declarations
    // ─────────────────────────────────────────────────────────────
    if (language.toLowerCase() === 'python') {
      // 1. Function / Method: def process_data():
      if (nodeType === 'function_definition') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : 'anonymous_func';

        nodes.push({
          chunkType: 'FUNCTION',
          name,
          content: getNodeText(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          dependencies: [],
        });
        return;
      }

      // 2. Class: class DataPipeline:
      if (nodeType === 'class_definition') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : 'AnonymousClass';

        nodes.push({
          chunkType: 'CLASS',
          name,
          content: getNodeText(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          dependencies: [],
        });
        return;
      }
    }

    // Traverse children for nested declarations
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  }

  visit(rootNode);

  // Filter out micro fragments (< 3 lines)
  return nodes.filter((n) => n.endLine - n.startLine + 1 >= MIN_CHUNK_LINES);
}

/**
 * Check if a function name follows React component naming convention (PascalCase)
 */
function isComponentName(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]+$/.test(name) && !['String', 'Number', 'Boolean', 'Object', 'Array'].includes(name);
}

/**
 * Split large AST nodes (> 150 lines) into smaller overlapping sub-chunks
 */
function splitLargeNode(
  node: ExtractedNode,
  file: GitHubFileContent,
  repositoryId: string,
  startChunkIndex: number
): ChunkData[] {
  const lines = node.content.split('\n');
  const chunks: ChunkData[] = [];
  let subIndex = 0;

  for (let start = 0; start < lines.length; start += FALLBACK_CHUNK_SIZE_LINES - FALLBACK_OVERLAP_LINES) {
    const end = Math.min(start + FALLBACK_CHUNK_SIZE_LINES, lines.length);
    const chunkLines = lines.slice(start, end);
    const startLine = node.startLine + start;
    const endLine = node.startLine + end - 1;

    chunks.push({
      id: buildChunkId(repositoryId, file.path, startChunkIndex + subIndex),
      chunkType: node.chunkType,
      name: `${node.name} (Part ${subIndex + 1})`,
      content:
        buildChunkHeader(file.path, `${node.name} [part ${subIndex + 1}]`, node.chunkType, startLine, endLine) +
        '\n' +
        chunkLines.join('\n'),
      filePath: file.path,
      chunkIndex: startChunkIndex + subIndex,
      startLine,
      endLine,
      language: file.language || 'unknown',
      dependencies: node.dependencies,
      repositoryId,
    });

    subIndex++;
    if (end >= lines.length) break;
  }

  return chunks;
}

// =============================================================================
// FALLBACK LINE-BASED CHUNKING
// =============================================================================

function fallbackLineChunking(
  file: GitHubFileContent,
  repositoryId: string
): ChunkData[] {
  const lines = file.content.split('\n');
  const chunks: ChunkData[] = [];
  const language = file.language || inferLanguageFromPath(file.path);

  if (lines.length <= FALLBACK_CHUNK_SIZE_LINES) {
    chunks.push({
      id: buildChunkId(repositoryId, file.path, 0),
      chunkType: 'MODULE',
      name: file.path.split('/').pop() || file.path,
      content: buildChunkHeader(file.path, 'Module', 'MODULE', 1, lines.length) + '\n' + file.content,
      filePath: file.path,
      chunkIndex: 0,
      startLine: 1,
      endLine: lines.length,
      language,
      dependencies: [],
      repositoryId,
    });
    return chunks;
  }

  let chunkIndex = 0;
  for (let start = 0; start < lines.length; start += FALLBACK_CHUNK_SIZE_LINES - FALLBACK_OVERLAP_LINES) {
    const end = Math.min(start + FALLBACK_CHUNK_SIZE_LINES, lines.length);
    const chunkLines = lines.slice(start, end);
    if (chunkLines.length < MIN_CHUNK_LINES && chunkIndex > 0) break;

    const startLine = start + 1;
    const endLine = end;

    chunks.push({
      id: buildChunkId(repositoryId, file.path, chunkIndex),
      chunkType: 'OTHER',
      name: `${file.path.split('/').pop()} (Lines ${startLine}-${endLine})`,
      content: buildChunkHeader(file.path, 'Code Block', 'OTHER', startLine, endLine) + '\n' + chunkLines.join('\n'),
      filePath: file.path,
      chunkIndex,
      startLine,
      endLine,
      language,
      dependencies: [],
      repositoryId,
    });

    chunkIndex++;
    if (end >= lines.length) break;
  }

  return chunks;
}

// =============================================================================
// UTILITIES
// =============================================================================

function buildChunkHeader(
  filePath: string,
  name: string,
  type: ChunkType,
  startLine: number,
  endLine: number
): string {
  return `// File: ${filePath} | ${type}: ${name} (Lines ${startLine}-${endLine})`;
}

function buildChunkId(
  repositoryId: string,
  filePath: string,
  chunkIndex: number
): string {
  const sanitizedPath = filePath.replace(/[/\\.]/g, '_');
  return `${repositoryId}_${sanitizedPath}_${chunkIndex}`;
}

function inferLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext || 'unknown';
}