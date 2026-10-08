// Bot do Telegram. O Telegram chama esta função a cada mensagem (webhook configurado no deploy).
// Segurança: o Telegram manda o cabeçalho X-Telegram-Bot-Api-Secret-Token, que conferimos.
import { admin } from "../_shared/supabase.ts";
import { downloadTelegramFile, sendTelegram, telegramWebhookSecret } from "../_shared/telegram.ts";
import { handleBotMessage, HELP } from "../_shared/bot.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (req.headers.get("x-telegram-bot-api-secret-token") !== await telegramWebhookSecret()) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json().catch(() => ({}));
  const work = handleUpdate(update).catch((e) => console.error("telegram", e));
  // @ts-ignore EdgeRuntime existe no Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
  return new Response("ok");
});

async function handleUpdate(update: any) {
  const msg = update.message ?? update.edited_message;
  if (!msg?.chat?.id || msg.chat.type !== "private") return;
  const db = admin();

  // idempotência: o Telegram reenvia se não respondermos a tempo
  const { error: dup } = await db.from("inbound_messages").insert({ id: `tg:${update.update_id}` });
  if (dup) return;

  const chatId: number = msg.chat.id;
  const text: string = msg.text ?? "";
  const reply = (t: string) => sendTelegram(chatId, t);

  const { data: prof } = await db.from("profiles").select("id,name").eq("telegram_chat_id", chatId).maybeSingle();

  // ---------- vínculo da conta: /start 123456 (vem do botão do app) ou só o código ----------
  if (!prof) {
    const code = text.match(/\b(\d{6})\b/)?.[1];
    if (code) {
      const { data: owner } = await db.from("profiles").select("id,name")
        .eq("whatsapp_link_code", code).gt("whatsapp_link_expires", new Date().toISOString()).maybeSingle();
      if (owner) {
        await db.from("profiles").update({ telegram_chat_id: chatId, whatsapp_link_code: null, whatsapp_link_expires: null }).eq("id", owner.id);
        return reply(`✅ Pronto${owner.name ? `, ${owner.name.split(" ")[0]}` : ""}! Seu Telegram está conectado ao Fôlego.\n\n${HELP}`);
      }
      return reply("Código inválido ou expirado. No app, vá em *Conexões → Telegram* e toque em *Conectar Telegram* de novo.");
    }
    return reply("Olá! Para usar o assistente, abra o Fôlego, vá em *Conexões → Telegram* e toque em *Conectar Telegram*.");
  }

  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  const doc = msg.document && /pdf|image/i.test(msg.document.mime_type ?? "") ? msg.document : null;
  const fileId: string | null = photo?.file_id ?? doc?.file_id ?? null;

  return handleBotMessage(db, prof, {
    channel: "telegram",
    text,
    caption: msg.caption,
    media: fileId ? () => downloadTelegramFile(fileId) : undefined,
    reply,
  });
}
