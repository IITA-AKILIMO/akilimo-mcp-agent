import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AkilimoApiClient } from "./api/client.js";
import { ComputeRequestSchema } from "@akilimo/shared";
import express from "express";
import cors from "cors";

const API_BASE_URL = process.env.AKILIMO_API_BASE_URL || "http://localhost:8600";
const API_KEY = process.env.AKILIMO_API_KEY || "";
const V2_API_KEY = process.env.AKILIMO_V2_API_KEY || "";
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];

const apiClient = new AkilimoApiClient(API_BASE_URL, API_KEY, V2_API_KEY);

const server = new Server(
  {
    name: "akilimo-mcp-agent",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_reference_data",
        description: "Fetch public agricultural reference data (countries, currencies, fertilizers, prices, etc.)",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "The category of data to fetch (e.g., 'countries', 'currencies', 'fertilizers', 'fertilizer-prices', 'maize-prices', 'cassava-prices', 'potato-prices')",
              enum: ['countries', 'currencies', 'fertilizers', 'fertilizer-prices', 'maize-prices', 'cassava-prices', 'potato-prices', 'investment-amounts', 'operation-costs'],
            },
            countryCode: {
              type: "string",
              description: "Optional ISO 2-letter country code to filter results",
            },
          },
          required: ["category"],
        },
      },
      {
        name: "compute_recommendations",
        description: "Submit farm data to receive agricultural recommendations",
        inputSchema: {
          type: "object",
          properties: {
            payload: {
              type: "object",
              description: "The detailed farm and crop data according to ComputeRequestData schema",
            },
          },
          required: ["payload"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "get_reference_data") {
      const category = args?.category as string;
      const countryCode = args?.countryCode as string;
      
      let url = `/v1/${category}`;
      if (countryCode) {
        url = `/v1/${category}/country/${countryCode}`;
      }

      const data = await apiClient.get(url);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "compute_recommendations") {
      const payload = args?.payload;
      
      const validation = ComputeRequestSchema.safeParse(payload);
      if (!validation.success) {
        return {
          content: [{ type: "text", text: `Invalid payload: ${validation.error.message}` }],
          isError: true,
        };
      }

      const result = await apiClient.post("/v1/recommendations/compute", validation.data);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: error.message }],
      isError: true,
    };
  }
});

async function main() {
  if (process.env.TRANSPORT === "sse") {
    const app = express();
    
    app.use(cors({
      origin: ALLOWED_ORIGINS,
      methods: ['GET', 'POST'],
      credentials: true
    }));

    let transport: SSEServerTransport | null = null;

    app.get("/health", (req, res) => {
      res.json({ status: "ok" });
    });

    app.get("/sse", async (req, res) => {
      transport = new SSEServerTransport("/messages", res);
      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send("No SSE connection established");
      }
    });

    app.listen(PORT, () => {
      console.error(`Akilimo MCP Agent running on SSE at http://localhost:${PORT}/sse`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Akilimo MCP Agent running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
