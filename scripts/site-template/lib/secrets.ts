import { openSecret, sealSecret } from "@bitbaum/ai-kit/seal";

/**
 * Secrets at rest, sealed with ai-kit's `sealSecret` (AES-256-GCM). A value is
 * sealed with SECRET_SEAL_KEY and a CONTEXT naming what it is and whose it is,
 * so a sealed value copied into another row or column will not open.
 *
 * The rules (fleet SHARED.md, "Your own model"): sealed at rest, never a
 * plaintext column; no API ever returns a secret, only a hint.
 */
const MIN_KEY_LENGTH = 32;

export function sealKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.SECRET_SEAL_KEY?.trim();
  return key && key.length >= MIN_KEY_LENGTH ? key : null;
}

export function canSeal(): boolean {
  return sealKey() !== null;
}

function requireKey(): string {
  const key = sealKey();
  if (!key) throw new Error("SECRET_SEAL_KEY is missing or shorter than 32 characters");
  return key;
}

export function seal(plain: string, context: string): string {
  return sealSecret(plain, requireKey(), context);
}

export function open(sealed: string, context: string): string {
  return openSecret(sealed, requireKey(), context);
}

/** What may be shown of a secret: its last four characters. */
export function hintOf(secret: string): string {
  const tail = secret.trim().slice(-4);
  return tail ? `…${tail}` : "";
}
