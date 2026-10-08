// Telegram Bot API
import { env } from "./supabase.ts";

const api = (method: string) => `https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/${method}`;

/** Segredo do webhook derivado do token (o usuário só precisa cadastrar o token). */
export async function telegramWebhookSecret(): Promise<string> {
  const data = new TextEncoder().encode(`${env("TELEGRAM_BOT_TOKEN")}:folego-webhook`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(hash).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** O assistente escreve no estilo do WhatsApp (*negrito*, _itálico_); no Telegram vira HTML. */
export function toTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/(^|[\s(“"])\*([^*\n]+?)\*(?=[\s).,!?:;”"]|$)/gm, "$1<b>$2</b>")
    .replace(/(^|[\s(“"])_([^_\n]+?)_(?=[\s).,!?:;”"]|$)/gm, "$1<i>$2</i>");
}

export async function sendTelegram(chatId: number | string, text: string): Promise<boolean> {
  const body = { chat_id: chatId, text: toTelegramHtml(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true };
  let res = await fetch(api("sendMessage"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    // formatação inválida? manda em texto puro
    res = await fetch(api("sendMessage"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.replace(/[*_]/g, "").slice(0, 4000), disable_web_page_preview: true }),
    });
  }
  if (!res.ok) console.error("telegram send", await res.text());
  return res.ok;
}

export async function downloadTelegramFile(fileId: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const meta = await fetch(api("getFile") + `?file_id=${encodeURIComponent(fileId)}`).then((r) => r.json());
  const path: string | undefined = meta?.result?.file_path;
  if (!path) throw new Error("Não consegui baixar o arquivo do Telegram.");
  const res = await fetch(`https://api.telegram.org/file/bot${env("TELEGRAM_BOT_TOKEN")}/${path}`);
  if (!res.ok) throw new Error("Não consegui baixar o arquivo do Telegram.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 8_000_000) throw new Error("Arquivo grande demais (máx. 8 MB).");
  const mime = /\.pdf$/i.test(path) ? "application/pdf" : /\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg";
  return { bytes, mime };
}
