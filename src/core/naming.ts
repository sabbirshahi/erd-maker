/** Naming helpers shared by generators/parsers. */

export function toPascalCase(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

export function toSnakeCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
}

const IRREGULAR: Record<string, string> = {
  people: 'person', men: 'man', women: 'woman', children: 'child', teeth: 'tooth', feet: 'foot',
  mice: 'mouse', geese: 'goose', data: 'datum', media: 'medium', indices: 'index', statuses: 'status',
  addresses: 'address', categories: 'category', companies: 'company', countries: 'country',
}

/** Naive English singularisation good enough for table -> class names. */
export function singularize(word: string): string {
  const lower = word.toLowerCase()
  if (IRREGULAR[lower]) return IRREGULAR[lower]
  if (/(ss|us|is)$/.test(lower)) return word
  if (/ies$/.test(lower)) return word.slice(0, -3) + 'y'
  if (/(x|ch|sh|s)es$/.test(lower)) return word.slice(0, -2)
  if (/s$/.test(lower) && !/ss$/.test(lower)) return word.slice(0, -1)
  return word
}

export function pluralize(word: string): string {
  const lower = word.toLowerCase()
  const inv = Object.entries(IRREGULAR).find(([, s]) => s === lower)
  if (inv) return inv[0]
  if (/(s|x|ch|sh)$/.test(lower)) return word + 'es'
  if (/[^aeiou]y$/.test(lower)) return word.slice(0, -1) + 'ies'
  return word + 's'
}

/** `users` -> `User`, `order_items` -> `OrderItem`, `public.blog_posts` -> `BlogPost` */
export function tableNameToClassName(tableName: string): string {
  const base = tableName.split('.').pop() ?? tableName
  const parts = base.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) return 'Model'
  parts[parts.length - 1] = singularize(parts[parts.length - 1])
  return toPascalCase(parts.join(' '))
}

/** `OrderItem` -> `order_items` */
export function classNameToTableName(className: string): string {
  const snake = toSnakeCase(className)
  const parts = snake.split('_')
  parts[parts.length - 1] = pluralize(parts[parts.length - 1])
  return parts.join('_')
}
