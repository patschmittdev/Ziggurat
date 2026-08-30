import { McpServer } from '@modelcontextprotocol/server';
import { createContextAccess } from './access.js';
import { registerContextTools } from './tools.js';

export { createContextAccess } from './access.js';
export { registerContextTools } from './tools.js';

/** Creates the shipped communion-only MCP server. */
export async function createMcpServer(root: string): Promise<McpServer> {
  const access = await createContextAccess(root, 'communion');
  const server = new McpServer({
    name: 'ziggurat-communion',
    version: '0.1.0',
  });
  registerContextTools(server, access);
  return server;
}

/** Starts the communion-only MCP server over stdio. */
export async function startMcpServer(root: string): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
  const server = await createMcpServer(root);
  await server.connect(new StdioServerTransport());
}
