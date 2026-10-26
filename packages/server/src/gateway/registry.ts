import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";

// How the browser-supplied key is passed to the upstream server
export const AuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer") }),
  z.object({ type: z.literal("header"), header: z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Header name may only contain letters, digits and dashes") }),
]);

export const ServerEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,39}$/, "Use 1-40 lowercase letters, digits, dots or dashes"),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).default(""),
  url: z.url({ protocol: /^https?$/, error: "Use an http(s) URL of a streamable HTTP MCP endpoint" }),
  auth: AuthSchema.default({ type: "none" }),
  enabled: z.boolean().default(true),
});

export type ServerEntry = z.infer<typeof ServerEntrySchema>;

// First-run contents; both entries can be edited or removed like any other
const defaults = (port: number): ServerEntry[] => [
  {
    id: "akilimo-1.0",
    label: "Akilimo 1.0",
    description: "This repository's agent on the Akilimo 1.0 API",
    url: `http://127.0.0.1:${port}/mcp`,
    auth: { type: "none" },
    enabled: true,
  },
  {
    id: "akilimo-2.0",
    label: "Akilimo 2.0",
    description: "Hosted agent of the Akilimo 2.0 platform; needs a partner key from Hub operations",
    url: "https://mcp.akilimo.org/mcp",
    auth: { type: "bearer" },
    enabled: true,
  },
];

// MCP server registry persisted as a JSON file; writes go through a temp file and rename
export class Registry {
  private entries: ServerEntry[] = [];

  constructor(private readonly file: string, private readonly port: number) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8"));
      this.entries = z.array(ServerEntrySchema).parse(raw);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw new Error(`Cannot read MCP registry ${this.file}: ${error.message}`);
      this.entries = defaults(this.port);
      await this.save();
    }
  }

  list(): ServerEntry[] {
    return this.entries;
  }

  get(id: string): ServerEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  async add(entry: ServerEntry): Promise<void> {
    if (this.get(entry.id)) throw new RegistryError(409, `A server with id '${entry.id}' already exists`);
    this.entries = [...this.entries, entry];
    await this.save();
  }

  async update(id: string, entry: ServerEntry): Promise<void> {
    if (!this.get(id)) throw new RegistryError(404, `No server with id '${id}'`);
    if (entry.id !== id && this.get(entry.id)) throw new RegistryError(409, `A server with id '${entry.id}' already exists`);
    this.entries = this.entries.map((e) => (e.id === id ? entry : e));
    await this.save();
  }

  async remove(id: string): Promise<void> {
    if (!this.get(id)) throw new RegistryError(404, `No server with id '${id}'`);
    this.entries = this.entries.filter((e) => e.id !== id);
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.entries, null, 2));
    await rename(tmp, this.file);
  }
}

export class RegistryError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
