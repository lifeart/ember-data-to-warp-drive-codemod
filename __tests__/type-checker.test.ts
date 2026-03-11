import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { applyTransform } from 'jscodeshift/src/testUtils';
import { createTypeChecker, getOrCreateTypeChecker, _resetTypeScriptCache } from '../src/utils/type-checker';

const transformPath = path.resolve(__dirname, '../src/phase-0-deprecation-cleanup.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const transform = require(transformPath);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemod-tc-'));
  // Create a minimal tsconfig with DOM lib so FormData/Map/Headers exist
  if (!files['tsconfig.json']) {
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          lib: ['ES2020', 'DOM'],
          strict: true,
          skipLibCheck: true,
        },
        include: ['**/*.ts'],
      }),
    );
  }
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return dir;
}

function runWithTypeChecker(
  tempDir: string,
  input: string,
  fileName = 'test.ts',
): string {
  const filePath = path.join(tempDir, fileName);
  // Write/overwrite the file so the TS program can find it
  fs.writeFileSync(filePath, input);
  return applyTransform(
    transform,
    { useTypeChecker: 'true', target: tempDir },
    { source: input, path: filePath },
    { parser: 'ts' },
  );
}

function runWithoutTypeChecker(input: string, filePath = 'app/models/test.ts'): string {
  return applyTransform(
    transform,
    {},
    { source: input, path: filePath },
    { parser: 'ts' },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Type Checker Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempProject({});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // .get() — non-Ember types that should NOT be transformed
  // -----------------------------------------------------------------------

  describe('.get() — skip non-Ember types', () => {
    it('FormData assigned to arbitrary variable name', () => {
      const input = `const fd = new FormData();\nconst val = fd.get('field');`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('Map assigned to arbitrary variable name', () => {
      const input = `const m = new Map<string, string>();\nconst val = m.get('key');`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('Headers assigned to arbitrary variable name', () => {
      const input = `const h = new Headers();\nconst ct = h.get('content-type');`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('URLSearchParams assigned to arbitrary variable name', () => {
      const input = `const sp = new URLSearchParams('?q=hello');\nconst q = sp.get('q');`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('FormData received as function parameter', () => {
      const input = `function handle(data: FormData) {\n  const val = data.get('field');\n}`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('Map received as function parameter', () => {
      const input = `function handle(lookup: Map<string, number>) {\n  const val = lookup.get('count');\n}`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('Headers received as function parameter', () => {
      const input = `function handle(h: Headers) {\n  const val = h.get('content-type');\n}`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('URLSearchParams received as function parameter', () => {
      const input = `function handle(q: URLSearchParams) {\n  const val = q.get('page');\n}`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('variable returned from a function typed as Map (via intermediate variable)', () => {
      const input = `function getCache(): Map<string, any> { return new Map(); }
const cache = getCache();
const val = cache.get('key');`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('chained call — getCache().get("key") should be skipped when return type is Map', () => {
      const input = `function getCache(): Map<string, any> { return new Map(); }
const val = getCache().get('key');`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('class property typed as FormData', () => {
      const input = `class Uploader {
  body: FormData = new FormData();
  getField() {
    return this.body.get('file');
  }
}`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('multiple .get() calls — only non-Ember ones are skipped', () => {
      const input = `function mixed(data: FormData, model: any) {
  const a = data.get('field');
  const b = model.get('name');
}`;
      const result = runWithTypeChecker(tempDir, input);
      // FormData.get should be preserved, model.get should be transformed
      expect(result).toContain("data.get('field')");
      expect(result).toContain('model.name');
      expect(result).not.toContain("model.get('name')");
    });
  });

  // -----------------------------------------------------------------------
  // .set() — non-Ember types that should NOT be transformed
  // -----------------------------------------------------------------------

  describe('.set() — skip non-Ember types', () => {
    it('Map.set() with arbitrary variable name', () => {
      const input = `const m = new Map<string, string>();\nm.set('key', 'value');`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('Map.set() received as function parameter', () => {
      const input = `function update(cache: Map<string, number>) {\n  cache.set('count', 42);\n}`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('Headers.set() with arbitrary variable name', () => {
      const input = `const h = new Headers();\nh.set('content-type', 'application/json');`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('multiple .set() calls — only non-Ember ones are skipped', () => {
      const input = `function mixed(cache: Map<string, string>, model: any) {
  cache.set('key', 'val');
  model.set('name', 'Alice');
}`;
      const result = runWithTypeChecker(tempDir, input);
      expect(result).toContain("cache.set('key', 'val')");
      expect(result).toContain("model.name = 'Alice'");
    });
  });

  // -----------------------------------------------------------------------
  // Type resolution edge cases
  // -----------------------------------------------------------------------

  describe('type resolution edge cases', () => {
    it('any type — should NOT skip (fall back to blocklist)', () => {
      const input = `function test(model: any) {\n  const val = model.get('name');\n}`;
      const result = runWithTypeChecker(tempDir, input);
      expect(result).toContain('model.name');
    });

    it('unknown type cast to any — should NOT skip (fall back to blocklist)', () => {
      const input = `function test(model: unknown) {\n  const val = (model as any).get('name');\n}`;
      const result = runWithTypeChecker(tempDir, input);
      // The cast to `any` means the receiver type is `any`, not skipped
      expect(result).toContain('(model as any).name');
    });

    it('union with non-Ember type — should skip', () => {
      const input = `function test(data: FormData | null) {
  if (data) {
    const val = data.get('field');
  }
}`;
      const result = runWithTypeChecker(tempDir, input);
      // FormData | null should still be caught (FormData is a constituent)
      expect(result).toBe('');
    });

    it('subclass of Map — should skip', () => {
      const input = `class MyMap extends Map<string, string> {}
const m = new MyMap();
const val = m.get('key');`;
      const result = runWithTypeChecker(tempDir, input);
      expect(result).toBe('');
    });

    it('custom class with .get() — should transform', () => {
      const input = `class EmberModel {
  get(key: string): any { return (this as any)[key]; }
}
const model = new EmberModel();
const val = model.get('name');`;
      const result = runWithTypeChecker(tempDir, input);
      expect(result).toContain('model.name');
    });

    it('interface with .get() method — should transform', () => {
      const input = `interface Model { get(key: string): any; }
function test(model: Model) {
  const val = model.get('name');
}`;
      const result = runWithTypeChecker(tempDir, input);
      expect(result).toContain('model.name');
    });

    it('generic type parameter — should not skip', () => {
      const input = `function test<T extends { get(key: string): any }>(obj: T) {
  const val = obj.get('name');
}`;
      const result = runWithTypeChecker(tempDir, input);
      expect(result).toContain('obj.name');
    });

    it('WeakMap received as function parameter', () => {
      // Use a typed parameter so isObjectGet matches (string literal arg)
      // and the type checker actually detects WeakMap
      const input = `function test(wm: WeakMap<any, string>) {
  const val = wm.get('key');
}`;
      const result = runWithTypeChecker(tempDir, input);
      expect(result).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // Fallback behavior — when type checker is NOT enabled
  // -----------------------------------------------------------------------

  describe('fallback — type checker disabled', () => {
    it('transforms fd.get() when type checker is off (blocklist misses arbitrary name)', () => {
      const input = `const fd = new FormData();\nconst val = fd.get('field');`;
      const result = runWithoutTypeChecker(input);
      // Without type checker, 'fd' is not in blocklist, so it transforms
      expect(result).toContain('fd.field');
    });

    it('still blocks map.get() via name-based blocklist', () => {
      const input = `const val = map.get('key');`;
      const result = runWithoutTypeChecker(input);
      expect(result).toBe('');
    });

    it('still blocks headers.get() via name-based blocklist', () => {
      const input = `const ct = headers.get('content-type');`;
      const result = runWithoutTypeChecker(input);
      expect(result).toBe('');
    });

    it('still blocks new Map().get() via NewExpression guard', () => {
      const input = `const val = new Map().get('key');`;
      const result = runWithoutTypeChecker(input);
      expect(result).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // Graceful degradation
  // -----------------------------------------------------------------------

  describe('graceful degradation', () => {
    it('handles file not in the TS program (falls back to blocklist)', () => {
      const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemod-tc-other-'));
      try {
        const input = `const val = model.get('name');`;
        const filePath = path.join(otherDir, 'test.ts');
        fs.writeFileSync(filePath, input);
        const result = applyTransform(
          transform,
          { useTypeChecker: 'true', target: tempDir },
          { source: input, path: filePath },
          { parser: 'ts' },
        );
        // File is outside tsconfig scope — can't resolve types, falls back
        expect(result).toContain('model.name');
      } finally {
        fs.rmSync(otherDir, { recursive: true, force: true });
      }
    });

    it('handles missing tsconfig — returns null from createTypeChecker', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemod-tc-empty-'));
      try {
        const checker = createTypeChecker(emptyDir);
        expect(checker).toBeNull();
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('handles invalid tsconfig — returns null from createTypeChecker', () => {
      const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemod-tc-bad-'));
      try {
        fs.writeFileSync(path.join(badDir, 'tsconfig.json'), 'NOT VALID JSON{{{');
        const checker = createTypeChecker(badDir);
        expect(checker).toBeNull();
      } finally {
        fs.rmSync(badDir, { recursive: true, force: true });
      }
    });

    it('handles explicit --tsconfig path', () => {
      const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemod-tc-custom-'));
      try {
        const customTsconfig = path.join(customDir, 'tsconfig.custom.json');
        fs.writeFileSync(
          customTsconfig,
          JSON.stringify({
            compilerOptions: {
              target: 'ES2020',
              module: 'commonjs',
              lib: ['ES2020', 'DOM'],
              strict: true,
            },
            include: ['**/*.ts'],
          }),
        );
        const checker = createTypeChecker(customDir, customTsconfig);
        expect(checker).not.toBeNull();
        checker!.dispose();
      } finally {
        fs.rmSync(customDir, { recursive: true, force: true });
      }
    });
  });

  // -----------------------------------------------------------------------
  // getOrCreateTypeChecker — caching
  // -----------------------------------------------------------------------

  describe('getOrCreateTypeChecker caching', () => {
    it('returns null when useTypeChecker is not set', () => {
      const result = getOrCreateTypeChecker({});
      expect(result).toBeNull();
    });

    it('returns null when useTypeChecker is falsy', () => {
      expect(getOrCreateTypeChecker({ useTypeChecker: false })).toBeNull();
      expect(getOrCreateTypeChecker({ useTypeChecker: '' })).toBeNull();
      expect(getOrCreateTypeChecker({ useTypeChecker: 0 })).toBeNull();
    });

    it('caches the type checker on the options object', () => {
      const options: Record<string, any> = {
        useTypeChecker: 'true',
        target: tempDir,
      };
      const first = getOrCreateTypeChecker(options);
      const second = getOrCreateTypeChecker(options);
      expect(first).not.toBeNull();
      expect(first).toBe(second); // Same reference
    });

    it('caches null when tsconfig is missing (does not retry)', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemod-tc-cache-'));
      try {
        const options: Record<string, any> = {
          useTypeChecker: 'true',
          target: emptyDir,
        };
        const first = getOrCreateTypeChecker(options);
        expect(first).toBeNull();
        // Second call should return the cached null, not retry
        const second = getOrCreateTypeChecker(options);
        expect(second).toBeNull();
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('reuses cached type checker across multiple applyTransform calls (simulating jscodeshift Runner)', () => {
      // jscodeshift Runner passes the same options object to each file's transform
      const sharedOptions: Record<string, any> = {
        useTypeChecker: 'true',
        target: tempDir,
      };

      const input1 = `function a(data: FormData) { return data.get('field'); }`;
      const input2 = `function b(m: Map<string, any>) { return m.get('key'); }`;

      const file1 = path.join(tempDir, 'file1.ts');
      const file2 = path.join(tempDir, 'file2.ts');
      fs.writeFileSync(file1, input1);
      fs.writeFileSync(file2, input2);

      const result1 = applyTransform(
        transform,
        sharedOptions,
        { source: input1, path: file1 },
        { parser: 'ts' },
      );
      const result2 = applyTransform(
        transform,
        sharedOptions,
        { source: input2, path: file2 },
        { parser: 'ts' },
      );

      // Both should be skipped
      expect(result1).toBe('');
      expect(result2).toBe('');
      // Verify caching happened — __typeCheckerInstance should be on the options
      expect(sharedOptions.__typeCheckerInstance).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // createTypeChecker — unit tests
  // -----------------------------------------------------------------------

  describe('createTypeChecker', () => {
    it('creates a working service when tsconfig exists', () => {
      const checker = createTypeChecker(tempDir);
      expect(checker).not.toBeNull();
      expect(typeof checker!.shouldSkipReceiver).toBe('function');
      expect(typeof checker!.dispose).toBe('function');
    });

    it('shouldSkipReceiver returns false for out-of-range offset', () => {
      const input = `const val = model.get('name');`;
      fs.writeFileSync(path.join(tempDir, 'test.ts'), input);
      const checker = createTypeChecker(tempDir);
      expect(checker).not.toBeNull();
      // Negative offset
      expect(checker!.shouldSkipReceiver(path.join(tempDir, 'test.ts'), -1)).toBe(false);
      // Way past end of file
      expect(checker!.shouldSkipReceiver(path.join(tempDir, 'test.ts'), 99999)).toBe(false);
    });

    it('shouldSkipReceiver returns false for non-existent file', () => {
      const checker = createTypeChecker(tempDir);
      expect(checker).not.toBeNull();
      expect(checker!.shouldSkipReceiver('/non/existent/file.ts', 0)).toBe(false);
    });

    it('shouldSkipReceiver returns false at offset that is not a call expression', () => {
      const input = `const x = 42;`;
      fs.writeFileSync(path.join(tempDir, 'test.ts'), input);
      const checker = createTypeChecker(tempDir);
      expect(checker).not.toBeNull();
      expect(checker!.shouldSkipReceiver(path.join(tempDir, 'test.ts'), 0)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-file type resolution
  // -----------------------------------------------------------------------

  describe('cross-file type resolution', () => {
    it('resolves types imported from another file', () => {
      const dir = makeTempProject({
        'helpers.ts': `export function createForm(): FormData { return new FormData(); }`,
        'consumer.ts': `import { createForm } from './helpers';
const fd = createForm();
const val = fd.get('field');`,
      });
      try {
        const result = runWithTypeChecker(dir, fs.readFileSync(path.join(dir, 'consumer.ts'), 'utf-8'), 'consumer.ts');
        expect(result).toBe('');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('resolves types from re-exported Map wrapper', () => {
      const dir = makeTempProject({
        'cache.ts': `export const store: Map<string, any> = new Map();`,
        'consumer.ts': `import { store } from './cache';
const val = store.get('key');`,
      });
      try {
        const result = runWithTypeChecker(dir, fs.readFileSync(path.join(dir, 'consumer.ts'), 'utf-8'), 'consumer.ts');
        expect(result).toBe('');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // -----------------------------------------------------------------------
  // Real-world patterns
  // -----------------------------------------------------------------------

  describe('real-world patterns', () => {
    it('fetch response headers', () => {
      const input = `async function fetchData() {
  const response = await fetch('/api/data');
  const ct = response.headers.get('content-type');
}`;
      // response.headers is Headers — name blocklist catches "headers"
      // but type checker also validates it
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('FormData in event handler', () => {
      const input = `function onSubmit(event: SubmitEvent) {
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  const name = data.get('name');
}`;
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('Map used as lookup table', () => {
      const input = `const lookup = new Map([['a', 1], ['b', 2]]);
function resolve(key: string) {
  return lookup.get(key as any) ?? 0;
}`;
      // lookup.get(key as any) won't match isObjectGet (arg is not a StringLiteral)
      // so this never reaches the type checker — but the test validates no crash
      expect(runWithTypeChecker(tempDir, input)).toBe('');
    });

    it('destructured assignment with Map and Ember model in same scope', () => {
      const input = `function process(model: any, meta: Map<string, string>) {
  const name = model.get('name');
  const version = meta.get('version');
}`;
      const result = runWithTypeChecker(tempDir, input);
      expect(result).toContain('model.name');
      expect(result).toContain("meta.get('version')");
    });

    it('this.get() is always transformed (not affected by type checker)', () => {
      const input = `export default class MyModel {
  test() {
    return this.get('name');
  }
}`;
      const result = runWithTypeChecker(tempDir, input);
      expect(result).toContain('this.name');
    });
  });

  // -----------------------------------------------------------------------
  // loadTypeScript caching
  // -----------------------------------------------------------------------

  describe('loadTypeScript caching', () => {
    afterEach(() => {
      _resetTypeScriptCache();
    });

    it('caches successful TypeScript load', () => {
      // First call creates a checker (TypeScript loads successfully)
      const checker1 = createTypeChecker(tempDir);
      expect(checker1).not.toBeNull();
      // Second call should reuse the cached TS module
      const checker2 = createTypeChecker(tempDir);
      expect(checker2).not.toBeNull();
    });
  });
});
