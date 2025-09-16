// index.ts
// Drop-in Cloudflare Worker (TypeScript) that hosts an authless MCP server.
// - Exposes SSE at /sse (and /mcp as an alias)
// - Rewrites the SSE `data:` endpoint to an absolute URL (so Copilot Studio will POST correctly)
// - Accepts JSON-RPC POSTs at the session message path /sse/message (and /mcp/message alias)
// Paste/overwrite this into your index.ts in Cloudflare Worker.

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/* -------------------------
   Your MCP Agent + tools
   ------------------------- */
export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "Authless Calculator",
    version: "1.0.0",
  });

  async init() {
    // Simple addition tool
    this.server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }));

    // Calculator tool with multiple operations
    this.server.tool(
      "calculate",
      {
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
        a: z.number(),
        b: z.number(),
      },
      async ({ operation, a, b }) => {
        let result: number;
        switch (operation) {
          case "add":
            result = a + b;
            break;
          case "subtract":
            result = a - b;
            break;
          case "multiply":
            result = a * b;
            break;
          case "divide":
            if (b === 0)
              return {
                content: [
                  {
                    type: "text",
                    text: "Error: Cannot divide by zero",
                  },
                ],
              };
            result = a / b;
            break;
          default:
            return {
              content: [{ type: "text", text: "Unknown operation" }],
            };
        }
        return { content: [{ type: "text", text: String(result) }] };
      },
    );
  }
}

/* -------------------------
   Helper: rewrite SSE stream
   - Replaces relative `data: /sse/message?...` lines with absolute URLs
   - Preserves all other SSE content
   ------------------------- */
async function rewriteSseResponseToAbsolute(resp: Response, requestUrl: string): Promise<Response> {
  if (!resp.body) return resp;

  const reader = resp.body.getReader();
  const urlObj = new URL(requestUrl);
  const origin = `${urlObj.protocol}//${request.headers.get("host") ?? urlObj.host}`;

  let firstChunk = true;

  const transformed = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          let chunkText = new TextDecoder().decode(value);

          if (firstChunk && chunkText) {
            // Rewrite any `data: <relative-path>` occurrences to absolute URL
            // Examples matched: data: /sse/message?sessionId=..., data: /message?sessionId=...
            chunkText = chunkText.replace(/data:\s*(\/[^\r\n]*)/g, (m, rel) => {
              // If it's already absolute, leave it
              if (rel.startsWith("http://") || rel.startsWith("https://")) return `data: ${rel}`;
              // Otherwise make absolute using the request origin
              return `data: ${origin}${rel}`;
            });
            firstChunk = false;
          }

          controller.enqueue(new TextEncoder().encode(chunkText));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason);
    },
  });

  // copy headers from original response
  const newHeaders = new Headers();
  for (const [k, v] of resp.headers) {
    newHeaders.set(k, v ?? "");
  }

  return new Response(transformed, {
    status: resp.status,
    statusText: resp.statusText,
    headers: newHeaders,
  });
}

/* -------------------------
   Worker fetch handler
   Routes:
   - GET /sse  -> open SSE (rewritten to return absolute session URL)
   - GET /mcp  -> alias for /sse (rewritten similarly)
   - POST /sse/message?sessionId=... -> JSON-RPC handling (serve by SDK)
   - POST /mcp/message?sessionId=... -> alias (served by SDK)
   - POST /mcp (optional) -> alias to /sse/message handling
   ------------------------- */

interface Env {} // add bindings if you have any KV / secrets

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // normalize path: remove trailing slashes (but keep root '/')
    const rawPath = url.pathname || "/";
    const path = rawPath.replace(/\/+$/, "") || "/";

    // If client requests SSE on either /sse or /mcp, let the SDK produce SSE and rewrite endpoint URLs to absolute
    if (path === "/sse" || path === "/mcp") {
      // The SDK helper returns a Response object with an SSE body.
      // We ask it to serveSSE("/sse") so its internal session message path is /sse/message.
      const sseResp = await MyMCP.serveSSE("/sse").fetch(request, env, ctx);
      return await rewriteSseResponseToAbsolute(sseResp, request.url);
    }

    // POST /sse/message (session-specific JSON-RPC endpoint) or aliases
    if (path === "/sse/message" || path === "/mcp/message" || path === "/mcp") {
      // Delegate JSON-RPC handling to the SDK. We use serve("/sse/message") so the SDK's routing matches.
      return MyMCP.serve("/sse/message").fetch(request, env, ctx);
    }

    // Optional health or root text for browsers
    if (path === "/" || path === "") {
      return new Response("MCP Worker - endpoints: /sse (SSE entrypoint) and /sse/message (POST JSON-RPC).", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
