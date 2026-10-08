-- Forma — módulo Saúde e Corpo do Life OS.
-- Mesmo projeto Supabase do Fôlego: mesmo login (auth.users), mesma tabela de eventos.
-- Tudo com prefixo forma_ para não conflitar com o financeiro.

-- ---------- Perfil e metas ----------
create table if not exists public.forma_perfil (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sexo text not null check (sexo in ('M','F')),
  nascimento date not null,
  altura_cm numeric(5,1) not null check (altura_cm between 120 and 230),
  atividade text not null default 'leve' check (atividade in ('sedentario','leve','moderado','intenso','atleta')),
  peso_meta_kg numeric(5,2) check (peso_meta_kg between 30 and 300),
  ritmo text not null default 'moderado' check (ritmo in ('leve','moderado','acelerado')),
  agua_meta_ml int,                         -- nulo = 35 ml/kg
  kcal_meta_manual int,                     -- nulo = calculada
  lembretes jsonb not null default '{
    "agua": {"ativo": true, "inicio": "08:00", "fim": "22:00", "intervalo_min": 120},
    "pesagem": {"ativo": true, "hora": "07:30"},
    "treino": {"ativo": true, "hora": "21:00"}
  }'::jsonb,
  calibracao jsonb not null default '{}'::jsonb,   -- {"cintura": 1.04, ...} fita/foto
  guardar_fotos boolean not null default true,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Pesagem diária (uma por dia; a última do dia vale) ----------
create table if not exists public.forma_pesagens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data date not null,
  peso_kg numeric(5,2) not null check (peso_kg between 25 and 350),
  gordura_pct numeric(4,1) check (gordura_pct between 2 and 70),  -- se a balança informar
  observacao text,
  origem text not null default 'app' check (origem in ('app','notificacao','whatsapp','importado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, data)
);

-- ---------- Avaliação corporal por foto ----------
create table if not exists public.forma_avaliacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data date not null,
  peso_kg numeric(5,2),
  altura_cm numeric(5,1) not null,
  foto_frente text,                 -- caminho no storage privado (se guardar fotos)
  foto_lado text,
  medidas jsonb not null default '{}'::jsonb,       -- perímetros finais (cm), já calibrados
  medidas_brutas jsonb not null default '{}'::jsonb,-- antes da calibração
  fita jsonb not null default '{}'::jsonb,          -- medidas com fita métrica, se informadas
  detalhes jsonb not null default '{}'::jsonb,      -- larguras, profundidades, relação lado/frente, avisos
  indicadores jsonb not null default '{}'::jsonb,   -- gordura %, RCE, RCQ
  fonte text not null default 'foto' check (fonte in ('foto','fita','foto+fita')),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists forma_avaliacoes_user_data on public.forma_avaliacoes (user_id, data desc) where deleted_at is null;

-- ---------- Refeições ----------
create table if not exists public.forma_refeicoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data date not null,
  momento timestamptz not null default now(),
  tipo text not null default 'lanche' check (tipo in ('cafe','almoco','lanche','jantar','ceia')),
  descricao text not null,
  itens jsonb not null default '[]'::jsonb,   -- [{nome, quantidade, gramas, kcal, proteina_g, carbo_g, gordura_g}]
  kcal numeric(7,1) not null default 0,
  proteina_g numeric(6,1) not null default 0,
  carbo_g numeric(6,1) not null default 0,
  gordura_g numeric(6,1) not null default 0,
  foto text,
  origem text not null default 'manual' check (origem in ('foto','texto','manual','favorito','whatsapp')),
  confianca text check (confianca in ('alta','media','baixa')),
  favorito boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists forma_refeicoes_user_data on public.forma_refeicoes (user_id, data desc) where deleted_at is null;

-- ---------- Água ----------
create table if not exists public.forma_agua (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data date not null,
  ml int not null check (ml between -2000 and 3000),  -- negativo = desfazer
  origem text not null default 'app',
  created_at timestamptz not null default now()
);
create index if not exists forma_agua_user_data on public.forma_agua (user_id, data);

-- ---------- Check-in diário de treino e cardio ----------
create table if not exists public.forma_checkins (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data date not null,
  treinou boolean,
  treino_tipo text,
  treino_min int check (treino_min between 0 and 600),
  cardio boolean,
  cardio_tipo text,
  cardio_min int check (cardio_min between 0 and 600),
  energia int check (energia between 1 and 5),
  sono_h numeric(3,1) check (sono_h between 0 and 24),
  origem text not null default 'app',
  updated_at timestamptz not null default now(),
  primary key (user_id, data)
);

-- ---------- Notificações (Web Push) ----------
create table if not exists public.forma_push (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  aparelho text,
  created_at timestamptz not null default now()
);
create table if not exists public.forma_lembretes_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null,
  data date not null,
  enviado_em timestamptz not null default now()
);
create index if not exists forma_lembretes_log_idx on public.forma_lembretes_log (user_id, tipo, enviado_em desc);

-- Limite diário de uso de IA (fotos de comida)
create table if not exists public.forma_ia_uso (
  user_id uuid not null references auth.users(id) on delete cascade,
  data date not null,
  n int not null default 0,
  primary key (user_id, data)
);

-- ---------- updated_at ----------
create or replace function public.forma_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['forma_perfil','forma_pesagens','forma_refeicoes','forma_checkins'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.forma_touch()', t, t);
  end loop;
end $$;

-- ---------- RLS: cada pessoa só vê o que é seu ----------
do $$ declare t text; begin
  foreach t in array array['forma_perfil','forma_pesagens','forma_avaliacoes','forma_refeicoes','forma_agua','forma_checkins','forma_push'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_dono on public.%I', t, t);
    execute format('create policy %I_dono on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
  end loop;
end $$;
alter table public.forma_lembretes_log enable row level security;   -- só o servidor (service role)
alter table public.forma_ia_uso enable row level security;
drop policy if exists forma_ia_uso_ler on public.forma_ia_uso;
create policy forma_ia_uso_ler on public.forma_ia_uso for select to authenticated using (user_id = auth.uid());

-- ---------- Resumo diário (base para o dashboard e para outros módulos) ----------
create or replace view public.forma_dia with (security_invoker = true) as
with dias as (
  select user_id, data from public.forma_pesagens
  union select user_id, data from public.forma_refeicoes where deleted_at is null
  union select user_id, data from public.forma_agua
  union select user_id, data from public.forma_checkins
)
select d.user_id, d.data,
  p.peso_kg,
  coalesce((select sum(r.kcal) from public.forma_refeicoes r where r.user_id = d.user_id and r.data = d.data and r.deleted_at is null), 0) as kcal,
  coalesce((select sum(r.proteina_g) from public.forma_refeicoes r where r.user_id = d.user_id and r.data = d.data and r.deleted_at is null), 0) as proteina_g,
  coalesce((select count(*) from public.forma_refeicoes r where r.user_id = d.user_id and r.data = d.data and r.deleted_at is null), 0) as refeicoes,
  coalesce((select sum(a.ml) from public.forma_agua a where a.user_id = d.user_id and a.data = d.data), 0) as agua_ml,
  c.treinou, c.cardio, c.treino_min, c.cardio_min
from dias d
left join public.forma_pesagens p on p.user_id = d.user_id and p.data = d.data
left join public.forma_checkins c on c.user_id = d.user_id and c.data = d.data;

-- ---------- Eventos para o resto do Life OS ----------
-- Usa a tabela public.events do Fôlego se existir. Nunca impede a gravação: se falhar, só registra aviso.
create or replace function public.forma_evento() returns trigger language plpgsql security definer set search_path = public as $$
declare
  linha jsonb := to_jsonb(coalesce(new, old));
  acao text := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  nome text := case tg_table_name
    when 'forma_pesagens' then 'weight'
    when 'forma_avaliacoes' then 'body_scan'
    when 'forma_refeicoes' then 'meal'
    when 'forma_checkins' then 'workout_checkin'
    else tg_table_name end;
begin
  if to_regclass('public.events') is null then return null; end if;
  begin
    execute 'insert into public.events (user_id, type, payload) values ($1, $2, $3)'
      using (linha->>'user_id')::uuid, 'health.' || nome || '.' || acao,
            jsonb_build_object('source', 'forma', 'table', tg_table_name, 'record', linha - 'foto' - 'foto_frente' - 'foto_lado');
  exception when others then
    raise warning 'forma_evento: % (%)', sqlerrm, tg_table_name;
  end;
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['forma_pesagens','forma_avaliacoes','forma_refeicoes','forma_checkins'] loop
    execute format('drop trigger if exists %I_evento on public.%I', t, t);
    execute format('create trigger %I_evento after insert or update or delete on public.%I for each row execute function public.forma_evento()', t, t);
  end loop;
end $$;

-- ---------- Fotos: bucket privado, pasta = id do usuário ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('forma-fotos', 'forma-fotos', false, 5242880, array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;

drop policy if exists forma_fotos_dono on storage.objects;
create policy forma_fotos_dono on storage.objects for all to authenticated
  using (bucket_id = 'forma-fotos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'forma-fotos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Excluir todos os dados do módulo (LGPD) ----------
create or replace function public.forma_apagar_meus_dados() returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'não autenticado'; end if;
  -- As fotos são apagadas pelo app via API de Storage antes de chamar esta função
  -- (o Supabase não permite apagar storage.objects direto por SQL).
  delete from public.forma_refeicoes where user_id = u;
  delete from public.forma_agua where user_id = u;
  delete from public.forma_checkins where user_id = u;
  delete from public.forma_avaliacoes where user_id = u;
  delete from public.forma_pesagens where user_id = u;
  delete from public.forma_push where user_id = u;
  delete from public.forma_lembretes_log where user_id = u;
  delete from public.forma_ia_uso where user_id = u;
  delete from public.forma_perfil where user_id = u;
end $$;
revoke all on function public.forma_apagar_meus_dados() from public;
grant execute on function public.forma_apagar_meus_dados() to authenticated;
