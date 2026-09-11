import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';
import { mcpConfigSchema, type McpConfig, type McpServer } from './types.js';

export function parseMcpConfig(json: string): McpConfig {
  return mcpConfigSchema.parse(JSON.parse(json));
}

async function connectOne(config: McpConfig): Promise<MCPClient> {
  return createMCPClient({
    clientName: 'gandre',
    transport:
      config.transport === 'stdio'
        ? new StdioMCPTransport({ command: config.command, args: config.args, env: config.env })
        : { type: config.transport, url: config.url, headers: config.headers },
  });
}

export interface McpConnection {
  tools: ToolSet;
  close: () => Promise<void>;
}

export async function connectMcpServers(servers: McpServer[]): Promise<McpConnection> {
  const clients: MCPClient[] = [];
  let tools: ToolSet = {};
  try {
    for (const server of servers) {
      const client = await connectOne(parseMcpConfig(server.config)).catch((err) => {
        throw new Error(`MCP-server «${server.name}»: ${err instanceof Error ? err.message : err}`);
      });
      clients.push(client);
      const serverTools = (await client.tools()) as ToolSet;
      tools = { ...tools, ...serverTools };
    }
  } catch (err) {
    await closeAll(clients);
    throw err;
  }
  return { tools, close: () => closeAll(clients) };
}

export interface McpTestResult {
  ok: boolean;
  tools: string[];
  error?: string;
}

// Prøver å koble til serveren og liste verktøyene — brukes av Test-knappen på /mcp
export async function testMcpServer(server: McpServer, timeoutMs = 20_000): Promise<McpTestResult> {
  let client: MCPClient | null = null;
  try {
    const result = await Promise.race([
      (async () => {
        client = await connectOne(parseMcpConfig(server.config));
        const tools = await client.tools();
        return { ok: true, tools: Object.keys(tools) } satisfies McpTestResult;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`tidsavbrudd etter ${timeoutMs / 1000}s`)), timeoutMs)
      ),
    ]);
    return result;
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (message.includes('closed client')) {
      message =
        'Serverprosessen døde rett etter start — sjekk at stien i konfigurasjonen stemmer ' +
        'og at avhengigheter er installert (npm install i servermappen). Detaljer i err.log.';
    }
    return { ok: false, tools: [], error: message };
  } finally {
    if (client) await (client as MCPClient).close().catch(() => {});
  }
}

async function closeAll(clients: MCPClient[]): Promise<void> {
  await Promise.allSettled(clients.map((c) => c.close()));
}
