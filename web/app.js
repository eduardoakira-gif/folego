// Fôlego — app (site + PWA). Sem build: HTML, CSS e JS puros.
const CFG = window.APP_CONFIG;
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ------------------------------------------------------------------ utilidades
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const d = (iso) => new Date(String(iso).length === 10 ? iso + "T12:00:00" : iso);
const fmtDay = (iso) => d(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const fmtLong = (iso) => d(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const parseMoney = (s) => {
  let t = String(s).replace(/[^\d,.-]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : null;
};
const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}
async function busy(btn, fn) {
  const old = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = "Aguarde…"; }
  try { return await fn(); } catch (e) { console.error(e); toast(e.message || "Algo deu errado. Tente de novo."); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
}
async function call(fn, body) {
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return data;
}
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 01-12 0V8zM12 18v4"/></svg>',
};

// ------------------------------------------------------------------ estado
const S = { session: null, profile: null, snap: null, cats: [], txs: [], conns: [], accounts: [], rules: [], view: "inicio", filter: { q: "", type: "all", cycle: 0 } };

async function loadProfile() {
  S.profile = must(await sb.from("profiles").select("*").eq("id", S.session.user.id).single());
}
async function loadCore() {
  const [snap, cats, conns, accounts] = await Promise.all([
    sb.rpc("financial_snapshot"),
    sb.from("categories").select("*").eq("archived", false).order("kind").order("sort_order"),
    sb.from("bank_connections").select("*").order("created_at"),
    sb.from("accounts").select("*"),
  ]);
  S.snap = must(snap); S.cats = must(cats); S.conns = must(conns); S.accounts = must(accounts);
  // últimas notificações recebidas do celular (para saber se o MacroDroid está funcionando)
  const { data: inbox } = await sb.from("notification_inbox").select("id,app,title,body,result,received_at").order("received_at", { ascending: false }).limit(40);
  S.inbox = inbox ?? [];
  // Open Finance liberado para este usuário? (no plano gratuito Meu Pluggy, só o titular)
  if (!S.of) S.of = await call("pluggy", { action: "availability" }).catch(() => ({ enabled: false }));
}
const fmtWeekday = (iso) => d(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "short" }).replace("-feira", "").replace(".", "");
const daysTo = (iso) => Math.round((d(iso) - d(todayISO())) / 864e5);
// Ciclos (do pagamento até a véspera do próximo) calculados no servidor — mesma regra de
// dia útil e feriados usada nos relatórios. offset 0 = ciclo atual, -1 = anterior…
const addDays = (iso, n) => { const x = d(iso); x.setDate(x.getDate() + n); return x.toLocaleDateString("sv"); };
async function getCycle(offset = 0) {
  S.cycles ??= {};
  if (S.cycles[offset]) return S.cycles[offset];
  let c;
  if (offset === 0) {
    const r = must(await sb.rpc("my_cycle"));
    c = Array.isArray(r) ? r[0] : r;
  } else {
    const after = await getCycle(offset + 1);
    const r = must(await sb.rpc("my_cycle", { p_ref: addDays(after.cycle_start, -1) }));
    c = Array.isArray(r) ? r[0] : r;
  }
  return (S.cycles[offset] = c);
}
async function loadTxs() {
  const c = await getCycle(S.filter.cycle);
  S.curCycle = c;
  // limites no horário de Brasília (o banco guarda em UTC)
  S.txs = must(await sb.from("transactions").select("*").is("deleted_at", null)
    .gte("occurred_at", `${c.cycle_start}T00:00:00-03:00`).lt("occurred_at", `${addDays(c.cycle_end, 1)}T00:00:00-03:00`)
    .order("occurred_at", { ascending: false }).limit(2000));
}
const catById = (id) => S.cats.find((c) => c.id === id);

// ------------------------------------------------------------------ autenticação
function renderAuth(mode = "login") {
  const titles = { login: ["Entrar", "Seu dinheiro, com fôlego até o próximo salário."], signup: ["Criar conta", "Conecte o banco uma vez e o resto se organiza sozinho."], reset: ["Recuperar senha", "Enviaremos um link para o seu e-mail."], newpass: ["Nova senha", "Escolha uma senha com pelo menos 8 caracteres."] };
  const [h, lede] = titles[mode];
  $("#app").innerHTML = `
  <main class="auth"><form class="auth-card" id="authf" novalidate>
    <div class="brand"><span class="brand-mark">F</span>Fôlego</div>
    <h1>${h}</h1><p class="lede">${lede}</p>
    ${mode === "signup" ? `<label class="field"><span>Seu nome</span><input class="input" name="name" autocomplete="given-name" required></label>` : ""}
    ${mode !== "newpass" ? `<label class="field"><span>E-mail</span><input class="input" type="email" name="email" autocomplete="email" required></label>` : ""}
    ${mode !== "reset" ? `<label class="field"><span>Senha</span><input class="input" type="password" name="password" minlength="8" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required></label>` : ""}
    <button class="btn block" type="submit">${{ login: "Entrar", signup: "Criar conta", reset: "Enviar link", newpass: "Salvar senha" }[mode]}</button>
    <div class="row" style="justify-content:space-between;margin-top:12px">
      ${mode === "login" ? `<button type="button" class="linkbtn" data-m="signup">Criar conta</button><button type="button" class="linkbtn" data-m="reset">Esqueci a senha</button>` : ""}
      ${mode === "signup" || mode === "reset" ? `<button type="button" class="linkbtn" data-m="login">Já tenho conta</button>` : ""}
    </div>
  </form></main>`;
  document.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => renderAuth(b.dataset.m));
  $("#authf").onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector("button[type=submit]");
    busy(btn, async () => {
      if (f.password !== undefined && f.password.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
      if (mode === "login") must(await sb.auth.signInWithPassword({ email: f.email, password: f.password }));
      if (mode === "signup") {
        const r = must(await sb.auth.signUp({ email: f.email, password: f.password, options: { data: { name: f.name }, emailRedirectTo: location.origin + location.pathname } }));
        if (!r.session) toast("Conta criada! Confirme pelo link enviado ao seu e-mail.");
      }
      if (mode === "reset") { must(await sb.auth.resetPasswordForEmail(f.email, { redirectTo: location.origin + location.pathname })); toast("Link enviado. Confira seu e-mail."); }
      if (mode === "newpass") { must(await sb.auth.updateUser({ password: f.password })); toast("Senha atualizada."); boot(); }
    });
  };
}

// ------------------------------------------------------------------ dia do pagamento
function paydayFields(p) {
  const mode = p.payday_mode ?? "business_day";
  return `
  <fieldset class="field payday" id="pd">
    <legend>Quando o salário cai</legend>
    <div class="seg" role="group" aria-label="Regra do pagamento">
      <button type="button" data-pm="business_day" aria-pressed="${mode === "business_day"}">Dia útil</button>
      <button type="button" data-pm="fixed" aria-pressed="${mode === "fixed"}">Dia fixo</button>
    </div>
    <input type="hidden" name="payday_mode" value="${mode}">
    <div class="payday-row">
      <span id="pd-pre">${mode === "fixed" ? "Todo dia" : ""}</span>
      <input class="input" name="payday" type="number" inputmode="numeric" min="1" max="${mode === "fixed" ? 31 : 23}" value="${p.payday ?? 5}" aria-label="Dia" required>
      <span id="pd-suf">${mode === "fixed" ? "do mês" : "º dia útil do mês"}</span>
    </div>
    <label class="check" id="pd-sat" ${mode === "fixed" ? "hidden" : ""}><input type="checkbox" name="payday_sat" ${p.payday_count_saturday ? "checked" : ""}>
      <span>Contar sábado como dia útil<br><span class="faint">A CLT conta o sábado no prazo do salário; muitas empresas seguem o calendário bancário. Na dúvida, compare com as datas do seu holerite.</span></span></label>
    <p class="faint" id="pd-prev" aria-live="polite"></p>
  </fieldset>`;
}
function bindPayday(form) {
  const modeIn = form.querySelector("[name=payday_mode]"), dayIn = form.querySelector("[name=payday]"), satIn = form.querySelector("[name=payday_sat]");
  const update = async () => {
    const fixed = modeIn.value === "fixed";
    $("#pd-pre").textContent = fixed ? "Todo dia" : "";
    $("#pd-suf").textContent = fixed ? "do mês" : "º dia útil do mês";
    $("#pd-sat").hidden = fixed;
    dayIn.max = fixed ? 31 : 23;
    const n = Number(dayIn.value);
    if (!n || n < 1 || n > Number(dayIn.max)) { $("#pd-prev").textContent = fixed ? "Escolha um dia de 1 a 31." : "Escolha de 1º a 23º dia útil."; return; }
    clearTimeout(update._t);
    update._t = setTimeout(async () => {
      const { data } = await sb.rpc("preview_paydays", { p_mode: modeIn.value, p_n: n, p_sat: !!satIn?.checked });
      if (data?.length) $("#pd-prev").textContent = "Próximos pagamentos: " + data.map((x) => d(x).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "")).join(" · ");
    }, 200);
  };
  form.querySelectorAll("[data-pm]").forEach((b) => b.onclick = () => {
    modeIn.value = b.dataset.pm;
    form.querySelectorAll("[data-pm]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    if (b.dataset.pm === "business_day" && Number(dayIn.value) > 23) dayIn.value = 5;
    update();
  });
  dayIn.oninput = update; if (satIn) satIn.onchange = update;
  update();
}
const paydayValues = (f) => ({ payday: Number(f.payday), payday_mode: f.payday_mode, payday_count_saturday: !!f.payday_sat });

// ------------------------------------------------------------------ primeiro acesso
function renderOnboarding() {
  const p = S.profile;
  $("#app").innerHTML = `
  <main class="auth"><form class="auth-card" id="onb">
    <div class="brand"><span class="brand-mark">F</span>Fôlego</div>
    <h1>Vamos começar</h1>
    <p class="lede">Com sua renda e o dia em que ela cai, montamos um orçamento inicial por categoria. Você ajusta tudo depois.</p>
    <label class="field"><span>Como quer ser chamado</span><input class="input" name="name" value="${esc(p.name ?? "")}" required></label>
    <label class="field"><span>Renda mensal líquida</span><input class="input" name="income" inputmode="decimal" placeholder="Ex: 4.500,00" required></label>
    ${paydayFields({ ...p, payday_mode: p.onboarded ? p.payday_mode : "business_day" })}
    <button class="btn block" type="submit">Montar meu orçamento</button>
  </form></main>`;
  bindPayday($("#onb"));
  $("#onb").onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy(e.target.querySelector("button"), async () => {
      const income = parseMoney(f.income);
      if (!income) throw new Error("Informe a renda, por exemplo 4.500,00.");
      const pd = paydayValues(f);
      must(await sb.rpc("complete_onboarding", { p_name: f.name.trim(), p_income: income, p_payday: pd.payday, p_payday_mode: pd.payday_mode, p_count_saturday: pd.payday_count_saturday }));
      await loadProfile(); location.hash = "#conexoes"; await render();
      toast("Orçamento criado. Agora conecte seu banco.");
    });
  };
}

// ------------------------------------------------------------------ casca
const VIEWS = [["inicio", "Início", "home"], ["lancamentos", "Lançamentos", "list"], ["orcamento", "Orçamento", "target"], ["conexoes", "Conexões", "plug"]];
function shell(inner, { fab = true } = {}) {
  const first = (S.profile.name || "").split(" ")[0];
  $("#app").innerHTML = `
  <div class="shell">
    <nav class="tabs" aria-label="Seções">
      <div class="brand"><span class="brand-mark">F</span>Fôlego</div>
      ${VIEWS.map(([k, l, i]) => `<button class="tab" data-v="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${ICONS[i]}<span>${l}</span></button>`).join("")}
    </nav>
    <main class="main">
      <div class="topbar"><div class="brand"><span class="brand-mark">F</span>Fôlego</div><div class="row"><span class="greet">${first ? `Olá, ${esc(first)}` : ""}</span>${fab ? `<button class="btn add-top" id="addtop">Novo lançamento</button>` : ""}</div></div>
      ${inner}
    </main>
  </div>
  ${fab ? `<button class="fab" id="fab" aria-label="Adicionar lançamento">+</button>` : ""}`;
  document.querySelectorAll(".tab").forEach((b) => b.onclick = () => { location.hash = "#" + b.dataset.v; });
  if (fab) { $("#fab").onclick = () => editTx(null); $("#addtop").onclick = () => editTx(null); }
}

// ------------------------------------------------------------------ INÍCIO
function viewHome() {
  const s = S.snap;
  if (!s) return shell(`<div class="skeleton"></div>`);
  const total = Math.max(1, (d(s.cycle_end) - d(s.cycle_start)) / 864e5 + 1);
  const elapsed = Math.min(total, total - s.days_left + 1);
  const timePct = (elapsed - 0.5) / total * 100;
  const inc = Math.max(1, s.income);
  const spentPct = Math.min(100, s.expenses / inc * 100);
  const commPct = Math.min(100 - spentPct, s.committed_recurring / inc * 100);
  const state = s.available < 0 ? "is-negative" : s.per_day < 0.25 * (s.income / total) ? "is-low" : "";
  const [reais, cents] = brl(Math.max(0, s.per_day)).replace("R$", "").trim().split(",");

  const notices = [];
  const disconnected = S.conns.filter((c) => /ERROR|WAITING|OUTDATED/.test(c.status));
  disconnected.forEach((c) => notices.push(["over", `<b>${esc(c.institution)}</b> precisa ser reconectado para continuar sincronizando.`, "#conexoes"]));
  (s.card_bills || []).filter((b) => daysTo(b.due) <= 10).forEach((b) => notices.push([daysTo(b.due) <= 3 ? "warn" : "info",
    `💳 Fatura ${esc(b.institution ?? b.account)} de <b>${brl(b.amount)}</b> vence ${daysTo(b.due) === 0 ? "hoje" : daysTo(b.due) === 1 ? "amanhã" : fmtWeekday(b.due)}.`, "#inicio"]));
  if (!S.conns.length && !S.txs.length) notices.push(["info", S.of?.enabled
    ? "<b>Conecte seu banco</b> para os lançamentos entrarem sozinhos."
    : "<b>Importe o extrato do seu banco</b> (OFX ou CSV) para começar com seu histórico.", S.of?.enabled ? "#conexoes" : "#lancamentos?importar"]);
  (s.categories || []).filter((c) => c.kind === "expense" && c.pct >= 100).forEach((c) => notices.push(["over", `${c.icon} <b>${esc(c.name)}</b> ${c.spent > c.budget ? "passou do" : "chegou ao limite do"} orçamento: ${brl0(c.spent)} de ${brl0(c.budget)}.`, "#orcamento"]));
  (s.categories || []).filter((c) => c.kind === "expense" && c.pct >= 80 && c.pct < 100).forEach((c) => notices.push(["warn", `${c.icon} <b>${esc(c.name)}</b> já usou ${c.pct}% do orçamento.`, "#orcamento"]));
  if (s.pending_review > 0) notices.push(["info", `<b>${s.pending_review}</b> lançamento(s) sem categoria ou aguardando o banco.`, "#lancamentos?revisar"]);
  const lastNotif = S.inbox?.[0];
  if (lastNotif && (Date.now() - Date.parse(lastNotif.received_at)) > 48 * 3600e3) {
    notices.unshift(["warn", `📵 O celular não envia notificações desde <b>${new Date(lastNotif.received_at).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}</b>. Confira se o MacroDroid está ligado e sem economia de bateria.`, "#conexoes"]);
  }
  const ignoredRecent = (S.inbox || []).filter((n) => n.result === "ignored" && /R\$\s*\d/.test(`${n.title} ${n.body}`) && Date.now() - Date.parse(n.received_at) < 3 * 86400e3);
  if (ignoredRecent.length) notices.push(["info", `<b>${ignoredRecent.length}</b> aviso(s) do banco com valor não viraram lançamento. Confira se algum era gasto.`, "#conexoes?avisos"]);
  if (s.reimbursable_open > 0) notices.push(["info", `<b>${brl(s.reimbursable_open)}</b> em gastos da empresa a reembolsar.`, "#lancamentos?reembolso"]);

  const pace = timePct;
  const cats = (s.categories || []).filter((c) => c.kind === "expense" && (c.spent > 0 || c.budget)).slice(0, 8);
  const recent = S.txs.slice(0, 6);

  shell(`
  <section class="breath ${state}" aria-label="Quanto você pode gastar">
    <div class="breath-label">Pode gastar por dia até o salário de ${fmtWeekday(s.next_payday)}</div>
    <div class="breath-value"><span class="cur">R$</span>${reais}<small>,${cents}</small></div>
    <p class="breath-sub">${s.available >= 0
      ? `Sobram <strong>${brl(s.available)}</strong> para os próximos <strong>${s.days_left} dias</strong>, já descontando ${s.committed_recurring > 0 ? `${brl(s.committed_recurring)} de contas recorrentes que ainda vão cair` : "o que você gastou"}.`
      : `Você está <strong>${brl(-s.available)}</strong> acima da renda neste ciclo. Faltam ${s.days_left} dias para o próximo salário.`}</p>
  </section>

  <div class="ruler" aria-hidden="true">
    <div class="ruler-track" style="--day:${100 / total}%">
      <div class="ruler-money" style="left:${spentPct + commPct}%;width:${100 - spentPct - commPct}%"></div>
      <div class="ruler-spent" style="width:${spentPct}%;background-color:color-mix(in srgb, var(--ink) 10%, transparent)"></div>
      <div class="ruler-spent" style="left:${spentPct}%;width:${commPct}%;background-color:color-mix(in srgb, var(--warn) 45%, transparent)"></div>
      <div class="ruler-today" style="left:calc(${timePct}% - 1.5px)"></div>
    </div>
    <div class="ruler-ends"><span>${fmtDay(s.cycle_start)}</span><span>${fmtDay(s.cycle_end)}</span></div>
    <div class="ruler-legend">
      <span><i class="sw" style="background:color-mix(in srgb, var(--ink) 22%, transparent)"></i>gasto</span>
      ${commPct > 0 ? `<span><i class="sw" style="background:color-mix(in srgb, var(--warn) 55%, transparent)"></i>recorrentes por vir</span>` : ""}
      <span><i class="sw" style="background:var(--accent)"></i>livre</span>
    </div>
  </div>

  <dl class="figures">
    <div><dt>Entrou</dt><dd class="money pos">${brl0(s.income)}</dd></div>
    <div><dt>Saiu</dt><dd class="money">${brl0(s.expenses)}</dd></div>
    <div><dt>Livre</dt><dd class="money">${brl0(s.available)}</dd></div>
  </dl>

  ${notices.length ? `<div class="notices">${notices.slice(0, 5).map(([k, html, go]) => `<button class="notice ${k}" data-go="${go}"><span class="grow">${html}</span><span aria-hidden="true">›</span></button>`).join("")}</div>` : ""}

  <div class="two">
    <section>
      <h2>Para onde foi o dinheiro</h2>
      ${cats.length ? `<ul class="catlist">${cats.map((c) => catRow(c, pace)).join("")}</ul>` : `<p class="muted">Nenhum gasto neste ciclo ainda.</p>`}
    </section>
    <section>
      <h2>Últimos lançamentos</h2>
      ${recent.length ? recent.map(txRow).join("") : `<p class="muted">Sem lançamentos. Conecte o banco ou use o botão +.</p>`}
      ${commitments(s)}
    </section>
  </div>`);
  document.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => { location.hash = b.dataset.go; });
  bindTxRows();
}
// Faturas abertas, parcelas futuras e contas recorrentes: o que já está comprometido
function commitments(s) {
  const rows = [];
  (s.card_bills || []).forEach((b) => rows.push(["💳", `Fatura ${esc(b.institution ?? b.account)}`, `vence ${fmtDay(b.due)}`, b.amount]));
  const inst = s.installments;
  if (inst?.items?.length) rows.push(["🧾", "Parcelas no cartão", `${inst.items.length} compra(s) · ${brl(inst.total_remaining)} até quitar tudo`, inst.next_3_months, "próx. 3 meses"]);
  (s.recurring || []).slice(0, 6).forEach((r) => rows.push(["🔁", esc(r.merchant), `próximo por volta de ${fmtDay(r.next_expected)}`, r.avg_amount, "por mês"]));
  if (!rows.length) return "";
  return `<h2>O que ainda vai sair</h2><ul class="catlist">${rows.map(([ic, name, sub, val, unit]) => `
    <li class="catrow"><span class="ico" aria-hidden="true">${ic}</span><span class="name">${name}<br><span class="faint">${sub}</span></span>
    <span class="val money">${brl(val)}${unit ? `<br><small>${unit}</small>` : ""}</span></li>`).join("")}</ul>`;
}
function catRow(c, pace) {
  const pct = c.budget ? Math.min(100, c.spent / c.budget * 100) : 0;
  const cls = !c.budget ? "" : c.pct >= 100 ? "over" : c.pct >= 80 ? "warn" : "";
  return `<li class="catrow">
    <span class="ico" aria-hidden="true">${c.icon}</span>
    <span class="name">${esc(c.name)}</span>
    <span class="val money">${brl0(c.spent)}${c.budget ? ` <small>de ${brl0(c.budget)}</small>` : ""}</span>
    ${c.budget ? `<div class="meter ${cls}" role="img" aria-label="${Math.round(c.pct)}% do orçamento"><i style="width:${pct}%"></i>${pace ? `<span class="pace" style="left:${pace}%"></span>` : ""}</div>` : ""}
  </li>`;
}
function txRow(t) {
  const c = catById(t.category_id);
  const cls = t.type === "income" ? "in" : t.type === "transfer" ? "tr" : "";
  const sign = t.type === "income" ? "+" : t.type === "transfer" ? "" : "−";
  const acc = S.accounts.find((a) => a.id === t.account_id);
  const origin = { open_finance: acc?.name || "Banco", notification: "Notificação", whatsapp: "WhatsApp", manual: "Manual", import: acc?.name || "Extrato" }[t.source];
  return `<button class="tx" data-tx="${t.id}">
    <span class="ico" aria-hidden="true">${t.type === "transfer" ? "↔" : c?.icon ?? "❔"}</span>
    <span style="min-width:0"><div class="t1">${esc(t.merchant || t.description)}</div>
      <div class="t2">${t.type === "transfer" ? "Entre contas / fatura" : esc(c?.name ?? "Sem categoria")} · ${esc(origin)}${t.installment ? ` · ${esc(t.installment)}` : ""}
      ${t.status === "pending" ? `<span class="pill wait">aguardando banco</span>` : ""}${t.reimbursable ? `<span class="pill biz">${t.reimbursed_at ? "reembolsado" : "empresa"}</span>` : ""}</div></span>
    <span class="amt money ${cls}">${sign}${brl(t.amount)}</span>
  </button>`;
}
function bindTxRows() {
  document.querySelectorAll("[data-tx]").forEach((b) => b.onclick = () => editTx(S.txs.find((t) => t.id === b.dataset.tx)));
}

// ------------------------------------------------------------------ LANÇAMENTOS
function viewTxs() {
  const f = S.filter;
  const hashQ = location.hash.split("?")[1];
  if (hashQ === "revisar") f.type = "review";
  if (hashQ === "reembolso") f.type = "biz";
  const start = S.curCycle.cycle_start, end = S.curCycle.cycle_end;
  if (hashQ === "importar") { history.replaceState(null, "", "#lancamentos"); setTimeout(importSheet, 0); }
  const q = f.q.toLowerCase();
  const rows = S.txs.filter((t) => {
    if (f.type === "expense" && t.type !== "expense") return false;
    if (f.type === "income" && t.type !== "income") return false;
    if (f.type === "review" && !(t.status === "pending" || (!t.category_id && t.type !== "transfer"))) return false;
    if (f.type === "biz" && !t.reimbursable) return false;
    if (q && !`${t.description} ${t.merchant ?? ""} ${catById(t.category_id)?.name ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const groups = new Map();
  rows.forEach((t) => { const k = d(t.occurred_at).toLocaleDateString("sv"); (groups.get(k) ?? groups.set(k, []).get(k)).push(t); });
  const totOut = rows.filter((t) => t.type === "expense").reduce((a, t) => a + +t.amount, 0);
  const totIn = rows.filter((t) => t.type === "income").reduce((a, t) => a + +t.amount, 0);

  shell(`
  <h1>Lançamentos</h1>
  <div class="toolbar">
    <button class="btn quiet" id="prev" aria-label="Ciclo anterior">‹</button>
    <strong>${fmtDay(start)} – ${fmtDay(end)}</strong>
    <button class="btn quiet" id="next" aria-label="Próximo ciclo" ${f.cycle >= 0 ? "disabled" : ""}>›</button>
    <span class="grow"></span>
    <button class="btn ghost" id="imp">Importar extrato</button>
    <button class="btn ghost" id="csv">Exportar planilha</button>
  </div>
  <div class="toolbar">
    <input class="input search" id="q" type="search" placeholder="Buscar estabelecimento ou categoria" value="${esc(f.q)}">
    <div class="seg" role="group" aria-label="Filtro">
      ${[["all", "Tudo"], ["expense", "Saídas"], ["income", "Entradas"], ["review", "Revisar"], ["biz", "Empresa"]].map(([k, l]) => `<button data-f="${k}" aria-pressed="${f.type === k}">${l}</button>`).join("")}
    </div>
  </div>
  <p class="faint">${rows.length} lançamentos · saídas ${brl(totOut)} · entradas ${brl(totIn)}</p>
  ${rows.length ? [...groups.entries()].map(([k, list]) => `
    <section class="daygroup"><div class="dayhead"><span>${fmtLong(k)}</span><span class="money">${brl(list.filter((t) => t.type === "expense").reduce((a, t) => a + +t.amount, 0))}</span></div>
    ${list.map(txRow).join("")}</section>`).join("")
    : `<div class="empty"><h3>Nada por aqui</h3><p>${f.type === "review" ? "Tudo revisado." : "Os lançamentos aparecem assim que o banco sincroniza. Você também pode lançar pelo botão + ou pelo WhatsApp."}</p></div>`}
  `);
  $("#prev").onclick = async () => { f.cycle--; await loadTxs(); viewTxs(); };
  $("#next").onclick = async () => { f.cycle++; await loadTxs(); viewTxs(); };
  $("#q").oninput = (e) => { f.q = e.target.value; clearTimeout(viewTxs._t); viewTxs._t = setTimeout(() => { viewTxs(); const i = $("#q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  document.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { f.type = b.dataset.f; history.replaceState(null, "", "#lancamentos"); viewTxs(); });
  $("#csv").onclick = () => exportCSV(rows);
  $("#imp").onclick = importSheet;
  bindTxRows();
}

// ------------------------------------------------------------------ importar extrato (OFX/CSV)
async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return new TextDecoder("windows-1252").decode(buf); }   // bancos brasileiros costumam exportar em Latin-1
}
function importSheet() {
  sheet("Importar extrato", `
    <p class="muted">No app ou internet banking do seu banco, exporte o extrato ou a fatura em <b>OFX</b> (melhor opção, todos os bancos têm) ou <b>CSV</b>. Lançamentos que já existem não são duplicados.</p>
    <label class="field"><span>Arquivo</span><input class="input" type="file" id="impf" accept=".ofx,.csv,.txt,.qfx"></label>
    <label class="check"><input type="checkbox" id="impcard"><span>É fatura de cartão de crédito</span></label>
    <div id="impprev"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="impgo" disabled>Importar</button></div>`, (close) => {
    let file = null, text = "";
    const preview = async () => {
      if (!file) return;
      $("#impprev").innerHTML = `<p class="faint">Lendo…</p>`; $("#impgo").disabled = true;
      try {
        text = await readText(file);
        const r = await call("import-statement", { filename: file.name, content: text, isCard: $("#impcard").checked || undefined, preview: true });
        if (r.isCard) $("#impcard").checked = true;
        $("#impprev").innerHTML = `<div class="notice info" style="cursor:default"><span class="grow"><b>${r.count} lançamentos</b> de ${fmtDay(r.from)} a ${fmtDay(r.to)}<br>
          Saídas ${brl(r.expenses)} · entradas ${brl(r.income)}</span></div>`;
        $("#impgo").disabled = false;
      } catch (e) { $("#impprev").innerHTML = `<p style="color:var(--over)">${esc(e.message)}</p>`; }
    };
    $("#impf").onchange = (e) => { file = e.target.files[0]; if (file && file.size > 3e6) { toast("Arquivo grande demais (máx. 3 MB)."); file = null; return; } preview(); };
    $("#impcard").onchange = preview;
    $("#impgo").onclick = (e) => busy(e.target, async () => {
      const r = await call("import-statement", { filename: file.name, content: text, isCard: $("#impcard").checked });
      close();
      toast(`${r.inserted} importados${r.merged ? `, ${r.merged} juntados a lançamentos existentes` : ""}${r.skipped ? `, ${r.skipped} já existiam` : ""}.`);
      await refresh();
    });
  });
}

function exportCSV(rows) {
  const head = ["Data", "Tipo", "Descrição", "Estabelecimento", "Categoria", "Valor", "Conta", "Origem", "Status", "Parcela", "Reembolso empresa", "Observação"];
  const tipo = { income: "Entrada", expense: "Saída", transfer: "Transferência" };
  const lines = rows.map((t) => [
    d(t.occurred_at).toLocaleDateString("pt-BR"), tipo[t.type], t.description, t.merchant ?? "", catById(t.category_id)?.name ?? "",
    (t.type === "expense" ? -t.amount : +t.amount).toFixed(2).replace(".", ","), S.accounts.find((a) => a.id === t.account_id)?.name ?? "",
    t.source, t.status, t.installment ?? "", t.reimbursable ? (t.reimbursed_at ? "reembolsado" : "pendente") : "", t.note ?? "",
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
  const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `lancamentos-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

// ------------------------------------------------------------------ folha de edição
function sheet(title, html, onMount) {
  const root = $("#sheet-root");
  const prevFocus = document.activeElement;
  root.innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t">
    <div class="sheet-head"><h2 id="sh-t" style="margin:0">${title}</h2><button class="x" id="shx" aria-label="Fechar">×</button></div>${html}</div></div>`;
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); prevFocus?.focus?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  $("#shx").onclick = close;
  $("#scrim").onclick = (e) => { if (e.target.id === "scrim") close(); };
  setTimeout(() => root.querySelector("input,select,button:not(.x)")?.focus(), 50);
  onMount?.(close);
}

function catOptions(kind, selected) {
  return S.cats.filter((c) => c.kind === kind).map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("");
}

function editTx(t, preset = {}) {
  const isNew = !t;
  t = t ?? { type: "expense", amount: "", description: "", occurred_at: todayISO(), category_id: null, reimbursable: false, note: "", ...preset };
  const fromBank = t.source === "open_finance";
  const merchantKey = (t.merchant || t.description || "").trim();
  sheet(isNew ? "Novo lançamento" : "Lançamento", `
  <form id="txf">
    <div class="seg" role="group" aria-label="Tipo" style="margin-bottom:14px">
      ${[["expense", "Saída"], ["income", "Entrada"], ["transfer", "Entre contas"]].map(([k, l]) => `<button type="button" data-type="${k}" aria-pressed="${t.type === k}">${l}</button>`).join("")}
    </div>
    <div class="row">
      <label class="field"><span>Valor</span><input class="input" name="amount" inputmode="decimal" value="${t.amount ? String(t.amount).replace(".", ",") : ""}" ${fromBank ? "readonly" : ""} required placeholder="0,00"></label>
      <label class="field"><span>Data</span><input class="input" type="date" name="date" value="${d(t.occurred_at).toLocaleDateString("sv")}" ${fromBank ? "readonly" : ""}></label>
    </div>
    <label class="field"><span>Descrição</span><input class="input" name="description" value="${esc(t.merchant || t.description)}" required></label>
    <label class="field" id="catf"><span>Categoria</span><select class="input" name="category_id"><option value="">Sem categoria</option>${catOptions(t.type === "income" ? "income" : "expense", t.category_id)}</select></label>
    ${!isNew && merchantKey ? `<label class="check"><input type="checkbox" name="rule"><span>Sempre usar esta categoria para <b>${esc(merchantKey.slice(0, 40))}</b></span></label>` : ""}
    <label class="check"><input type="checkbox" name="reimbursable" ${t.reimbursable ? "checked" : ""}><span>Gasto da empresa (reembolsável)</span></label>
    ${t.reimbursable && !isNew ? `<label class="check"><input type="checkbox" name="reimbursed" ${t.reimbursed_at ? "checked" : ""}><span>Já fui reembolsado</span></label>` : ""}
    <label class="field"><span>Observação</span><input class="input" name="note" value="${esc(t.note ?? "")}"></label>
    ${fromBank ? `<p class="faint">Valor e data vêm do banco e não podem ser alterados. ${t.raw?.description ? `Texto original: “${esc(t.raw.description)}”` : ""}</p>` : ""}
    ${t.source === "notification" ? `<p class="faint">Lançado pela notificação do celular. Quando o banco confirmar, este registro é atualizado automaticamente.</p>` : ""}
    <div class="row" style="justify-content:space-between;margin-top:8px">
      ${isNew ? "<span></span>" : `<button type="button" class="btn danger" id="del">Excluir</button>`}
      <button class="btn" type="submit">${isNew ? "Adicionar" : "Salvar"}</button>
    </div>
  </form>`, (close) => {
    let type = t.type;
    document.querySelectorAll("[data-type]").forEach((b) => b.onclick = () => {
      type = b.dataset.type;
      document.querySelectorAll("[data-type]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      $("#catf select").innerHTML = `<option value="">Sem categoria</option>` + catOptions(type === "income" ? "income" : "expense", null);
      $("#catf").hidden = type === "transfer";
    });
    $("#catf").hidden = type === "transfer";
    $("#txf").onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      busy(e.target.querySelector("[type=submit]"), async () => {
        const amount = parseMoney(f.amount);
        if (!amount) throw new Error("Informe um valor válido.");
        const catChanged = (f.category_id || null) !== (t.category_id || null);
        const row = {
          type, description: f.description.trim(), merchant: f.description.trim(),
          category_id: type === "transfer" ? null : f.category_id || null,
          category_locked: t.category_locked || catChanged,
          reimbursable: !!f.reimbursable, note: f.note || null,
          reimbursed_at: f.reimbursed ? (t.reimbursed_at ?? new Date().toISOString()) : null,
        };
        if (!fromBank) { row.amount = amount; row.occurred_at = new Date(f.date + "T12:00:00").toISOString(); }
        if (isNew) must(await sb.from("transactions").insert({ ...row, user_id: S.session.user.id, source: "manual", status: "confirmed" }));
        else must(await sb.from("transactions").update(row).eq("id", t.id));
        if (f.rule && row.category_id) {
          const pattern = merchantKey.toLowerCase().replace(/[^a-z0-9à-ú ]/gi, " ").replace(/\s+/g, " ").trim().slice(0, 40);
          must(await sb.from("category_rules").upsert({ user_id: S.session.user.id, pattern, category_id: row.category_id, mark_reimbursable: row.reimbursable }, { onConflict: "user_id,pattern" }));
          // aplica a regra aos lançamentos parecidos que ainda não foram ajustados à mão
          await sb.from("transactions").update({ category_id: row.category_id }).ilike("description", `%${pattern}%`).eq("category_locked", false).neq("type", "transfer");
        }
        close(); toast(isNew ? "Lançamento adicionado." : "Alterações salvas."); await refresh();
      });
    };
    $("#del")?.addEventListener("click", (e) => {
      if (!confirm("Excluir este lançamento? Ele continua no histórico de alterações.")) return;
      busy(e.target, async () => {
        must(await sb.from("transactions").update({ deleted_at: new Date().toISOString() }).eq("id", t.id));
        close(); toast("Lançamento excluído."); await refresh();
      });
    });
  });
}

// ------------------------------------------------------------------ ORÇAMENTO
function viewBudget() {
  const s = S.snap; const p = S.profile;
  const spent = new Map((s?.categories || []).map((c) => [c.id, c.spent]));
  const exp = S.cats.filter((c) => c.kind === "expense");
  const planned = exp.reduce((a, c) => a + Number(c.monthly_budget || 0), 0);
  const free = Number(p.monthly_income) - planned;
  shell(`
  <h1>Orçamento</h1>
  <p class="muted" style="max-width:60ch">Os valores partem de uma divisão sugerida da sua renda (moradia até 30%, reserva de 10%…). É um ponto de partida: ajuste ao que é real para você.</p>
  <form id="incf" class="panel" style="margin-top:14px">
    <label class="field"><span>Renda mensal líquida</span><input class="input" name="income" inputmode="decimal" value="${Number(p.monthly_income).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}"></label>
    ${paydayFields(p)}
    <button class="btn" type="submit">Salvar renda e pagamento</button>
  </form>
  <p class="faint">Mudar a renda recalcula os orçamentos que estão em %. Planejado: <b>${brl(planned)}</b> · ${free >= 0 ? `sem destino: <b>${brl(free)}</b>` : `<b style="color:var(--over)">${brl(-free)} acima da renda</b>`}</p>

  <h2>Categorias de saída</h2>
  <ul class="catlist">${exp.map((c) => `
    <li class="catrow" style="grid-template-columns:28px 1fr 130px">
      <span class="ico">${c.icon}</span>
      <span><span class="name">${esc(c.name)}</span><br><span class="faint">gasto no ciclo ${brl0(spent.get(c.id) || 0)}</span></span>
      <input class="input money" aria-label="Orçamento de ${esc(c.name)}" data-bud="${c.id}" inputmode="decimal" placeholder="sem limite" value="${c.monthly_budget != null ? Number(c.monthly_budget).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : ""}">
    </li>`).join("")}</ul>
  <h2>Categorias de entrada</h2>
  <p class="muted">${S.cats.filter((c) => c.kind === "income").map((c) => `${c.icon} ${esc(c.name)}`).join(" · ")}</p>
  <div class="row" style="margin-top:18px"><button class="btn ghost" id="addcat">Nova categoria</button></div>
  `, { fab: false });

  bindPayday($("#incf"));
  $("#incf").onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy(e.target.querySelector("button"), async () => {
      const income = parseMoney(f.income);
      if (income == null) throw new Error("Renda inválida.");
      must(await sb.from("profiles").update({ monthly_income: income, ...paydayValues(f) }).eq("id", p.id));
      S.cycles = {}; S.filter.cycle = 0;
      await loadProfile(); await refresh(); toast("Renda e dia do pagamento salvos.");
    });
  };
  document.querySelectorAll("[data-bud]").forEach((inp) => inp.onchange = async () => {
    const v = inp.value.trim() === "" ? null : parseMoney(inp.value);
    const income = Number(p.monthly_income) || 0;
    const { error } = await sb.from("categories").update({ monthly_budget: v, budget_pct: v != null && income ? Math.round(v / income * 10000) / 100 : null }).eq("id", inp.dataset.bud);
    if (error) return toast(error.message);
    toast("Orçamento salvo."); await refresh();
  });
  $("#addcat").onclick = () => sheet("Nova categoria", `
    <form id="ncf">
      <div class="row"><label class="field" style="flex:0 0 80px"><span>Ícone</span><input class="input" name="icon" value="🏷️" maxlength="4"></label>
      <label class="field"><span>Nome</span><input class="input" name="name" required></label></div>
      <label class="field"><span>Tipo</span><select class="input" name="kind"><option value="expense">Saída</option><option value="income">Entrada</option></select></label>
      <label class="field"><span>Orçamento mensal (opcional)</span><input class="input" name="budget" inputmode="decimal"></label>
      <button class="btn block" type="submit">Criar categoria</button>
    </form>`, (close) => {
      $("#ncf").onsubmit = (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        busy(e.target.querySelector("button"), async () => {
          must(await sb.from("categories").insert({ user_id: p.id, name: f.name.trim(), kind: f.kind, icon: f.icon || "🏷️", monthly_budget: parseMoney(f.budget) }));
          close(); toast("Categoria criada."); await refresh();
        });
      };
    });
}

// ------------------------------------------------------------------ CONEXÕES
const STATUS = { UPDATED: ["ok", "Sincronizado"], UPDATING: ["wait", "Sincronizando…"], LOGIN_ERROR: ["bad", "Conexão expirou"], OUTDATED: ["bad", "Desatualizado"], WAITING_USER_INPUT: ["wait", "Precisa de você"], DELETED: ["bad", "Removido"] };
function viewConnections() {
  const p = S.profile;
  const fn = `${CFG.SUPABASE_URL}/functions/v1/ingest-notification`;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  shell(`
  <h1>Conexões</h1>
  ${!standalone ? `<div class="notices"><button class="notice info" id="install"><span class="grow"><b>Instale o app</b> na tela inicial ${isIOS ? "(Compartilhar → Adicionar à Tela de Início)" : "para abrir como aplicativo"}.</span><span>›</span></button></div>` : ""}

  <section class="panel" style="margin-top:18px">
    <h2>Bancos e cartões</h2>
    ${!S.of?.enabled ? `<p class="muted">A conexão automática com bancos não está ativa na sua conta. Você pode importar o extrato do seu banco (OFX ou CSV) e usar as notificações do celular para registrar os gastos na hora.</p>
      <button class="btn" id="goimp">Importar extrato</button>` : S.of.meuPluggy ? `<p class="muted">Conexão gratuita pelo <b>Meu Pluggy</b> (uso pessoal). Atualiza uma vez por dia; as notificações do celular cobrem o tempo real.</p>
      <ol class="steps"><li>Em <a href="https://meu.pluggy.ai" target="_blank" rel="noopener">meu.pluggy.ai</a>, crie sua conta e conecte seus bancos pelo Open Finance.</li>
      <li>Aqui, toque em <b>Conectar banco</b> e entre com a conta do Meu Pluggy.</li></ol>`
      : `<p class="muted">Pelo Open Finance as transações entram sozinhas. A conexão é autorizada no app do seu banco e pode ser revogada a qualquer momento.</p>`}
    ${S.conns.map((c) => {
      const [k, l] = STATUS[c.status] ?? ["wait", c.status];
      const accs = S.accounts.filter((a) => a.connection_id === c.id);
      return `<div class="bank">${c.institution_logo ? `<img src="${esc(c.institution_logo)}" alt="">` : `<span class="logo"></span>`}
        <div><b>${esc(c.institution ?? "Banco")}</b> <span class="status ${k}">${l}</span><br>
        <span class="faint">${accs.map((a) => `${esc(a.name)}${a.balance != null ? ` ${a.type === "CREDIT" ? "fatura" : "saldo"} ${brl(a.balance)}` : ""}`).join(" · ") || "—"}${c.last_sync_at ? ` · atualizado ${new Date(c.last_sync_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}</span></div>
        <div class="row">${k === "bad" ? `<button class="btn" data-recon="${c.pluggy_item_id}">Reconectar</button>` : `<button class="btn quiet" data-sync="${c.pluggy_item_id}">Atualizar</button>`}
        <button class="btn ghost" data-rm="${c.pluggy_item_id}" aria-label="Remover ${esc(c.institution)}">Remover</button></div></div>`;
    }).join("")}
    ${S.of?.enabled ? `<div class="row" style="margin-top:12px"><button class="btn" id="connect">Conectar banco</button><button class="btn ghost" id="goimp">Importar extrato</button></div>` : ""}
  </section>

  <section class="panel">
    <h2>WhatsApp</h2>
    ${p.whatsapp_phone
      ? `<p>Conectado ao número <b>+${esc(p.whatsapp_phone)}</b>. Mande <b>resumo</b>, <b>hoje</b>, <b>mês</b> ou <i>gastei 30 no almoço</i>.</p>
         <label class="check"><input type="checkbox" id="alerts" ${p.alerts_enabled ? "checked" : ""}><span>Avisos de orçamento e resumo semanal</span></label>
         <div class="row">${CFG.WHATSAPP_NUMBER ? `<a class="btn" href="https://wa.me/${CFG.WHATSAPP_NUMBER}?text=resumo" target="_blank" rel="noopener">Abrir conversa</a>` : ""}<button class="btn ghost" id="unlink">Desconectar</button></div>`
      : `<p class="muted">Peça relatórios e lance gastos por mensagem. Gere um código e envie para o assistente.</p>
         <div id="codebox"></div><button class="btn" id="gencode">Gerar código</button>`}
  </section>

  <section class="panel">
    <h2>Notificações do celular</h2>
    <p class="muted">Registra o gasto no instante em que o banco notifica, antes mesmo do Open Finance. Quando o banco confirma, os dois viram um lançamento só.</p>
    <details ${!isIOS ? "open" : ""}><summary>Android (MacroDroid)</summary>
      <ol class="steps">
        <li>Instale o <b>MacroDroid</b> na Play Store e dê a permissão de acesso a notificações.</li>
        <li>Crie uma macro com o gatilho <b>Notificação recebida</b> e escolha os apps dos seus bancos.</li>
        <li>Adicione a ação <b>Requisição HTTP</b>: método <b>POST</b>, URL abaixo, cabeçalho <b>X-Ingest-Token</b> com seu token e corpo JSON:<br>
          <code>{"app":"[not_app_name]","title":"[not_title]","text":"[notification]"}</code></li>
        <li>Salve e toque em “Testar” aqui embaixo para conferir.</li>
      </ol>
    </details>
    <details ${isIOS ? "open" : ""}><summary>iPhone (Atalhos)</summary>
      <ol class="steps">
        <li>No app <b>Atalhos</b> → Automação → Nova → <b>Transação</b> (compras com Apple Pay/Carteira) → Executar imediatamente.</li>
        <li>Ação <b>Obter conteúdo do URL</b>: POST para a URL abaixo, cabeçalho <b>X-Ingest-Token</b>, corpo JSON com <code>merchant</code> = Comerciante e <code>amount</code> = Valor.</li>
        <li>O iPhone não permite ler notificações de outros apps; para os demais gastos o Open Finance cobre.</li>
      </ol>
    </details>
    ${notifStatus()}
    <p class="field"><span class="faint">URL</span><span class="token">${esc(fn)}</span></p>
    <p class="field"><span class="faint">Seu token (não compartilhe)</span><span class="token" id="tok">${esc(p.ingest_token)}</span></p>
    <div class="row"><button class="btn quiet" id="copytok">Copiar token</button><button class="btn ghost" id="testnot">Testar</button><button class="btn ghost" id="rotate">Gerar novo token</button></div>
  </section>

  <section class="panel">
    <h2>Conta</h2>
    <p class="muted">${esc(S.session.user.email)}<br><span class="faint">Versão do app: ${esc(CFG.APP_VERSION || "local")}</span></p>
    <div class="row"><button class="btn ghost" id="logout">Sair</button><button class="btn danger" id="delacc">Excluir conta e dados</button></div>
  </section>
  `, { fab: false });

  $("#install")?.addEventListener("click", () => {
    if (window._installPrompt) { window._installPrompt.prompt(); window._installPrompt = null; }
    else toast(isIOS ? "No Safari: Compartilhar → Adicionar à Tela de Início." : "Use o menu do navegador → Instalar app.");
  });
  $("#connect")?.addEventListener("click", (e) => openPluggy(e.target));
  $("#goimp")?.addEventListener("click", importSheet);
  document.querySelectorAll("[data-recon]").forEach((b) => b.onclick = () => openPluggy(b, b.dataset.recon));
  document.querySelectorAll("[data-sync]").forEach((b) => b.onclick = () => busy(b, async () => {
    const r = await call("pluggy", { action: "sync", itemId: b.dataset.sync });
    toast(r.inserted || r.merged ? `${r.inserted + r.merged} lançamento(s) novos.` : "Tudo em dia.");
    await refresh();
  }));
  document.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => {
    if (!confirm("Remover esta conexão? Os lançamentos já importados continuam no histórico.")) return;
    busy(b, async () => { await call("pluggy", { action: "remove", itemId: b.dataset.rm }); toast("Conexão removida."); await refresh(); });
  });
  $("#gencode")?.addEventListener("click", (e) => busy(e.target, async () => {
    const code = must(await sb.rpc("whatsapp_link_code"));
    const link = CFG.WHATSAPP_NUMBER ? `https://wa.me/${CFG.WHATSAPP_NUMBER}?text=${encodeURIComponent("Vincular " + code)}` : null;
    $("#codebox").innerHTML = `<div class="code">${code}</div><p class="faint">Envie este código para o assistente em até 15 minutos.</p>${link ? `<p><a class="btn" href="${link}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a></p>` : ""}`;
    pollLink();
  }));
  $("#unlink")?.addEventListener("click", (e) => busy(e.target, async () => { must(await sb.rpc("whatsapp_unlink")); await loadProfile(); viewConnections(); }));
  $("#alerts")?.addEventListener("change", async (e) => { await sb.from("profiles").update({ alerts_enabled: e.target.checked }).eq("id", p.id); S.profile.alerts_enabled = e.target.checked; toast("Preferência salva."); });
  $("#copytok").onclick = async () => { await navigator.clipboard.writeText(p.ingest_token); toast("Token copiado."); };
  $("#rotate").onclick = (e) => {
    if (!confirm("O token antigo para de funcionar. Você precisará atualizar o MacroDroid/Atalhos. Continuar?")) return;
    busy(e.target, async () => { must(await sb.rpc("rotate_ingest_token")); await loadProfile(); viewConnections(); toast("Novo token gerado."); });
  };
  document.querySelectorAll("[data-launch]").forEach((b) => b.onclick = () => {
    const n = S.inbox.find((x) => String(x.id) === b.dataset.launch);
    const txt = `${n.title || ""} ${n.body || ""}`;
    const m = txt.match(/R\$\s*([\d.]+,\d{2}|[\d.]+)/);
    editTx(null, {
      amount: m ? parseMoney(m[1]) : "",
      description: n.title || n.app || "",
      type: /receb|devolu|estorno/i.test(txt) ? "income" : "expense",
      occurred_at: n.received_at, note: (n.body || "").slice(0, 200),
    });
  });
  $("#testnot").onclick = (e) => busy(e.target, async () => {
    const r = await fetch(fn, { method: "POST", headers: { "Content-Type": "application/json", "X-Ingest-Token": p.ingest_token },
      body: JSON.stringify({ app: "Teste", title: "Compra aprovada", text: "Compra de R$ 1,00 aprovada em TESTE FOLEGO" }) }).then((r) => r.json());
    if (r.error) throw new Error(r.error);
    toast(r.result === "created" ? "Funcionou! Um lançamento de teste de R$ 1,00 foi criado." : "Recebido (já existia um teste igual).");
    await refresh();
  });
  $("#logout").onclick = async () => { await sb.auth.signOut(); };
  $("#delacc").onclick = (e) => {
    const typed = prompt('Isso apaga sua conta e todos os seus dados para sempre. Digite "EXCLUIR" para confirmar.');
    if (typed !== "EXCLUIR") return;
    busy(e.target, async () => {
      for (const c of S.conns) await call("pluggy", { action: "remove", itemId: c.pluggy_item_id }).catch(() => null);
      must(await sb.rpc("delete_my_account")); await sb.auth.signOut(); toast("Conta excluída.");
    });
  };
}

// Situação das notificações: quando chegou a última e quais avisos foram descartados
function notifStatus() {
  const inbox = S.inbox || [];
  if (!inbox.length) return `<p class="faint">Nenhuma notificação recebida ainda. Depois de configurar, toque em <b>Testar</b>.</p>`;
  const last = inbox[0];
  const ago = Math.round((Date.now() - Date.parse(last.received_at)) / 60000);
  const agoTxt = ago < 60 ? `há ${ago} min` : ago < 1440 ? `há ${Math.round(ago / 60)} h` : `há ${Math.round(ago / 1440)} dia(s)`;
  const week = inbox.filter((n) => Date.now() - Date.parse(n.received_at) < 7 * 86400e3);
  const created = week.filter((n) => n.result === "created").length;
  const dup = week.filter((n) => n.result === "duplicate").length;
  const ignored = week.filter((n) => n.result === "ignored" && /R\$\s*\d/.test(`${n.title} ${n.body}`));
  return `
    <div class="notice ${ago > 2880 ? "warn" : "info"}" style="cursor:default;margin:10px 0"><span class="grow">
      Última notificação recebida <b>${agoTxt}</b> (${esc(last.app || "app")}).<br>
      <span class="faint">Últimos 7 dias: ${created} lançada(s) · ${dup} repetida(s) descartada(s) · ${ignored.length} aviso(s) com valor ignorado(s)</span></span></div>
    <details ${location.hash.includes("avisos") ? "" : ""}><summary>Últimos avisos recebidos do celular</summary>
      ${inbox.slice(0, 8).map((n) => `<div class="bank" style="grid-template-columns:1fr auto">
        <div><b>${esc(n.app || "?")}</b> · ${esc(n.title || "(sem título)")}<br><span class="faint">${esc((n.body || "(sem texto)").slice(0, 120))} · ${new Date(n.received_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span></div>
        <span class="status ${n.result === "created" ? "ok" : n.result === "ignored" ? "bad" : "wait"}">${{ created: "lançado", duplicate: "repetido", ignored: "ignorado", error: "erro" }[n.result] ?? n.result}</span></div>`).join("")}
    </details>
    ${ignored.length ? `<details id="avisos" ${location.hash.includes("avisos") ? "open" : ""}><summary>Avisos com valor que não viraram lançamento</summary>
      <p class="faint">Códigos, propagandas e compras recusadas são ignorados de propósito. Se algum destes era um gasto de verdade, toque em <b>Lançar</b>.</p>
      ${ignored.slice(0, 10).map((n) => `<div class="bank" style="grid-template-columns:1fr auto">
        <div><b>${esc(n.title || n.app || "Aviso")}</b><br><span class="faint">${esc((n.body || "").slice(0, 140))} · ${new Date(n.received_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span></div>
        <button class="btn quiet" data-launch="${n.id}">Lançar</button></div>`).join("")}
    </details>` : ""}`;
}

function pollLink() {
  let n = 0;
  const t = setInterval(async () => {
    n++; await loadProfile();
    if (S.profile.whatsapp_phone) { clearInterval(t); toast("WhatsApp conectado!"); if (S.view === "conexoes") viewConnections(); }
    if (n > 90) clearInterval(t);
  }, 5000);
}

function loadScript(src) {
  return new Promise((ok, fail) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Não foi possível carregar o Pluggy."));
    document.head.appendChild(s);
  });
}
async function openPluggy(btn, itemId) {
  await busy(btn, async () => {
    const [{ accessToken, connectorIds }] = await Promise.all([
      call("pluggy", { action: "connect_token", itemId }),
      loadScript("https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js"),
    ]);
    const widget = new window.PluggyConnect({
      connectToken: accessToken,
      includeSandbox: !!CFG.PLUGGY_SANDBOX,
      ...(connectorIds ? { connectorIds } : {}),
      updateItem: itemId,
      onSuccess: async ({ item }) => {
        toast("Banco conectado. Importando os últimos 90 dias…");
        try {
          const r = await call("pluggy", { action: "register_item", itemId: item.id });
          toast(`${r.inserted ?? 0} lançamentos importados.`);
        } catch (e) { toast(e.message); }
        await refresh();
      },
      onError: (e) => toast(e?.message || "A conexão não foi concluída."),
    });
    widget.init();
  });
}

// ------------------------------------------------------------------ roteamento
async function refresh() {
  await Promise.all([loadCore(), loadTxs()]);
  await render();
}
async function render() {
  if (!S.session) return renderAuth();
  if (!S.profile?.onboarded) return renderOnboarding();
  S.view = (location.hash.slice(1).split("?")[0] || "inicio");
  if (!VIEWS.some(([k]) => k === S.view)) S.view = "inicio";
  ({ inicio: viewHome, lancamentos: viewTxs, orcamento: viewBudget, conexoes: viewConnections })[S.view]();
  document.title = `${VIEWS.find(([k]) => k === S.view)[1]} · Fôlego`;
}
window.addEventListener("hashchange", async () => {
  if (!S.session || !S.profile?.onboarded) return;
  if (!location.hash.startsWith("#lancamentos") && S.filter.cycle !== 0) { S.filter.cycle = 0; await loadTxs(); }
  render();
});

let channel = null;
function subscribeRealtime() {
  channel?.unsubscribe();
  channel = sb.channel("tx-" + S.session.user.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${S.session.user.id}` }, () => {
      clearTimeout(subscribeRealtime._t);
      subscribeRealtime._t = setTimeout(() => { if (!$("#sheet-root").innerHTML) refresh(); }, 800);
    }).subscribe();
}

async function boot() {
  $("#app").innerHTML = `<main class="main"><div class="skeleton"></div></main>`;
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (!S.session) return renderAuth();
  try {
    await loadProfile();
    if (S.profile.onboarded) { await Promise.all([loadCore(), loadTxs()]); subscribeRealtime(); }
    await render();
  } catch (e) {
    console.error(e);
    $("#app").innerHTML = `<main class="auth"><div class="auth-card"><h1>Sem conexão</h1><p class="lede">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Tentar de novo</button></div></main>`;
  }
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") { S.session = session; return renderAuth("newpass"); }
  if (event === "SIGNED_IN" && !S.session) boot();
  if (event === "SIGNED_OUT") { S.session = null; S.profile = null; channel?.unsubscribe(); renderAuth(); }
});
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window._installPrompt = e; });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.profile?.onboarded) refresh(); });
if ("serviceWorker" in navigator) {
  // quando uma versão nova do app é publicada, recarrega sozinho uma vez
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !window._reloadedForUpdate) { window._reloadedForUpdate = true; location.reload(); }
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
    .then((reg) => { reg.update(); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update(); }); })
    .catch(() => {});
}

if (CFG.SUPABASE_URL.includes("SEU-PROJETO")) {
  $("#app").innerHTML = `<main class="auth"><div class="auth-card"><div class="brand"><span class="brand-mark">F</span>Fôlego</div><h1>Configure o app</h1><p class="lede">Preencha <b>web/config.js</b> com a URL e a anon key do seu projeto Supabase (veja o README).</p></div></main>`;
} else boot();
