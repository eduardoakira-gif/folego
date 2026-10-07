-- =====================================================================
-- Fluxo de Caixa — assistente financeiro multiusuário
-- Banco: Supabase (Postgres 15+). Rodar no SQL Editor ou via `supabase db push`.
-- Toda tabela tem user_id e RLS: cada usuário só enxerga os próprios dados.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- PERFIL (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  name             text,
  monthly_income   numeric(12,2) not null default 0 check (monthly_income >= 0),
  payday           smallint not null default 5 check (payday between 1 and 31),
  whatsapp_phone   text unique,                    -- E.164 sem "+", ex: 5511999998888
  whatsapp_link_code text,                         -- código temporário para vincular
  whatsapp_link_expires timestamptz,
  ingest_token     text not null unique default encode(gen_random_bytes(24), 'hex'), -- notificações do celular
  alerts_enabled   boolean not null default true,
  onboarded        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- CATEGORIAS (por usuário; criadas automaticamente no cadastro)
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  kind           text not null check (kind in ('income','expense')),
  icon           text not null default '•',
  color          text not null default '#8a8f98',
  budget_pct     numeric(5,2),                     -- % da renda (base do orçamento)
  monthly_budget numeric(12,2),                    -- valor em R$ (calculado ou ajustado)
  sort_order     smallint not null default 100,
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (user_id, kind, name)
);

-- ---------------------------------------------------------------------
-- CONEXÕES OPEN FINANCE (Pluggy "items") e CONTAS
-- ---------------------------------------------------------------------
create table if not exists public.bank_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  pluggy_item_id text not null unique,
  institution    text,
  institution_logo text,
  status         text not null default 'UPDATING',
  status_detail  text,
  last_sync_at   timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  connection_id     uuid references public.bank_connections(id) on delete cascade,
  pluggy_account_id text unique,
  name              text not null,
  type              text not null default 'BANK',  -- BANK | CREDIT | MANUAL
  subtype           text,
  balance           numeric(14,2),
  credit_limit      numeric(14,2),
  bill_due_date     date,
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- TRANSAÇÕES — fonte única de verdade
--   amount sempre positivo; o sentido está em `type`.
--   transfer = movimentação entre contas próprias / pagamento de fatura
--   (não entra em receita nem despesa, evita contar gasto duas vezes).
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  account_id      uuid references public.accounts(id) on delete set null,
  external_id     text,                            -- id da transação no Pluggy
  source          text not null check (source in ('open_finance','notification','manual','whatsapp')),
  type            text not null check (type in ('income','expense','transfer')),
  amount          numeric(12,2) not null check (amount > 0),
  description     text not null,
  merchant        text,
  category_id     uuid references public.categories(id) on delete set null,
  category_locked boolean not null default false,  -- usuário escolheu à mão: sync não sobrescreve
  occurred_at     timestamptz not null,
  status          text not null default 'confirmed' check (status in ('pending','confirmed')),
  reimbursable    boolean not null default false,  -- gasto da empresa a reembolsar
  reimbursed_at   timestamptz,
  installment     text,                            -- "3/10" quando parcelado
  note            text,
  raw             jsonb,                           -- texto/payload original preservado
  deleted_at      timestamptz,                     -- exclusão lógica (histórico)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, external_id)
);
create index if not exists tx_user_date on public.transactions (user_id, occurred_at desc) where deleted_at is null;
create index if not exists tx_pending  on public.transactions (user_id, status, amount) where status = 'pending';

-- ---------------------------------------------------------------------
-- REGRAS DE CATEGORIA aprendidas ("sempre que aparecer IFOOD → Delivery")
-- ---------------------------------------------------------------------
create table if not exists public.category_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  pattern     text not null,                      -- comparado em minúsculas, "contém"
  category_id uuid not null references public.categories(id) on delete cascade,
  mark_reimbursable boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, pattern)
);

-- ---------------------------------------------------------------------
-- HISTÓRICO: toda alteração/exclusão de transação fica registrada
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  entity     text not null,
  entity_id  uuid not null,
  action     text not null,
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now()
);
create index if not exists audit_user on public.audit_log (user_id, at desc);

-- Notificações recebidas do celular (inclusive as ignoradas) — rastreabilidade
create table if not exists public.notification_inbox (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  app         text,
  title       text,
  body        text,
  result      text not null,                      -- created | duplicate | ignored | error
  transaction_id uuid,
  received_at timestamptz not null default now()
);

-- Alertas já enviados (evita repetir o mesmo aviso)
create table if not exists public.alerts_sent (
  user_id   uuid not null references auth.users(id) on delete cascade,
  key       text not null,                        -- ex: budget80:<cat>:2026-10
  sent_at   timestamptz not null default now(),
  primary key (user_id, key)
);

-- Mensagens de WhatsApp já processadas (a Meta reenvia em caso de timeout)
create table if not exists public.inbound_messages (
  id          text primary key,
  received_at timestamptz not null default now()
);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.profiles           enable row level security;
alter table public.categories         enable row level security;
alter table public.bank_connections   enable row level security;
alter table public.accounts           enable row level security;
alter table public.transactions       enable row level security;
alter table public.category_rules     enable row level security;
alter table public.audit_log          enable row level security;
alter table public.notification_inbox enable row level security;
alter table public.alerts_sent        enable row level security;
alter table public.inbound_messages   enable row level security;  -- sem policy: só o servidor acessa

drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['categories','accounts','transactions','category_rules'] loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
  -- somente leitura para o app; escrita só pelo servidor (service role)
  foreach t in array array['bank_connections','audit_log','notification_inbox'] loop
    execute format('drop policy if exists own_rows_read on public.%I', t);
    execute format('create policy own_rows_read on public.%I for select using (user_id = auth.uid())', t);
  end loop;
end $$;

-- Campos sensíveis do perfil não podem ser trocados pelo próprio app
-- (revogar só colunas não funciona com grant de tabela inteira, então concedemos coluna a coluna)
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (name, monthly_income, payday, alerts_enabled, onboarded) on public.profiles to authenticated;

-- =====================================================================
-- TRIGGERS
-- =====================================================================
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists trg_tx_touch on public.transactions;
create trigger trg_tx_touch before update on public.transactions for each row execute function public.touch_updated_at();

create or replace function public.audit_transactions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(old) - 'updated_at') is distinct from (to_jsonb(new) - 'updated_at') then
      insert into audit_log(user_id, entity, entity_id, action, before, after)
      values (new.user_id, 'transaction', new.id,
              case when new.deleted_at is not null and old.deleted_at is null then 'delete' else 'update' end,
              to_jsonb(old) - 'raw', to_jsonb(new) - 'raw');
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into audit_log(user_id, entity, entity_id, action, before)
    values (old.user_id, 'transaction', old.id, 'hard_delete', to_jsonb(old));
    return old;
  end if;
  return new;
end $$;
drop trigger if exists trg_tx_audit on public.transactions;
create trigger trg_tx_audit after update or delete on public.transactions for each row execute function public.audit_transactions();

-- Recalcula os orçamentos em R$ quando a renda muda
create or replace function public.recalc_budgets() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.monthly_income is distinct from old.monthly_income then
    update categories
       set monthly_budget = round(new.monthly_income * budget_pct / 100, 2)
     where user_id = new.id and budget_pct is not null;
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_budget on public.profiles;
create trigger trg_profiles_budget after update on public.profiles for each row execute function public.recalc_budgets();

-- =====================================================================
-- CADASTRO: cria perfil + categorias padrão para todo novo usuário
-- =====================================================================
create or replace function public.seed_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id) values (p_user) on conflict do nothing;

  insert into categories(user_id, name, kind, icon, color, budget_pct, sort_order) values
    (p_user, 'Moradia',               'expense', '🏠', '#5b7cfa', 30, 10),
    (p_user, 'Mercado',               'expense', '🛒', '#2fb47c', 12, 20),
    (p_user, 'Restaurantes e delivery','expense','🍔', '#f08c3a',  6, 30),
    (p_user, 'Transporte',            'expense', '🚗', '#3aa6d8',  8, 40),
    (p_user, 'Contas e serviços',     'expense', '💡', '#d6a419',  7, 50),
    (p_user, 'Saúde',                 'expense', '💊', '#e0566b',  5, 60),
    (p_user, 'Educação',              'expense', '📚', '#8e6cf0',  4, 70),
    (p_user, 'Lazer',                 'expense', '🎮', '#c85bd6',  5, 80),
    (p_user, 'Compras',               'expense', '🛍️', '#d6577f',  5, 90),
    (p_user, 'Assinaturas',           'expense', '🔁', '#6a7bd8',  3, 100),
    (p_user, 'Cuidados pessoais',     'expense', '✂️', '#b98a5e',  2, 110),
    (p_user, 'Reserva e investimentos','expense','🏦', '#1f9e8f', 10, 120),
    (p_user, 'Taxas e juros',         'expense', '⚠️', '#a33b3b', null, 130),
    (p_user, 'Outros gastos',         'expense', '📦', '#8a8f98',  3, 140),
    (p_user, 'Salário',               'income',  '💼', '#2fb47c', null, 10),
    (p_user, 'Renda extra',           'income',  '✨', '#3aa6d8', null, 20),
    (p_user, 'Reembolsos',            'income',  '↩️', '#d6a419', null, 30),
    (p_user, 'Rendimentos',           'income',  '📈', '#1f9e8f', null, 40),
    (p_user, 'Estornos',              'income',  '🔄', '#8e6cf0', null, 50),
    (p_user, 'Outras entradas',       'income',  '➕', '#8a8f98', null, 60)
  on conflict do nothing;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_user(new.id);
  update profiles set name = coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
   where id = new.id;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Onboarding: salário + dia de pagamento → orçamento sugerido
create or replace function public.complete_onboarding(p_name text, p_income numeric, p_payday int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform seed_user(auth.uid());
  update profiles set name = p_name, monthly_income = p_income, payday = p_payday, onboarded = true
   where id = auth.uid();
  update categories set monthly_budget = round(p_income * budget_pct / 100, 2)
   where user_id = auth.uid() and budget_pct is not null;
end $$;

-- =====================================================================
-- RELATÓRIOS — mesma lógica para o app e para o WhatsApp
-- =====================================================================

-- Início/fim do ciclo salarial que contém p_ref (ex: dia 5 a dia 4)
create or replace function public.pay_cycle(p_payday int, p_ref date)
returns table (cycle_start date, cycle_end date) language sql immutable as $$
  with base as (
    select make_date(extract(year from p_ref)::int, extract(month from p_ref)::int,
                     least(p_payday, extract(day from (date_trunc('month', p_ref) + interval '1 month - 1 day'))::int)) as this_pay
  ), s as (
    select case when p_ref >= this_pay then this_pay
                else (select make_date(extract(year from pm)::int, extract(month from pm)::int,
                       least(p_payday, extract(day from (date_trunc('month', pm) + interval '1 month - 1 day'))::int))
                      from (select (p_ref - interval '1 month')::date as pm) x)
           end as st
    from base
  )
  select st,
         (select make_date(extract(year from nm)::int, extract(month from nm)::int,
                 least(p_payday, extract(day from (date_trunc('month', nm) + interval '1 month - 1 day'))::int)) - 1
            from (select (st + interval '1 month')::date as nm) y)
  from s
$$;

-- Assinaturas/gastos recorrentes: mesmo estabelecimento em ≥2 meses diferentes,
-- valor parecido (±15%), nos últimos 120 dias.
create or replace function public.recurring_for(p_user uuid)
returns table (merchant text, avg_amount numeric, months int, last_date date, next_expected date, category_id uuid)
language sql stable security definer set search_path = public as $$
  with t as (
    select lower(regexp_replace(coalesce(merchant, description), '[^a-zA-Z ]', '', 'g')) as key,
           coalesce(merchant, description) as label, amount, occurred_at::date d, category_id
      from transactions
     where user_id = p_user and type = 'expense' and deleted_at is null
       and occurred_at >= now() - interval '120 days'
  ), g as (
    select key, max(label) label, avg(amount) avg_amount, count(distinct date_trunc('month', d)) months,
           max(d) last_date, (array_agg(category_id order by d desc))[1] category_id,
           (max(amount) - min(amount)) / nullif(avg(amount),0) spread
      from t where length(key) >= 3 group by key
  )
  select label, round(avg_amount, 2), months::int, last_date, (last_date + interval '1 month')::date, category_id
    from g where months >= 2 and spread <= 0.3
   order by avg_amount desc
$$;

create or replace function public.financial_snapshot_for(p_user uuid, p_ref date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pr profiles; cs date; ce date;
  inc numeric; exp numeric; days_left int; committed numeric; result jsonb;
begin
  select * into pr from profiles where id = p_user;
  if pr.id is null then return null; end if;
  select cycle_start, cycle_end into cs, ce from pay_cycle(pr.payday, p_ref);

  select coalesce(sum(amount) filter (where type = 'income'), 0),
         coalesce(sum(amount) filter (where type = 'expense'), 0)
    into inc, exp
    from transactions
   where user_id = p_user and deleted_at is null and occurred_at::date between cs and ce;

  -- se o salário ainda não caiu no ciclo, considera a renda cadastrada
  inc := greatest(inc, pr.monthly_income);
  days_left := greatest(ce - p_ref + 1, 1);

  -- recorrentes previstos que ainda vão cair até o fim do ciclo
  select coalesce(sum(avg_amount), 0) into committed
    from recurring_for(p_user) r
   where r.next_expected between p_ref and ce
     and r.last_date < cs;

  select jsonb_build_object(
    'cycle_start', cs, 'cycle_end', ce, 'days_left', days_left,
    'income', inc, 'expenses', exp,
    'committed_recurring', committed,
    'available', round(inc - exp - committed, 2),
    'per_day', round(greatest(inc - exp - committed, 0) / days_left, 2),
    'pending_review', (select count(*) from transactions where user_id = p_user and deleted_at is null
                         and (category_id is null or status = 'pending')),
    'reimbursable_open', (select coalesce(sum(amount),0) from transactions where user_id = p_user
                            and deleted_at is null and reimbursable and reimbursed_at is null),
    'categories', coalesce((
      select jsonb_agg(c order by (c->>'spent')::numeric desc) from (
        select jsonb_build_object(
          'id', cat.id, 'name', cat.name, 'icon', cat.icon, 'color', cat.color, 'kind', cat.kind,
          'budget', cat.monthly_budget,
          'spent', coalesce(sum(t.amount), 0),
          'pct', case when cat.monthly_budget > 0 then round(coalesce(sum(t.amount),0) / cat.monthly_budget * 100) end
        ) c
          from categories cat
          left join transactions t on t.category_id = cat.id and t.deleted_at is null
                                  and t.occurred_at::date between cs and ce
         where cat.user_id = p_user and not cat.archived
         group by cat.id
      ) q where (q.c->>'spent')::numeric > 0 or (q.c->>'budget') is not null), '[]'::jsonb),
    'recurring', coalesce((select jsonb_agg(to_jsonb(r)) from recurring_for(p_user) r), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- Versão para o app: sempre o usuário logado
create or replace function public.financial_snapshot(p_ref date default current_date)
returns jsonb language sql stable security definer set search_path = public as $$
  select financial_snapshot_for(auth.uid(), p_ref)
$$;

-- Gera código para vincular o WhatsApp (válido 15 min)
create or replace function public.whatsapp_link_code()
returns text language plpgsql security definer set search_path = public as $$
declare code text := lpad((floor(random() * 1000000))::int::text, 6, '0');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update profiles set whatsapp_link_code = code, whatsapp_link_expires = now() + interval '15 minutes'
   where id = auth.uid();
  return code;
end $$;

create or replace function public.whatsapp_unlink() returns void
language sql security definer set search_path = public as $$
  update profiles set whatsapp_phone = null where id = auth.uid();
$$;

create or replace function public.rotate_ingest_token() returns text
language plpgsql security definer set search_path = public as $$
declare tok text := encode(gen_random_bytes(24), 'hex');
begin
  update profiles set ingest_token = tok where id = auth.uid();
  return tok;
end $$;

-- Exclusão total da conta (LGPD)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from audit_log where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

-- Permissões
revoke execute on function public.financial_snapshot_for(uuid, date) from public, anon, authenticated;
revoke execute on function public.recurring_for(uuid)               from public, anon, authenticated;
revoke execute on function public.seed_user(uuid)                   from public, anon, authenticated;
grant  execute on function public.financial_snapshot_for(uuid, date) to service_role;
grant  execute on function public.recurring_for(uuid)               to service_role;
grant  execute on function public.financial_snapshot(date)          to authenticated;
grant  execute on function public.complete_onboarding(text, numeric, int) to authenticated;
grant  execute on function public.whatsapp_link_code()              to authenticated;
grant  execute on function public.whatsapp_unlink()                 to authenticated;
grant  execute on function public.rotate_ingest_token()             to authenticated;
grant  execute on function public.delete_my_account()               to authenticated;

-- Atualização em tempo real no app quando chega transação nova
do $$ begin
  alter publication supabase_realtime add table public.transactions;
exception when others then null; end $$;
