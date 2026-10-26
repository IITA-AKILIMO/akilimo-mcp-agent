import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AkilimoApiClient } from "./api/client.js";
import {
  ComputeFieldsSchema,
  ComputeRequestSchema,
  FertilizerSchema,
  UserInfoSchema,
} from "@akilimo/shared";
import { z } from "zod/v4";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";

const API_BASE_URL = process.env.AKILIMO_API_BASE_URL || "http://localhost:8600";
const API_KEY = process.env.AKILIMO_API_KEY || "";
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];

const apiClient = new AkilimoApiClient(API_BASE_URL, API_KEY);

// Reference data endpoints of the Akilimo API, and which of them accept /country/{code}
const REFERENCE_CATEGORIES = [
  'countries', 'currencies', 'fertilizers', 'fertilizer-prices', 'investment-amounts',
  'operation-costs', 'starch-factories', 'starch-prices', 'default-prices', 'cassava-units',
  'cassava-prices', 'potato-prices', 'maize-prices',
];
const COUNTRY_FILTERABLE = [
  'fertilizers', 'fertilizer-prices', 'investment-amounts', 'operation-costs',
  'starch-factories', 'cassava-prices', 'potato-prices', 'maize-prices',
];

// The API requires user_info; the agent sends an anonymous profile unless the caller overrides it
const DEFAULT_USER_INFO = {
  device_token: process.env.AKILIMO_DEVICE_TOKEN || randomUUID(),
  risk_attitude: 0,
  user_name: "akilimo-mcp",
  first_name: "Akilimo",
  last_name: "MCP",
  gender: "M" as const,
  send_sms: false,
  send_email: false,
};

const ComputeToolInputSchema = z.object({
  compute_request: ComputeFieldsSchema,
  fertilizer_list: z.array(FertilizerSchema).default([])
    .describe("Fertilizers available to the farmer; get keys and names from get_reference_data 'fertilizers'"),
  user_info: UserInfoSchema.partial().optional()
    .describe("Optional overrides for the farmer profile; an anonymous profile is used by default"),
});

const computeToolJsonSchema = z.toJSONSchema(ComputeToolInputSchema, { io: "input" });

const server = new Server(
  {
    // Akilimo 1.0 = this agent on the Laravel Akilimo API; Akilimo 2.0 is the hosted MCP at app2.akilimo.org
    name: "akilimo-1.0",
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
        description: "Fetch public agricultural reference data from the Akilimo API (countries, currencies, fertilizers, prices, costs, starch factories, etc.)",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "The category of data to fetch",
              enum: REFERENCE_CATEGORIES,
            },
            countryCode: {
              type: "string",
              description: `Optional ISO 2-letter country code. Only supported for: ${COUNTRY_FILTERABLE.join(', ')}`,
            },
          },
          required: ["category"],
        },
      },
      {
        name: "compute_recommendations",
        description: "Compute fertilizer, intercropping and planting recommendations for a farm. Only farm location, size, use case and planting/harvest dates are required; other fields default to neutral values.",
        inputSchema: computeToolJsonSchema as { type: "object"; [key: string]: unknown },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "get_reference_data") {
      const category = args?.category as string;
      const countryCode = (args?.countryCode as string | undefined)?.trim().toUpperCase();

      if (!REFERENCE_CATEGORIES.includes(category)) {
        throw new Error(`Unknown category '${category}'. Use one of: ${REFERENCE_CATEGORIES.join(', ')}`);
      }
      if (countryCode && !COUNTRY_FILTERABLE.includes(category)) {
        throw new Error(`Category '${category}' cannot be filtered by country; omit countryCode. Country filtering works for: ${COUNTRY_FILTERABLE.join(', ')}`);
      }

      let url = `/v1/${category}`;
      if (countryCode) {
        url = `/v1/${category}/country/${encodeURIComponent(countryCode)}`;
      }

      const data = await apiClient.get(url);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "compute_recommendations") {
      const validation = ComputeRequestSchema.safeParse({
        compute_request: args?.compute_request,
        fertilizer_list: args?.fertilizer_list,
        user_info: { ...DEFAULT_USER_INFO, ...(args?.user_info as object | undefined) },
      });
      if (!validation.success) {
        return {
          content: [{ type: "text", text: `Invalid payload:\n${z.prettifyError(validation.error)}` }],
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
      console.error(`Akilimo 1.0 MCP Agent running on SSE at http://localhost:${PORT}/sse`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Akilimo 1.0 MCP Agent running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
