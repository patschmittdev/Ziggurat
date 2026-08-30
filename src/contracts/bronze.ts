import { z } from 'zod';
import { PiiStateSchema, SensitivitySchema } from './common.js';

/**
 * Bronze frontmatter is strict: an unknown field is either corruption or an attempt to
 * smuggle admission metadata into evidence, and neither should be silently preserved.
 */
export const BronzeRecordSchema = z.object({
  schema_version: z.literal(1),
  source_id: z.string().min(1),
  source_kind: z.string().min(1),
  captured_at: z.string().regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    'captured_at must be a UTC ISO-8601 datetime',
  ),
  sha256: z.string().length(64).regex(/^[0-9a-f]{64}$/),
  origin: z.string().url().optional(),
  sensitivity: SensitivitySchema,
  pii: PiiStateSchema,
}).strict();

export type BronzeRecord = z.infer<typeof BronzeRecordSchema>;
