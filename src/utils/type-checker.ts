import * as path from 'path';
import * as fs from 'fs';

/**
 * TypeCheckerService — uses the TypeScript compiler API to resolve
 * the type of `.get()` / `.set()` receivers and skip non-Ember types.
 *
 * This avoids false positives where `FormData.get()`, `Map.get()`, etc.
 * would be incorrectly transformed.
 */

// Lazily loaded TypeScript module
let ts: typeof import('typescript') | null = null;

function loadTypeScript(): typeof import('typescript') | null {
  if (ts !== null) return ts;
  try {
    ts = require('typescript');
    return ts;
  } catch {
    return null;
  }
}

/**
 * Known types whose `.get()` / `.set()` methods should NOT be transformed.
 * These are standard Web/JS APIs, not Ember.
 */
const NON_EMBER_TYPE_NAMES = new Set([
  'Map',
  'WeakMap',
  'ReadonlyMap',
  'Set',
  'WeakSet',
  'Headers',
  'FormData',
  'URLSearchParams',
  'Storage',
  'CSSStyleDeclaration',
  'MediaKeyStatusMap',
  'CacheStorage',
  'Cache',
  'IDBObjectStore',
  'IDBIndex',
  'HTMLFormElement',
  'DOMStringMap',
  'EventTarget',
]);

export interface TypeCheckerService {
  /**
   * Returns true if the `.get()` or `.set()` call at the given file/position
   * has a non-Ember receiver type and should be skipped.
   *
   * Returns false if:
   * - Type info is unavailable for this file
   * - The type is `any`/`unknown` (fall back to blocklist)
   * - The type IS an Ember type (proceed with transform)
   */
  shouldSkipReceiver(filePath: string, offset: number): boolean;

  /**
   * Dispose of the TS program to free memory.
   */
  dispose(): void;
}

/**
 * Create a TypeCheckerService for the given target directory.
 *
 * @param targetDir - The root directory of the project being transformed
 * @param tsconfigPath - Optional explicit path to tsconfig.json
 */
export function createTypeChecker(
  targetDir: string,
  tsconfigPath?: string,
): TypeCheckerService | null {
  const tsModule = loadTypeScript();
  if (!tsModule) {
    console.warn('[type-checker] TypeScript not found, falling back to name-based guards.');
    return null;
  }

  // Find tsconfig.json
  const resolvedTsconfigPath = tsconfigPath
    ? path.resolve(tsconfigPath)
    : tsModule.findConfigFile(
        path.resolve(targetDir),
        tsModule.sys.fileExists,
        'tsconfig.json',
      );

  if (!resolvedTsconfigPath) {
    console.warn('[type-checker] No tsconfig.json found, falling back to name-based guards.');
    return null;
  }

  // Parse tsconfig
  const configFile = tsModule.readConfigFile(resolvedTsconfigPath, tsModule.sys.readFile);
  if (configFile.error) {
    console.warn(
      `[type-checker] Error reading tsconfig.json: ${tsModule.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`,
    );
    return null;
  }

  const configDir = path.dirname(resolvedTsconfigPath);
  const parsedConfig = tsModule.parseJsonConfigFileContent(
    configFile.config,
    tsModule.sys,
    configDir,
  );

  // Check for Glint — try to add .gts/.gjs support
  let glintTransformManager: GlintTransformManager | null = null;
  try {
    glintTransformManager = createGlintTransformManager(tsModule, configDir);
  } catch {
    // Glint not available — that's fine
  }

  // Build compiler options — add .gts/.gjs if Glint is available
  const compilerOptions: import('typescript').CompilerOptions = {
    ...parsedConfig.options,
    // Don't emit anything
    noEmit: true,
    // Be lenient — we only need type info, not error-free compilation
    skipLibCheck: true,
  };

  // Create the program
  let fileNames = parsedConfig.fileNames;

  // If Glint is available, also include .gts/.gjs files
  if (glintTransformManager) {
    const gtsFiles = findGtsFiles(targetDir);
    fileNames = [...fileNames, ...gtsFiles];
  }

  // Create a custom compiler host that can handle .gts/.gjs files
  const host = createCompilerHost(tsModule, compilerOptions, glintTransformManager);

  let program: import('typescript').Program;
  try {
    program = tsModule.createProgram(fileNames, compilerOptions, host);
  } catch (err) {
    console.warn(`[type-checker] Failed to create TS program: ${err}`);
    return null;
  }

  const checker = program.getTypeChecker();

  return {
    shouldSkipReceiver(filePath: string, offset: number): boolean {
      try {
        const resolvedPath = path.resolve(filePath);

        // For .gts/.gjs files, we need the virtual .ts path
        let lookupPath = resolvedPath;
        if (glintTransformManager && (resolvedPath.endsWith('.gts') || resolvedPath.endsWith('.gjs'))) {
          lookupPath = resolvedPath; // The host handles the mapping
        }

        const sourceFile = program.getSourceFile(lookupPath);
        if (!sourceFile) {
          return false; // Can't check — fall back to blocklist
        }

        // Find the token at the given position
        const node = findNodeAtOffset(tsModule, sourceFile, offset);
        if (!node) return false;

        // Walk up to find the CallExpression
        const callExpr = findParentCallExpression(tsModule, node);
        if (!callExpr) return false;

        // Get the receiver of the .get()/.set() call
        const receiver = getCallReceiver(tsModule, callExpr);
        if (!receiver) return false;

        // Get the type of the receiver
        const type = checker.getTypeAtLocation(receiver);

        return isNonEmberType(tsModule, checker, type);
      } catch {
        return false; // On any error, fall back to blocklist
      }
    },

    dispose() {
      // Nothing to explicitly dispose — let GC handle it
    },
  };
}

/**
 * Check if a type (or any constituent of a union) is a known non-Ember type.
 */
function isNonEmberType(
  tsModule: typeof import('typescript'),
  checker: import('typescript').TypeChecker,
  type: import('typescript').Type,
): boolean {
  // For union types, check if ANY constituent is a non-Ember type
  if (type.isUnion()) {
    return type.types.some((t) => isNonEmberType(tsModule, checker, t));
  }

  // Skip `any` and `unknown` — can't determine, fall back to blocklist
  if (type.flags & tsModule.TypeFlags.Any || type.flags & tsModule.TypeFlags.Unknown) {
    return false;
  }

  // Get the type name
  const symbol = type.getSymbol() || type.aliasSymbol;
  if (symbol) {
    const name = symbol.getName();
    if (NON_EMBER_TYPE_NAMES.has(name)) {
      return true;
    }
  }

  // Check the apparent type (for interfaces/type aliases)
  const apparentType = checker.getApparentType(type);
  if (apparentType !== type) {
    const apparentSymbol = apparentType.getSymbol() || apparentType.aliasSymbol;
    if (apparentSymbol) {
      const name = apparentSymbol.getName();
      if (NON_EMBER_TYPE_NAMES.has(name)) {
        return true;
      }
    }
  }

  // Check base types (for classes extending Map, etc.)
  const baseTypes = type.getBaseTypes?.();
  if (baseTypes) {
    for (const baseType of baseTypes) {
      if (isNonEmberType(tsModule, checker, baseType)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find the deepest AST node at a given offset.
 */
function findNodeAtOffset(
  tsModule: typeof import('typescript'),
  sourceFile: import('typescript').SourceFile,
  offset: number,
): import('typescript').Node | undefined {
  if (offset < 0 || offset >= sourceFile.getEnd()) {
    return undefined;
  }

  function visit(node: import('typescript').Node): import('typescript').Node | undefined {
    if (offset < node.getStart(sourceFile) || offset >= node.getEnd()) {
      return undefined;
    }
    // Try children first (depth-first) to find the deepest match
    let result: import('typescript').Node | undefined;
    tsModule.forEachChild(node, (child) => {
      if (!result) {
        result = visit(child);
      }
    });
    return result || node;
  }

  return visit(sourceFile);
}

/**
 * Walk up the AST to find a CallExpression parent.
 */
function findParentCallExpression(
  tsModule: typeof import('typescript'),
  node: import('typescript').Node,
): import('typescript').CallExpression | undefined {
  let current: import('typescript').Node | undefined = node;
  while (current) {
    if (tsModule.isCallExpression(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * Get the receiver object from a call expression like `receiver.get(...)`.
 */
function getCallReceiver(
  tsModule: typeof import('typescript'),
  callExpr: import('typescript').CallExpression,
): import('typescript').Expression | undefined {
  const expr = callExpr.expression;
  if (tsModule.isPropertyAccessExpression(expr)) {
    return expr.expression;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Glint support
// ---------------------------------------------------------------------------

interface GlintTransformManager {
  /**
   * Transform a .gts/.gjs source into valid TypeScript for type checking.
   * Returns null if the file cannot be processed.
   */
  transformGtsSource(filePath: string, source: string): string | null;
}

/**
 * Try to create a Glint-based transform manager for .gts/.gjs files.
 * Falls back to a simple approach: strip <template> blocks and replace
 * with placeholder code that the TS compiler can parse.
 */
function createGlintTransformManager(
  _tsModule: typeof import('typescript'),
  _configDir: string,
): GlintTransformManager | null {
  // Try to load content-tag for parsing <template> blocks
  let Preprocessor: any;
  try {
    Preprocessor = require('content-tag').Preprocessor;
  } catch {
    return null;
  }

  return {
    transformGtsSource(_filePath: string, source: string): string | null {
      try {
        const preprocessor = new Preprocessor();
        const parsed = preprocessor.parse(source);

        if (parsed.length === 0) {
          return source;
        }

        // Replace <template> blocks with valid TS placeholders
        // We reuse the same approach as gts-support.ts
        let result = source;
        for (let i = parsed.length - 1; i >= 0; i--) {
          const p = parsed[i];
          const startByte = p.range.startByte ?? p.range.start;
          const endByte = p.range.endByte ?? p.range.end;

          let placeholder: string;
          if (p.type === 'expression') {
            // Module-level <template> — replace with empty export
            placeholder = `({} as any)`;
          } else {
            // Class member <template> — replace with property
            placeholder = `__template = ({} as any);`;
          }

          result = result.slice(0, startByte) + placeholder + result.slice(endByte);
        }

        return result;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Create a custom TypeScript compiler host that handles .gts/.gjs files.
 */
function createCompilerHost(
  tsModule: typeof import('typescript'),
  options: import('typescript').CompilerOptions,
  glintTransformManager: GlintTransformManager | null,
): import('typescript').CompilerHost {
  const defaultHost = tsModule.createCompilerHost(options);

  return {
    ...defaultHost,
    fileExists(fileName: string): boolean {
      if (glintTransformManager && (fileName.endsWith('.gts') || fileName.endsWith('.gjs'))) {
        return fs.existsSync(fileName);
      }
      return defaultHost.fileExists(fileName);
    },
    getSourceFile(fileName, languageVersion, onError?, shouldCreateNewSourceFile?) {
      if (
        glintTransformManager &&
        (fileName.endsWith('.gts') || fileName.endsWith('.gjs'))
      ) {
        try {
          const rawSource = fs.readFileSync(fileName, 'utf-8');
          const transformed = glintTransformManager.transformGtsSource(fileName, rawSource);
          if (transformed) {
            return tsModule.createSourceFile(fileName, transformed, languageVersion, true);
          }
        } catch {
          // Fall through to default
        }
      }
      return defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },
  };
}

/**
 * Find all .gts/.gjs files under a directory.
 */
function findGtsFiles(dir: string): string[] {
  const results: string[] = [];
  const resolvedDir = path.resolve(dir);

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
          continue;
        }
        walk(fullPath);
      } else if (entry.name.endsWith('.gts') || entry.name.endsWith('.gjs')) {
        results.push(fullPath);
      }
    }
  }

  walk(resolvedDir);
  return results;
}

// ---------------------------------------------------------------------------
// Caching: attach the type checker to jscodeshift options for reuse
// ---------------------------------------------------------------------------

const TYPE_CHECKER_KEY = '__typeCheckerInstance';

/**
 * Get or lazily create a TypeCheckerService, caching it on the jscodeshift
 * options object so it persists across file transforms in the same run.
 */
export function getOrCreateTypeChecker(
  options: Record<string, any>,
): TypeCheckerService | null {
  if (!options.useTypeChecker) return null;

  if (options[TYPE_CHECKER_KEY] !== undefined) {
    return options[TYPE_CHECKER_KEY] as TypeCheckerService | null;
  }

  const targetDir = options.target || process.cwd();
  const tsconfigPath = options.tsconfig;

  const checker = createTypeChecker(targetDir, tsconfigPath);
  options[TYPE_CHECKER_KEY] = checker;
  return checker;
}
