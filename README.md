# Fôlego — assistente financeiro (site + app + WhatsApp)

> Neste repositório também vive o **Forma** (peso, medidas por foto, calorias, água e treino), em `web/forma/`. É um app separado com o mesmo login. Veja [docs/forma.md](docs/forma.md).

Cada pessoa cria sua conta com e-mail e senha. Os gastos entram sozinhos (Open Finance, notificação do celular, extrato importado ou mensagem no WhatsApp), já categorizados. O orçamento é montado a partir da renda, e a tela principal responde uma pergunta: **quanto posso gastar por dia até o próximo salário**.

## Site, app e celular são a mesma coisa

Não existem duas versões. O app é o próprio site instalado na tela inicial (PWA). No Android ele aparece como app pelo Chrome; no iPhone, pelo Safari, em *Adicionar à Tela de Início*.

- **Mesmo login**, com e-mail e senha, no computador, no Android e no iPhone.
- **Mesmos dados.** Tudo fica no mesmo banco de dados. Um gasto lançado pelo WhatsApp aparece no app do celular e no site do computador em segundos, sem recarregar a página.
- **Atualização única.** Quando você publica uma mudança, ela chega a todos os aparelhos. Não tem loja de apps nem atualização manual.

## Como as peças se encaixam

```
 Banco ──Open Finance──► Pluggy ──webhook──► [pluggy-webhook] ──────┐
 Notificação do celular ─MacroDroid/Atalhos─► [ingest-notification] ─┤
 Extrato OFX/CSV ──────────── app ──────────► [import-statement] ────┤
 WhatsApp ◄────────► Meta Cloud API ◄───────► [whatsapp-webhook] ────┼──► Postgres (Supabase)
 Site / app instalado (PWA) ─────────────────────────────────────────┘    transações, categorias, regras,
                                                                           histórico, eventos, RLS
```

| Pasta | O que é |
|---|---|
| `supabase/migrations/` | Banco completo: tabelas, segurança por usuário (RLS), calendário de dias úteis, relatórios, histórico e eventos |
| `supabase/functions/` | Servidor: Open Finance, importação de extrato, notificações, bot do WhatsApp, resumo semanal |
| `web/` | Site/app (HTML+CSS+JS, sem build) |
| `.github/workflows/` | Publicação automática: site no GitHub Pages, servidor no Supabase |
| `deploy.sh` | Alternativa: publicar o servidor pelo seu computador |
| `tests/` | Testes de leitura de notificações, extratos, categorização e deduplicação |

## O que ele faz

**Dia do pagamento flexível.** Duas regras de pagamento:
- **Dia fixo**: todo dia 5, todo dia 20. Em mês curto usa o último dia (dia 31 em fevereiro vira 28).
- **N-ésimo dia útil**: por exemplo o 5º dia útil. Pula fins de semana e os dias sem expediente bancário: feriados nacionais, Carnaval, Sexta-feira Santa e Corpus Christi, calculados automaticamente para qualquer ano.
- Opção de contar o sábado como dia útil (regra da CLT). A tela mostra os próximos 3 pagamentos para você conferir com o holerite.
- Em 2026 o 5º dia útil cai em: 08/01, 06/02, 06/03, 08/04, 08/05, 08/06, 07/07, 07/08, 08/09, 07/10, 09/11 e 07/12.

**Ciclo pelo salário, não pelo mês.** As contas vão do dia do pagamento até a véspera do próximo. O salário que cai até 3 dias antes da data (o banco às vezes credita na véspera) conta para o ciclo novo.

**Orçamento a partir da renda.** Com R$ 4.500, o orçamento inicial fica assim (tudo editável):

| Categoria | Valor |
|---|---|
| Moradia (30%) | R$ 1.350 |
| Mercado | R$ 540 |
| Restaurantes e delivery | R$ 270 |
| Transporte | R$ 360 |
| Contas e serviços | R$ 315 |
| Saúde | R$ 225 |
| Educação | R$ 180 |
| Lazer | R$ 225 |
| Compras | R$ 225 |
| Assinaturas | R$ 135 |
| Cuidados pessoais | R$ 90 |
| Reserva e investimentos (10%) | R$ 450 |
| Outros | R$ 135 |

**O que ainda vai sair.** A tela inicial e o comando `fatura` no WhatsApp mostram o que já está comprometido:
- **Faturas abertas** dos cartões, com aviso quando faltam 10 dias para o vencimento.
- **Parcelas a vencer**: quanto cai nos próximos 3 meses e quanto falta para quitar tudo.
- **Contas recorrentes** detectadas sozinhas.

**Categorias de entrada e saída.** São 14 de saída e 6 de entrada. A ordem de categorização é:
1. Regras da própria pessoa.
2. Cerca de 150 estabelecimentos brasileiros conhecidos.
3. Categoria informada pelo banco.
4. "Outros".

**Aprende com correções.** Ao trocar a categoria de um lançamento, a opção *"Sempre usar esta categoria para X"* vale também para os próximos. Uma categoria escolhida à mão nunca é sobrescrita.

**Nada contado duas vezes.**
- A notificação chega primeiro e entra como *aguardando banco*. Quando o banco confirma, as duas viram um registro só.
- Pagamento de fatura, aplicação, resgate e cofrinho são *Entre contas*: não entram como gasto nem como renda.
- **Pix entre seus próprios bancos** (do Nubank para o Itaú, por exemplo) é reconhecido pelo mesmo CPF dos dois lados, ou pelo par saída/entrada de mesmo valor em contas suas. Não vira gasto em um banco e renda no outro.
- **Extrato importado** não duplica o que já veio do Open Finance. Reimportar o mesmo arquivo não faz nada. Duas compras iguais no mesmo dia continuam sendo duas.
- **Compra pendente cancelada** pelo banco some sozinha depois de 5 dias. Se ela voltar confirmada, mantém a categoria que você escolheu.

**Importar extrato (OFX ou CSV).** Funciona com qualquer banco: no app do banco, exporte o extrato ou a fatura e importe em *Lançamentos → Importar extrato*. O app reconhece o formato do Nubank (conta e fatura), CSV com `;` ou `,`, valores em reais e arquivos com acentuação antiga. É o caminho gratuito para quem não tem Open Finance.

**Horário de Brasília em tudo.** Uma compra às 23h fica no dia certo, inclusive quando o banco manda só a data.

**Gastos da empresa (reembolso).** Qualquer lançamento pode ser marcado como *empresa*. No WhatsApp basta incluir a palavra: *"gastei 89 almoço cliente empresa"*.

**Avisos sem ruído.** Um aviso aos 80% e outro aos 100% de cada categoria, no máximo uma vez por ciclo. Mais o resumo semanal na segunda às 8h45.

**Histórico e eventos.**
- Nenhum lançamento é apagado de verdade.
- Toda alteração fica registrada (antes e depois).
- Cada transação gera um evento (`transaction.created`, `.updated` e `.deleted`) na tabela `events`. É assim que os próximos módulos do Life OS (Metas, Agenda, Tarefas) vão reagir ao financeiro sem depender das tabelas internas.

### Comandos do WhatsApp

| Mensagem | Resposta |
|---|---|
| `resumo` | Quanto pode gastar até o salário (com a data), por dia, top categorias, faturas próximas |
| `hoje` / `semana` / `mês` | Gastos do período por categoria |
| `orçamento` | Barras de cada categoria |
| `fatura` | Faturas abertas, parcelas a vencer e contas recorrentes |
| `últimos` | Últimos 12 lançamentos |
| `recorrentes` | Assinaturas e contas fixas detectadas |
| `reembolso` | Gastos da empresa a receber |
| `gastei 45 mercado` / `uber 23,50` | Lança na hora e diz quanto já usou da categoria |
| `recebi 300 freela` | Lança uma entrada |
| `desfazer` | Apaga o último lançamento feito pelo WhatsApp |
| Pergunta livre (*"quanto gastei com uber esse mês?"*) | Respondida pela IA com os seus dados (opcional; limite de 30 por dia por pessoa) |

---

## Quanto custa

Valores de outubro de 2026. Preços em dólar convertidos a cerca de R$ 5,50 (o câmbio varia).

### Só você usando (uso pessoal)

| Item | Custo |
|---|---|
| Supabase (banco, login, servidor), plano gratuito | R$ 0 |
| Hospedagem do site (GitHub Pages) | R$ 0 |
| Open Finance via **Meu Pluggy** (grátis por tempo indeterminado para as suas próprias contas, até 5 conexões) | R$ 0 |
| WhatsApp: respostas aos seus comandos (1.000 por mês grátis por número) | R$ 0 |
| WhatsApp: avisos e resumo semanal (~15 por mês × R$ 0,035) | ~R$ 0,50/mês |
| Chip pré-pago para o número do assistente (não pode estar em uso no WhatsApp comum) | ~R$ 15, uma vez |
| IA para perguntas livres (opcional; ~R$ 0,06 por pergunta) | R$ 0 a R$ 10/mês |
| Domínio próprio (opcional, ex. `folego.com.br`) | ~R$ 40/ano |
| **Total** | **≈ R$ 0 a R$ 10 por mês** |

O plano gratuito do Supabase pausa o projeto após uma semana sem uso. O uso diário e o resumo semanal o mantêm ativo; se pausar, basta reativar no painel. Esse plano também não tem backup automático.

### Aberto para outras pessoas

| Item | Custo |
|---|---|
| Supabase Pro (backup diário, sem pausa, até 100 mil usuários) | US$ 25/mês ≈ R$ 140 |
| WhatsApp: acima de 1.000 respostas por mês, e cada aviso | R$ 0,035 por mensagem |
| IA (o limite diário por pessoa controla o custo) | ~R$ 0,06 por pergunta |
| **Sem Open Finance** (notificações + WhatsApp + extrato importado) | **≈ R$ 150 a R$ 250/mês** |
| **Open Finance para todos** via Pluggy (plano Dados, a partir de R$ 2.500/mês, 15 dias de teste grátis) | **≈ R$ 2.700/mês** |

O Meu Pluggy não pode ser usado comercialmente nem para contas de terceiros. Por isso o servidor tem a opção `PLUGGY_ALLOWED_EMAILS`: só os e-mails listados veem a conexão automática, e os demais usuários usam extrato e notificações. Antes de contratar Open Finance para outras pessoas, vale cotar outros agregadores.

Sobre o WhatsApp: a cobrança das respostas (acima de 1.000 por mês) e dos avisos dentro da janela de 24h começou em 1º/10/2026, segundo parceiros oficiais da Meta. Confira no painel da Meta ao ativar.

---

## Colocando no ar

Tudo é feito pelo navegador, sem instalar nada no computador. São 4 fases independentes, e depois da primeira você já usa o app.

| Fase | O que liga | Tempo |
|---|---|---|
| 1. App no ar | Login, orçamento, lançamentos, importar extrato, app no celular | 30–40 min |
| 2. Bancos automáticos | Open Finance grátis pelo Meu Pluggy | 15 min |
| 3. WhatsApp | Relatórios e lançamentos por mensagem, avisos, resumo semanal | 30 min + aprovação da Meta |
| 4. Notificações do Android | Gasto registrado no instante da compra | 10 min |

Ao longo das fases você vai juntar algumas chaves. Deixe um bloco de notas aberto e anote cada uma no momento em que aparecer; no fim, elas vão para o cofre do GitHub (*Secrets*).

---

### FASE 1 — App no ar

#### 1.1 Criar o banco de dados (Supabase)

1. Entre em **supabase.com** → **Start your project** e faça login com o **GitHub**.
   O e-mail desta conta importa: o envio de e-mail gratuito do Supabase só manda mensagens (confirmação de cadastro, troca de senha) para o e-mail da sua conta, no máximo 2 por hora. Crie sua conta no app com esse mesmo e-mail.
2. **New project**:
   - *Name*: `folego`.
   - *Database Password*: clique em **Generate a password**, copie e anote como `SUPABASE_DB_PASSWORD`.
   - *Region*: **South America (São Paulo)**.
   - Clique em **Create new project** e espere uns 2 minutos.
3. Anote mais três informações:
   - **Project ref**: *Project Settings → General → Project ID* (16 letras, ex.: `abcdefghijklmnop`). Anote como `SUPABASE_PROJECT_REF`.
   - **Chave pública**: *Project Settings → API Keys → Publishable key* (começa com `sb_publishable_`). Se o projeto mostrar a aba *Legacy*, a `anon` também serve. Anote como `SUPABASE_ANON_KEY`.
   - **Token de acesso**: clique no seu avatar (canto superior direito) → *Account preferences → Access Tokens → Generate new token*, com o nome `github`. Anote como `SUPABASE_ACCESS_TOKEN`; ele só aparece uma vez.
4. Em **Authentication → URL Configuration**:
   - *Site URL*: `https://eduardoakira-gif.github.io/folego/`
   - *Redirect URLs* → **Add URL**: o mesmo endereço.

#### 1.2 Criar o repositório (GitHub)

1. Acesse **github.com/new**:
   - *Repository name*: `folego`.
   - Visibilidade **Public**. O GitHub Pages gratuito exige isso, e o código não contém nenhuma senha: as chaves ficam no cofre.
   - Não marque "Add a README".
   - **Create repository**.
2. Guarde as chaves **antes** de enviar os arquivos. Assim a primeira publicação já funciona.
   Em **Settings → Secrets and variables → Actions**:

   Aba **Secrets** → *New repository secret* (um de cada vez, com o nome exatamente assim):

   | Nome | Valor |
   |---|---|
   | `SUPABASE_PROJECT_REF` | o Project ID |
   | `SUPABASE_DB_PASSWORD` | a senha do banco |
   | `SUPABASE_ACCESS_TOKEN` | o token gerado |
   | `APP_ORIGINS` | `https://eduardoakira-gif.github.io` (sem barra no final) |

   Aba **Variables** → *New repository variable*:

   | Nome | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://SEU-PROJECT-ID.supabase.co` |
   | `SUPABASE_ANON_KEY` | a chave pública (`sb_publishable_…`) |
   | `PLUGGY_SANDBOX` | `false` |

3. Em **Settings → Pages → Build and deployment → Source**, escolha **GitHub Actions**.
4. Envie os arquivos:
   - Descompacte o `folego.zip` e abra a pasta `finbot`.
   - Mostre os arquivos ocultos. No Mac, aperte `Cmd + Shift + .` no Finder; no Windows, vá em *Exibir → Mostrar → Itens ocultos*. Precisam aparecer a pasta `.github` e o arquivo `.gitignore`.
   - Na página do repositório, clique em **uploading an existing file**.
   - Selecione **tudo o que está dentro** de `finbot` (inclusive `.github`) e arraste para a página.
   - Clique em **Commit changes**.
   - Confira se a lista do repositório mostra `.github`, `supabase`, `web` e `README.md`.
5. Abra a aba **Actions**. Se aparecer um botão para habilitar workflows, clique nele. Duas publicações começam sozinhas:
   - **Publicar servidor** (2 a 4 min): cria o banco, as funções e os agendamentos.
   - **Publicar site** (1 min).

   As duas precisam terminar com ✅ verde. Se alguma ficar ❌ vermelha, veja "Se algo der errado" no fim deste guia.

#### 1.3 Primeiro acesso

1. Abra **https://eduardoakira-gif.github.io/folego/**.
2. **Criar conta** com o mesmo e-mail da conta do Supabase → confirme pelo link que chega no e-mail → entre.
3. Preencha:
   - Renda: **4.500,00**.
   - Pagamento: **Dia útil → 5**.
   - Confira as próximas datas (07/out, 09/nov, 07/dez) e clique em **Montar meu orçamento**.
4. **Segurança, enquanto for só você**: no Supabase, em *Authentication → Sign In / Providers*, desligue **Allow new users to sign up**. Ninguém mais consegue criar conta, e você liga de novo quando quiser abrir para outras pessoas.
5. **Instale no celular**: abra o mesmo endereço no celular e entre.
   - Android (Chrome): menu ⋮ → **Instalar app**.
   - iPhone (Safari): **Compartilhar → Adicionar à Tela de Início**.
6. **Primeiro teste**: no app do seu banco, exporte o extrato em **OFX**. No Fôlego, vá em **Lançamentos → Importar extrato**.

---

### FASE 2 — Bancos automáticos (Meu Pluggy, grátis)

1. Em **meu.pluggy.ai**, crie a conta e conecte cada banco e cartão. A autorização acontece no app do próprio banco (Open Finance).
   O consentimento do Open Finance tem prazo de validade (normalmente 12 meses). Quando vencer, o app avisa *Conexão expirou* e você renova em 1 minuto.
2. Em **dashboard.pluggy.ai**, crie a conta (pode ser o mesmo e-mail) e uma *Application* chamada `Fôlego`.
   - Copie o **Client ID** e o **Client Secret**.
   - Se aparecer um aviso de "15 dias de teste", ignore: o Meu Pluggy é gratuito sem prazo.
3. Na aplicação, vá em **Customização → Conectores**, ative **Seleção personalizada**, busque **MeuPluggy** e ative.
4. No GitHub, em *Secrets*, crie:

   | Nome | Valor |
   |---|---|
   | `PLUGGY_CLIENT_ID` | Client ID |
   | `PLUGGY_CLIENT_SECRET` | Client Secret |
   | `PLUGGY_CONNECTOR_IDS` | `200` |
   | `PLUGGY_ALLOWED_EMAILS` | o e-mail com que você entra no app |
   | `PLUGGY_WEBHOOK_SECRET` | uma senha longa inventada (ex.: 30 letras e números aleatórios) |

5. Em **Actions → Publicar servidor**, clique em **Run workflow** e espere o ✅.
6. No app, vá em **Conexões → Conectar banco**, escolha **MeuPluggy**, entre e autorize. O app importa os últimos 90 dias.

O Meu Pluggy atualiza uma vez por dia. Para registrar o gasto na hora, use a Fase 4.

---

### FASE 3 — WhatsApp

Você vai precisar de uma conta no Facebook. Para o número próprio do assistente (passo 3.6), também de um chip novo que não esteja em uso no WhatsApp.

#### 3.1 Criar o app na Meta

1. Em **developers.facebook.com → Meus apps → Criar app**:
   - Caso de uso: **Outro**.
   - Tipo: **Empresa**.
   - Nome: `Fôlego`.
   - Vincule a um portfólio empresarial (ou crie um com seu nome).
2. No painel do app, em **WhatsApp**, clique em **Configurar**.
3. Em **WhatsApp → Configuração da API** (*API Setup*):
   - A Meta já dá um **número de teste**. Anote o **Phone number ID** como `WA_PHONE_NUMBER_ID`.
   - No campo **Para** (*To*), adicione o **seu WhatsApp pessoal** e confirme o código. O número de teste só conversa com até 5 números cadastrados aqui.
   - Anote o próprio número de teste (só dígitos, com 55) para a variável `WHATSAPP_NUMBER`.
4. Em **Configurações do app → Básico → Chave secreta do app → Mostrar**: anote como `WA_APP_SECRET`.

#### 3.2 Token permanente

O token que aparece na tela de API expira em 24h, então crie um permanente.

1. Em **business.facebook.com → Configurações → Usuários → Usuários do sistema → Adicionar**: nome `folego`, função **Administrador**.
2. **Atribuir ativos**:
   - o app `Fôlego` (controle total);
   - a conta do WhatsApp (controle total).
3. **Gerar token**:
   - Escolha o app `Fôlego` e a validade **Nunca**.
   - Marque as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
   - Anote como `WA_ACCESS_TOKEN`.

#### 3.3 Guardar e publicar

No GitHub, em *Secrets*, crie:

| Nome | Valor |
|---|---|
| `WA_PHONE_NUMBER_ID` | o Phone number ID |
| `WA_ACCESS_TOKEN` | o token permanente |
| `WA_APP_SECRET` | a chave secreta do app |
| `WA_VERIFY_TOKEN` | uma palavra inventada (ex.: `folego-verifica-2026`) |
| `WA_NOTIFY_TEMPLATE` | `aviso_financeiro` |
| `CRON_SECRET` | outra senha longa inventada |

Na aba *Variables*, crie:

| Nome | Valor |
|---|---|
| `WHATSAPP_NUMBER` | o número do assistente (só dígitos, com 55) |

Depois, rode **Publicar servidor** e **Publicar site** em *Actions → Run workflow*.

#### 3.4 Ligar o WhatsApp ao servidor

1. No app da Meta, vá em **WhatsApp → Configuração → Webhook → Editar**:
   - *URL de callback*: `https://SEU-PROJECT-ID.supabase.co/functions/v1/whatsapp-webhook`
   - *Token de verificação*: o mesmo `WA_VERIFY_TOKEN`.
   - Clique em **Verificar e salvar**.
2. Em **Campos do webhook**, encontre **messages** e clique em **Assinar**.
3. No Fôlego, vá em **Conexões → WhatsApp → Gerar código** e toque em **Enviar pelo WhatsApp**. A resposta deve ser "✅ Pronto! Seu WhatsApp está conectado".
4. Teste com as mensagens `resumo` e `gastei 12 café`.

#### 3.5 Avisos e resumo semanal

As respostas aos seus comandos já funcionam. Para o assistente mandar mensagem por conta própria (avisos de orçamento e o resumo de segunda às 8h45):

1. Em **WhatsApp Manager → Modelos de mensagem → Criar modelo**:
   - Categoria **Utilidade**.
   - Nome `aviso_financeiro`.
   - Idioma **Português (BR)**.
   - Corpo: `Atualização das suas finanças: {{1}}`, com um exemplo para o `{{1}}` (ex.: "Mercado chegou a 80% do orçamento").
   - Envie. A aprovação costuma levar de minutos a algumas horas.
2. Em **WhatsApp Manager → Configurações de pagamento**, cadastre um cartão. Segundo parceiros oficiais da Meta, isso é exigido desde outubro de 2026. No seu uso, o gasto fica abaixo de R$ 1 por mês.

#### 3.6 Número próprio (quando quiser sair do número de teste)

1. Em **WhatsApp Manager → Números de telefone → Adicionar**, informe o número do chip novo, o nome de exibição `Fôlego` e confirme o código por SMS ou ligação.
   O número não pode estar ativo no WhatsApp. Se estiver, apague a conta do WhatsApp nesse número antes.
2. Atualize o secret `WA_PHONE_NUMBER_ID` e a variável `WHATSAPP_NUMBER` e rode os dois workflows.
3. No app, gere um novo código em **Conexões → WhatsApp** e envie para o número novo.

#### 3.7 Perguntas livres com IA (opcional)

1. Em **console.anthropic.com**, crie uma API key e coloque US$ 5 de crédito, que duram meses no uso pessoal.
2. Crie o secret `ANTHROPIC_API_KEY` e rode **Publicar servidor**.

Agora você pode perguntar coisas como *"quanto gastei com uber esse mês?"*.

---

### FASE 4 — Notificações do Android (gasto na hora)

1. Instale o **MacroDroid** pela Play Store. Abra, aceite a permissão de **acesso a notificações** e desative a otimização de bateria para ele.
2. No Fôlego, vá em **Conexões → Notificações do celular → Copiar token**.
3. No MacroDroid, crie uma macro em **Adicionar macro**:
   - **Gatilho**: *Notificação → Notificação recebida* → selecione os apps dos seus bancos e cartões → *Qualquer conteúdo*.
   - **Ação**: *Web / Interação → Requisição HTTP*:
     - Método **POST**.
     - URL: `https://SEU-PROJECT-ID.supabase.co/functions/v1/ingest-notification`
     - Cabeçalho: `X-Ingest-Token` com o token copiado.
     - Tipo de conteúdo: `application/json`.
     - Corpo: `{"app":"[not_app_name]","title":"[not_title]","text":"[notification]"}`
   - Salve com o nome `Fôlego`.
4. No Fôlego, toque em **Testar**. Deve aparecer "Funcionou!" e um lançamento de R$ 1,00, que você pode excluir.

O app lê o texto da notificação, ignora códigos de verificação, propagandas e compras recusadas, e registra o gasto como *aguardando banco*. Quando o Open Finance confirma, os dois viram um lançamento só.

No iPhone a Apple não permite ler notificações de outros apps. Lá, use o app **Atalhos → Automação → Transação**, que captura compras feitas com Apple Pay. O caminho está em *Conexões*.

---

### Onde vai cada chave (resumo)

| Nome | Tipo no GitHub | Fase | De onde vem |
|---|---|---|---|
| `SUPABASE_PROJECT_REF` | Secret | 1 | Supabase → Settings → General |
| `SUPABASE_DB_PASSWORD` | Secret | 1 | Senha gerada ao criar o projeto |
| `SUPABASE_ACCESS_TOKEN` | Secret | 1 | Supabase → Account → Access Tokens |
| `APP_ORIGINS` | Secret | 1 | `https://eduardoakira-gif.github.io` |
| `SUPABASE_URL` | Variable | 1 | `https://PROJECT-ID.supabase.co` |
| `SUPABASE_ANON_KEY` | Variable | 1 | Supabase → Settings → API Keys (publishable) |
| `PLUGGY_SANDBOX` | Variable | 1 | `false` |
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` | Secret | 2 | dashboard.pluggy.ai → Application |
| `PLUGGY_CONNECTOR_IDS` | Secret | 2 | `200` |
| `PLUGGY_ALLOWED_EMAILS` | Secret | 2 | Seu e-mail de login no app |
| `PLUGGY_WEBHOOK_SECRET` | Secret | 2 | Senha inventada |
| `WA_PHONE_NUMBER_ID` | Secret | 3 | Meta → WhatsApp → API Setup |
| `WA_ACCESS_TOKEN` | Secret | 3 | Token permanente (usuário do sistema) |
| `WA_APP_SECRET` | Secret | 3 | Meta → Configurações do app → Básico |
| `WA_VERIFY_TOKEN` | Secret | 3 | Palavra inventada (a mesma no webhook da Meta) |
| `WA_NOTIFY_TEMPLATE` | Secret | 3 | `aviso_financeiro` |
| `CRON_SECRET` | Secret | 3 | Senha inventada |
| `WHATSAPP_NUMBER` | Variable | 3 | Número do assistente com 55 |
| `ANTHROPIC_API_KEY` | Secret | 3 (opcional) | console.anthropic.com |

Toda vez que mudar um *Secret*, rode **Publicar servidor**. Toda vez que mudar uma *Variable*, rode **Publicar site**.

### Se algo der errado

| Sintoma | Causa provável e solução |
|---|---|
| ❌ em *Publicar servidor*, no passo "link" ou "Banco de dados" | Nome ou valor errado em `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` ou `SUPABASE_ACCESS_TOKEN`. Corrija o secret e rode de novo. |
| ❌ em *Publicar site* | *Settings → Pages → Source* não está em **GitHub Actions**. |
| O site abre escrito "Configure o app" | Faltam as *Variables* `SUPABASE_URL` / `SUPABASE_ANON_KEY`. Crie e rode **Publicar site**. |
| "Email address not authorized" ao criar conta | Use o mesmo e-mail da sua conta do Supabase, ou desligue temporariamente *Confirm email* em *Authentication → Sign In / Providers → Email*. |
| O app atualizado não aparece no celular | Feche e abra o app. Ele busca a versão nova ao abrir. |
| "Conexão automática com bancos não está disponível" | `PLUGGY_ALLOWED_EMAILS` diferente do e-mail de login, ou falta rodar *Publicar servidor* depois de criar os secrets. |
| O MeuPluggy não aparece no widget | O conector não foi ativado em *Customização → Conectores* no dashboard do Pluggy. |
| O WhatsApp não responde | Confira 3 coisas: o campo **messages** assinado no webhook; seu número na lista *Para* do número de teste; o `WA_ACCESS_TOKEN` permanente. |
| A Meta não aceita o webhook ("não foi possível validar") | O `WA_VERIFY_TOKEN` digitado na Meta é diferente do secret, ou faltou rodar *Publicar servidor*. |
| A notificação não vira lançamento | No MacroDroid, confira o cabeçalho `X-Ingest-Token`. Em *Conexões → Testar*, a mensagem de erro diz o motivo. |
| Ver o erro detalhado de uma função | Supabase → **Edge Functions** → escolha a função → **Logs**. |

---

## Segurança e dados

- Cada usuário só acessa os próprios dados: RLS em todas as tabelas.
- As chaves do Pluggy, da Meta e do banco ficam só no servidor (secrets). O site tem apenas a anon key, que é pública por design.
- O webhook do WhatsApp confere a assinatura da Meta.
- O webhook do Pluggy exige um segredo e nunca confia no conteúdo do aviso: ele busca os dados direto na API.
- Uma conexão bancária só é aceita se foi criada pelo próprio usuário.
- O WhatsApp só é vinculado com um código gerado no app logado, válido por 15 minutos.
- *Excluir conta e dados* revoga as conexões e apaga tudo (LGPD).
- O app nunca guarda dados financeiros no cache do celular.

**Antes de abrir para outras pessoas:** publique a política de privacidade e os termos de uso (exigidos pela LGPD e pela Meta) e use um domínio próprio.

## Testes

```bash
deno run --allow-env tests/statement.test.ts   # extratos OFX/CSV e datas dos bancos
deno run --allow-env tests/dedupe.test.ts      # notificação ↔ banco ↔ extrato, Pix entre contas
npx esbuild tests/parse.test.ts --bundle --platform=node --outfile=/tmp/t.cjs && node /tmp/t.cjs
cd supabase/functions && deno check */index.ts
```

## Próximos passos sugeridos

- **Metas** ("juntar R$ 10 mil até dezembro"): um módulo próprio do Life OS, que lê os eventos do financeiro e calcula quanto guardar por ciclo.
- **Exportar os gastos da empresa** direto para a planilha de reembolso.
- **Foto de recibo no WhatsApp** → lançamento.
