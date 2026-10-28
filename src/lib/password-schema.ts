import { z } from "zod";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@bitbaum/accountkit/auth/password";

/**
 * The one bitbaum password rule (@bitbaum/accountkit): not empty, at most 128
 * characters. Setup, register, invite, reset and change all use this schema; no
 * other minimum, no strength meter and no hint text. (Hashing lives in
 * ./password.ts.)
 */
export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);
