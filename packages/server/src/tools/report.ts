import { ToolError, type ToolDefinition } from "./types.js";

// Only the API's own report route; the host of the link is ignored and the file is always fetched from
// AKILIMO_API_BASE_URL, so the tool can never be pointed at another server
const REPORT_PATH = /\/v1\/recommendations\/reports\/[0-9a-f-]{36}\/[A-Za-z0-9_.-]{1,100}\.pdf$/i;
const MAX_BYTES = 10 * 1024 * 1024;

export const recommendationReportTool: ToolDefinition = {
  name: "get_recommendation_report",
  description: "Get the PDF report of a recommendation from compute_recommendations: pass report.url (or one of report.files[].url) from its answer. "
    + "Returns the PDF as a file for MCP clients that can show or save files. In a chat, give the farmer the link itself instead of calling this; "
    + "the link works until report.expires_at (7 days by default) and needs no key.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "report.url or report.files[].url from the compute_recommendations answer" },
    },
    required: ["url"],
  },

  async handler(args, api) {
    let link: URL;
    try {
      link = new URL(String(args?.url ?? ""));
    } catch {
      throw new ToolError("url must be the report.url from a compute_recommendations answer");
    }
    const at = link.pathname.search(/\/v1\/recommendations\/reports\//);
    if (at < 0 || !REPORT_PATH.test(link.pathname) || !link.searchParams.get("signature")) {
      throw new ToolError("url must be the report.url from a compute_recommendations answer");
    }

    // The path after the API's base (…/v1/…) with the signature and expiry, on this server's own API address
    const { bytes, contentType } = await api.getFile(link.pathname.slice(at) + link.search);
    if (!contentType.includes("pdf") || bytes.subarray(0, 4).toString() !== "%PDF" || bytes.length > MAX_BYTES) {
      throw new ToolError("The API did not return a PDF report; the link may have expired, compute the recommendation again");
    }

    const name = link.pathname.split("/").pop()!;
    return {
      content: [
        { type: "resource", resource: { uri: link.toString(), mimeType: "application/pdf", blob: bytes.toString("base64") } },
        { type: "text", text: `AKILIMO report ${name} (${Math.round(bytes.length / 1024)} KB). Download link, valid until it expires: ${link.toString()}` },
      ],
    };
  },
};
