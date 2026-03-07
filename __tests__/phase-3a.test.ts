import { applyTransform } from 'jscodeshift/src/testUtils';
import * as path from 'path';

const transformPath = path.resolve(__dirname, '../src/phase-3a-model-to-schema.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const transform = require(transformPath);

// Import schema-builder utilities for unit testing
import {
  toPascalCase,
  toCamelCase,
  buildSchemaFile,
  buildModelStub,
  classifyMembersForSchema,
} from '../src/utils/schema-builder';
import type { SchemaInfo } from '../src/utils/schema-builder';

function makeSchemaInfo(overrides: Partial<SchemaInfo> & { modelName: string }): SchemaInfo {
  const pascal = toPascalCase(overrides.modelName);
  return {
    className: pascal,
    schemaVarName: `${pascal}Schema`,
    extensionVarName: `${pascal}Extension`,
    selfTypeName: `${pascal}Self`,
    typeAliasName: pascal,
    fields: [],
    localFields: [],
    services: [],
    features: [],
    namedExports: [],
    parentClass: 'Model',
    appName: 'brn',
    customTransforms: {},
    isTypeScript: true,
    ...overrides,
  };
}

function runTransform(
  input: string,
  filePath = 'app/models/signal.ts',
  options: Record<string, any> = {},
): string {
  return applyTransform(
    transform,
    { appName: 'brn', dryRun: true, ...options },
    { source: input, path: filePath },
    { parser: 'ts' },
  );
}

describe('Phase 3a: Model to Schema', () => {
  describe('simple model extraction', () => {
    it('should generate a model stub for a simple model', () => {
      const input = `import Model, { attr, belongsTo } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export default class Signal extends Model {
  declare [Type]: 'signal';
  @attr('string') name!: string;
  @attr('number') frequency!: number;
  @belongsTo('task', { async: false, inverse: null }) task!: Task;
}`;
      const result = runTransform(input, 'app/models/signal.ts');
      expect(result).toContain("export type { Signal as default } from 'brn/schemas/signal'");
    });
  });

  describe('base-only class skipping', () => {
    it('should skip CompletionDependent base class', () => {
      const input = `import Model from '@warp-drive/legacy/model';

export default class CompletionDependentModel extends Model {
  get isCompleted() { return false; }
}`;
      const result = runTransform(input, 'app/models/completion-dependent.ts');
      expect(result).toBe('');
    });

    it('should skip CompletionDependent class', () => {
      const input = `import Model from '@warp-drive/legacy/model';
export default class CompletionDependent extends Model {}`;
      const result = runTransform(input, 'app/models/completion-dependent.ts');
      expect(result).toBe('');
    });
  });

  describe('named exports preservation', () => {
    it('should re-export named exports from the stub', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export interface IStatsObject {
  countedSeconds: number;
  exerciseId: string;
}

export default class Exercise extends Model {
  declare [Type]: 'exercise';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/exercise.ts');
      expect(result).toContain("export type { IStatsObject } from 'brn/schemas/exercise'");
    });

    it('should re-export type aliases', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export type ExerciseType = 'SINGLE_SIMPLE_WORDS' | 'PHRASES';

export default class Exercise extends Model {
  declare [Type]: 'exercise';
  @attr('string') exerciseType!: ExerciseType;
}`;
      const result = runTransform(input, 'app/models/exercise.ts');
      expect(result).toContain("export type { ExerciseType } from 'brn/schemas/exercise'");
    });

    it('should NOT collect non-exported interfaces for re-export from stub', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

interface InternalConfig {
  key: string;
  value: number;
}

export default class Exercise extends Model {
  declare [Type]: 'exercise';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/exercise.ts');
      // Non-exported interfaces should NOT be re-exported from stub
      // because they aren't exported from the original file
      expect(result).not.toContain('InternalConfig');
    });

    it('should NOT collect non-exported type aliases for re-export from stub', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

type InternalStatus = 'active' | 'inactive';

export default class Exercise extends Model {
  declare [Type]: 'exercise';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/exercise.ts');
      // Non-exported type aliases should NOT be re-exported from stub
      expect(result).not.toContain('InternalStatus');
    });

    it('should still collect exported interfaces for re-export from stub', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export interface PublicConfig {
  key: string;
  value: number;
}

interface PrivateConfig {
  secret: string;
}

export default class Exercise extends Model {
  declare [Type]: 'exercise';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/exercise.ts');
      // Exported interfaces should be re-exported
      expect(result).toContain("export type { PublicConfig } from 'brn/schemas/exercise'");
      // Non-exported interfaces should NOT be re-exported
      expect(result).not.toContain('PrivateConfig');
    });

    // M13: Exported const/function/class should be collected and re-exported as value
    it('should re-export exported const as value export', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export const MAX_RETRIES = 3;

export default class Exercise extends Model {
  declare [Type]: 'exercise';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/exercise.ts');
      // Should use value export (not type export) for const
      expect(result).toContain("export { MAX_RETRIES } from 'brn/schemas/exercise'");
      expect(result).not.toContain("export type { MAX_RETRIES }");
    });

    it('should re-export exported function as value export', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export function formatName(name: string): string {
  return name.toUpperCase();
}

export default class Exercise extends Model {
  declare [Type]: 'exercise';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/exercise.ts');
      // Should use value export for function
      expect(result).toContain("export { formatName } from 'brn/schemas/exercise'");
      expect(result).not.toContain("export type { formatName }");
    });

    it('should re-export exported class as value export', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export class ExerciseError extends Error {
  code: string = '';
}

export default class Exercise extends Model {
  declare [Type]: 'exercise';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/exercise.ts');
      // Should use value export for class
      expect(result).toContain("export { ExerciseError } from 'brn/schemas/exercise'");
      expect(result).not.toContain("export type { ExerciseError }");
    });
  });

  describe('model name derivation', () => {
    it('should derive model name from file path', () => {
      const input = `import Model from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';
export default class TaskSignal extends Model {
  declare [Type]: 'task/signal';
}`;
      const result = runTransform(input, 'app/models/task/signal.ts');
      expect(result).toContain('brn/schemas/task/signal');
    });

    it('should handle kebab-case model names', () => {
      const input = `import Model from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';
export default class UserWeeklyStatistics extends Model {
  declare [Type]: 'user-weekly-statistics';
}`;
      const result = runTransform(input, 'app/models/user-weekly-statistics.ts');
      expect(result).toContain('brn/schemas/user-weekly-statistics');
    });
  });

  describe('anonymous default export class', () => {
    it('should handle export default class extends Model (no class name)', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export default class extends Model {
  declare [Type]: 'signal';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/signal.ts');
      // Should derive class name from file path (signal -> Signal)
      expect(result).toContain("export type { Signal as default } from 'brn/schemas/signal'");
    });

    it('should derive PascalCase name from kebab-case file path for anonymous class', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export default class extends Model {
  declare [Type]: 'user-weekly-statistics';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/user-weekly-statistics.ts');
      expect(result).toContain("export type { UserWeeklyStatistics as default } from 'brn/schemas/user-weekly-statistics'");
    });
  });

  describe('non-model files', () => {
    it('should return undefined for files without a Model class', () => {
      const input = `import Component from '@glimmer/component';
export default class Foo extends Component {}`;
      const result = applyTransform(
        transform,
        { appName: 'brn', dryRun: true },
        { source: input, path: 'app/components/foo.ts' },
        { parser: 'ts' },
      );
      expect(result).toBe('');
    });

    it('should return undefined for files not in models directory', () => {
      const input = `import Model from '@warp-drive/legacy/model';
export default class Foo extends Model {}`;
      const result = applyTransform(
        transform,
        { appName: 'brn', dryRun: true },
        { source: input, path: 'app/routes/foo.ts' },
        { parser: 'ts' },
      );
      expect(result).toBe('');
    });
  });

  describe('parent class detection', () => {
    it('should handle models extending other models', () => {
      const input = `import BaseTask from '../task';
import { Type } from '@warp-drive/core/types/symbols';
import { attr } from '@warp-drive/legacy/model';

export default class TaskSignal extends BaseTask {
  declare [Type]: 'task/signal';
  @attr('string') signalType!: string;
}`;
      const result = runTransform(input, 'app/models/task/signal.ts');
      expect(result).toContain("export type { TaskSignal as default } from 'brn/schemas/task/signal'");
    });
  });

  describe('tracked property handling', () => {
    it('should handle @tracked properties as @local fields', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';
import { tracked } from '@glimmer/tracking';

export default class Group extends Model {
  declare [Type]: 'group';
  @attr('string') name!: string;
  @tracked isManuallyCompleted = false;
}`;
      const result = runTransform(input, 'app/models/group.ts');
      // Stub should be generated
      expect(result).toContain("export type { Group as default } from 'brn/schemas/group'");
    });
  });

  describe('service detection', () => {
    it('should handle models with @service injections', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';
import { service } from '@ember/service';

export default class Exercise extends Model {
  declare [Type]: 'exercise';
  @service('audio') audioService!: any;
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/exercise.ts');
      expect(result).toContain("export type { Exercise as default } from 'brn/schemas/exercise'");
    });
  });

  describe('getter/method extraction', () => {
    it('should handle models with getters', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export default class Group extends Model {
  declare [Type]: 'group';
  @attr('string') name!: string;
  get displayName() { return this.name.toUpperCase(); }
}`;
      const result = runTransform(input, 'app/models/group.ts');
      expect(result).toContain("export type { Group as default } from 'brn/schemas/group'");
    });

    it('should handle models with @action methods', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';
import { action } from '@ember/object';

export default class Task extends Model {
  declare [Type]: 'task';
  @attr('string') name!: string;
  @action toggle() { /* ... */ }
}`;
      const result = runTransform(input, 'app/models/task.ts');
      expect(result).toContain("export type { Task as default } from 'brn/schemas/task'");
    });
  });
});

describe('Schema Builder Utilities', () => {
  describe('toPascalCase', () => {
    it('should convert kebab-case to PascalCase', () => {
      expect(toPascalCase('foo-bar')).toBe('FooBar');
    });

    it('should handle nested paths with slashes', () => {
      expect(toPascalCase('task/signal')).toBe('TaskSignal');
    });

    it('should handle underscores', () => {
      expect(toPascalCase('user_weekly_statistics')).toBe('UserWeeklyStatistics');
    });

    it('should handle single word', () => {
      expect(toPascalCase('exercise')).toBe('Exercise');
    });

    it('should handle multiple separators', () => {
      expect(toPascalCase('my-cool_task/sub-type')).toBe('MyCoolTaskSubType');
    });
  });

  describe('toCamelCase', () => {
    it('should convert kebab-case to camelCase', () => {
      expect(toCamelCase('foo-bar')).toBe('fooBar');
    });

    it('should handle single word', () => {
      expect(toCamelCase('exercise')).toBe('exercise');
    });
  });

  describe('classifyMembersForSchema', () => {
    const customTransforms = {
      'full-date': { tsType: 'DateTime', importFrom: 'luxon' },
      array: { tsType: 'unknown[]' },
    };

    it('should classify standard attributes as "attribute"', () => {
      const members = [
        { kind: 'attribute' as const, name: 'name', attrType: 'string', options: null, tsType: 'string' },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      expect(fields[0].kind).toBe('attribute');
      expect(fields[0].name).toBe('name');
      expect(fields[0].type).toBe('string');
    });

    it('should classify custom transforms as "attribute" in LegacyMode', () => {
      const members = [
        { kind: 'attribute' as const, name: 'startDate', attrType: 'full-date', options: null, tsType: null },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      expect(fields[0].kind).toBe('attribute');
      expect(fields[0].type).toBe('full-date');
    });

    it('should classify untyped @attr as "attribute" without type in LegacyMode', () => {
      const members = [
        { kind: 'attribute' as const, name: 'data', attrType: null, options: null, tsType: 'unknown' },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      expect(fields[0].kind).toBe('attribute');
      expect(fields[0].type).toBeUndefined();
    });

    it('should classify empty string attrType as "attribute" without type', () => {
      const members = [
        { kind: 'attribute' as const, name: 'data', attrType: '', options: null, tsType: null },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      expect(fields[0].kind).toBe('attribute');
      expect(fields[0].type).toBeUndefined();
    });

    it('should preserve tsType from original model', () => {
      const members = [
        { kind: 'attribute' as const, name: 'count', attrType: 'number', options: null, tsType: 'number | null' },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      expect(fields[0].tsType).toBe('number | null');
    });

    it('should classify @tracked as @local', () => {
      const members = [
        { kind: 'tracked' as const, name: 'isActive', defaultValue: 'false', tsType: 'boolean' },
      ];
      const { localFields } = classifyMembersForSchema(members, customTransforms);
      expect(localFields[0].kind).toBe('@local');
      expect(localFields[0].name).toBe('isActive');
      expect(localFields[0].defaultValue).toBe('false');
    });

    it('should classify services', () => {
      const members = [
        { kind: 'service' as const, name: 'audioService', serviceName: 'audio' },
      ];
      const { services } = classifyMembersForSchema(members, customTransforms);
      expect(services[0].serviceName).toBe('audio');
    });

    it('should classify @action methods as getter-closure', () => {
      const members = [
        { kind: 'method' as const, name: 'toggle', body: '{ this.isActive = !this.isActive; }', isAction: true },
      ];
      const { features } = classifyMembersForSchema(members, customTransforms);
      expect(features[0].featureKind).toBe('getter-closure');
    });

    it('should classify regular methods as method', () => {
      const members = [
        { kind: 'method' as const, name: 'doSomething', body: '{ return 42; }', isAction: false },
      ];
      const { features } = classifyMembersForSchema(members, customTransforms);
      expect(features[0].featureKind).toBe('method');
    });

    it('should classify getters', () => {
      const members = [
        { kind: 'getter' as const, name: 'displayName', body: '{ return this.name; }', isCached: false },
      ];
      const { features } = classifyMembersForSchema(members, customTransforms);
      expect(features[0].featureKind).toBe('getter');
    });

    it('should classify properties as readonly-value', () => {
      const members = [
        { kind: 'property' as const, name: 'maxRetries', body: '3', tsType: 'number' },
      ];
      const { features } = classifyMembersForSchema(members, customTransforms);
      expect(features[0].featureKind).toBe('readonly-value');
    });

    it('should skip "declare" and "unknown" members', () => {
      const members = [
        { kind: 'declare' as const, name: 'type', tsType: "'foo'" },
        { kind: 'unknown' as const, name: 'weird' },
      ];
      const result = classifyMembersForSchema(members, customTransforms);
      expect(result.fields).toHaveLength(0);
      expect(result.localFields).toHaveLength(0);
      expect(result.services).toHaveLength(0);
      expect(result.features).toHaveLength(0);
    });

    // M11: normalizeRelOptions should handle complex AST values
    it('should handle Identifier values in relationship options', () => {
      const members = [
        {
          kind: 'belongsTo' as const,
          name: 'parent',
          relatedType: 'node',
          options: {
            type: 'ObjectExpression',
            properties: [
              { key: { name: 'async' }, value: { type: 'BooleanLiteral', value: false } },
              { key: { name: 'inverse' }, value: { type: 'Identifier', name: 'INVERSE_NAME' } },
            ],
          },
        },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      expect(fields[0].options!.inverse).toContain("TODO");
      expect(fields[0].options!.inverse).toContain("INVERSE_NAME");
    });

    it('should handle ArrayExpression values in relationship options', () => {
      const members = [
        {
          kind: 'hasMany' as const,
          name: 'items',
          relatedType: 'item',
          options: {
            type: 'ObjectExpression',
            properties: [
              { key: { name: 'async' }, value: { type: 'BooleanLiteral', value: false } },
              {
                key: { name: 'polymorphic' },
                value: {
                  type: 'ArrayExpression',
                  elements: [
                    { type: 'StringLiteral', value: 'photo' },
                    { type: 'StringLiteral', value: 'video' },
                  ],
                },
              },
            ],
          },
        },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      expect(fields[0].options!.polymorphic).toContain("TODO");
      expect(fields[0].options!.polymorphic).toContain("'photo'");
      expect(fields[0].options!.polymorphic).toContain("'video'");
    });

    it('should handle SpreadElement in relationship options', () => {
      const members = [
        {
          kind: 'belongsTo' as const,
          name: 'owner',
          relatedType: 'user',
          options: {
            type: 'ObjectExpression',
            properties: [
              { type: 'SpreadElement', argument: { name: 'sharedOpts' } },
              { key: { name: 'async' }, value: { type: 'BooleanLiteral', value: false } },
            ],
          },
        },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      // Spread should create a TODO marker key
      const keys = Object.keys(fields[0].options!);
      expect(keys.some((k) => k.includes('sharedOpts'))).toBe(true);
    });

    it('should handle computed keys in relationship options', () => {
      const members = [
        {
          kind: 'belongsTo' as const,
          name: 'ref',
          relatedType: 'thing',
          options: {
            type: 'ObjectExpression',
            properties: [
              { computed: true, key: { name: 'dynamicKey' }, value: { type: 'StringLiteral', value: 'val' } },
              { key: { name: 'async' }, value: { type: 'BooleanLiteral', value: false } },
            ],
          },
        },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      const keys = Object.keys(fields[0].options!);
      expect(keys.some((k) => k.includes('computed') && k.includes('dynamicKey'))).toBe(true);
    });

    // Test gap #22: normalizeRelOptions edge cases
    it('should handle options with only async but no inverse', () => {
      const members = [
        {
          kind: 'belongsTo' as const,
          name: 'parent',
          relatedType: 'node',
          options: {
            type: 'ObjectExpression',
            properties: [
              { key: { name: 'async' }, value: { type: 'BooleanLiteral', value: false } },
            ],
          },
        },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      // Should default inverse to null when not provided
      expect(fields[0].options!.async).toBe(false);
      expect(fields[0].options!.inverse).toBeNull();
    });

    it('should handle options with variable references instead of literals', () => {
      const members = [
        {
          kind: 'hasMany' as const,
          name: 'children',
          relatedType: 'node',
          options: {
            type: 'ObjectExpression',
            properties: [
              { key: { name: 'async' }, value: { type: 'Identifier', name: 'ASYNC_FLAG' } },
              { key: { name: 'inverse' }, value: { type: 'Identifier', name: 'INVERSE_KEY' } },
            ],
          },
        },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      // async should be forced to false regardless of the original value
      expect(fields[0].options!.async).toBe(false);
      // inverse should contain TODO since it was a variable reference
      expect(fields[0].options!.inverse).toContain('TODO');
      expect(fields[0].options!.inverse).toContain('INVERSE_KEY');
    });

    it('should handle options with spread elements', () => {
      const members = [
        {
          kind: 'belongsTo' as const,
          name: 'owner',
          relatedType: 'user',
          options: {
            type: 'ObjectExpression',
            properties: [
              { type: 'SpreadElement', argument: { name: 'defaultRelOpts' } },
            ],
          },
        },
      ];
      const { fields } = classifyMembersForSchema(members, customTransforms);
      // Spread should produce a TODO marker key
      const keys = Object.keys(fields[0].options!);
      expect(keys.some((k) => k.includes('defaultRelOpts'))).toBe(true);
      // Should still ensure async: false and inverse is present
      expect(fields[0].options!.async).toBe(false);
      expect('inverse' in fields[0].options!).toBe(true);
    });
  });

  describe('buildSchemaFile', () => {
    it('should generate correct imports', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain("from '@warp-drive/legacy/model/migration-support'");
      expect(output).toContain("from '@warp-drive/core/types/schema/fields'");
      expect(output).toContain("WithLegacy");
    });

    it('should include CAUTION_MEGA_DANGER_ZONE_Extension import when features exist', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
        features: [{ featureKind: 'getter', name: 'displayName', body: '{ return this.name; }' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain("CAUTION_MEGA_DANGER_ZONE_Extension");
      expect(output).toContain("from '@warp-drive/core/reactive'");
    });

    it('should add objectExtensions to schema when extensions exist', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        features: [{ featureKind: 'getter', name: 'displayName', body: '{ return this.name; }' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain("objectExtensions: ['group-ext']");
    });

    it('should NOT add objectExtensions when no extensions', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
      });
      const output = buildSchemaFile(info);
      expect(output).not.toContain('objectExtensions');
    });

    it('should generate extension as typed object (not function call)', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        features: [{ featureKind: 'getter', name: 'displayName', body: '{ return this.name; }' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain('GroupExtension: CAUTION_MEGA_DANGER_ZONE_Extension = {');
      expect(output).toContain("kind: 'object'");
      expect(output).not.toContain('CAUTION_MEGA_DANGER_ZONE_Extension({');
    });

    it('should include @local fields inline in the fields array', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
        localFields: [{ kind: '@local', name: 'isActive', defaultValue: 'false', tsType: 'boolean' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain("{ kind: '@local', name: 'isActive', options: { defaultValue: false } }");
      expect(output).not.toContain('fields.push');
    });

    it('should include service TODO comments', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        services: [{ name: 'audioService', serviceName: 'audio' }],
        features: [{ featureKind: 'getter', name: 'isReady', body: '{ return true; }' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain("TODO: Wire services manually");
      expect(output).toContain("@service('audio') audioService");
    });

    it('should include custom transform type imports', () => {
      const info = makeSchemaInfo({
        modelName: 'task',
        fields: [{ kind: 'attribute', name: 'startDate', type: 'full-date' }],
        customTransforms: {
          'full-date': { tsType: 'DateTime', importFrom: 'luxon' },
        },
      });
      const output = buildSchemaFile(info);
      expect(output).toContain("import type { DateTime } from 'luxon'");
    });

    it('should include [Type] property in Self interface', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain("[Type]: 'exercise'");
    });

    it('should import Type from @warp-drive/core/types/symbols', () => {
      const info = makeSchemaInfo({ modelName: 'exercise' });
      const output = buildSchemaFile(info);
      expect(output).toContain("import { Type } from '@warp-drive/core/types/symbols'");
    });

    it('should include registration TODO comments', () => {
      const info = makeSchemaInfo({ modelName: 'exercise' });
      const output = buildSchemaFile(info);
      expect(output).toContain('TODO: Register this schema');
      expect(output).toContain('store.schema.registerResource(ExerciseSchema)');
      expect(output).toContain('registerDerivations(store.schema)');
    });

    it('should include registerExtension TODO when features exist', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        features: [{ featureKind: 'getter', name: 'x', body: '{ return 1; }' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain('store.schema.CAUTION_MEGA_DANGER_ZONE_registerExtension(GroupExtension)');
    });

    it('should generate complete schema file with correct structure', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        fields: [
          { kind: 'attribute', name: 'name', type: 'string', tsType: 'string' },
          { kind: 'belongsTo', name: 'series', type: 'series', options: { async: false, inverse: null } },
        ],
        localFields: [{ kind: '@local', name: 'isManuallyCompleted', defaultValue: 'false', tsType: 'boolean' }],
        services: [{ name: 'audioService', serviceName: 'audio' }],
        features: [{ featureKind: 'getter', name: 'isCompleted', body: '{ return this.name === "done"; }' }],
      });
      const output = buildSchemaFile(info);

      // Imports
      expect(output).toContain("import { withDefaults } from '@warp-drive/legacy/model/migration-support'");
      expect(output).toContain("import type { LegacyResourceSchema } from '@warp-drive/core/types/schema/fields'");
      expect(output).toContain("import { Type } from '@warp-drive/core/types/symbols'");
      expect(output).toContain("import type { CAUTION_MEGA_DANGER_ZONE_Extension } from '@warp-drive/core/reactive'");
      expect(output).toContain("import type { WithLegacy } from '@warp-drive/legacy/model/migration-support'");

      // Self interface with [Type]
      expect(output).toContain('interface GroupSelf {');
      expect(output).toContain("[Type]: 'group'");
      expect(output).toContain('name: string');

      // Schema const
      expect(output).toContain('export const GroupSchema = withDefaults({');
      expect(output).toContain("type: 'group'");
      expect(output).toContain("kind: 'attribute', name: 'name', type: 'string'");
      expect(output).toContain("objectExtensions: ['group-ext']");
      expect(output).toContain('}) as LegacyResourceSchema');

      // @local field inline
      expect(output).toContain("{ kind: '@local', name: 'isManuallyCompleted'");

      // Extension
      expect(output).toContain('export const GroupExtension: CAUTION_MEGA_DANGER_ZONE_Extension = {');
      expect(output).toContain("kind: 'object'");
      expect(output).toContain("name: 'group-ext'");

      // Type alias
      expect(output).toContain('export type Group = WithLegacy<GroupSelf>');
    });

    it('should include TODO import comments for relationship types', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        fields: [
          { kind: 'attribute', name: 'name', type: 'string' },
          { kind: 'belongsTo', name: 'series', type: 'series', options: { async: false, inverse: null } },
          { kind: 'hasMany', name: 'tasks', type: 'task', options: { async: false, inverse: 'group' } },
        ],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain('// TODO: Import related model types:');
      expect(output).toContain("//   import type { Series } from 'brn/schemas/series';");
      expect(output).toContain("//   import type { Task } from 'brn/schemas/task';");
    });

    it('should use JS object literal syntax (unquoted keys) for relationship options', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        fields: [
          { kind: 'belongsTo', name: 'series', type: 'series', options: { async: false, inverse: null } },
          { kind: 'hasMany', name: 'tasks', type: 'task', options: { async: false, inverse: 'group' } },
        ],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain('options: { async: false, inverse: null }');
      expect(output).toContain("options: { async: false, inverse: 'group' }");
      expect(output).not.toContain('"async"');
      expect(output).not.toContain('"inverse"');
    });

    it('should NOT include relationship TODO comments when no relationships exist', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
      });
      const output = buildSchemaFile(info);
      expect(output).not.toContain('// TODO: Import related model types:');
    });

    it('should emit TODO comment when @attr has rawOptions (defaultValue)', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        fields: [{ kind: 'attribute', name: 'name', type: 'string', rawOptions: "{ defaultValue: '' }" }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain("/* TODO: defaultValue was { defaultValue: '' }");
      expect(output).toContain('handle at handler/transform layer */');
    });

    it('should NOT emit TODO comment when @attr has no rawOptions', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
      });
      const output = buildSchemaFile(info);
      expect(output).not.toContain('TODO: defaultValue was');
    });

    it('should emit NOTE comment when getter had @cached', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        features: [{ featureKind: 'getter', name: 'expensiveValue', body: '{ return compute(); }', isCached: true }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain('// NOTE: Was @cached in original model');
    });

    it('should NOT emit @cached NOTE for non-cached getters', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        features: [{ featureKind: 'getter', name: 'displayName', body: '{ return this.name; }', isCached: false }],
      });
      const output = buildSchemaFile(info);
      expect(output).not.toContain('// NOTE: Was @cached in original model');
    });
  });

  describe('buildSchemaFile (JS output)', () => {
    it('should omit type-only imports for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        isTypeScript: false,
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain("import { withDefaults } from '@warp-drive/legacy/model/migration-support'");
      expect(output).not.toContain('import type');
      expect(output).not.toContain('LegacyResourceSchema');
      expect(output).not.toContain('WithLegacy');
    });

    it('should not import Type symbol for JS (only used in Self interface)', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        isTypeScript: false,
      });
      const output = buildSchemaFile(info);
      expect(output).not.toContain('Type');
      expect(output).not.toContain('@warp-drive/core/types/symbols');
    });

    it('should omit Self interface for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        isTypeScript: false,
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
      });
      const output = buildSchemaFile(info);
      expect(output).not.toContain('interface ExerciseSelf');
    });

    it('should omit as LegacyResourceSchema cast for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        isTypeScript: false,
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
      });
      const output = buildSchemaFile(info);
      expect(output).not.toContain('as LegacyResourceSchema');
      expect(output).toContain('});');
    });

    it('should omit type annotation on extension for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        isTypeScript: false,
        features: [{ featureKind: 'getter', name: 'displayName', body: '{ return this.name; }' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain('export const GroupExtension = {');
      expect(output).not.toContain('CAUTION_MEGA_DANGER_ZONE_Extension');
    });

    it('should use default export instead of type alias for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        isTypeScript: false,
        fields: [{ kind: 'attribute', name: 'name', type: 'string' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain('export default ExerciseSchema;');
      expect(output).not.toContain('export type');
    });

    it('should use const self = this instead of TS cast in extensions for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        isTypeScript: false,
        features: [{ featureKind: 'getter', name: 'displayName', body: '{ return this.name; }' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain('const self = this;');
      expect(output).not.toContain('as unknown as');
    });

    it('should omit type annotations on setter params for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        isTypeScript: false,
        features: [{ featureKind: 'setter', name: 'label', body: '{ this.name = value; }' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain('set label(value) {');
      expect(output).not.toContain('value: any');
    });

    it('should omit type annotations on method params for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        isTypeScript: false,
        features: [{ featureKind: 'method', name: 'doSomething', body: '{ return 1; }' }],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain('doSomething(...args) {');
      expect(output).not.toContain('args: any[]');
    });

    it('should skip type-only named exports in JS schema file', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        isTypeScript: false,
        namedExports: [
          { name: 'IStatsObject', kind: 'interface', sourceText: 'export interface IStatsObject {}' },
          { name: 'SOME_CONST', kind: 'VariableDeclaration', sourceText: "export const SOME_CONST = 'foo';" },
        ],
      });
      const output = buildSchemaFile(info);
      expect(output).not.toContain('IStatsObject');
      expect(output).toContain("export const SOME_CONST = 'foo';");
    });

    it('should use import (not import type) in relationship TODO comments for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'group',
        isTypeScript: false,
        fields: [
          { kind: 'belongsTo', name: 'series', type: 'series', options: { async: false, inverse: null } },
        ],
      });
      const output = buildSchemaFile(info);
      expect(output).toContain("//   import { Series } from 'brn/schemas/series';");
      expect(output).not.toContain('import type { Series }');
    });

    it('should skip custom transform type imports for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'task',
        isTypeScript: false,
        fields: [{ kind: 'attribute', name: 'startDate', type: 'full-date' }],
        customTransforms: {
          'full-date': { tsType: 'DateTime', importFrom: 'luxon' },
        },
      });
      const output = buildSchemaFile(info);
      expect(output).not.toContain('import type');
      expect(output).not.toContain('DateTime');
    });
  });

  describe('buildModelStub', () => {
    it('should use value re-export for enum named exports', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        namedExports: [
          { name: 'ExerciseType', kind: 'TSEnumDeclaration', sourceText: 'export enum ExerciseType { A = "A" }' },
          { name: 'IStatsObject', kind: 'interface', sourceText: 'export interface IStatsObject {}' },
        ],
      });
      const output = buildModelStub(info);
      expect(output).toContain("export { ExerciseType } from 'brn/schemas/exercise'");
      expect(output).not.toContain("export type { ExerciseType }");
      expect(output).toContain("export type { IStatsObject } from 'brn/schemas/exercise'");
    });

    it('should generate correct re-export', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        namedExports: [{ name: 'IStatsObject', kind: 'interface', sourceText: 'export interface IStatsObject {}' }],
      });
      const output = buildModelStub(info);
      expect(output).toContain("export type { Exercise as default } from 'brn/schemas/exercise'");
      expect(output).toContain("export type { IStatsObject } from 'brn/schemas/exercise'");
    });
  });

  describe('buildModelStub (JS output)', () => {
    it('should use export { default } instead of export type for JS', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        isTypeScript: false,
      });
      const output = buildModelStub(info);
      expect(output).toContain("export { default } from 'brn/schemas/exercise'");
      expect(output).not.toContain('export type');
    });

    it('should skip type-only named exports in JS stub', () => {
      const info = makeSchemaInfo({
        modelName: 'exercise',
        isTypeScript: false,
        namedExports: [
          { name: 'ExerciseType', kind: 'TSEnumDeclaration', sourceText: 'export enum ExerciseType { A = "A" }' },
          { name: 'IStatsObject', kind: 'interface', sourceText: 'export interface IStatsObject {}' },
        ],
      });
      const output = buildModelStub(info);
      expect(output).toContain("export { ExerciseType } from 'brn/schemas/exercise'");
      expect(output).not.toContain('IStatsObject');
      expect(output).not.toContain('export type');
    });
  });

  describe('Phase 3a JS file handling', () => {
    it('should generate JS model stub for .js input file', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';

export default class Signal extends Model {
  @attr('string') name;
}`;
      const result = runTransform(input, 'app/models/signal.js');
      expect(result).toContain("export { default } from 'brn/schemas/signal'");
      expect(result).not.toContain('export type');
    });

    it('should generate TS model stub for .ts input file', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export default class Signal extends Model {
  declare [Type]: 'signal';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/signal.ts');
      expect(result).toContain("export type { Signal as default } from 'brn/schemas/signal'");
    });

    it('should generate JS model stub for .gjs input file', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';

export default class Signal extends Model {
  @attr('string') name;
}`;
      const result = runTransform(input, 'app/models/signal.gjs');
      expect(result).toContain("export { default } from 'brn/schemas/signal'");
      expect(result).not.toContain('export type');
    });

    it('should generate TS model stub for .gts input file', () => {
      const input = `import Model, { attr } from '@warp-drive/legacy/model';
import { Type } from '@warp-drive/core/types/symbols';

export default class Signal extends Model {
  declare [Type]: 'signal';
  @attr('string') name!: string;
}`;
      const result = runTransform(input, 'app/models/signal.gts');
      expect(result).toContain("export type { Signal as default } from 'brn/schemas/signal'");
    });
  });
});
