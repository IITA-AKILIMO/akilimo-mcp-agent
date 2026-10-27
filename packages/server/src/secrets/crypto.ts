import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Reversible encryption for secrets kept in the database (LLM provider keys, MCP server keys):
// AES-256-GCM with a random IV per value. The master key comes from SECRETS_KEY and is never stored
// in the database, so a database dump alone does not reveal the secrets.
// Stored form: v1.<iv>.<tag>.<ciphertext>, each part base64url.
const VERSION = "v1";

export class SecretsError extends Error {}

// `openssl rand -base64 32` makes a suitable key
export function parseSecretsKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value.trim(), /^[0-9a-f]{64}$/i.test(value.trim()) ? "hex" : "base64");
  if (key.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes, base64 or hex encoded (generate one with: openssl rand -base64 32)");
  return key;
}

export class SecretBox {
  constructor(private readonly key: Buffer) {}

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data].map((part, i) => (i === 0 ? part : (part as Buffer).toString("base64url"))).join(".");
  }

  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split(".");
    if (version !== VERSION || !iv || !tag || data === undefined) throw new SecretsError("Unrecognised secret format");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new SecretsError("Cannot decrypt a stored secret: SECRETS_KEY differs from the one it was saved with");
    }
  }
}

// What the admin screens show instead of a key: enough to recognise it
export const keyHint = (secret: string) => (secret.length > 8 ? `…${secret.slice(-4)}` : "set");
