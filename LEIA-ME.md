# Monitor de investimentos (gratuito, sem IA)

Acompanha renda fixa (Tesouro Direto), ações, FIIs, ETFs, cripto e dólar.
Calcula sinais de compra e venda por regras transparentes, mostra tudo num app
para o celular e manda alertas push. Custo: zero.

**Como funciona**

- O GitHub roda o `monitor.py` a cada 30 minutos no horário do pregão.
- O script busca dados públicos (Banco Central, Tesouro Transparente, Yahoo Finance),
  calcula os sinais e grava `docs/data.json`.
- O app (`docs/index.html`) fica publicado no GitHub Pages e lê esse arquivo.
- Quando algo importante acontece, o script envia um alerta pelo app **ntfy**.

## Instalação (uns 15 minutos, tudo pelo navegador)

1. **Crie uma conta no GitHub** em github.com (grátis).
2. **Crie um repositório público**: botão "New", nome `monitor-investimentos`, marque *Public*, crie.
   (Público é o que deixa o GitHub Pages e o agendador gratuitos e sem limite.)
3. **Envie os arquivos**: na página do repositório, "Add file" → "Upload files" e arraste
   o conteúdo da pasta descompactada (`monitor.py`, `config.json`, `requirements.txt`,
   `state.json`, `LEIA-ME.md` e a pasta `docs`). Clique em "Commit changes".
4. **Crie o agendador**: a pasta `.github` costuma ficar oculta e não sobe arrastando.
   Clique em "Add file" → "Create new file", digite o nome
   `.github/workflows/monitor.yml`, cole o conteúdo do arquivo `monitor.yml` e salve.
5. **Instale o ntfy no celular** (Play Store ou App Store). Toque em "+" e assine um
   tópico com nome difícil de adivinhar, por exemplo `alertas-invest-8k2q7x`.
   Qualquer pessoa que souber o nome consegue ler os alertas, então não use algo óbvio.
6. **Guarde o tópico no GitHub**: Settings → Secrets and variables → Actions →
   aba *Secrets* → "New repository secret". Nome `NTFY_TOPIC`, valor = seu tópico.
7. **Ligue o site**: Settings → Pages → *Source: Deploy from a branch* →
   branch `main`, pasta `/docs` → Save. Em 1 ou 2 minutos aparece o endereço,
   algo como `https://seu-usuario.github.io/monitor-investimentos/`.
8. (Opcional) Para o alerta abrir o app ao tocar: Settings → Secrets and variables →
   Actions → aba *Variables* → nome `PAGES_URL`, valor = endereço do passo 7.
9. **Primeira execução**: aba Actions → "Monitor de Investimentos" → "Run workflow".
   Em 2 a 3 minutos o `docs/data.json` é atualizado com dados reais.
10. **No celular**, abra o endereço do site e use "Adicionar à tela inicial"
    (Safari: botão compartilhar; Chrome: menu ⋮). Ele passa a abrir como um app.

## Personalizar (editando `config.json` no próprio GitHub)

- **Ativos**: adicione ou remova linhas em `ativos`. Ações, FIIs e ETFs brasileiros
  levam `.SA` no fim (ex.: `ITSA4.SA`). Classes aceitas pelo app:
  `Ações`, `FIIs`, `ETFs`, `Cripto e câmbio`. Use `"dividendos": true` para considerar proventos.
- **Alertas**: `variacao_dia_pct` (padrão 4%), ligar ou desligar avisos de compra e venda,
  `tesouro_percentil_atrativo` (padrão 80) e o limite de alertas por rodada.
- **Horários**: o `cron` no `monitor.yml` está em UTC (Brasília = UTC−3).

## Como os sinais são calculados

Cada ativo soma ou perde pontos:

| Regra | Pontos |
|---|---|
| Preço acima / abaixo da média de 200 dias | +1 / −1 |
| Média de 50 dias acima / abaixo da de 200 | +1 / −1 |
| RSI abaixo de 30 / acima de 70 | +1 / −1 |
| Retorno de 12 meses acima / abaixo do CDI | +1 / −1 |
| Proventos de 12 meses ≥ 85% do CDI (FIIs e pagadoras) | +1 |

3 ou mais = **Compra**, 1 a 2 = viés de alta, −1 a 0 = neutro, −2 = viés de baixa,
−3 ou menos = **Venda**. O risco (baixo, médio, alto) vem da volatilidade de 12 meses.

No Tesouro, o título ganha **Taxa alta** quando a taxa de hoje supera 80% das taxas
daquele tipo nos últimos 5 anos. Tesouro Selic aparece como **Reserva**.

## Limites que você precisa saber

- São regras fixas, não previsão. Funcionam melhor como filtro para estudar do que
  como ordem para executar. Sinais técnicos erram com frequência, principalmente em
  mercado de lado.
- Dados gratuitos têm atraso (até ~30 min neste agendamento; o GitHub às vezes atrasa
  execuções em horários de pico).
- O Yahoo Finance pode falhar de vez em quando; o app avisa e mantém o resto.
- Se o repositório ficar 60 dias sem atividade manual, o GitHub pode pausar o agendador.
  Basta entrar na aba Actions e reativar.
- Nada aqui é recomendação de investimento.
