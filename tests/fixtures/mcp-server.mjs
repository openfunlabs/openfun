import { createInterface } from "node:readline";

// A local protocol fixture. No provider, credentials or network requests.
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case "initialize":
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "openfun-fixture", version: "1.0.0" },
      };
      break;
    case "tools/list":
      result = {
        tools: [
          {
            name: "echo",
            description: "Echo a fixture message",
            inputSchema: {
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"],
            },
          },
        ],
      };
      break;
    case "tools/call":
      result = {
        content: [
          {
            type: "text",
            text: `OpenFun MCP: ${request.params.arguments.message}`,
          },
        ],
      };
      break;
    default:
      result = {};
  }
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
  );
});
