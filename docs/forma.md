# Forma — peso, medidas, calorias, água e treino

Módulo **Saúde e Corpo** do Life OS. App separado do Fôlego (ícone próprio no celular), mas com o mesmo login e o mesmo banco: fica em
`https://eduardoakira-gif.github.io/folego/forma/` e funciona igual no computador.

## O problema

Saber, todo dia, se o corpo está indo na direção certa, sem depender só da balança (que oscila 1–2 kg com água e sal) e sem anotar tudo à mão.

## O que ele faz

| Pedido | Como ficou |
|---|---|
| Fotos de corpo inteiro no cadastro, de frente e de lado, tirando as medidas | A altura vira régua. A foto de frente mede a **largura** de pescoço, peito, cintura, quadril, coxa e braço; a de lado, a **profundidade** nos mesmos pontos. Frente + lado viram o **contorno** de cada região (elipse). A leitura roda **no celular** (MediaPipe), a foto não precisa sair do aparelho. |
| Calcular a diferença entre um e outro | Diferença entre fotos (relação lado/frente por região) e entre avaliações: tabela com **vs anterior** e **vs início**, mais fotos lado a lado. |
| Postar o peso todo dia | Campo único na tela Hoje. Uma pesagem por dia (a última vale). |
| Ver se ganhou ou perdeu | **Tendência** (média móvel exponencial) separa gordura de oscilação de água; ritmo em kg/semana e data prevista para a meta. |
| Peso ideal pela altura | Faixa saudável (IMC 18,5–24,9) e ponto médio (IMC 22), com aviso de que IMC não separa músculo de gordura. |
| Quantas calorias preciso perder | Gasto (Mifflin-St Jeor × atividade), déficit pelo ritmo escolhido, meta diária, total de kcal até a meta e semanas estimadas. |
| Foto da comida → calorias | IA (Claude) lê a foto e devolve itens com gramas, kcal e macros. Você ajusta os gramas e tudo recalcula antes de salvar. Também aceita texto ("2 ovos e pão na chapa"). |
| Lembrar de beber água | Notificação a cada X horas dentro da janela escolhida, com botões **+250 ml / +500 ml** direto na notificação. Pula se você acabou de beber ou já bateu a meta. |
| Perguntar se treinou e fez cardio | Notificação no horário escolhido com **Treinei / Não treinei**; respondendo, chega a pergunta do cardio. Tudo sem abrir o app. Também na tela Hoje. |

## Melhorias que já entraram nesta versão

- **Segurança na meta calórica**: ritmo limitado a 1% do peso por semana e piso mínimo (TMB; 1.500 kcal homens / 1.200 mulheres). Se o ritmo pedir menos que isso, a meta trava e o app explica.
- **Gasto adaptativo**: após 14+ dias de refeições e pesagens, o app compara o que você comeu com a variação real da tendência e passa a usar o **seu** gasto, não a fórmula.
- **Calibração com fita métrica**: informe a cintura (ou outra medida) com fita uma vez; o app aprende o desvio da foto e corrige as próximas.
- **Indicadores além do peso**: % de gordura (método da Marinha), massa magra, cintura ÷ altura (melhor preditor de risco que o IMC), cintura ÷ quadril.
- **Conferência visual**: a silhueta e as linhas amarelas mostram onde cada medida foi tirada; avisos se a pose atrapalhar (braço colado, pernas juntas, corpo cortado).
- **"Pede atenção"**: perda rápida demais, platô, ganho, proteína baixa, água atrás do ritmo, comer abaixo do mínimo, hora de nova avaliação, recomposição (cintura cai com peso estável).
- **Repetir refeição**, proteína como meta, sequência de dias treinando, exportar CSV, apagar tudo (LGPD), tema claro/escuro.

## Entidades e eventos

| Tabela | Conteúdo |
|---|---|
| `forma_perfil` | sexo, nascimento, altura, atividade, peso meta, ritmo, lembretes, calibração |
| `forma_pesagens` | uma por dia |
| `forma_avaliacoes` | medidas (cm), medidas brutas, fita, larguras/profundidades, indicadores, fotos |
| `forma_refeicoes` | itens com gramas e macros, origem (foto/texto/manual), confiança |
| `forma_agua`, `forma_checkins` | água por registro; treino/cardio por dia |
| `forma_push`, `forma_lembretes_log`, `forma_ia_uso` | aparelhos, log de lembretes, limite diário de IA |
| `forma_dia` (view) | resumo diário para dashboard e outros módulos |

Eventos na tabela `events` do Fôlego: `health.weight.*`, `health.body_scan.*`, `health.meal.*`, `health.workout_checkin.*`. Assim o futuro módulo **Metas** reage a "cintura −5 cm" e o **Financeiro** pode cruzar gastos de delivery com calorias, sem ler tabelas internas.

Segurança: RLS em tudo, fotos em bucket privado por usuário, chaves só no servidor, botões das notificações com token assinado que vale 20 h.

## Arquivos

```
supabase/migrations/003_forma_saude.sql      banco, RLS, storage, eventos
supabase/functions/forma-ia/                 foto/texto → calorias (Claude)
supabase/functions/forma-lembretes/          água, pesagem, treino (Web Push)
web/forma/                                   o app (sem build), usa o mesmo web/config.js do Fôlego
tests/forma-calc.test.mjs                    testes dos cálculos e da medição (node tests/forma-calc.test.mjs)
```

A publicação usa os mesmos workflows do Fôlego: *Publicar site* sobe `web/forma/` junto, e *Publicar servidor* aplica a migration, publica `forma-ia` e `forma-lembretes` e agenda os lembretes a cada 15 min no próprio banco (pg_cron), como o resumo semanal.

## Secrets novos (Settings → Secrets and variables → Actions → Secrets)

| Nome | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | chave pública das notificações |
| `VAPID_PRIVATE_KEY` | chave privada das notificações |
| `VAPID_SUBJECT` | `mailto:` + seu e-mail |
| `FORMA_IA_LIMITE_DIA` | opcional, padrão 40 fotos de comida por dia |

`ANTHROPIC_API_KEY`, `CRON_SECRET`, `APP_ORIGINS` e as Variables `SUPABASE_URL`/`SUPABASE_ANON_KEY` são as mesmas do Fôlego. Um novo par de chaves VAPID pode ser gerado em *Ajustes → Configuração do servidor* dentro do Forma.

**Custo extra**: zero de infraestrutura. A IA da comida custa centavos por foto, com limite diário.

## Limites honestos

- Medida por foto erra 2–4 cm por região; o valor está na **comparação** (mesma pose, mesma distância). Com uma medida de fita, cai bastante.
- Calorias por foto erram mais em fritura, molho e porções escondidas; sempre confira antes de salvar.
- No iPhone, notificações só com o app instalado na Tela de Início, e sem os botões dentro da notificação (toque abre o app no ponto certo).
- Lembretes rodam pelo agendador do GitHub, que pode atrasar alguns minutos em horário de pico.
- Referências populacionais, não orientação médica.

## Próximas melhorias (em ordem de impacto)

1. **WhatsApp do Fôlego** entender `peso 88,4`, `bebi 500`, `treinei`, e foto de prato. Um canal só para tudo.
2. **Balança Bluetooth/Google Fit/Health Connect**: peso e passos entrando sozinhos.
3. **Resumo semanal** junto ao do Fôlego (segunda 8h45): tendência, cintura, média de kcal, dias treinados.
4. **Metas** do Life OS: "cintura abaixo de 94 cm até março" com marcos automáticos.
5. **Guia de pose ao vivo** na câmera (contorno e contagem regressiva) para fotos mais padronizadas.
6. **Código de barras** de produtos (Open Food Facts) para lanches embalados.
