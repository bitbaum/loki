/**
 * A secret Loki must keep and use again later, sealed at rest.
 *
 * AES-256-GCM under a key derived from AUTH_SECRET (HKDF, its own label, so
 * it can never collide with the HMACs action-link.ts and private-zone-token.ts
 * sign with the same secret). The database alone opens nothing: a dump of the
 * row without the server's environment is noise.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each base64url. The version lets the
 * scheme change without guessing what an old row is.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const LABEL = "loki:secret-box:v1";

function key(): Buffer {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to keep secrets");
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), LABEL, 32));
}

export function sealSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url"));
  return `v1.${parts.join(".")}`;
}

/** The plaintext, or null when the box is not ours or was tampered with. */
export function openSecret(sealed: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
