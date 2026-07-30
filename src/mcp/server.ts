import { McpServer } from '@modelcontextprotocol/server';
import type { AccessProfile } from '../contracts/index.js';
import { createContextAccess } from './access.js';
import { registerContextTools } from './tools.js';

export { createContextAccess } from './access.js';
export { registerContextTools } from './tools.js';

/**
 * Creates an McpServer bound to the given profile and vault root.
 * Loads the index at call time; throws if the index is absent or invalid.
 */
export async function createMcpServer(root: string, profile: AccessProfile): Promise<McpServer> {
  const access = await createContextAccess(root, profile);
  const server = new McpServer({
    name: `ziggurat-${profile}`,
    version: '0.1.0',
  });
  registerContextTools(server, access);
  return server;
}

/**
 * Starts the MCP server over stdio. Blocks until the process exits.
 * Designed for use as a subprocess entry point.
 */
export async function startMcpServer(root: string, profile: AccessProfile): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
  const server = await createMcpServer(root, profile);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
