/**
 * Pre-cleaning of SQL DDL before handing it to the @dbml/core importer, plus dialect auto-detection.
 * Removed statements are replaced by the same number of blank lines so importer diagnostics still
 * point at the user's original line numbers.
 */
import type { SqlImportDialect } from './index'

const MYSQL_HINTS = [/`[^`\n]+`/, /\bENGINE\s*=/i, /\bAUTO_INCREMENT\b/i, /\bUNSIGNED\b/i, /\bCHARSET\b/i, /\bCOLLATE\s*=/i]
const MSSQL_HINTS = [/\[dbo\]\./i, /\bNVARCHAR\b/i, /\bIDENTITY\s*\(/i, /^\s*GO\s*$/im, /\bCREATE\s+TABLE\s+\[/i, /\bDATETIME2\b/i]
const POSTGRES_HINTS = [/\bSERIAL\b/i, /\bGENERATED\s+(BY\s+DEFAULT|ALWAYS)\s+AS\s+IDENTITY\b/i, /\bCREATE\s+TYPE\b/i, /\bCREATE\s+EXTENSION\b/i, /::\w+/, /\bTIMESTAMPTZ\b/i, /\bJSONB\b/i]

const score = (sql: string, hints: RegExp[]): number => hints.reduce((n, re) => n + (re.test(sql) ? 1 : 0), 0)

export function detectDialect(sql: string): SqlImportDialect {
  const my = score(sql, MYSQL_HINTS)
  const ms = score(sql, MSSQL_HINTS)
  const pg = score(sql, POSTGRES_HINTS)
  if (ms > my && ms >= pg) return 'mssql'
  if (my > pg && my > ms) return 'mysql'
  return 'postgres'
}

/** Split on `;` outside of single/double quotes, backticks, brackets and comments. Keeps the terminator. */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let start = 0
  let quote: string | null = null
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (quote) {
      if (quote === '--') {
        if (ch === '\n') quote = null
      } else if (quote === '/*') {
        if (ch === '*' && sql[i + 1] === '/') {
          quote = null
          i++
        }
      } else if (ch === quote) {
        if (sql[i + 1] === quote) i++ // doubled quote escape
        else quote = null
      } else if (ch === '\\' && quote === "'") i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '[') quote = ']'
    else if (ch === '-' && sql[i + 1] === '-') quote = '--'
    else if (ch === '/' && sql[i + 1] === '*') quote = '/*'
    else if (ch === ';') {
      out.push(sql.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < sql.length) out.push(sql.slice(start))
  return out
}

/** Statements that carry no schema information and only trip up (or bloat) the importer. */
const DROP_PATTERNS: RegExp[] = [
  /^\s*(?:--[^\n]*\n\s*)*(?:\/\*[\s\S]*?\*\/\s*)*SET\b/i,
  /^\s*(?:--[^\n]*\n\s*)*USE\b/i,
  /^\s*(?:--[^\n]*\n\s*)*(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/i,
  /^\s*(?:--[^\n]*\n\s*)*SELECT\b/i,
  /^\s*(?:--[^\n]*\n\s*)*INSERT\s+INTO\b/i,
  /^\s*(?:--[^\n]*\n\s*)*(?:LOCK|UNLOCK)\s+TABLES\b/i,
  /^\s*(?:--[^\n]*\n\s*)*DROP\s+(?:TABLE|TYPE|INDEX|SEQUENCE|VIEW|SCHEMA|DATABASE|EXTENSION|TRIGGER|FUNCTION)\b/i,
  /^\s*(?:--[^\n]*\n\s*)*CREATE\s+(?:OR\s+REPLACE\s+)?(?:EXTENSION|SEQUENCE|FUNCTION|PROCEDURE|TRIGGER|VIEW|MATERIALIZED\s+VIEW|DATABASE|SCHEMA|ROLE|USER)\b/i,
  /^\s*(?:--[^\n]*\n\s*)*ALTER\s+(?:SEQUENCE|SCHEMA|DATABASE|ROLE|USER|FUNCTION|TYPE)\b/i,
  /^\s*(?:--[^\n]*\n\s*)*ALTER\s+TABLE\s+(?:ONLY\s+)?[^;]*?\bOWNER\s+TO\b/i,
  /^\s*(?:--[^\n]*\n\s*)*ALTER\s+TABLE\s+(?:ONLY\s+)?[^;]*?\bALTER\s+COLUMN\s+[^;]*?\bSET\s+DEFAULT\s+nextval\(/i,
  /^\s*(?:--[^\n]*\n\s*)*COMMENT\s+ON\s+(?:EXTENSION|SCHEMA|DATABASE|TYPE|INDEX|CONSTRAINT|SEQUENCE|FUNCTION)\b/i,
  /^\s*(?:--[^\n]*\n\s*)*GRANT\b/i,
  /^\s*(?:--[^\n]*\n\s*)*REVOKE\b/i,
  /^\s*(?:--[^\n]*\n\s*)*DELIMITER\b/i,
  /^\s*(?:--[^\n]*\n\s*)*ANALYZE\b/i,
  /^\s*(?:--[^\n]*\n\s*)*VACUUM\b/i,
  /^\s*(?:--[^\n]*\n\s*)*\\\w/, // psql meta-commands such as \connect
]

const blankLike = (s: string): string => s.replace(/[^\n]/g, '')

/** `::type` casts (optionally schema-qualified, multi-word, with args / array suffix). */
const PG_CAST =
  /::"?[A-Za-z_]\w*"?(?:\."?[A-Za-z_]\w*"?)?(?: varying| precision| without time zone| with time zone)?(?:\(\d+(?:,\s*\d+)?\))?(?:\[\])*/g

export function cleanSql(sql: string, dialect: SqlImportDialect): string {
  let text = sql.replace(/\r\n?/g, '\n')
  // psql meta-commands are not `;`-terminated; blank them line-wise first.
  text = text.replace(/^\\[^\n]*$/gm, '')
  if (dialect === 'mssql') {
    // Batch separators are noise for the parser; IDENTITY(seed, step) is `increment` in DBML terms.
    text = text.replace(/^[ \t]*GO(?:[ \t]+\d+)?[ \t]*$/gim, '')
    text = text.replace(/\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'IDENTITY')
  }
  if (dialect === 'mysql') {
    // `/*!40101 SET ... */` conditional comments from mysqldump.
    text = text.replace(/\/\*![0-9]{5}[\s\S]*?\*\//g, (m) => blankLike(m))
    text = text.replace(/^[ \t]*DELIMITER\b[^\n]*$/gim, '')
  }
  if (dialect === 'postgres') {
    // pg_dump casts every default: `DEFAULT 'draft'::public.post_status`, `nextval('s'::regclass)`.
    text = text.replace(PG_CAST, '')
  }
  const cleaned = splitStatements(text).map((stmt) =>
    DROP_PATTERNS.some((re) => re.test(stmt)) || /^[\s;]*$/.test(stmt) ? blankLike(stmt) : stmt,
  )
  return cleaned.join('')
}
