/**
 * Django models.py generation and parsing. OWNER: worker-4 (core-django).
 * Signatures are a contract used by editors/app/demo — keep them.
 */
import type { Diagnostic, Schema } from '../schema'

export { generateDjango, type GenerateResult } from './generate'
export { initDjangoParser, parseDjango, type DjangoParseResult, type DjangoParserOptions } from './parse'
export { DJANGO_TYPE_CHOICES, TYPE_MAP, mapDbmlType, mapDjangoField } from './typemap'
export type { Diagnostic, Schema }
