// Recebe eventos do Pluggy. O Pluggy não assina webhooks, então:
//  1) exigimos um segredo na URL (PLUGGY_WEBHOOK_SECRET), e
//  2) nunca confiamos no payload: só usamos o itemId para buscar os dados direto na API do Pluggy.
import { admin, env } from "../_shared/supabase.ts";
import { syncItem } from "../_shared/pluggy.ts";
import { checkBudgetAlerts } from "../_shared/store.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.searchParams.get("secret") !== env("PLUGGY_WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const evt = await req.json().catch(() => ({}));
  const db = admin();
  const itemId: string | undefined = evt.itemId ?? evt.item?.id;
  if (!itemId) return new Response("ok");

  const work = (async () => {
    try {
      switch (evt.event) {
        case "item/deleted":
          await db.from("bank_connections").update({ status: "DELETED" }).eq("pluggy_item_id", itemId);
          break;
        case "item/error":
        case "item/waiting_user_input":
        case "item/waiting_user_action":
          await db.from("bank_connections").update({ status: evt.event === "item/error" ? "LOGIN_ERROR" : "WAITING_USER_INPUT", status_detail: evt.error?.message ?? null }).eq("pluggy_item_id", itemId);
          break;
        case "transactions/deleted":
          if (Array.isArray(evt.transactionIds) && evt.transactionIds.length) {
            const { data: conn } = await db.from("bank_connections").select("user_id").eq("pluggy_item_id", itemId).maybeSingle();
            if (!conn) break;
            // Pendente removido costuma voltar como "confirmado" com outro id: solta o vínculo
            // para a versão confirmada se juntar a ele (mantendo categoria e anotações).
            // Se não voltar em 5 dias, a sincronização descarta como compra cancelada.
            await db.from("transactions").update({ external_id: null })
              .eq("user_id", conn.user_id).in("external_id", evt.transactionIds).eq("status", "pending");
            await db.from("transactions").update({ deleted_at: new Date().toISOString() })
              .eq("user_id", conn.user_id).in("external_id", evt.transactionIds).eq("status", "confirmed");
          }
          break;
        default: { // item/created, item/updated, transactions/created, transactions/updated…
          const r = await syncItem(db, itemId);
          if (r.ok && r.user_id) await checkBudgetAlerts(db, r.user_id);
        }
      }
    } catch (e) {
      console.error("pluggy-webhook", evt.event, itemId, e);
    }
  })();

  // responde rápido; o processamento continua em segundo plano
  // @ts-ignore EdgeRuntime existe no Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
  return new Response("ok");
});
