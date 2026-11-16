import readline from "node:readline";
import { handleToolCall } from "./handlers.js";
import { POLY_MCP_RESOURCES, handleResourceRead } from "./resources.js";
import { POLY_MCP_TOOLS } from "./tools.js";
import type { JsonRpcRequest, JsonRpcResponse } from "./types.js";

export class PolyMcpServer {
  private workspaceDir: string;
  private isRunning = false;

  constructor(workspaceDir = process.cwd()) {
    this.workspaceDir = workspaceDir;
  }

  /**
   * Starts the stdio JSON-RPC MCP server.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Use readline interface to process line-delimited JSON-RPC
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Handle optional Content-Length prefix if present
      let jsonPayload = trimmed;
      if (jsonPayload.startsWith("Content-Length:")) {
        const headerEnd = jsonPayload.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          jsonPayload = jsonPayload.substring(headerEnd + 4).trim();
        }
      }

      if (!jsonPayload.startsWith("{")) return;

      try {
        const request = JSON.parse(jsonPayload) as JsonRpcRequest;
        const response = await this.handleRequest(request);
        if (response) {
          this.sendResponse(response);
        }
      } catch (err) {
        this.sendResponse({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${(err as Error).message}`,
          },
        });
      }
    });

    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());
  }

  stop(): void {
    this.isRunning = false;
    process.exit(0);
  }

  /**
   * Dispatches incoming JSON-RPC 2.0 requests to the appropriate MCP capability.
   */
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { id, method, params } = request;

    // Handle notifications (no response required)
    if (method.startsWith("notifications/")) {
      return null;
    }

    switch (method) {
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: {
              name: "poly-mcp",
              version: "0.1.0",
            },
          },
        };
      }

      case "ping": {
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };
      }

      case "tools/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: POLY_MCP_TOOLS,
          },
        };
      }

      case "tools/call": {
        const toolName = String(params?.name || "");
        const toolArgs = (params?.arguments || {}) as Record<string, unknown>;

        if (!toolArgs.workspaceDir) {
          toolArgs.workspaceDir = this.workspaceDir;
        }

        const callResult = await handleToolCall(toolName, toolArgs);
        return {
          jsonrpc: "2.0",
          id,
          result: callResult,
        };
      }

      case "resources/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            resources: POLY_MCP_RESOURCES,
          },
        };
      }

      case "resources/read": {
        const uri = String(params?.uri || "");
        try {
          const content = handleResourceRead(uri, this.workspaceDir);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              contents: [content],
            },
          };
        } catch (err) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: (err as Error).message,
            },
          };
        }
      }

      default: {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: '${method}'`,
          },
        };
      }
    }
  }

  private sendResponse(response: JsonRpcResponse): void {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
