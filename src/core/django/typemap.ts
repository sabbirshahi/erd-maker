/**
 * DBML type <-> Django field mapping. Single bidirectional table (plan §2, authoritative).
 * Pure: no schema access. Enum types are handled by generate/parse (they need the schema).
 * OWNER: worker-4 (core-django).
 */
import type { Column } from '../schema'

/** Django field + kwargs, where every kwarg value is python source (e.g. `'x'`, `150`, `True`). */
export interface DjangoField {
  field: string
  kwargs: Record<string, string>
}

export interface TypeMapRow {
  /** Matched against the normalised DBML type (lower-cased, single-spaced). */
  dbmlPattern: RegExp | string
  /** Django field classes this row parses back to DBML. */
  djangoFields: string[]
  toDjango(type: string, col: Column): DjangoField
  fromDjango(field: string, kwargs: Record<string, string>): string
  /** Plain-language reason the DBML -> Django direction loses information (per matched type). */
  lossy?: (type: string) => string | undefined
}

const norm = (type: string): string => type.trim().toLowerCase().replace(/\s+/g, ' ')

const m = (re: RegExp, type: string): RegExpMatchArray | null => norm(type).match(re)

export const TYPE_MAP: TypeMapRow[] = [
  {
    dbmlPattern: /^(int|integer|int4)$/,
    djangoFields: ['IntegerField'],
    toDjango: () => ({ field: 'IntegerField', kwargs: {} }),
    fromDjango: () => 'int',
  },
  {
    dbmlPattern: /^(bigint|int8)$/,
    djangoFields: ['BigIntegerField'],
    toDjango: () => ({ field: 'BigIntegerField', kwargs: {} }),
    fromDjango: () => 'bigint',
  },
  {
    dbmlPattern: /^(smallint|int2|tinyint)$/,
    djangoFields: ['SmallIntegerField'],
    toDjango: () => ({ field: 'SmallIntegerField', kwargs: {} }),
    fromDjango: () => 'smallint',
    lossy: (t) => (norm(t) === 'tinyint' ? '`tinyint` is widened to SmallIntegerField (16-bit)' : undefined),
  },
  {
    dbmlPattern: /^(varchar|character varying|nvarchar|string|char|character)( ?\((\d+)\))?$/,
    djangoFields: ['CharField'],
    toDjango: (type) => {
      const mt = m(/^(varchar|character varying|nvarchar|string|char|character)( ?\((\d+)\))?$/, type)
      const n = mt?.[3] ?? '255'
      return { field: 'CharField', kwargs: { max_length: n } }
    },
    fromDjango: (_f, kw) => (kw.max_length ? `varchar(${kw.max_length})` : 'varchar(255)'),
    lossy: (t) => {
      const mt = m(/^(varchar|character varying|nvarchar|string|char|character)( ?\((\d+)\))?$/, t)
      if (!mt) return undefined
      if (mt[1] === 'char' || mt[1] === 'character')
        return `\`${t}\` is fixed-width; Django CharField is variable-width (varchar)`
      if (!mt[3]) return `\`${t}\` has no length; Django CharField needs one, assuming max_length=255`
      return undefined
    },
  },
  {
    dbmlPattern: /^(text|longtext|mediumtext|clob)$/,
    djangoFields: ['TextField'],
    toDjango: () => ({ field: 'TextField', kwargs: {} }),
    fromDjango: () => 'text',
  },
  {
    dbmlPattern: /^(boolean|bool|bit)$/,
    djangoFields: ['BooleanField'],
    toDjango: () => ({ field: 'BooleanField', kwargs: {} }),
    fromDjango: () => 'boolean',
  },
  {
    dbmlPattern: /^(timestamp|timestamptz|datetime|timestamp with(out)? time zone)$/,
    djangoFields: ['DateTimeField'],
    toDjango: () => ({ field: 'DateTimeField', kwargs: {} }),
    fromDjango: () => 'timestamp',
    lossy: (t) =>
      /timestamptz|with time zone/.test(norm(t))
        ? `\`${t}\` loses its timezone flavour: Django DateTimeField has no equivalent`
        : undefined,
  },
  {
    dbmlPattern: /^date$/,
    djangoFields: ['DateField'],
    toDjango: () => ({ field: 'DateField', kwargs: {} }),
    fromDjango: () => 'date',
  },
  {
    dbmlPattern: /^(time|timetz|time with(out)? time zone)$/,
    djangoFields: ['TimeField'],
    toDjango: () => ({ field: 'TimeField', kwargs: {} }),
    fromDjango: () => 'time',
    lossy: (t) =>
      /timetz|with time zone/.test(norm(t))
        ? `\`${t}\` loses its timezone flavour: Django TimeField has no equivalent`
        : undefined,
  },
  {
    dbmlPattern: /^(decimal|numeric|money)( ?\((\d+) ?, ?(\d+)\))?$/,
    djangoFields: ['DecimalField'],
    toDjango: (type) => {
      const mt = m(/^(decimal|numeric|money)( ?\((\d+) ?, ?(\d+)\))?$/, type)
      return {
        field: 'DecimalField',
        kwargs: { max_digits: mt?.[3] ?? '10', decimal_places: mt?.[4] ?? '2' },
      }
    },
    fromDjango: (_f, kw) => `decimal(${kw.max_digits ?? '10'},${kw.decimal_places ?? '2'})`,
    lossy: (t) => {
      const mt = m(/^(decimal|numeric|money)( ?\((\d+) ?, ?(\d+)\))?$/, t)
      if (mt && !mt[3]) return `\`${t}\` has no precision; assuming DecimalField(max_digits=10, decimal_places=2)`
      return undefined
    },
  },
  {
    dbmlPattern: /^(float|double|double precision|real|float4|float8)$/,
    djangoFields: ['FloatField'],
    toDjango: () => ({ field: 'FloatField', kwargs: {} }),
    fromDjango: () => 'float',
    lossy: (t) =>
      /^(real|float4)$/.test(norm(t))
        ? `\`${t}\` is single precision; Django FloatField is double precision`
        : undefined,
  },
  {
    dbmlPattern: /^uuid$/,
    djangoFields: ['UUIDField'],
    toDjango: () => ({ field: 'UUIDField', kwargs: {} }),
    fromDjango: () => 'uuid',
  },
  {
    dbmlPattern: /^(json|jsonb)$/,
    djangoFields: ['JSONField'],
    toDjango: () => ({ field: 'JSONField', kwargs: {} }),
    fromDjango: () => 'json',
    lossy: (t) => (norm(t) === 'jsonb' ? '`jsonb` comes back from Django as plain `json`' : undefined),
  },
]

/**
 * Django fields with no DBML row of their own. They parse via a base row (`like`) and are
 * re-emitted through `column.django.fieldType`. `defaults` are kwargs implied by the field.
 */
export const PARSE_ONLY_FIELDS: Record<string, { like: string; defaults?: Record<string, string> }> = {
  EmailField: { like: 'CharField', defaults: { max_length: '254' } },
  URLField: { like: 'CharField', defaults: { max_length: '200' } },
  SlugField: { like: 'CharField', defaults: { max_length: '50' } },
  GenericIPAddressField: { like: 'CharField', defaults: { max_length: '39' } },
  FileField: { like: 'CharField', defaults: { max_length: '100' } },
  ImageField: { like: 'CharField', defaults: { max_length: '100' } },
  FilePathField: { like: 'CharField', defaults: { max_length: '100' } },
  PositiveIntegerField: { like: 'IntegerField' },
  PositiveSmallIntegerField: { like: 'SmallIntegerField' },
  PositiveBigIntegerField: { like: 'BigIntegerField' },
  BinaryField: { like: 'TextField' },
  DurationField: { like: 'BigIntegerField' },
}

/** Auto-increment fields: Django field -> DBML type. */
export const AUTO_FIELDS: Record<string, string> = {
  AutoField: 'int',
  BigAutoField: 'bigint',
  SmallAutoField: 'smallint',
}

/** DBML type -> auto field for `[pk, increment]` columns. */
export function autoFieldFor(type: string): string {
  const t = norm(type)
  if (/^(bigint|int8)$/.test(t)) return 'BigAutoField'
  if (/^(smallint|int2|tinyint)$/.test(t)) return 'SmallAutoField'
  return 'AutoField'
}

export const RELATION_FIELDS = ['ForeignKey', 'OneToOneField', 'ManyToManyField'] as const

/** Every Django field the inspector combobox offers (mapped rows first, then parse-only and auto fields). */
export const DJANGO_TYPE_CHOICES: string[] = [
  ...new Set([
    ...TYPE_MAP.flatMap((r) => r.djangoFields),
    ...Object.keys(PARSE_ONLY_FIELDS),
    ...Object.keys(AUTO_FIELDS),
    ...RELATION_FIELDS,
  ]),
]

export function findRowForDbml(type: string): TypeMapRow | undefined {
  const t = norm(type)
  return TYPE_MAP.find((r) =>
    typeof r.dbmlPattern === 'string' ? r.dbmlPattern === t : r.dbmlPattern.test(t),
  )
}

export function findRowForDjango(field: string): TypeMapRow | undefined {
  return TYPE_MAP.find((r) => r.djangoFields.includes(field))
}

export interface DbmlMapping extends DjangoField {
  /** Set when the type is not in the table (fell back to TextField). */
  unknown: boolean
  /** Plain-language lossy note, when the mapping drops information. */
  lossy?: string
}

/** DBML type -> Django field. Unknown types fall back to TextField with `unknown: true`. */
export function mapDbmlType(type: string, col: Column): DbmlMapping {
  const row = findRowForDbml(type)
  if (!row) return { field: 'TextField', kwargs: {}, unknown: true }
  const out = row.toDjango(type, col)
  return { ...out, unknown: false, lossy: row.lossy?.(type) }
}

export interface DjangoMapping {
  /** DBML type. */
  type: string
  /** kwargs consumed by the type (not to be re-emitted as extraKwargs). */
  consumed: string[]
  /** Set when the field must be re-emitted verbatim via `column.django.fieldType`. */
  fieldType?: string
  /** True when the field is unknown to the table (fell back to `text`). */
  unknown: boolean
  /** Auto-increment pk field. */
  auto: boolean
}

/** Django field + kwargs -> DBML type. Unknown fields fall back to `text` and keep the field name. */
export function mapDjangoField(field: string, kwargs: Record<string, string>): DjangoMapping {
  if (field in AUTO_FIELDS) return { type: AUTO_FIELDS[field], consumed: [], unknown: false, auto: true }
  const row = findRowForDjango(field)
  if (row) return { type: row.fromDjango(field, kwargs), consumed: typeKwargs(row), unknown: false, auto: false }
  const alias = PARSE_ONLY_FIELDS[field]
  if (alias) {
    const base = findRowForDjango(alias.like)!
    const merged = { ...(alias.defaults ?? {}), ...kwargs }
    return {
      type: base.fromDjango(alias.like, merged),
      consumed: typeKwargs(base),
      fieldType: field,
      unknown: false,
      auto: false,
    }
  }
  return { type: 'text', consumed: [], fieldType: field, unknown: true, auto: false }
}

/** kwargs a row derives from the DBML type (so they are not extraKwargs). */
function typeKwargs(row: TypeMapRow): string[] {
  if (row.djangoFields.includes('CharField')) return ['max_length']
  if (row.djangoFields.includes('DecimalField')) return ['max_digits', 'decimal_places']
  return []
}
