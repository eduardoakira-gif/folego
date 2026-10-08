// Ações do app sobre o Open Finance (usuário logado):
//   { action: "connect_token", itemId? }   → token para abrir o widget Pluggy Connect
//   { action: "register_item", itemId }    → depois do widget: valida dono, salva e sincroniza
//   { action: "sync", itemId }             → pede atualização ao banco e sincroniza
//   { action: "remove", itemId }           → revoga a conexão no Pluggy e apaga contas
//   { action: "availability" }             → se o Open Finance está liberado para este usuário
//
// PLUGGY_ALLOWED_EMAILS (opcional): no plano gratuito Meu Pluggy só o titular pode conectar
// (uso pessoal). Liste aqui o(s) e-mail(s) liberados; vazio = todos (plano pago).
// PLUGGY_CONNECTOR_IDS (opcional): restringe o widget, ex. "200" para mostrar só o Meu Pluggy.
import { admin, handler, HttpError, json, requireUserInfo } from "../_shared/supabase.ts";
import { pluggy, syncItem, webhookUrl } from "../_shared/pluggy.ts";
import { checkBudgetAlerts } from "../_shared/store.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUserInfo(req);
  const userId = user.id;
  const { action, itemId } = await req.json();
  const db = admin();

  const allowed = (Deno.env.get("PLUGGY_ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const enabled = !!Deno.env.get("PLUGGY_CLIENT_ID") && (!allowed.length || allowed.includes(user.email));
  const connectorIds = (Deno.env.get("PLUGGY_CONNECTOR_IDS") ?? "").split(",").map((s) => parseInt(s)).filter((n) => n > 0);
  if (action === "availability") {
    const reason = !Deno.env.get("PLUGGY_CLIENT_ID") ? "no_keys" : enabled ? null : "email_not_allowed";
    return json(req, { enabled, meuPluggy: connectorIds.includes(200), reason, email: user.email });
  }
  if (!enabled && action !== "remove") {
    throw new HttpError(403, "Conexão automática com bancos não está disponível na sua conta. Use a importação de extrato ou as notificações do celular.");
  }

  const owned = async () => {
    const { data } = await db.from("bank_connections").select("id").eq("pluggy_item_id", itemId).eq("user_id", userId).maybeSingle();
    if (!data) throw new HttpError(404, "Conexão não encontrada.");
  };

  switch (action) {
    case "connect_token": {
      if (itemId) await owned();
      const r = await pluggy("/connect_token", {
        method: "POST",
        body: JSON.stringify({ options: { clientUserId: userId, webhookUrl: webhookUrl(), avoidDuplicates: true, ...(itemId ? { itemId } : {}) } }),
      });
      return json(req, { accessToken: r.accessToken, connectorIds: connectorIds.length ? connectorIds : undefined });
    }

    case "register_item": {
      const item = await pluggy(`/items/${itemId}`);
      // Segurança: só aceita item criado com o clientUserId deste usuário
      if (item.clientUserId && item.clientUserId !== userId) throw new HttpError(403, "Conexão pertence a outro usuário.");
      const { data: exists } = await db.from("bank_connections").select("user_id").eq("pluggy_item_id", itemId).maybeSingle();
      if (exists && exists.user_id !== userId) throw new HttpError(403, "Conexão pertence a outro usuário.");
      await db.from("bank_connections").upsert({
        user_id: userId, pluggy_item_id: itemId, institution: item.connector?.name,
        institution_logo: item.connector?.imageUrl, status: item.status,
      }, { onConflict: "pluggy_item_id" });
      const r = await syncItem(db, itemId);
      return json(req, r);
    }

    case "sync": {
      await owned();
      // pede ao Pluggy que busque dados novos no banco; o webhook avisa quando terminar
      await pluggy(`/items/${itemId}`, { method: "PATCH", body: "{}" }).catch(() => null);
      const r = await syncItem(db, itemId);
      await checkBudgetAlerts(db, userId);
      return json(req, r);
    }

    case "remove": {
      await owned();
      await pluggy(`/items/${itemId}`, { method: "DELETE" }).catch((e) => console.warn(e.message));
      // transações ficam (histórico); a conta é desvinculada
      await db.from("bank_connections").delete().eq("pluggy_item_id", itemId).eq("user_id", userId);
      return json(req, { ok: true });
    }
  }
  throw new HttpError(400, "Ação inválida.");
}));
