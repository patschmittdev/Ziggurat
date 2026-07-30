import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import * as YAML from 'yaml';

export interface ZigguratConfig {
  schema_version: 1;
  lifecycle: { review_queue_limit: number };
  domain: { page_types: string[]; tags: string[] };
  privacy: { default_sensitivity: 'restricted'; default_pii: 'unknown' };
  adapters: {
    model_endpoint?: string;
    embedding_endpoint?: string;
  };
}

const ZigguratConfigSchema = z.object({
  schema_version: z.literal(1),
  lifecycle: z.object({
    review_queue_limit: z.number().int().min(1),
  }),
  domain: z.object({
    page_types: z.array(z.string().min(1)).min(1),
    tags: z.array(z.string().min(1)).min(1),
  }),
  privacy: z.object({
    default_sensitivity: z.literal('restricted'),
    default_pii: z.literal('unknown'),
  }),
  adapters: z.object({
    model_endpoint: z.string().url().optional(),
    embedding_endpoint: z.string().url().optional(),
  }),
});

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function loadYamlFile(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, 'utf-8');

  if (/\t/.test(text)) {
    throw new Error(`${filePath}: tab characters are not permitted in YAML config`);
  }

  if (/!!/.test(text)) {
    throw new Error(`${filePath}: custom YAML type tags (!!) are not permitted`);
  }

  const doc = YAML.parseDocument(text);

  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    throw new Error(
      `${filePath}: YAML parse error: ${first != null ? String(first.message) : 'unknown'}`,
    );
  }

  let violation: string | undefined;

  YAML.visit(doc, {
    Alias() {
      violation = `${filePath}: YAML aliases (*) are not permitted`;
    },
    Scalar(_key, node) {
      if (node.anchor != null) {
        violation = `${filePath}: YAML anchors (&) are not permitted`;
      }
    },
    Map(_key, node) {
      if (node.anchor != null) {
        violation = `${filePath}: YAML anchors (&) are not permitted`;
      }
    },
    Seq(_key, node) {
      if (node.anchor != null) {
        violation = `${filePath}: YAML anchors (&) are not permitted`;
      }
    },
  });

  if (violation !== undefined) {
    throw new Error(violation);
  }

  return doc.toJS();
}

function buildAdapters(
  raw: { model_endpoint?: string | undefined; embedding_endpoint?: string | undefined },
): ZigguratConfig['adapters'] {
  const adapters: ZigguratConfig['adapters'] = {};
  if (raw.model_endpoint !== undefined) {
    adapters.model_endpoint = raw.model_endpoint;
  }
  if (raw.embedding_endpoint !== undefined) {
    adapters.embedding_endpoint = raw.embedding_endpoint;
  }
  return adapters;
}

export async function parseZigguratConfig(root: string): Promise<ZigguratConfig> {
  const configDir = join(root, 'config');

  const [base, domain, privacy, adapters] = await Promise.all([
    loadYamlFile(join(configDir, 'ziggurat.yaml')),
    loadYamlFile(join(configDir, 'domain.yaml')),
    loadYamlFile(join(configDir, 'privacy.yaml')),
    loadYamlFile(join(configDir, 'adapters.yaml')),
  ]);

  const merged: unknown = Object.assign(
    {},
    typeof base === 'object' && base !== null ? base : {},
    typeof domain === 'object' && domain !== null ? domain : {},
    typeof privacy === 'object' && privacy !== null ? privacy : {},
    typeof adapters === 'object' && adapters !== null ? adapters : {},
  );

  const parsed = ZigguratConfigSchema.parse(merged);

  for (const key of ['model_endpoint', 'embedding_endpoint'] as const) {
    const endpoint = parsed.adapters[key];
    if (endpoint !== undefined) {
      const url = new URL(endpoint);
      if (!LOOPBACK_HOSTS.has(url.hostname)) {
        throw new Error(
          `adapters.${key}: only loopback addresses are allowed, got ${url.hostname}`,
        );
      }
    }
  }

  return {
    schema_version: parsed.schema_version,
    lifecycle: parsed.lifecycle,
    domain: parsed.domain,
    privacy: parsed.privacy,
    adapters: buildAdapters(parsed.adapters),
  };
}
