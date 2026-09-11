/**
 * Column-level fake value heuristics. Pure functions over the IR; faker must already be seeded
 * by the caller so the call sequence is deterministic. OWNER: worker-5 (demo).
 */
import { faker } from '@faker-js/faker/locale/en'
import type { Column, Table } from '../schema'

export type TypeCategory =
  | 'int'
  | 'float'
  | 'decimal'
  | 'bool'
  | 'date'
  | 'datetime'
  | 'time'
  | 'uuid'
  | 'json'
  | 'binary'
  | 'string'
  | 'text'
  | 'enum'
  | 'unknown'

export interface ParsedType {
  category: TypeCategory
  /** varchar(n) / char(n) length, when given. */
  length?: number
  /** decimal(p, s) */
  precision?: number
  scale?: number
  /** Smallest / largest representable integer for int-like types. */
  intMin?: number
  intMax?: number
}

const DATE_FROM = new Date('2023-01-01T00:00:00.000Z')
const DATE_TO = new Date('2026-01-01T00:00:00.000Z')

export function parseType(type: string, isEnum: boolean): ParsedType {
  if (isEnum) return { category: 'enum' }
  const raw = type.trim().toLowerCase()
  const base = raw.replace(/\s*\(.*\)\s*$/, '').replace(/\s+unsigned$/, '').trim()
  const argMatch = /\(([^)]*)\)/.exec(raw)
  const args = argMatch ? argMatch[1].split(',').map((a) => Number(a.trim())) : []

  if (/^(tinyint)$/.test(base)) return { category: 'int', intMin: 0, intMax: 127 }
  if (/^(smallint|int2|smallserial|serial2)$/.test(base))
    return { category: 'int', intMin: 0, intMax: 32_767 }
  if (/^(bigint|int8|bigserial|serial8)$/.test(base))
    return { category: 'int', intMin: 0, intMax: 9_007_199_254_740_991 }
  if (/^(int|integer|int4|serial|serial4|mediumint|number|long)$/.test(base))
    return { category: 'int', intMin: 0, intMax: 2_147_483_647 }
  if (/^(decimal|numeric|money|smallmoney)$/.test(base)) {
    const precision = Number.isFinite(args[0]) ? args[0] : 10
    const scale = Number.isFinite(args[1]) ? args[1] : 2
    return { category: 'decimal', precision, scale }
  }
  if (/^(float|float4|float8|double|double precision|real)$/.test(base)) return { category: 'float' }
  if (/^(bool|boolean|bit)$/.test(base)) return { category: 'bool' }
  if (/^(timestamp|timestamptz|datetime|datetime2|datetimeoffset|smalldatetime)$/.test(base))
    return { category: 'datetime' }
  if (/^(timestamp|datetime)\b/.test(base)) return { category: 'datetime' }
  if (/^(date)$/.test(base)) return { category: 'date' }
  if (/^(time|timetz)$/.test(base) || /^time\b/.test(base)) return { category: 'time' }
  if (/^(uuid|uniqueidentifier|guid)$/.test(base)) return { category: 'uuid' }
  if (/^(json|jsonb)$/.test(base)) return { category: 'json' }
  if (/^(blob|bytea|binary|varbinary|image|longblob|mediumblob|tinyblob)$/.test(base))
    return { category: 'binary' }
  if (/^(text|longtext|mediumtext|tinytext|ntext|clob|citext)$/.test(base))
    return { category: 'text' }
  if (/^(varchar|char|character varying|character|nvarchar|nchar|string|str|varchar2)$/.test(base)) {
    const length = Number.isFinite(args[0]) ? args[0] : undefined
    return { category: 'string', length }
  }
  return { category: 'unknown' }
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export function formatTime(d: Date): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

const randomDate = (): Date => faker.date.between({ from: DATE_FROM, to: DATE_TO })

/** Truncate to the declared varchar length (when any). */
export function fit(value: string, length?: number): string {
  if (length === undefined || value.length <= length) return value
  return value.slice(0, length)
}

const PERSON_TABLE = /(user|customer|author|employee|person|people|member|student|teacher|staff|contact|client|patient|driver|owner|player|account|profile)/i
const PRODUCT_TABLE = /(product|item|good|sku|article|book|course|plan|package|service)/i

/** A "name" column: a person's name for people-ish tables, a product/word name otherwise. */
function nameFor(table: Table): string {
  if (PERSON_TABLE.test(table.name)) return faker.person.fullName()
  if (PRODUCT_TABLE.test(table.name)) return faker.commerce.productName()
  return `${faker.word.adjective()} ${faker.word.noun()}`
}

const STATUS_WORDS = ['active', 'pending', 'inactive', 'archived', 'draft']

type Gen = (col: Column, table: Table, parsed: ParsedType) => unknown

interface Heuristic {
  pattern: RegExp
  /** Column type categories this heuristic may produce a value for. */
  categories: readonly TypeCategory[]
  gen: Gen
}

const STRINGY: readonly TypeCategory[] = ['string', 'text', 'unknown']
const NUMERIC: readonly TypeCategory[] = ['int', 'float', 'decimal', 'unknown']
const TEMPORAL: readonly TypeCategory[] = ['date', 'datetime', 'time', 'string', 'text', 'unknown']

function temporal(parsed: ParsedType): string {
  const d = randomDate()
  if (parsed.category === 'date') return formatDate(d)
  if (parsed.category === 'time') return formatTime(d)
  return formatDateTime(d)
}

function money(parsed: ParsedType, max = 1000): number {
  const scale = parsed.category === 'int' ? 0 : (parsed.scale ?? 2)
  return faker.number.float({ min: 1, max, fractionDigits: scale })
}

const HEURISTICS: Heuristic[] = [
  { pattern: /(^|_)e_?mail$/, categories: STRINGY, gen: () => faker.internet.email().toLowerCase() },
  { pattern: /^(first_?name|given_?name|forename)$/, categories: STRINGY, gen: () => faker.person.firstName() },
  { pattern: /^(last_?name|surname|family_?name)$/, categories: STRINGY, gen: () => faker.person.lastName() },
  { pattern: /^(full_?name|display_?name|author_?name|customer_?name|contact_?name)$/, categories: STRINGY, gen: () => faker.person.fullName() },
  { pattern: /^(user_?name|login|handle|nick(name)?)$/, categories: STRINGY, gen: () => faker.internet.username().toLowerCase() },
  { pattern: /^(company|organi[sz]ation|employer|vendor|brand|manufacturer)(_name)?$/, categories: STRINGY, gen: () => faker.company.name() },
  { pattern: /(^|_)name$/, categories: STRINGY, gen: (_c, t) => nameFor(t) },
  { pattern: /(title|subject|headline|caption)$/, categories: STRINGY, gen: () => faker.lorem.sentence({ min: 3, max: 7 }).replace(/\.$/, '') },
  { pattern: /slug/, categories: STRINGY, gen: () => faker.helpers.slugify(faker.lorem.words(3)).toLowerCase() },
  { pattern: /password|passwd|pwd/, categories: STRINGY, gen: () => faker.internet.password({ length: 16 }) },
  { pattern: /(price|amount|total|cost|salary|balance|fee|tax|subtotal|discount|budget|revenue)/, categories: NUMERIC, gen: (_c, _t, p) => money(p) },
  { pattern: /^(lat|latitude)$/, categories: ['float', 'decimal', 'unknown'], gen: () => faker.location.latitude() },
  { pattern: /^(lng|lon|long|longitude)$/, categories: ['float', 'decimal', 'unknown'], gen: () => faker.location.longitude() },
  { pattern: /^age$/, categories: NUMERIC, gen: () => faker.number.int({ min: 18, max: 90 }) },
  { pattern: /(quantity|qty|count|stock|views|likes|downloads|visits|clicks|hits|inventory|capacity)/, categories: NUMERIC, gen: () => faker.number.int({ min: 0, max: 1000 }) },
  { pattern: /(rating|score|stars)/, categories: NUMERIC, gen: (_c, _t, p) => (p.category === 'int' ? faker.number.int({ min: 1, max: 5 }) : faker.number.float({ min: 1, max: 5, fractionDigits: 1 })) },
  { pattern: /(percent|percentage|ratio|progress)/, categories: NUMERIC, gen: (_c, _t, p) => (p.category === 'int' ? faker.number.int({ min: 0, max: 100 }) : faker.number.float({ min: 0, max: 100, fractionDigits: 2 })) },
  { pattern: /(year)$/, categories: NUMERIC, gen: () => faker.number.int({ min: 1990, max: 2026 }) },
  { pattern: /(_at|_on|_time|timestamp)$|^(created|updated|deleted|modified|published|expires|expired|started|ended|finished)$/, categories: TEMPORAL, gen: (_c, _t, p) => temporal(p) },
  { pattern: /(_date|^date|birthday|birth_?date|dob|deadline|due)/, categories: TEMPORAL, gen: (_c, _t, p) => (p.category === 'datetime' || p.category === 'time' ? temporal(p) : formatDate(randomDate())) },
  { pattern: /(image|avatar|photo|picture|thumbnail|logo|icon|banner|cover)/, categories: STRINGY, gen: () => faker.image.url() },
  { pattern: /(url|website|link|href|homepage|uri)/, categories: STRINGY, gen: () => faker.internet.url() },
  { pattern: /(phone|mobile|tel|fax)/, categories: STRINGY, gen: () => faker.phone.number({ style: 'international' }) },
  { pattern: /^(description|body|content|bio|summary|abstract|about|details|remarks?|notes?|comments?|message|text|excerpt|review)$/, categories: STRINGY, gen: (_c, _t, p) => (p.category === 'string' ? faker.lorem.sentence() : faker.lorem.paragraph()) },
  { pattern: /^(is_|has_|can_|should_|allow_|enable_)|_flag$|^(active|enabled|verified|deleted|published|archived|visible|public|approved|confirmed|completed|featured|default|locked|paid|shipped)$/, categories: ['bool', 'int', 'unknown'], gen: (_c, _t, p) => (p.category === 'int' ? (faker.datatype.boolean() ? 1 : 0) : faker.datatype.boolean()) },
  { pattern: /(status|state)$/, categories: STRINGY, gen: () => faker.helpers.arrayElement(STATUS_WORDS) },
  { pattern: /^(type|kind|category|group|level|tier|role)$/, categories: STRINGY, gen: () => faker.word.noun() },
  { pattern: /country/, categories: STRINGY, gen: () => faker.location.country() },
  { pattern: /city|town/, categories: STRINGY, gen: () => faker.location.city() },
  { pattern: /(state|province|region)$/, categories: STRINGY, gen: () => faker.location.state() },
  { pattern: /(street|address|addr)/, categories: STRINGY, gen: () => faker.location.streetAddress() },
  { pattern: /(zip|postal|postcode)/, categories: STRINGY, gen: () => faker.location.zipCode() },
  { pattern: /^(ip|ip_?address|ipv4)$/, categories: STRINGY, gen: () => faker.internet.ipv4() },
  { pattern: /(currency)/, categories: STRINGY, gen: () => faker.finance.currencyCode() },
  { pattern: /(color|colour)/, categories: STRINGY, gen: () => faker.color.human() },
  { pattern: /(uuid|guid)/, categories: STRINGY, gen: () => faker.string.uuid() },
  { pattern: /(token|secret|api_?key|hash|digest|signature)/, categories: STRINGY, gen: () => faker.string.alphanumeric(32) },
  { pattern: /(sku|code|reference|ref_?no|barcode|isbn|serial)/, categories: STRINGY, gen: () => faker.string.alphanumeric(8).toUpperCase() },
  { pattern: /^(gender|sex)$/, categories: STRINGY, gen: () => faker.person.sex() },
  { pattern: /(job|position|occupation)/, categories: STRINGY, gen: () => faker.person.jobTitle() },
  { pattern: /(language|locale)/, categories: STRINGY, gen: () => faker.helpers.arrayElement(['en', 'de', 'fr', 'es', 'pt', 'ja']) },
  { pattern: /(timezone|tz)$/, categories: STRINGY, gen: () => faker.location.timeZone() },
  { pattern: /version/, categories: STRINGY, gen: () => faker.system.semver() },
  { pattern: /(mime|content_type)/, categories: STRINGY, gen: () => faker.system.mimeType() },
  { pattern: /(file|path|filename)/, categories: STRINGY, gen: () => faker.system.filePath() },
  { pattern: /(user_?agent|browser)/, categories: STRINGY, gen: () => faker.internet.userAgent() },
  { pattern: /(domain|host)/, categories: STRINGY, gen: () => faker.internet.domainName() },
  { pattern: /(iban)/, categories: STRINGY, gen: () => faker.finance.iban() },
  { pattern: /(card_?number|credit_?card)/, categories: STRINGY, gen: () => faker.finance.creditCardNumber() },
  { pattern: /(department|team)/, categories: STRINGY, gen: () => faker.commerce.department() },
  { pattern: /(tag|label|keyword)/, categories: STRINGY, gen: () => faker.word.noun() },
  { pattern: /(weight|height|width|length|depth|distance|size)/, categories: NUMERIC, gen: (_c, _t, p) => (p.category === 'int' ? faker.number.int({ min: 1, max: 500 }) : faker.number.float({ min: 1, max: 500, fractionDigits: 2 })) },
  { pattern: /(duration|minutes|seconds|hours|days)/, categories: NUMERIC, gen: () => faker.number.int({ min: 1, max: 600 }) },
  { pattern: /(order|position|rank|priority|sort|sequence|index)$/, categories: NUMERIC, gen: () => faker.number.int({ min: 0, max: 100 }) },
]

/** Value for a column based purely on its type. */
export function valueForType(parsed: ParsedType, enumValues: string[] | undefined): unknown {
  switch (parsed.category) {
    case 'enum':
      return enumValues && enumValues.length > 0 ? faker.helpers.arrayElement(enumValues) : faker.word.noun()
    case 'int':
      return faker.number.int({ min: parsed.intMin ?? 0, max: Math.min(parsed.intMax ?? 100_000, 100_000) })
    case 'float':
      return faker.number.float({ min: 0, max: 10_000, fractionDigits: 2 })
    case 'decimal': {
      const p = parsed.precision ?? 10
      const s = parsed.scale ?? 2
      const max = Math.min(10 ** Math.max(1, p - s) - 1, 1_000_000)
      return faker.number.float({ min: 0, max, fractionDigits: s })
    }
    case 'bool':
      return faker.datatype.boolean()
    case 'date':
      return formatDate(randomDate())
    case 'datetime':
      return formatDateTime(randomDate())
    case 'time':
      return formatTime(randomDate())
    case 'uuid':
      return faker.string.uuid()
    case 'json':
      return JSON.stringify({ key: faker.word.noun(), value: faker.number.int({ min: 0, max: 100 }) })
    case 'binary':
      return faker.string.hexadecimal({ length: 16, prefix: '', casing: 'lower' })
    case 'text':
      return faker.lorem.paragraph()
    case 'string': {
      const len = parsed.length
      if (len !== undefined && len <= 3) return faker.string.alpha({ length: len })
      if (len !== undefined && len <= 12) return fit(faker.word.noun(), len)
      return fit(faker.lorem.words({ min: 1, max: 3 }), len)
    }
    default:
      return faker.lorem.word()
  }
}

/**
 * Value for a (non-FK, non-auto pk) column: name heuristics first, then the type default.
 * The declared varchar length is always honoured.
 */
export function valueForColumn(
  col: Column,
  table: Table,
  parsed: ParsedType,
  enumValues: string[] | undefined,
): unknown {
  if (parsed.category === 'enum') return valueForType(parsed, enumValues)
  const name = col.name.toLowerCase()
  for (const h of HEURISTICS) {
    if (!h.pattern.test(name)) continue
    if (!h.categories.includes(parsed.category)) continue
    const v = h.gen(col, table, parsed)
    return typeof v === 'string' ? fit(v, parsed.length) : v
  }
  return valueForType(parsed, enumValues)
}

/**
 * Deterministic tie-breaker when a unique column keeps colliding: derive a fresh value from the
 * row index so uniqueness is guaranteed for numbers/strings/dates (booleans cannot be unique
 * beyond two rows — the caller accepts the duplicate).
 */
export function uniqueFallback(value: unknown, parsed: ParsedType, rowIndex: number, attempt: number): unknown {
  const n = rowIndex + 1
  switch (parsed.category) {
    case 'int':
      return n * 1000 + attempt
    case 'float':
    case 'decimal':
      return Number(`${n}.${attempt}`)
    case 'date':
    case 'datetime':
    case 'time': {
      const d = new Date(DATE_FROM.getTime() + (rowIndex * 97 + attempt) * 3_600_000)
      if (parsed.category === 'date') return formatDate(d)
      if (parsed.category === 'time') return formatTime(d)
      return formatDateTime(d)
    }
    case 'uuid':
      return faker.string.uuid()
    case 'bool':
      return value
    default: {
      const s = String(value ?? '')
      const suffix = attempt > 0 ? `${n}_${attempt}` : String(n)
      const len = parsed.length
      if (s.includes('@')) {
        const [local, domain] = s.split('@')
        return fit(`${local}${suffix}@${domain}`, len)
      }
      if (len !== undefined && suffix.length >= len) return faker.string.alphanumeric(len)
      const body = len === undefined ? s : s.slice(0, len - suffix.length - 1)
      return body ? `${body}_${suffix}` : suffix
    }
  }
}
