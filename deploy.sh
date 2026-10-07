#!/usr/bin/env bash
# Publica banco, servidor e agendamento no Supabase a partir do seu computador.
# Uso:  cp .env.example .env  (preencha)  →  ./deploy.sh
# Pré-requisito: Node.js instalado (o script usa "npx supabase", sem instalar nada global).
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Crie o arquivo .env a partir do .env.example primeiro."; exit 1; }
set -a; source .env; set +a

gen() { openssl rand -hex 24 2>/dev/null || node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"; }
# segredos gerados uma vez e guardados no .env
for k in PLUGGY_WEBHOOK_SECRET CRON_SECRET; do
  if [ -z "${!k:-}" ]; then
    v=$(gen); printf -v "$k" '%s' "$v"; export "$k"
    sed -i.bak "s/^$k=.*/$k=$v/" .env && rm -f .env.bak
  fi
done

SB="npx --yes supabase@latest"
echo "→ Conectando ao projeto $SUPABASE_PROJECT_REF"
$SB link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"

echo "→ Banco de dados (migrations)"
$SB db push --password "$SUPABASE_DB_PASSWORD" --include-all

echo "→ Segredos do servidor"
TMP=$(mktemp)
for k in PLUGGY_CLIENT_ID PLUGGY_CLIENT_SECRET PLUGGY_CONNECTOR_IDS PLUGGY_ALLOWED_EMAILS PLUGGY_WEBHOOK_SECRET \
         WA_PHONE_NUMBER_ID WA_ACCESS_TOKEN WA_APP_SECRET WA_VERIFY_TOKEN WA_NOTIFY_TEMPLATE \
         ANTHROPIC_API_KEY AI_DAILY_LIMIT APP_ORIGINS CRON_SECRET; do
  [ -n "${!k:-}" ] && echo "$k=${!k}" >> "$TMP"
done
$SB secrets set --env-file "$TMP"; rm -f "$TMP"

echo "→ Funções"
for f in pluggy import-statement pluggy-webhook whatsapp-webhook ingest-notification weekly-digest; do $SB functions deploy "$f" --no-verify-jwt; done

echo "→ Resumo semanal (segunda 8h45, horário de Brasília)"
$SB db query --linked "
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.schedule('resumo-semanal', '45 11 * * 1', \$\$
  select net.http_post(
    url := 'https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/weekly-digest',
    headers := jsonb_build_object('Authorization', 'Bearer $CRON_SECRET'));
\$\$);"

URL="https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1"
cat <<EOF

✅ Servidor publicado.

Configure estes endereços:
  Meta (WhatsApp → Configuração → Webhook):  $URL/whatsapp-webhook   (token: $WA_VERIFY_TOKEN)
  Pluggy: nada a fazer, o endereço do webhook vai junto em cada conexão.
  Supabase → Authentication → URL Configuration: coloque o endereço do site.

Falta só o site: veja "Publicar o site" no README.
EOF
