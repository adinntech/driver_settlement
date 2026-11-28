import { config } from "../config/index.js";

/** Removes anything that looks like a secret (database URLs, webhook keys, credentials in URLs) from a message. */
export function maskSecrets(s: string): string {
  return s
    .replace(/mongodb(\+srv)?:\/\/\S+/gi, "[database url]")
    .replace(/https:\/\/chat\.googleapis\.com\S*/gi, "[webhook]")
    .replace(/\b([a-z][a-z0-9+.-]*):\/\/[^\s/@]+@/gi, "$1://[credentials]@")
    .replace(/([?&](key|token|signature|x-amz-[a-z-]+)=)[^&\s]+/gi, "$1[hidden]");
}

/**
 * Posts a plain-text message to the Google Chat space webhook (GOOGLE_CHAT_WEBHOOK_URL). Never throws, and never logs the
 * webhook URL, which contains the space key.
 */
export async function postToGoogleChat(text: string, webhook = config.ops.googleChatWebhook): Promise<boolean> {
  if (!webhook) {
    console.warn("[ops] GOOGLE_CHAT_WEBHOOK_URL is not set; message not sent");
    return false;
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text: maskSecrets(text) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) console.error(`[ops] Google Chat message not sent (HTTP ${res.status})`);
    return res.ok;
  } catch {
    console.error("[ops] Google Chat message not sent (network error)");
    return false;
  }
}
