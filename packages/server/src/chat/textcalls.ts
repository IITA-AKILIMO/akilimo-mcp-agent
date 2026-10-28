import type { ChatMessage } from "@akilimo/shared";

// Small models often "call" a tool by writing JSON in their answer ({"tool": "...", "arguments": {...}}, usually
// in a code block) instead of making a real tool call, and then repeat it. This reads such calls back, so the
// tool runs and the model gets its result; only JSON that names a tool we really have is taken, and a name
// the model got slightly wrong (a mistyped server prefix) is matched on the tool's own name.
export interface TextCalls {
  calls: NonNullable<ChatMessage["tool_calls"]>;
  text: string; // the answer without the JSON (and the empty code blocks it leaves behind)
}

// Every balanced {...} in the text, as [start, end), ignoring braces inside strings
function jsonObjects(text: string): [number, number][] {
  const found: [number, number][] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j]!;
      if (inString) {
        if (c === "\\") j++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        found.push([i, j + 1]);
        i = j; // objects inside this one are part of it
        break;
      }
    }
  }
  return found;
}

// The registered function name a model's name stands for, or null: exact, else the part after the last "__"
export function resolveToolName(name: string, tools: readonly string[]): string | null {
  if (tools.includes(name)) return name;
  const short = name.split("__").pop() ?? name;
  return tools.find((t) => t === short) ?? tools.find((t) => t.endsWith(`__${short}`)) ?? null;
}

export function extractTextToolCalls(content: string, tools: readonly string[]): TextCalls | null {
  const calls: TextCalls["calls"] = [];
  const cut: [number, number][] = [];
  for (const [start, end] of jsonObjects(content)) {
    let parsed: unknown;
    try { parsed = JSON.parse(content.slice(start, end)); } catch { continue; }
    if (!parsed || typeof parsed !== "object") continue;
    const o = parsed as Record<string, unknown>;
    const raw = o.tool ?? o.name ?? o.function ?? o.tool_name;
    if (typeof raw !== "string") continue;
    const name = resolveToolName(raw, tools);
    if (!name) continue;
    const given = o.arguments ?? o.args ?? o.parameters ?? o.input ?? {};
    let args: Record<string, unknown> = {};
    if (typeof given === "string") { try { args = JSON.parse(given) as Record<string, unknown>; } catch { continue; } }
    else if (given && typeof given === "object") args = given as Record<string, unknown>;
    calls.push({ function: { name, arguments: args } });
    cut.push([start, end]);
  }
  if (calls.length === 0) return null;

  let text = content;
  for (const [start, end] of cut.reverse()) text = text.slice(0, start) + text.slice(end);
  // Code blocks that held only the call are left empty
  text = text.replace(/```[a-z]*\s*```/gi, "").replace(/\n{3,}/g, "\n\n").trim();
  return { calls, text };
}
