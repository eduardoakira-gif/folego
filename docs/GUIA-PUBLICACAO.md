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
