import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AKILIMO2_TOOL, akilimo2Args, summarizeAkilimo2 } from "@akilimo/shared";
import type { ToolSession } from "./mcp.js";

// When Akilimo 1.0 and Akilimo 2.0 are both switched on, a fertilizer request (`compute_recommendations`) is put
// to both in the same step, and the model gets both answers in one tool result, so it can show them together.
const SECOND_TIMEOUT_MS = 60_000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`did not answer within ${ms / 1000} s`)), ms).unref()),
  ]);

const textOf = (result: CallToolResult) => result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

// The other server in this session that offers the recommendation tool of Akilimo 2.0, if there is one
export const secondRecommender = (session: ToolSession, firstServer: string) =>
  session.tools.find((t) => t.name === AKILIMO2_TOOL && t.server !== firstServer);

interface Options {
  // Called before each upstream call, to count it against the user's allowance; throws to refuse it
  beforeCall?: (server: string) => void;
  signal?: AbortSignal;
}

export async function recommendOnBoth(
  session: ToolSession,
  firstServer: string,
  args: Record<string, unknown>,
  { beforeCall, signal }: Options = {},
): Promise<CallToolResult> {
  const second = secondRecommender(session, firstServer);
  const mapped = second ? akilimo2Args(args) : null;
  if (!second || !mapped) return session.callTool(firstServer, "compute_recommendations", args, signal);

  // Both run at the same time; a failure of the second never hides the first answer
  const secondCall = (async () => {
    beforeCall?.(second.server);
    const result = await withTimeout(session.callTool(second.server, AKILIMO2_TOOL, { ...mapped }, signal), SECOND_TIMEOUT_MS);
    const text = textOf(result);
    if (result.isError) return { error: text.slice(0, 400) || "Akilimo 2.0 returned an error" };
    try {
      const summary = summarizeAkilimo2(JSON.parse(text));
      return summary ?? { error: "Akilimo 2.0 answered in a format that was not understood", raw: text.slice(0, 1200) };
    } catch {
      return { error: "Akilimo 2.0 answered in a format that was not understood", raw: text.slice(0, 1200) };
    }
  })().catch((error: unknown) => ({ error: `Akilimo 2.0 could not be reached: ${error instanceof Error ? error.message : String(error)}` }));

  const [first, other] = await Promise.all([session.callTool(firstServer, "compute_recommendations", args, signal), secondCall]);
  if (first.isError) return first;

  let firstData: unknown;
  try {
    firstData = JSON.parse(textOf(first));
  } catch {
    firstData = textOf(first);
  }
  // The shorter 2.0 summary goes first so it survives the result being shortened for the model
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        akilimo_2_0: {
          figures: other,
          note: "Akilimo 2.0 used only the field location and size; its figures are per hectare, in the currency shown, with its own prices, not the farmer's fertilizer prices or budget.",
        },
        akilimo_1_0: firstData,
      }),
    }],
  };
}
