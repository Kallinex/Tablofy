import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { getMetadataStorage, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

type DtoClass = new () => Record<string, unknown>;

interface DtoProperty {
  name: string;
  hasInitializer: boolean;
}

interface DtoShape {
  properties: DtoProperty[];
  accessors: string[];
}

function collectDtoFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectDtoFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.dto.ts')) {
      out.push(full);
    }
  }
  return out;
}

function readShape(file: string): Map<string, DtoShape> {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const shapes = new Map<string, DtoShape>();

  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const properties: DtoProperty[] = [];
      const accessors: string[] = [];

      for (const member of node.members) {
        if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          properties.push({
            name: member.name.text,
            hasInitializer: member.initializer !== undefined,
          });
        } else if (ts.isGetAccessor(member) && member.name && ts.isIdentifier(member.name)) {
          accessors.push(member.name.text);
        }
      }

      shapes.set(node.name.text, { properties, accessors });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return shapes;
}

const SRC = path.resolve(__dirname, '..', '..');
const DTO_FILES = collectDtoFiles(SRC);

// Every DTO has to be loaded dynamically so a new DTO file is covered without touching this
// spec; eslint's no-require-imports rule does not apply to runtime-computed paths.
function loadModule(file: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(file);
}

interface DtoEntry {
  file: string;
  cls: DtoClass;
  name: string;
  properties: DtoProperty[];
  accessors: string[];
}

const loaded: Array<{ file: string; entries: DtoEntry[] }> = DTO_FILES.map((file) => {
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  const shapes = readShape(file);
  const module = loadModule(file) as Record<string, unknown>;

  const entries = Object.entries(module)
    .filter(([, value]) => typeof value === 'function')
    .map(([name, value]) => {
      const cls = value as DtoClass;
      // Classes synthesised at runtime (e.g. `PartialType(CreateDto)()` from @nestjs/swagger)
      // have no declaration in the source, so fall back to the validation metadata.
      const shape = shapes.get(name) ?? {
        properties: metadataProperties(cls).map((property) => ({
          name: property,
          hasInitializer: true,
        })),
        accessors: [],
      };
      return { file: rel, name, cls, properties: shape.properties, accessors: shape.accessors };
    })
    .filter((entry) => entry.properties.length > 0);

  return { file: rel, entries };
});

function metadataProperties(cls: DtoClass): string[] {
  const storage = getMetadataStorage();
  const target = cls as unknown as { name: string };
  return [
    ...new Set(
      storage
        .getTargetValidationMetadatas(target, target.name, true, false)
        .map((meta) => meta.propertyName)
        .filter((p): p is string => typeof p === 'string'),
    ),
  ];
}

const allEntries = loaded.flatMap(({ entries }) => entries);
const paginationEntries = allEntries.filter((entry) => {
  const names = entry.properties.map((p) => p.name);
  return names.includes('page') && names.includes('limit');
});

function optionalProperties(cls: DtoClass): Set<string> {
  const storage = getMetadataStorage();
  const target = cls as unknown as { name: string };
  const metas = storage.getTargetValidationMetadatas(target, target.name, true, false);

  // `@IsOptional()` is registered by the library under the decorator name `isOptional` as a
  // CONDITIONAL_VALIDATION; a bare `@ValidateIf(predicate)` registers under its own name.
  return new Set(
    metas
      .filter((meta) => meta.name === 'isOptional')
      .map((meta) => meta.propertyName)
      .filter((p): p is string => typeof p === 'string'),
  );
}

function validate(instance: object) {
  return validateSync(instance as never, { skipMissingProperties: false } as never);
}

function sampleFor(property: string): unknown {
  if (/date|at$/i.test(property)) return '2026-01-01T00:00:00.000Z';
  if (/^is|active|enabled|archived|deleted/i.test(property)) return true;
  if (
    /count|qty|quantity|length|retry|retries|threshold|seconds|minutes|hours|days/i.test(property)
  ) {
    return 2;
  }
  if (/page|pageSize|skip|offset|limit/i.test(property)) return 2;
  if (/percent|rate|amount|price|total|subtotal|tax|discount/i.test(property)) return 1;
  if (/order/i.test(property)) return 'asc';
  if (/id$/i.test(property)) return '3f1c0b7a-2f4e-4a3d-9c1e-6b2a5d7e8f90';
  if (/status|type|kind|mode|source|enum|action/i.test(property)) return 'ACTIVE';
  return 'sample';
}

describe('DTO inventory', () => {
  it('discovers the full DTO surface', () => {
    expect(DTO_FILES.length).toBeGreaterThan(100);
  });

  it('discovers every DTO file on disk', () => {
    const discovered = DTO_FILES.map((f) => path.relative(SRC, f).replace(/\\/g, '/'));
    expect(new Set(discovered).size).toBe(DTO_FILES.length);
    expect(discovered).toContain('modules/webhooks/dto/update-webhook.dto.ts');
  });

  it('only misses classes that @nestjs/swagger PartialType generates at runtime', () => {
    const withoutStaticClass = loaded
      .filter(({ entries }) => entries.length === 0)
      .map(({ file }) => file);

    expect(withoutStaticClass.sort()).toEqual([
      'modules/api-keys/dto/update-api-key.dto.ts',
      'modules/scheduled-reports/dto/update-scheduled-report.dto.ts',
      'modules/sso/dto/update-sso-connection.dto.ts',
      'modules/webhooks/dto/update-webhook.dto.ts',
    ]);
  });

  it('covers hundreds of DTO classes', () => {
    expect(allEntries.length).toBeGreaterThan(100);
  });
});

describe('pagination DTO contract', () => {
  it('finds the pagination query DTOs', () => {
    expect(paginationEntries.length).toBeGreaterThan(10);
  });

  it.each(paginationEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s coerces page and limit to numbers',
    (_label, entry) => {
      const instance = plainToInstance(entry.cls, { page: '2', limit: '10' });
      expect(typeof (instance as Record<string, unknown>).page).toBe('number');
      expect(typeof (instance as Record<string, unknown>).limit).toBe('number');
    },
  );

  it.each(paginationEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s accepts a valid pagination window',
    (_label, entry) => {
      expect(validate(plainToInstance(entry.cls, { page: '2', limit: '50' }))).toEqual([]);
    },
  );

  it.each(paginationEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s rejects page below 1',
    (_label, entry) => {
      const errors = validate(plainToInstance(entry.cls, { page: '0' }));
      expect(errors.map((e) => e.property)).toContain('page');
    },
  );

  it.each(paginationEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s rejects a limit above 100',
    (_label, entry) => {
      const errors = validate(plainToInstance(entry.cls, { limit: '101' }));
      expect(errors.map((e) => e.property)).toContain('limit');
    },
  );

  it.each(paginationEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s rejects a non-numeric page',
    (_label, entry) => {
      const errors = validate(plainToInstance(entry.cls, { page: 'abc' }));
      expect(errors.map((e) => e.property)).toContain('page');
    },
  );

  it.each(paginationEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s allows pagination to be omitted',
    (_label, entry) => {
      expect(validate(plainToInstance(entry.cls, {}))).toEqual([]);
    },
  );

  it.each(paginationEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s caps the default limit at 100',
    (_label, entry) => {
      const defaults = new entry.cls() as Record<string, unknown>;
      if (typeof defaults.limit === 'number') {
        expect(defaults.limit).toBeLessThanOrEqual(100);
      }
      if (typeof defaults.page === 'number') {
        expect(defaults.page).toBeGreaterThanOrEqual(1);
      }
    },
  );
});

describe('required-field contract', () => {
  // `*ResponseDto` classes describe outbound payloads and carry no validation decorators,
  // so they are not part of the request-validation contract.
  const requestEntries = allEntries.filter(
    (e) => !/ResponseDto$/.test(e.name) && !/^Rotate.*Response/.test(e.name),
  );

  it('excludes outbound response shapes', () => {
    expect(requestEntries.length).toBeLessThan(allEntries.length);
    expect(requestEntries.every((e) => !/ResponseDto$/.test(e.name))).toBe(true);
  });

  it.each(requestEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s rejects an empty payload when it declares required fields',
    (_label, entry) => {
      const optional = optionalProperties(entry.cls);
      const required = entry.properties.filter((p) => !p.hasInitializer && !optional.has(p.name));
      const reported = new Set(validate(plainToInstance(entry.cls, {})).map((e) => e.property));

      for (const property of required) {
        expect(reported).toContain(property.name);
      }
    },
  );

  it.each(requestEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s accepts an empty payload when every field is optional',
    (_label, entry) => {
      const optional = optionalProperties(entry.cls);
      const allOptional = entry.properties.every((p) => p.hasInitializer || optional.has(p.name));
      if (allOptional) {
        expect(validate(plainToInstance(entry.cls, {}))).toEqual([]);
      }
    },
  );

  it.each(allEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s validates a fully populated payload without crashing',
    (_label, entry) => {
      const populated: Record<string, unknown> = {};
      for (const property of entry.properties) {
        populated[property.name] = sampleFor(property.name);
      }
      expect(() => validate(plainToInstance(entry.cls, populated))).not.toThrow();
    },
  );

  it.each(allEntries.map((e) => [`${e.file}:${e.name}`, e] as const))(
    '%s exposes readable computed accessors',
    (_label, entry) => {
      const instance = new entry.cls();
      for (const accessor of entry.accessors) {
        expect(() => (instance as unknown as Record<string, unknown>)[accessor]).not.toThrow();
      }
    },
  );
});
