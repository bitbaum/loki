import { isSiteOperator } from "@/db/queries/users";
import { selfTelegramTarget } from "@/lib/actions/telegram-send";

/**
 * Where to send news about ONE account's work on Telegram, or null.
 *
 * There is one Telegram chat on the box and it is the operator's. News about
 * another account's projects — a visitor's note on their site, their run that
 * closed, their fix that shipped — went there too, so the operator read every
 * customer's feedback. Those accounts hear through their own push and alerts;
 * the operator's chat carries the operator's own work.
 */
export async function telegramTargetFor(userId: string): Promise<string | null> {
  const target = selfTelegramTarget();
  if (!target) return null;
  return (await isSiteOperator(userId).catch(() => false)) ? target : null;
}
