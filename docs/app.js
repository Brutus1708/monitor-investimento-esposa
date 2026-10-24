"use strict";
/*
 * Monitor de Investimentos — app web sem dependências.
 * Lê docs/data.json (gerado pelo monitor.py). Carteira, favoritos e preferências
 * ficam só neste aparelho (localStorage).
 */

// =============================================================== utilidades
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ok = v => v != null && isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const store = {
  get(k, padrao) { try { const v = localStorage.getItem("mi:" + k); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } },
  set(k, v) { try { localStorage.setItem("mi:" + k, JSON.stringify(v)); } catch (e) { /* armazenamento indisponível */ } },
  del(k) { try { localStorage.removeItem("mi:" + k); } catch (e) {} },
};

function fmt(v, c = 2) { return ok(v) ? Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }) : "—"; }
function casasPreco(v) { return ok(v) && Math.abs(v) < 10 ? 4 : 2; }
function moeda(v, m = "R$", c) { return ok(v) ? `${m} ${fmt(v, c ?? (m === "R$" ? 2 : casasPreco(v)))}` : "—"; }
function pct(v, c = 2, sinal = false) { return ok(v) ? (sinal && v > 0 ? "+" : "") + fmt(v, c) + "%" : "—"; }
function reais(v) { return moeda(v, "R$", 2); }
function reaisCurto(v) {
  if (!ok(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return "R$ " + fmt(v / 1e6, 1) + " mi";
  if (a >= 1e4) return "R$ " + fmt(v / 1e3, 1) + " mil";
  return reais(v);
}
function setaVar(v, c = 2) {
  if (!ok(v)) return `<span class="var">—</span>`;
  const cls = v > 0 ? "up" : v < 0 ? "down" : "";
  const seta = v > 0 ? "▲" : v < 0 ? "▼" : "•";
  return `<span class="var ${cls}"><span aria-hidden="true">${seta}</span> ${pct(Math.abs(v), c)}<span class="sr">${v > 0 ? " de alta" : v < 0 ? " de queda" : ""}</span></span>`;
}
function num(str) {
  if (str == null) return NaN;
  const s = String(str).trim().replace(/\s|R\$|%/g, "");
  if (!s) return NaN;
  // aceita 1.234,56 · 1.000 · 1234.56
  const n = s.includes(",") ? s.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  return Number(n);
}
function dataCurta(ms, ano) {
  const d = new Date(ms);
  return d.toLocaleDateString("pt-BR", ano ? { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" } : { day: "2-digit", month: "short", timeZone: "UTC" }).replace(".", "");
}
function parseBR(s) {
  // "24/10/2026 18:16" no horário de Brasília (UTC-3)
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(s || "");
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], (+m[4] || 0) + 3, +m[5] || 0) : null;
}
function haQuanto(ms) {
  if (!ms) return "";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}
function uid() { return Math.random().toString(36).slice(2, 10); }

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}

// =============================================================== ícones
const IC = {
  inicio: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
  mercado: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
  rf: '<path d="M3 21h18"/><path d="M5 21V10M9.5 21V10M14.5 21V10M19 21V10"/><path d="M2 10h20L12 3z"/>',
  carteira: '<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/><path d="M6 6V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
  ferramentas: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  voltar: '<path d="m15 18-6-6 6-6"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  escudo: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  alvo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  alta: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  baixa: '<path d="m3 7 6 6 4-4 8 8"/><path d="M14 17h7v-7"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h2M16 15v3"/>',
  troca: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
  pessoa: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  livro: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2.5zM20 19v3H6"/>',
  sino: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  celular: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  sinal: '<path d="M4 20V14M10 20V9M16 20V4"/>',
  externo: '<path d="M14 4h6v6M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  baixar: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>',
  subir: '<path d="M12 15V3m0 0L8 7m4-4 4 4M4 21h16"/>',
  editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  porco: '<path d="M19 9c1 1 2 2.5 2 4.5 0 1-1 1.5-2 1.5l-1 3h-3l-.5-1.5h-5L9 18H6l-1-3.5C3.8 13.5 3 12 3 10.5 3 7.5 6.5 5 11 5c1.5 0 3 .3 4.2.8L18 4v3.6c.4.4.7.9 1 1.4z"/><path d="M15 10h.01"/>',
};
function ic(nome, extra = "") { return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${IC[nome] || ""}</svg>`; }

// =============================================================== conhecimento fixo
const TABS = {
  inicio: { nome: "Início", titulo: "Início" },
  mercado: { nome: "Mercado", titulo: "Mercado" },
  rf: { nome: "Renda fixa", titulo: "Renda fixa" },
  carteira: { nome: "Carteira", titulo: "Minha carteira" },
  ferramentas: { nome: "Ferramentas", titulo: "Ferramentas" },
};

const SINAIS = {
  "COMPRA": { t: "Compra", cls: "b-buy", ordem: 5, cor: "var(--buy)" },
  "VIÉS DE ALTA": { t: "Viés de alta", cls: "b-buy", ordem: 4, cor: "var(--buy-2)" },
  "NEUTRO": { t: "Neutro", cls: "b-neutral", ordem: 3, cor: "var(--neutral-2)" },
  "VIÉS DE BAIXA": { t: "Viés de baixa", cls: "b-sell", ordem: 2, cor: "var(--sell-2)" },
  "VENDA": { t: "Venda", cls: "b-sell", ordem: 1, cor: "var(--sell)" },
  "ATRATIVO": { t: "Taxa alta", cls: "b-buy", ordem: 5 },
  "RESERVA": { t: "Reserva", cls: "b-info", ordem: 4 },
};
const ORDEM_SINAIS = ["VENDA", "VIÉS DE BAIXA", "NEUTRO", "VIÉS DE ALTA", "COMPRA"];
function badge(s) { const m = SINAIS[s] || { t: s, cls: "b-neutral" }; return `<span class="badge ${m.cls}">${esc(m.t)}</span>`; }

const CLASSES = ["Renda fixa", "Ações", "FIIs", "ETFs", "Cripto e câmbio", "Outros"];
const COR_CLASSE = { "Renda fixa": "var(--s1)", "Ações": "var(--s2)", "FIIs": "var(--s3)", "ETFs": "var(--s4)", "Cripto e câmbio": "var(--s5)", "Outros": "var(--s6)" };
const RISCO_N = { "baixo": 1, "médio": 2, "alto": 3 };

const PERFIS = {
  conservador: {
    nome: "Conservador", risco: 1,
    desc: "Prioriza não perder dinheiro. Aceita ganhar menos em troca de estabilidade.",
    meta: { "Renda fixa": 80, "Ações": 5, "FIIs": 10, "ETFs": 5, "Cripto e câmbio": 0 },
  },
  moderado: {
    nome: "Moderado", risco: 2,
    desc: "Aceita algumas oscilações para buscar um retorno maior no médio prazo.",
    meta: { "Renda fixa": 55, "Ações": 15, "FIIs": 15, "ETFs": 10, "Cripto e câmbio": 5 },
  },
  arrojado: {
    nome: "Arrojado", risco: 3,
    desc: "Aceita quedas fortes no caminho buscando o maior retorno no longo prazo.",
    meta: { "Renda fixa": 30, "Ações": 30, "FIIs": 15, "ETFs": 17, "Cripto e câmbio": 8 },
  },
};

const TIPOS_TESOURO = {
  "Tesouro Selic": { grupo: "Selic", idx: "Selic", desc: "Acompanha a taxa Selic e quase não oscila. É o título indicado para reserva de emergência e dinheiro de curto prazo." },
  "Tesouro Prefixado": { grupo: "Prefixado", idx: "pre", desc: "Você sabe exatamente quanto vai receber no vencimento. Ganha se os juros caírem; se vender antes, o preço pode oscilar." },
  "Tesouro Prefixado com Juros Semestrais": { grupo: "Prefixado", idx: "pre", desc: "Igual ao Prefixado, mas paga juros a cada 6 meses. Bom para quem quer renda periódica." },
  "Tesouro IPCA+": { grupo: "IPCA+", idx: "IPCA", desc: "Protege da inflação: rende IPCA mais uma taxa fixa. Ideal para objetivos de longo prazo. Oscila bastante se vendido antes do vencimento." },
  "Tesouro IPCA+ com Juros Semestrais": { grupo: "IPCA+", idx: "IPCA", desc: "IPCA mais taxa fixa, com juros pagos a cada 6 meses. Bom para complementar renda." },
  "Tesouro Renda+ Aposentadoria Extra": { grupo: "Aposentadoria e educação", idx: "IPCA", desc: "Feito para aposentadoria: você acumula até a data escolhida e depois recebe 240 parcelas mensais corrigidas pela inflação." },
  "Tesouro Educa+": { grupo: "Aposentadoria e educação", idx: "IPCA", desc: "Feito para pagar estudos: acumula até a data escolhida e depois paga 60 parcelas mensais corrigidas pela inflação." },
  "Tesouro IGPM+ com Juros Semestrais": { grupo: "Outros", idx: "IGP-M", desc: "Título antigo corrigido pelo IGP-M mais taxa fixa, com juros semestrais." },
};
function tipoInfo(t) { return TIPOS_TESOURO[t.tipo] || { grupo: "Outros", idx: t.tipo.includes("IPCA") ? "IPCA" : t.tipo.includes("Selic") ? "Selic" : "pre", desc: "" }; }
function taxaTexto(t, curto) {
  const i = tipoInfo(t).idx;
  if (i === "pre") return `${fmt(t.taxa)}%${curto ? "" : " a.a."}`;
  return `${i} + ${fmt(t.taxa)}%`;
}
function nomeTitulo(t) { return `${t.tipo.replace("Tesouro ", "").replace(" com Juros Semestrais", " Semestral").replace(" Aposentadoria Extra", "")} ${t.vencimento.slice(-4)}`; }
function riscoTesouro(t) { return t.risco.startsWith("baixo") ? "baixo" : t.risco.startsWith("médio") ? "médio" : "alto"; }

const GLOSS = {
  selic: ["Selic", "Taxa básica de juros do Brasil, definida pelo Banco Central a cada 45 dias. Serve de referência para quase todos os investimentos de renda fixa e para os juros de empréstimos."],
  cdi: ["CDI", "Taxa que os bancos usam para emprestar entre si; anda colada à Selic. Quando um CDB paga “100% do CDI”, ele rende o mesmo que essa taxa."],
  ipca: ["IPCA (inflação)", "Índice oficial de inflação do Brasil. Mostra quanto os preços subiram nos últimos 12 meses. Investir abaixo dele significa perder poder de compra."],
  juro_real: ["Juro real", "Quanto a Selic rende acima da inflação. Juro real alto favorece a renda fixa."],
  dolar: ["Dólar (PTAX)", "Cotação oficial do dólar calculada pelo Banco Central, usada como referência em contratos."],
  poupanca: ["Poupança", "Com a Selic acima de 8,5% ao ano, a poupança rende 0,5% ao mês mais a TR (cerca de 6,2% ao ano mais TR). É isenta de IR, mas costuma render menos que Tesouro Selic e CDBs de 100% do CDI."],
  rsi: ["RSI (Índice de Força Relativa)", "Vai de 0 a 100 e mede se o preço subiu ou caiu rápido demais nos últimos 14 pregões. Abaixo de 30 indica queda exagerada (pode repicar); acima de 70, alta exagerada (pode corrigir)."],
  mm50: ["Média móvel de 50 dias", "Preço médio dos últimos 50 pregões. Mostra a tendência de curto e médio prazo."],
  mm200: ["Média móvel de 200 dias", "Preço médio dos últimos 200 pregões (cerca de 10 meses). Preço acima dela indica tendência de longo prazo positiva."],
  volatilidade: ["Volatilidade", "Quanto o preço costuma oscilar em um ano. Abaixo de 20% é considerado baixo risco; acima de 35%, alto."],
  dy: ["Proventos em 12 meses (dividend yield)", "Quanto o ativo pagou em dividendos ou rendimentos no último ano, em % do preço atual."],
  ret12: ["Rentabilidade em 12 meses", "Quanto o preço variou no último ano. O app compara com o CDI para saber se valeu mais a pena que a renda fixa."],
  queda_max: ["Distância da máxima", "Quanto o preço está abaixo do maior valor dos últimos 12 meses."],
  score: ["Pontuação do sinal", "Soma das regras do app (de −4 a +5). 3 ou mais = Compra; 1 a 2 = viés de alta; −1 a 0 = neutro; −2 = viés de baixa; −3 ou menos = Venda."],
  percentil: ["Percentil de 5 anos", "Compara a taxa de hoje com todas as taxas do mesmo tipo de título nos últimos 5 anos. Percentil 90 significa que a taxa de hoje é maior que 90% das taxas do período."],
  marcacao: ["Marcação a mercado", "O preço de um título muda todos os dias conforme os juros. Se você vender antes do vencimento, pode ganhar mais ou menos que a taxa contratada. Levando até o vencimento, recebe exatamente a taxa."],
  liquidez: ["Liquidez", "Facilidade de transformar o investimento em dinheiro. O Tesouro Direto tem liquidez diária: o dinheiro cai em até 1 dia útil."],
  ir: ["Imposto de renda na renda fixa", "Tabela regressiva sobre o lucro: 22,5% até 180 dias, 20% até 360 dias, 17,5% até 720 dias e 15% acima disso. LCI, LCA e poupança são isentas para pessoa física (regra atual)."],
  fracionario: ["Mercado fracionário", "Na bolsa, ações são negociadas em lotes de 100. Para comprar menos (de 1 a 99), use o código com F no final, por exemplo PETR4F."],
  fii: ["FII (fundo imobiliário)", "Fundo que investe em imóveis (galpões, shoppings, lajes) ou em títulos do setor. Paga rendimentos mensais, normalmente."],
  etf: ["ETF", "Fundo negociado na bolsa que copia um índice, como o Ibovespa (BOVA11) ou o S&P 500 (IVVB11). Forma simples de diversificar com uma só compra."],
  custodia: ["Taxa de custódia", "A B3 cobra 0,20% ao ano sobre o valor em Tesouro Direto. No Tesouro Selic há isenção até R$ 10 mil (regra atual)."],
  corretora: ["Corretora", "Instituição que dá acesso à bolsa e ao Tesouro Direto. Muitas não cobram taxa para ações e Tesouro."],
  reserva: ["Reserva de emergência", "Dinheiro para imprevistos, guardado em investimento seguro e com resgate rápido. Em geral, de 6 a 12 meses dos seus gastos."],
  rebalancear: ["Rebalancear", "Ajustar a carteira para voltar às proporções planejadas, comprando o que ficou abaixo da meta e reduzindo o que passou dela."],
  preco_medio: ["Preço médio", "Média do que você pagou por um ativo, considerando todas as compras. Serve para calcular seu lucro ou prejuízo."],
  diversificacao: ["Diversificação", "Distribuir o dinheiro em tipos diferentes de investimento para que uma queda isolada não comprometa tudo."],
  juros_semestrais: ["Juros semestrais", "Títulos que pagam parte do rendimento a cada 6 meses, em vez de tudo no vencimento."],
};

// =============================================================== estado
const legadoPerfil = (() => { try { return localStorage.getItem("perfil"); } catch (e) { return null; } })();
const S = {
  data: null,
  origem: null,      // "rede" ou "cache"
  erroCarga: null,
  carregando: false,
  tab: "inicio",
  sheet: null,
  pilha: 0,          // folhas abertas por clique (para o botão Voltar)
  perfil: store.get("perfil", PERFIS[legadoPerfil] ? legadoPerfil : "moderado"),
  tema: store.get("tema", "auto"),
  favs: new Set(store.get("favs", [])),
  carteira: store.get("carteira", []),
  mercado: Object.assign({ q: "", classe: "Todos", sinal: "Todos", ordem: "sinal", soPerfil: false }, store.get("filtroMercado", {}), { q: "" }),
  rf: Object.assign({ grupo: "Todos", ordem: "vencimento" }, store.get("filtroRF", {})),
  graf: Object.assign({ faixa: "6M", mm50: true, mm200: true }, store.get("grafico", {})),
  sim: null,
};
function salvarFiltros() {
  const { q, ...m } = S.mercado;
  store.set("filtroMercado", m);
  store.set("filtroRF", S.rf);
  store.set("grafico", S.graf);
}

// =============================================================== dados
function decodHist(a) {
  const h = a.hist;
  if (h && Array.isArray(h.c) && h.c.length > 1) {
    let t = Date.parse(h.t0 + "T12:00:00Z");
    const datas = [], vals = [];
    h.c.forEach((v, i) => { t += ((h.dt && h.dt[i]) || 0) * 864e5; if (v != null) { datas.push(t); vals.push(v); } });
    return { datas, vals, aprox: false };
  }
  const v = (a.spark || []).filter(x => x != null);
  const fim = Date.now();
  return { datas: v.map((_, i) => fim - (v.length - 1 - i) * 1.4 * 864e5), vals: v, aprox: true };
}
function preparar(d) {
  d.ativos = (d.ativos || []).map(a => ({ ...a, serie: decodHist(a) }));
  d.tes = (d.tesouro && d.tesouro.titulos) || [];
  d.macro = d.macro || {};
  d.idxAtivo = new Map(d.ativos.map(a => [a.ticker, a]));
  d.idxTes = new Map(d.tes.map(t => [t.id, t]));
  d.quando = parseBR(d.atualizado);
  return d;
}
function poupancaAno(m) {
  if (!ok(m.selic_meta)) return null;
  const mensal = m.selic_meta > 8.5 ? 0.005 : Math.pow(1 + m.selic_meta * 0.7 / 100, 1 / 12) - 1;
  return (Math.pow(1 + mensal, 12) - 1) * 100;
}

async function carregar(manual) {
  if (S.carregando) return;
  S.carregando = true;
  $("#btn-refresh").classList.add("spin");
  try {
    const r = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const bruto = await r.json();
    store.set("cache", bruto);
    S.data = preparar(bruto);
    S.origem = "rede";
    S.erroCarga = null;
    if (manual) toast("Dados atualizados");
  } catch (e) {
    S.erroCarga = e.message || String(e);
    if (!S.data) {
      const c = store.get("cache", null);
      if (c) { S.data = preparar(c); S.origem = "cache"; }
    }
    if (manual) toast(S.data ? "Sem conexão. Mostrando os últimos dados salvos." : "Não foi possível carregar os dados.");
  } finally {
    S.carregando = false;
    $("#btn-refresh").classList.remove("spin");
    renderTudo();
  }
}

// =============================================================== carteira
function posicoes() {
  const d = S.data;
  const dolar = (d && d.macro.dolar_ptax) || null;
  return S.carteira.map(p => {
    let valor = null, custo = null, varDia = null, classe = p.classe || "Outros", nome = p.nome, sinal = null, ref = null, moedaAtivo = "R$";
    if (p.tipo === "ativo" && d) {
      ref = d.idxAtivo.get(p.ref);
      const fx = ref && ref.moeda === "US$" ? dolar : 1;
      if (ref) {
        moedaAtivo = ref.moeda;
        valor = ok(fx) ? ref.preco * p.qtd * fx : null;
        custo = ok(fx) && ok(p.pm) ? p.pm * p.qtd * fx : null;
        varDia = ok(ref.var_dia) && ok(valor) ? valor - valor / (1 + ref.var_dia / 100) : null;
        classe = ref.classe; nome = ref.nome; sinal = ref.sinal;
      }
    } else if (p.tipo === "tesouro" && d) {
      ref = d.idxTes.get(p.ref);
      classe = "Renda fixa";
      if (ref) {
        const pu = ok(ref.preco_venda) && ref.preco_venda > 0 ? ref.preco_venda : ref.preco;
        valor = pu * p.qtd; nome = ref.tipo + " " + ref.vencimento.slice(-4); sinal = ref.sinal;
      }
      custo = ok(p.pm) ? p.pm * p.qtd : null;
    } else if (p.tipo === "manual") {
      valor = p.valor; custo = p.custo;
    }
    const resultado = ok(valor) && ok(custo) ? valor - custo : null;
    return { ...p, nome: nome || p.ref || "Investimento", classe, valor, custo, resultado, resPct: ok(resultado) && custo > 0 ? resultado / custo * 100 : null, varDia, sinal, refObj: ref, moedaAtivo };
  });
}
function salvarCarteira() { store.set("carteira", S.carteira); }
function posicaoDe(tipo, ref) { return S.carteira.find(p => p.tipo === tipo && p.ref === ref); }

// =============================================================== componentes visuais
function spark(vals, w = 64, h = 28) {
  const v = (vals || []).filter(ok);
  if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const min = Math.min(...v), max = Math.max(...v), r = max - min || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 3 - (y - min) / r * (h - 6)).toFixed(1)}`).join(" ");
  const cor = v[v.length - 1] >= v[0] ? "var(--buy)" : "var(--sell)";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

function regua(score) {
  // Zonas de −4 a +5: Venda (≤−3), Baixa (−2), Neutro (−1..0), Alta (1..2), Compra (≥3)
  const pos = clamp((score + 4) / 9 * 100, 2, 98);
  const zona = score >= 3 ? 4 : score >= 1 ? 3 : score >= -1 ? 2 : score >= -2 ? 1 : 0;
  const nomes = ["Venda", "Baixa", "Neutro", "Alta", "Compra"];
  const cores = ["var(--sell)", "var(--sell-2)", "var(--neutral-2)", "var(--buy-2)", "var(--buy)"];
  return `<div class="gauge" role="img" aria-label="Pontuação ${score} em uma escala de −4 a +5: ${nomes[zona]}">
    <div class="gauge-wrap"><div class="gauge-track">${cores.map(c => `<i style="background:${c}"></i>`).join("")}</div><span class="gauge-mark" style="left:${pos}%"></span></div>
    <div class="gauge-labels">${nomes.map((n, i) => `<span class="${i === zona ? "on" : ""}">${n}</span>`).join("")}</div>
  </div>`;
}

function faixaTaxa(t) {
  if (!ok(t.taxa_min_5a) || !ok(t.taxa_max_5a) || t.taxa_max_5a <= t.taxa_min_5a) return "";
  const pos = clamp((t.taxa - t.taxa_min_5a) / (t.taxa_max_5a - t.taxa_min_5a) * 100, 0, 100);
  return `<div class="rangebox" aria-label="Taxa atual ${fmt(t.taxa)}% numa faixa de 5 anos entre ${fmt(t.taxa_min_5a)}% e ${fmt(t.taxa_max_5a)}%">
    <div class="range"><i style="left:${pos}%"></i></div>
    <div class="range-l"><span>mín. 5 anos ${fmt(t.taxa_min_5a)}%</span><span>máx. ${fmt(t.taxa_max_5a)}%</span></div>
  </div>`;
}

function rowAtivo(a, opts = {}) {
  const fav = S.favs.has(a.ticker);
  const acima = (RISCO_N[a.risco] || 2) > PERFIS[S.perfil].risco;
  const pos = posicaoDe("ativo", a.ticker);
  return `<button type="button" class="row" data-act="ativo" data-id="${esc(a.ticker)}">
    <span><span class="code">${esc(a.codigo)}${fav ? ic("star") : ""}</span><span class="name">${esc(a.nome)}${opts.classe ? " · " + esc(a.classe) : ""}</span></span>
    ${spark(a.serie.vals.slice(-60))}
    <span class="end"><span class="price">${moeda(a.preco, a.moeda)}</span>${setaVar(a.var_dia)}</span>
    <span class="foot">${badge(a.sinal)}<span class="tag">risco ${esc(a.risco)}</span>${acima ? `<span class="tag warn">acima do seu perfil</span>` : ""}${pos ? `<span class="tag">na carteira</span>` : ""}</span>
  </button>`;
}

function rowTitulo(t) {
  const sel = tipoInfo(t).idx === "Selic";
  return `<button type="button" class="row no-spark" data-act="titulo" data-id="${esc(t.id)}">
    <span><span class="code">${esc(nomeTitulo(t))}</span><span class="name">Vence ${esc(t.vencimento)} · ${fmt(t.anos, 1)} anos</span></span>
    <span class="end"><span class="price">${esc(taxaTexto(t))}</span><span class="var muted">${sel ? "liquidez diária" : "ao ano"}</span></span>
    <span class="foot">${badge(t.sinal)}${ok(t.percentil_5a) && !sel ? `<span class="tag">percentil ${fmt(t.percentil_5a, 0)} em 5 anos</span>` : ""}<span class="tag">mín. ${reais(t.minimo ?? Math.max(30, t.preco / 100))}</span></span>
    ${sel ? "" : faixaTaxa(t)}
  </button>`;
}

function lista(itens, render, vazio) {
  if (!itens.length) return `<div class="empty">${vazio}</div>`;
  return `<div class="list">${itens.map(render).join("")}</div>`;
}

// ---------- gráfico de linhas com cursor e dica
function niceTicks(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const passoBruto = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(passoBruto)));
  const passo = [1, 2, 2.5, 5, 10].map(f => f * mag).find(p => p >= passoBruto) || 10 * mag;
  const ini = Math.floor(min / passo) * passo, fim = Math.ceil(max / passo) * passo;
  const ticks = [];
  for (let v = ini; v <= fim + passo / 2; v += passo) ticks.push(+v.toFixed(10));
  return ticks;
}

const graficos = new Map();
function montarGrafico(el, cfg) {
  graficos.set(el, cfg);
  desenharGrafico(el);
}
function desenharGrafico(el) {
  const cfg = graficos.get(el);
  if (!cfg || !el.isConnected) { graficos.delete(el); return; }
  const { datas, series, fmtV, altura = 220 } = cfg;
  const vis = series.filter(s => s.on !== false);
  const W = Math.max(260, el.clientWidth), H = altura;
  const m = { t: 10, r: 10, b: 26, l: 52 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const todos = vis.flatMap(s => s.vals.filter(ok));
  if (!todos.length || datas.length < 2) { el.innerHTML = `<div class="empty">Sem histórico suficiente para o gráfico.</div>`; return; }
  const ticks = niceTicks(Math.min(...todos), Math.max(...todos));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const n = datas.length;
  const X = i => m.l + (n === 1 ? 0 : i / (n - 1) * pw);
  const Y = v => m.t + ph - (v - y0) / (y1 - y0 || 1) * ph;
  const linhas = vis.map(s => {
    let d = "", pen = false;
    s.vals.forEach((v, i) => { if (!ok(v)) { pen = false; return; } d += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); pen = true; });
    return `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="${s.largura || 2}" stroke-linejoin="round" stroke-linecap="round" ${s.tracejado ? 'stroke-dasharray="4 4"' : ""}/>`;
  }).join("");
  const grid = ticks.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)" stroke-width="1"/>
    <text class="tick" x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(fmtV(t, true))}</text>`).join("");
  const span = datas[n - 1] - datas[0];
  const nx = W < 420 ? 3 : 5;
  const xl = Array.from({ length: nx }, (_, k) => Math.round(k / (nx - 1) * (n - 1))).map((i, k) =>
    `<text class="tick" x="${X(i)}" y="${H - 6}" text-anchor="${k === 0 ? "start" : k === nx - 1 ? "end" : "middle"}">${esc(dataCurta(datas[i], span > 300 * 864e5))}</text>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(cfg.rotulo || "Gráfico")}">
      ${grid}<line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="var(--axis)"/>
      ${linhas}${xl}
      <g class="cursor" style="display:none"><line y1="${m.t}" y2="${m.t + ph}" stroke="var(--muted)" stroke-width="1"/>${vis.map(s => `<circle r="4.5" fill="${s.cor}" stroke="var(--surface)" stroke-width="2"/>`).join("")}</g>
      <rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" class="hit"/>
    </svg><div class="tip"></div>`;
  const svg = el.querySelector("svg"), cur = svg.querySelector(".cursor"), tip = el.querySelector(".tip");
  const mover = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    const i = clamp(Math.round((px - m.l) / pw * (n - 1)), 0, n - 1);
    cur.style.display = "";
    cur.querySelector("line").setAttribute("x1", X(i)); cur.querySelector("line").setAttribute("x2", X(i));
    $$("circle", cur).forEach((c, k) => {
      const v = vis[k].vals[i];
      c.style.display = ok(v) ? "" : "none";
      if (ok(v)) { c.setAttribute("cx", X(i)); c.setAttribute("cy", Y(v)); }
    });
    tip.innerHTML = `<b>${esc(new Date(datas[i]).toLocaleDateString("pt-BR", { timeZone: "UTC" }))}</b><br>` +
      [...vis].reverse().map(s => `<i style="background:${s.cor}"></i>${esc(s.nome)}: ${esc(fmtV(s.vals[i]))}`).join("<br>");
    tip.classList.add("on");
    const tx = X(i) / W * r.width;
    const tw = tip.offsetWidth;
    tip.style.left = clamp(tx + 12 + tw > r.width ? tx - tw - 12 : tx + 12, 0, Math.max(0, r.width - tw)) + "px";
  };
  const sair = () => { cur.style.display = "none"; tip.classList.remove("on"); };
  svg.addEventListener("pointermove", mover);
  svg.addEventListener("pointerdown", mover);
  svg.addEventListener("pointerleave", sair);
  svg.addEventListener("pointercancel", sair);
}
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => graficos.forEach((_, el) => desenharGrafico(el)), 120);
});

function sma(vals, n) {
  const out = new Array(vals.length).fill(null);
  let soma = 0;
  for (let i = 0; i < vals.length; i++) {
    soma += vals[i];
    if (i >= n) soma -= vals[i - n];
    if (i >= n - 1) out[i] = soma / n;
  }
  return out;
}

// =============================================================== cabeçalho, banner, abas
function renderTabbar() {
  $("#tabbar").innerHTML = Object.entries(TABS).map(([k, t]) =>
    `<button type="button" data-act="tab" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ""}>${ic(k)}<span>${t.nome}</span></button>`).join("");
}
function renderTopo() {
  $("#titulo").textContent = TABS[S.tab].titulo;
  const st = $("#status");
  const d = S.data;
  let cls = "", txt = "Carregando…";
  if (d) {
    const idade = d.quando ? Date.now() - d.quando : Infinity;
    if (S.origem === "cache") { cls = "err"; txt = "Offline · dados " + haQuanto(d.quando); }
    else if (idade > 30 * 3600e3) { cls = "warn"; txt = "Desatualizado · " + haQuanto(d.quando); }
    else { cls = idade < 90 * 60e3 ? "ok" : ""; txt = "Atualizado " + haQuanto(d.quando); }
    if ((d.erros || []).length) txt += ` · ${d.erros.length} aviso${d.erros.length > 1 ? "s" : ""}`;
  } else if (S.erroCarga) { cls = "err"; txt = "Sem dados"; }
  st.className = "status " + cls;
  st.querySelector("span").textContent = txt;
  $("#btn-refresh").innerHTML = ic("refresh");
  $('[data-sheet="ajustes"].icon-btn').innerHTML = ic("ajustes");
  $("#sheet .sheet-head [data-act=close]").innerHTML = ic("close");

  const avisos = [];
  if (d && d.demo) avisos.push(["", "Dados de exemplo. Rode o monitor uma vez no GitHub (aba Actions) para ver dados reais."]);
  if (d && S.origem === "cache") avisos.push(["err", "Sem conexão com o servidor. Você está vendo os últimos dados salvos neste aparelho."]);
  $("#banner").innerHTML = avisos.map(([c, t]) => `<div class="banner ${c}">${ic("info")}<span>${esc(t)}</span></div>`).join("");
}

function renderTudo() {
  renderTabbar();
  renderTopo();
  renderView();
  // Folhas de consulta acompanham os dados novos; formulários abertos não são redesenhados
  if (S.sheet && ($("#sheet").hidden || ["ativo", "titulo", "status"].includes(S.sheet.tipo))) renderSheet();
}

function renderView() {
  const v = $("#view");
  if (!S.data) {
    v.innerHTML = S.erroCarga
      ? `<div class="empty" style="margin-top:12px"><b>Não foi possível carregar os dados</b>Confira sua conexão. Se o problema continuar, verifique se o GitHub Pages está ativo e se o monitor já rodou na aba Actions do repositório.<div class="btns"><button class="btn primary" data-act="refresh">Tentar de novo</button></div><p class="small muted">Detalhe técnico: ${esc(S.erroCarga)}</p></div>`
      : `<div class="skel"></div><div class="skel" style="height:120px"></div><div class="skel"></div><div class="skel"></div>`;
    if (S.tab !== "ferramentas") return;
  }
  const telas = { inicio: telaInicio, mercado: telaMercado, rf: telaRF, carteira: telaCarteira, ferramentas: telaFerramentas };
  const foco = document.activeElement && document.activeElement.id === "busca";
  const pos = foco ? document.activeElement.selectionStart : 0;
  v.innerHTML = telas[S.tab]();
  if (S.tab === "mercado") atualizarListaMercado();
  if (foco) { const b = $("#busca"); if (b) { b.focus(); b.setSelectionRange(pos, pos); } }
}

// =============================================================== tela: início
function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}
function telaInicio() {
  const d = S.data, m = d.macro;
  const pp = poupancaAno(m);
  const kpis = [
    ["selic", "Selic", pct(m.selic_meta), "ao ano"],
    ["cdi", "CDI", pct(m.cdi_ano), "ao ano"],
    ["ipca", "Inflação", pct(m.ipca_12m), "12 meses"],
    ["juro_real", "Juro real", pct(m.juro_real), "acima da inflação"],
    ["dolar", "Dólar", moeda(m.dolar_ptax, "R$", 2), m.dolar_ptax_data ? "PTAX " + m.dolar_ptax_data.slice(0, 5) : "PTAX"],
    ["poupanca", "Poupança", ok(pp) ? "≈ " + pct(pp, 1) : "—", "ao ano + TR"],
  ];
  let h = `<div class="sec" style="margin-top:8px"><div class="sec-h"><h2>${saudacao()}!</h2>
      <button class="link" data-act="sheet" data-sheet="perfil">Perfil ${esc(PERFIS[S.perfil].nome.toLowerCase())} ›</button></div>
    <div class="kpis">${kpis.map(([k, n, v, s]) => `<button type="button" class="kpi" data-act="info" data-k="${k}"><span>${n}</span><b class="num">${v}</b><small>${s}</small></button>`).join("")}</div></div>`;

  h += `<section class="sec"><div class="sec-h"><h2>O que fazer agora</h2></div>${planoAcoes().join("")}</section>`;
  h += termometro();

  const comVar = d.ativos.filter(a => ok(a.var_dia));
  const altas = [...comVar].sort((a, b) => b.var_dia - a.var_dia).slice(0, 3).filter(a => a.var_dia > 0);
  const baixas = [...comVar].sort((a, b) => a.var_dia - b.var_dia).slice(0, 3).filter(a => a.var_dia < 0);
  h += `<section class="sec"><div class="sec-h"><h2>Destaques do dia</h2><button class="link" data-act="mercado-ordem" data-ordem="var">Ver todos</button></div>
    <p class="hint">Maiores altas e quedas na última cotação.</p>
    ${lista([...altas, ...baixas], a => rowAtivo(a, { classe: true }), "Sem cotações do dia.")}</section>`;

  const favs = d.ativos.filter(a => S.favs.has(a.ticker));
  if (favs.length) h += `<section class="sec"><div class="sec-h"><h2>Favoritos</h2><button class="link" data-act="mercado-classe" data-classe="Favoritos">Ver todos</button></div>${lista(favs.slice(0, 6), a => rowAtivo(a, { classe: true }), "")}</section>`;

  const hist = d.historico_alertas || [];
  h += `<section class="sec"><div class="sec-h"><h2>Últimos alertas</h2><button class="link" data-act="sheet" data-sheet="ferramenta" data-param="alertas">Como receber</button></div>
    ${hist.length ? `<div class="list"><ul class="alerts">${hist.slice(0, 6).map(a => `<li><b>${esc(a.titulo)}</b><span>${esc(a.msg)}</span><small>${esc(a.quando)}</small></li>`).join("")}</ul></div>`
      : `<div class="empty">Nenhum alerta registrado ainda. Eles aparecem aqui e no celular (app ntfy) quando um ativo muda de sinal, se move forte no dia ou quando uma taxa do Tesouro fica alta.</div>`}</section>`;
  h += disclaimer();
  return h;
}

function planoAcoes() {
  const d = S.data, cards = [];
  const perfil = PERFIS[S.perfil];
  const card = (ico, cls, titulo, texto, botoes) => `<div class="card acao"><span class="ico ${cls}">${ic(ico)}</span><div><h3>${titulo}</h3><p>${texto}</p>${botoes ? `<div class="btns">${botoes}</div>` : ""}</div></div>`;
  const pos = posicoes();

  if (!store.get("perfilQuiz", false)) {
    cards.push(card("pessoa", "", "Descubra seu perfil de investidor", `Responda 5 perguntas rápidas. O app usa o perfil para destacar o que combina com você e sugerir como dividir a carteira. Hoje está como <b>${esc(perfil.nome)}</b>.`,
      `<button class="btn primary" data-act="sheet" data-sheet="ferramenta" data-param="perfil">Fazer o teste</button>`));
  }

  const selic = d.tes.filter(t => tipoInfo(t).idx === "Selic").sort((a, b) => a.anos - b.anos)[0];
  if (selic) {
    cards.push(card("escudo", "", "Reserva de emergência", `Antes de investir em renda variável, tenha de 6 a 12 meses de gastos guardados. O <b>${esc(nomeTitulo(selic))}</b> rende <b>Selic + ${fmt(selic.taxa)}%</b> (≈ ${pct((d.macro.selic_meta || 0) + selic.taxa, 1)} ao ano) e o dinheiro volta em até 1 dia útil.`,
      `<button class="btn" data-act="sheet" data-sheet="ferramenta" data-param="reserva">Calcular minha reserva</button><button class="btn ghost" data-act="titulo" data-id="${esc(selic.id)}">Ver título</button>`));
  }

  const altas = d.tes.filter(t => t.sinal === "ATRATIVO").sort((a, b) => (b.percentil_5a || 0) - (a.percentil_5a || 0));
  if (altas.length) {
    const t = altas[0];
    cards.push(card("alvo", "buy", `${altas.length} título${altas.length > 1 ? "s" : ""} do Tesouro com taxa alta`, `Destaque: <b>${esc(nomeTitulo(t))}</b> paga <b>${esc(taxaTexto(t))}</b>, maior que ${fmt(t.percentil_5a, 0)}% das taxas dos últimos 5 anos. Bom momento para travar juros de longo prazo, se você puder ficar até o vencimento.`,
      `<button class="btn" data-act="rf-grupo" data-grupo="Taxa alta">Ver títulos</button><button class="btn ghost" data-act="simular-titulo" data-id="${esc(t.id)}">Simular</button>`));
  }

  const compra = d.ativos.filter(a => a.sinal === "COMPRA" && (RISCO_N[a.risco] || 2) <= perfil.risco).sort((a, b) => b.score - a.score);
  if (compra.length) {
    cards.push(card("alta", "buy", `${compra.length} sinal${compra.length > 1 ? "is" : ""} de compra no seu perfil`, `${compra.slice(0, 4).map(a => `<b>${esc(a.codigo)}</b>`).join(", ")}${compra.length > 4 ? " e outros" : ""} somaram 3 pontos ou mais nas regras. Abra cada um para ver os motivos antes de decidir.`,
      `<button class="btn" data-act="mercado-sinal" data-sinal="COMPRA">Ver sinais de compra</button>`));
  }

  if (!pos.length) {
    cards.push(card("carteira", "", "Cadastre sua carteira", "Informe o que você já tem para ver resultado, divisão por classe, sugestões de rebalanceamento e avisos quando um ativo seu mudar de sinal. Os dados ficam só neste aparelho.",
      `<button class="btn primary" data-act="sheet" data-sheet="add">Adicionar investimento</button>`));
  } else {
    const ruins = pos.filter(p => p.sinal === "VENDA" || p.sinal === "VIÉS DE BAIXA");
    if (ruins.length) {
      cards.push(card("baixa", "sell", "Revise estes ativos da sua carteira", `${ruins.map(p => `<b>${esc(p.refObj ? p.refObj.codigo || nomeTitulo(p.refObj) : p.nome)}</b>`).join(", ")} ${ruins.length > 1 ? "estão" : "está"} com sinal de baixa ou venda. Não é ordem de venda: confira os motivos e se ainda fazem sentido para o seu objetivo.`,
        `<button class="btn" data-act="tab" data-tab="carteira">Abrir carteira</button>`));
    }
    const desvio = desviosCarteira(pos).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif))[0];
    if (desvio && Math.abs(desvio.dif) >= 10) {
      cards.push(card("sinal", "warn", "Carteira fora da proporção do seu perfil", `Você tem <b>${fmt(desvio.atual, 0)}%</b> em ${esc(desvio.classe)}; a referência para o perfil ${esc(perfil.nome.toLowerCase())} é <b>${fmt(desvio.meta, 0)}%</b>.`,
        `<button class="btn" data-act="tab" data-tab="carteira">Ver rebalanceamento</button>`));
    }
  }
  return cards;
}

function termometro() {
  const at = S.data.ativos;
  if (!at.length) return "";
  const cont = Object.fromEntries(ORDEM_SINAIS.map(s => [s, at.filter(a => a.sinal === s).length]));
  const pos = cont["COMPRA"] + cont["VIÉS DE ALTA"], neg = cont["VENDA"] + cont["VIÉS DE BAIXA"];
  const leitura = pos > neg * 1.5 ? "A maioria dos ativos acompanhados está com tendência positiva pelas regras."
    : neg > pos * 1.5 ? "A maioria dos ativos acompanhados está com tendência negativa pelas regras. Cautela."
      : "Mercado dividido: quantidades parecidas de sinais positivos e negativos.";
  return `<section class="sec"><div class="sec-h"><h2>Termômetro do mercado</h2><button class="link" data-act="sheet" data-sheet="ferramenta" data-param="sinais">Como funciona</button></div>
    <div class="card"><p class="small" style="color:var(--ink-2)">${leitura}</p>
      <div class="stack" role="img" aria-label="${ORDEM_SINAIS.map(s => `${SINAIS[s].t}: ${cont[s]}`).join(", ")}">${ORDEM_SINAIS.filter(s => cont[s]).map(s => `<i style="flex:${cont[s]};background:${SINAIS[s].cor}" title="${SINAIS[s].t}: ${cont[s]}"></i>`).join("")}</div>
      <div class="legend">${ORDEM_SINAIS.map(s => `<span><i style="background:${SINAIS[s].cor}"></i>${SINAIS[s].t} <b>${cont[s]}</b></span>`).join("")}</div>
    </div></section>`;
}

function disclaimer() {
  return `<p class="disclaimer">Sinais calculados por regras automáticas sobre dados públicos (Banco Central, Tesouro Transparente e Yahoo Finance), com atraso de até 30 minutos. Não são recomendação de investimento nem garantia de resultado. Antes de decidir, confira notícias, custos e o seu objetivo para aquele dinheiro.</p>`;
}

// =============================================================== tela: mercado
function telaMercado() {
  const d = S.data, f = S.mercado;
  const classes = ["Todos", "Favoritos", "Ações", "FIIs", "ETFs", "Cripto e câmbio"];
  const nClasse = c => c === "Todos" ? d.ativos.length : c === "Favoritos" ? d.ativos.filter(a => S.favs.has(a.ticker)).length : d.ativos.filter(a => a.classe === c).length;
  const sinais = [["Todos", "Todos os sinais"], ["COMPRA", "Compra"], ["VIÉS DE ALTA", "Viés de alta"], ["NEUTRO", "Neutro"], ["VIÉS DE BAIXA", "Viés de baixa"], ["VENDA", "Venda"]];
  const ordens = [["sinal", "Sinal mais forte"], ["var", "Variação do dia"], ["ret", "Rentabilidade 12 meses"], ["dy", "Proventos 12 meses"], ["queda", "Mais longe da máxima"], ["risco", "Menor risco"], ["nome", "Nome (A–Z)"]];
  return `<div class="filters">
      <label class="search">${ic("busca")}<span class="sr">Buscar ativo</span><input id="busca" type="search" placeholder="Buscar por código ou nome" value="${esc(f.q)}" autocomplete="off" enterkeyhint="search"></label>
      <div class="chips" role="group" aria-label="Classe">${classes.map(c => `<button type="button" class="chip" data-act="m-classe" data-v="${c}" aria-pressed="${f.classe === c}">${c === "Favoritos" ? ic("star", 'style="width:14px;height:14px"') : ""}${c} <span class="n">${nClasse(c)}</span></button>`).join("")}</div>
      <div class="filter-row">
        <select class="select" id="m-sinal" aria-label="Filtrar por sinal">${sinais.map(([v, t]) => `<option value="${v}" ${f.sinal === v ? "selected" : ""}>${t}</option>`).join("")}</select>
        <select class="select" id="m-ordem" aria-label="Ordenar">${ordens.map(([v, t]) => `<option value="${v}" ${f.ordem === v ? "selected" : ""}>${t}</option>`).join("")}</select>
      </div>
      <div class="filter-row"><label class="toggle"><input type="checkbox" id="m-perfil" ${f.soPerfil ? "checked" : ""}> Só o que cabe no perfil ${esc(PERFIS[S.perfil].nome.toLowerCase())}</label><span id="m-count"></span></div>
    </div>
    <div id="m-lista"></div>
    <div class="card" style="margin-top:14px"><h3>Quer acompanhar outro ativo?</h3><p class="small muted">A lista de ativos fica no arquivo config.json do seu repositório. Você pode incluir qualquer ação, FII ou ETF da B3 (com .SA no fim) e criptomoedas.</p><div class="btns"><button class="btn" data-act="sheet" data-sheet="ferramenta" data-param="config">Ver como adicionar</button></div></div>
    ${disclaimer()}`;
}
function filtrarMercado() {
  const d = S.data, f = S.mercado;
  const q = f.q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let it = d.ativos.filter(a => {
    if (f.classe === "Favoritos" && !S.favs.has(a.ticker)) return false;
    if (f.classe !== "Todos" && f.classe !== "Favoritos" && a.classe !== f.classe) return false;
    if (f.sinal !== "Todos" && a.sinal !== f.sinal) return false;
    if (f.soPerfil && (RISCO_N[a.risco] || 2) > PERFIS[S.perfil].risco) return false;
    if (q) {
      const alvo = (a.codigo + " " + a.nome + " " + a.classe).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (!alvo.includes(q)) return false;
    }
    return true;
  });
  const val = (v, def) => ok(v) ? v : def;
  const ord = {
    sinal: (a, b) => b.score - a.score || val(b.ret_12m, -1e9) - val(a.ret_12m, -1e9),
    var: (a, b) => val(b.var_dia, -1e9) - val(a.var_dia, -1e9),
    ret: (a, b) => val(b.ret_12m, -1e9) - val(a.ret_12m, -1e9),
    dy: (a, b) => val(b.dy, -1) - val(a.dy, -1),
    queda: (a, b) => val(a.queda_max_12m, 0) - val(b.queda_max_12m, 0),
    risco: (a, b) => (RISCO_N[a.risco] || 2) - (RISCO_N[b.risco] || 2) || val(a.volatilidade, 99) - val(b.volatilidade, 99),
    nome: (a, b) => a.codigo.localeCompare(b.codigo),
  }[f.ordem] || (() => 0);
  return it.sort(ord);
}
function atualizarListaMercado() {
  const box = $("#m-lista");
  if (!box) return;
  const it = filtrarMercado();
  $("#m-count").textContent = `${it.length} ${it.length === 1 ? "ativo" : "ativos"}`;
  const vazio = S.mercado.classe === "Favoritos" && !S.favs.size
    ? "Você ainda não tem favoritos. Abra um ativo e toque na estrela."
    : `Nenhum ativo encontrado com esses filtros.<div class="btns"><button class="btn" data-act="m-limpar">Limpar filtros</button></div>`;
  box.innerHTML = lista(it, a => rowAtivo(a, { classe: S.mercado.classe === "Todos" || S.mercado.classe === "Favoritos" }), vazio);
}

// =============================================================== tela: renda fixa
const GRUPOS_RF = ["Todos", "Taxa alta", "Selic", "Prefixado", "IPCA+", "Aposentadoria e educação", "Outros"];
function telaRF() {
  const d = S.data, m = d.macro, f = S.rf;
  if (!d.tes.length) return `<div class="empty" style="margin-top:12px"><b>Dados do Tesouro indisponíveis</b>O site do Tesouro não respondeu nas últimas atualizações. O monitor tenta de novo a cada rodada.</div>`;
  const cdbLiq = ok(m.cdi_ano) ? m.cdi_ano * (1 - 0.15) : null;
  const pp = poupancaAno(m);
  let h = `<div class="card" style="margin-top:8px"><h3>Para comparar hoje</h3>
      <p class="small muted">Taxas de compra do Tesouro Direto em ${esc(d.tesouro.data_base || "—")}. Valores ao ano.</p>
      <ul class="kv">
        <li><span>CDI (referência dos CDBs)</span><b>${pct(m.cdi_ano)}</b></li>
        <li><span>CDB 100% do CDI, após IR (mais de 2 anos)</span><b>≈ ${pct(cdbLiq)}</b></li>
        <li><span>Poupança (isenta)</span><b>≈ ${pct(pp)} + TR</b></li>
        <li><span>Inflação em 12 meses</span><b>${pct(m.ipca_12m)}</b></li>
      </ul>
      <div class="btns" style="margin-top:12px"><button class="btn" data-act="sheet" data-sheet="ferramenta" data-param="sim">${ic("calc")}Simular um investimento</button></div>
    </div>`;
  const nGrupo = g => g === "Todos" ? d.tes.length : g === "Taxa alta" ? d.tes.filter(t => t.sinal === "ATRATIVO").length : d.tes.filter(t => tipoInfo(t).grupo === g).length;
  h += `<div class="filters" style="margin-top:10px">
      <div class="chips" role="group" aria-label="Tipo de título">${GRUPOS_RF.filter(g => nGrupo(g) > 0 || g === f.grupo).map(g => `<button type="button" class="chip" data-act="rf-grupo" data-grupo="${g}" aria-pressed="${f.grupo === g}">${g} <span class="n">${nGrupo(g)}</span></button>`).join("")}</div>
      <div class="filter-row"><span>Ordenar por</span><select class="select" id="rf-ordem" aria-label="Ordenar títulos">
        ${[["vencimento", "Tipo e vencimento"], ["taxa", "Maior taxa"], ["percentil", "Taxa mais alta vs. histórico"], ["minimo", "Menor investimento mínimo"]].map(([v, t]) => `<option value="${v}" ${f.ordem === v ? "selected" : ""}>${t}</option>`).join("")}
      </select></div>
    </div>`;
  let it = d.tes.filter(t => f.grupo === "Todos" || (f.grupo === "Taxa alta" ? t.sinal === "ATRATIVO" : tipoInfo(t).grupo === f.grupo));
  if (!it.length) return h + `<div class="empty">Nenhum título neste grupo agora.</div>` + disclaimer();
  if (f.ordem === "vencimento") {
    const porTipo = new Map();
    it.forEach(t => { if (!porTipo.has(t.tipo)) porTipo.set(t.tipo, []); porTipo.get(t.tipo).push(t); });
    h += `<div class="list">${[...porTipo.entries()].map(([tipo, ts]) =>
      `<div class="group-h"><b>${esc(tipo)}</b><span>${esc((TIPOS_TESOURO[tipo] || {}).desc || "")}</span></div>` +
      ts.sort((a, b) => a.anos - b.anos).map(rowTitulo).join("")).join("")}</div>`;
  } else {
    const ord = {
      taxa: (a, b) => b.taxa - a.taxa,
      percentil: (a, b) => (b.percentil_5a ?? -1) - (a.percentil_5a ?? -1),
      minimo: (a, b) => (a.minimo ?? a.preco) - (b.minimo ?? b.preco),
    }[f.ordem];
    h += lista(it.sort(ord), rowTitulo, "");
  }
  h += `<details class="acc"><summary>Como investir no Tesouro Direto</summary><div class="acc-b">${passosTesouro()}</div></details>`;
  return h + disclaimer();
}
function passosTesouro() {
  return `<ol>
    <li>Abra conta em uma corretora ou banco habilitado (muitos não cobram taxa para o Tesouro).</li>
    <li>Transfira o dinheiro para a conta da corretora (PIX ou TED).</li>
    <li>Na área de Tesouro Direto da corretora, escolha o título e o valor. Dá para começar com cerca de R$ 30.</li>
    <li>Confirme. O título fica guardado em seu nome na B3, e você acompanha também pelo app oficial Tesouro Direto.</li>
    <li>Para resgatar antes do vencimento, venda pela corretora: o dinheiro cai em até 1 dia útil, pelo preço do dia (veja “marcação a mercado”).</li>
  </ol><p class="small muted" style="margin-top:8px">Custos: a B3 cobra 0,20% ao ano de custódia (Tesouro Selic isento até R$ 10 mil). IR pela tabela regressiva sobre o lucro. Regras atuais; confira com sua corretora.</p>`;
}

// =============================================================== tela: carteira
function desviosCarteira(pos) {
  const total = pos.reduce((s, p) => s + (ok(p.valor) ? p.valor : 0), 0);
  if (!total) return [];
  const meta = PERFIS[S.perfil].meta;
  return CLASSES.filter(c => c !== "Outros").map(c => {
    const v = pos.filter(p => p.classe === c).reduce((s, p) => s + (ok(p.valor) ? p.valor : 0), 0);
    const atual = v / total * 100, mt = meta[c] || 0;
    return { classe: c, valor: v, atual, meta: mt, dif: atual - mt, ajuste: mt / 100 * total - v };
  });
}
function telaCarteira() {
  const pos = posicoes();
  if (!pos.length) {
    return `<div class="empty" style="margin-top:12px"><b>Sua carteira está vazia</b>Cadastre seus investimentos (ações, FIIs, ETFs, cripto, Tesouro ou outros como CDB) para acompanhar resultado, divisão por classe e receber sugestões de rebalanceamento.
      <div class="btns"><button class="btn primary" data-act="sheet" data-sheet="add">${ic("mais")}Adicionar investimento</button><button class="btn" data-act="importar">${ic("subir")}Importar backup</button></div>
      <p class="small muted" style="margin-top:12px">Os dados ficam só neste aparelho. Ninguém mais vê.</p></div>`;
  }
  const total = pos.reduce((s, p) => s + (ok(p.valor) ? p.valor : 0), 0);
  const custo = pos.reduce((s, p) => s + (ok(p.custo) && ok(p.valor) ? p.custo : 0), 0);
  const comCusto = pos.filter(p => ok(p.custo) && ok(p.valor)).reduce((s, p) => s + p.valor, 0);
  const res = comCusto - custo;
  const hoje = pos.reduce((s, p) => s + (ok(p.varDia) ? p.varDia : 0), 0);
  const semPreco = pos.filter(p => !ok(p.valor));
  let h = `<div class="card" style="margin-top:8px">
      <span class="small muted">Patrimônio estimado</span>
      <div class="hero"><div class="big num">${reais(total)}</div></div>
      <ul class="kv">
        <li><span>Resultado desde a compra</span><b class="${res > 0 ? "up" : res < 0 ? "down" : ""}">${custo ? `${res >= 0 ? "+" : "−"}${reais(Math.abs(res))} (${pct(res / custo * 100, 1, true)})` : "—"}</b></li>
        <li><span>Variação de hoje (bolsa e cripto)</span><b class="${hoje > 0 ? "up" : hoje < 0 ? "down" : ""}">${hoje >= 0 ? "+" : "−"}${reais(Math.abs(hoje))}</b></li>
        <li><span>Investimentos</span><b>${pos.length}</b></li>
      </ul>
      ${semPreco.length ? `<p class="small" style="color:var(--warn);margin-top:8px">${semPreco.length} item(ns) sem cotação nesta atualização não entraram no total.</p>` : ""}
      <div class="btns" style="margin-top:12px"><button class="btn primary" data-act="sheet" data-sheet="add">${ic("mais")}Adicionar</button><button class="btn" data-act="exportar">${ic("baixar")}Backup</button><button class="btn ghost" data-act="importar">${ic("subir")}Importar</button></div>
    </div>`;

  const dv = desviosCarteira(pos);
  const outros = pos.filter(p => p.classe === "Outros").reduce((s, p) => s + (ok(p.valor) ? p.valor : 0), 0);
  const fatias = [...dv.filter(x => x.valor > 0).map(x => [x.classe, x.valor]), ...(outros > 0 ? [["Outros", outros]] : [])];
  h += `<section class="sec"><div class="sec-h"><h2>Divisão da carteira</h2><button class="link" data-act="sheet" data-sheet="perfil">Perfil ${esc(PERFIS[S.perfil].nome.toLowerCase())}</button></div>
    <div class="card">
      <div class="stack" role="img" aria-label="${fatias.map(([c, v]) => `${c}: ${pct(v / total * 100, 0)}`).join(", ")}">${fatias.map(([c, v]) => `<i style="flex:${v};background:${COR_CLASSE[c]}" title="${c}: ${pct(v / total * 100, 1)}"></i>`).join("")}</div>
      <ul class="alloc">${dv.map(x => {
        const ajuste = Math.abs(x.ajuste) < total * 0.02 ? "na medida" : x.ajuste > 0 ? `faltam ${reaisCurto(x.ajuste)} para a referência` : `${reaisCurto(-x.ajuste)} acima da referência`;
        return `<li><i style="background:${COR_CLASSE[x.classe]}"></i><span>${x.classe}</span><span class="v"><b>${pct(x.atual, 0)}</b> · ${reaisCurto(x.valor)}</span><span class="meta">Referência ${x.meta}% · ${ajuste}</span></li>`;
      }).join("")}${outros > 0 ? `<li><i style="background:${COR_CLASSE.Outros}"></i><span>Outros</span><span class="v"><b>${pct(outros / total * 100, 0)}</b> · ${reaisCurto(outros)}</span></li>` : ""}</ul>
      <p class="small muted" style="margin-top:8px">A referência é uma divisão didática para o perfil escolhido, não uma recomendação. Para rebalancear, prefira direcionar novos aportes para as classes abaixo da referência em vez de vender.</p>
    </div></section>`;

  const porClasse = CLASSES.map(c => [c, pos.filter(p => p.classe === c)]).filter(([, ps]) => ps.length);
  h += `<section class="sec"><div class="sec-h"><h2>Seus investimentos</h2></div><div class="list">${porClasse.map(([c, ps]) =>
    `<div class="group-h"><b>${c}</b><span>${reais(ps.reduce((s, p) => s + (ok(p.valor) ? p.valor : 0), 0))}</span></div>` + ps.map(rowPosicao).join("")).join("")}</div></section>`;
  h += `<p class="disclaimer">Valores estimados com a última cotação disponível. Cripto cotada em dólar é convertida pela PTAX. Tesouro avaliado pelo preço de venda do dia. Não substitui o extrato da sua corretora.</p>`;
  return h;
}
function rowPosicao(p) {
  const qtd = p.tipo === "manual" ? "" : `${fmt(p.qtd, p.qtd % 1 ? (p.tipo === "tesouro" ? 2 : 4) : 0)} × ${p.refObj ? (p.tipo === "tesouro" ? reais(p.valor / p.qtd) : moeda(p.refObj.preco, p.moedaAtivo)) : "sem cotação"}`;
  const codigo = p.tipo === "ativo" && p.refObj ? p.refObj.codigo : p.tipo === "tesouro" && p.refObj ? nomeTitulo(p.refObj) : p.nome;
  return `<button type="button" class="row no-spark" data-act="sheet" data-sheet="add" data-param="${esc(p.id)}">
    <span><span class="code">${esc(codigo)}</span><span class="name">${esc(qtd || p.nome)}</span></span>
    <span class="end"><span class="price">${reais(p.valor)}</span>${ok(p.resPct) ? setaVar(p.resPct, 1) : `<span class="var muted">—</span>`}</span>
    ${p.sinal ? `<span class="foot">${badge(p.sinal)}${ok(p.resultado) ? `<span class="tag">${p.resultado >= 0 ? "+" : "−"}${reais(Math.abs(p.resultado))}</span>` : ""}</span>` : ""}
  </button>`;
}

// =============================================================== tela: ferramentas
const FERRAMENTAS = [
  ["sim", "calc", "Simulador de renda fixa", "Quanto rende CDB, Tesouro, LCI e outros, já com IR."],
  ["meta", "alvo", "Meta de investimento", "Quanto investir por mês para chegar lá."],
  ["reserva", "escudo", "Reserva de emergência", "Quanto guardar e onde deixar."],
  ["conversor", "troca", "Conversor de taxas", "Mensal ↔ anual e LCI × CDB."],
  ["perfil", "pessoa", "Descubra seu perfil", "5 perguntas para saber seu perfil."],
  ["sinais", "sinal", "Como os sinais funcionam", "As regras por trás de cada sinal."],
  ["glossario", "livro", "Glossário", "Termos do mercado explicados."],
  ["config", "editar", "Ativos e alertas", "Mudar a lista e as regras dos alertas."],
  ["alertas", "sino", "Alertas no celular", "Receber avisos pelo app ntfy."],
  ["instalar", "celular", "Instalar como app", "Atalho na tela inicial."],
];
function telaFerramentas() {
  return `<div class="tools" style="margin-top:8px">${FERRAMENTAS.map(([k, i, t, s]) =>
    `<button type="button" class="tool" data-act="sheet" data-sheet="ferramenta" data-param="${k}"><span class="ico">${ic(i)}</span><b>${t}</b><span>${s}</span></button>`).join("")}</div>
    <section class="sec"><div class="sec-h"><h2>Preferências</h2></div>
    <div class="card"><div class="btns"><button class="btn" data-act="sheet" data-sheet="perfil">${ic("pessoa")}Perfil: ${esc(PERFIS[S.perfil].nome)}</button><button class="btn" data-act="sheet" data-sheet="ajustes">${ic("ajustes")}Ajustes</button></div></div></section>
    ${disclaimer()}`;
}

// =============================================================== folhas (modais)
function abrirSheet(tipo, param) {
  S.pilha++;
  location.hash = [S.tab, tipo, param].filter(x => x != null && x !== "").map(encodeURIComponent).join("/");
}
function fecharSheet() {
  if (S.pilha > 0) { S.pilha--; history.back(); }
  else location.replace("#" + S.tab);
}
function aplicarRota() {
  const partes = location.hash.slice(1).split("/").map(p => { try { return decodeURIComponent(p); } catch (e) { return p; } });
  const tab = TABS[partes[0]] ? partes[0] : "inicio";
  const mudouTab = tab !== S.tab;
  S.tab = tab;
  S.sheet = partes[1] ? { tipo: partes[1], param: partes.slice(2).join("/") || null } : null;
  if (!S.sheet) S.pilha = 0;
  renderTabbar(); renderTopo();
  if (mudouTab || !$("#view").innerHTML) { renderView(); window.scrollTo(0, 0); }
  renderSheet();
}

function renderSheet() {
  const sh = $("#sheet"), bd = $("#backdrop");
  if (!S.sheet) {
    if (!sh.hidden) { sh.hidden = true; bd.hidden = true; document.body.classList.remove("sheet-open"); graficos.forEach((_, el) => { if (sh.contains(el)) graficos.delete(el); }); if (S.voltarFoco && S.voltarFoco.isConnected) S.voltarFoco.focus(); }
    return;
  }
  const abrindo = sh.hidden;
  const fn = { ativo: sheetAtivo, titulo: sheetTitulo, ajustes: sheetAjustes, perfil: sheetPerfil, add: sheetAdd, ferramenta: sheetFerramenta, info: sheetInfo, status: sheetStatus }[S.sheet.tipo];
  const r = fn && (S.data || ["ajustes", "perfil", "ferramenta", "info", "status"].includes(S.sheet.tipo)) ? fn(S.sheet.param) : null;
  if (!r) { if (S.data || !["ativo", "titulo", "add"].includes(S.sheet.tipo)) { S.sheet = null; location.replace("#" + S.tab); } return; }
  if (abrindo) S.voltarFoco = document.activeElement;
  const corpo = $("#sheet-body");
  const rolagem = abrindo ? 0 : corpo.scrollTop;
  $("#sheet-title").textContent = r.titulo;
  $("#sheet-actions").innerHTML = r.acoes || "";
  corpo.innerHTML = r.html;
  sh.hidden = false; bd.hidden = false;
  document.body.classList.add("sheet-open");
  corpo.scrollTop = rolagem;
  if (r.depois) r.depois(corpo);
  if (abrindo) $("#sheet .sheet-head [data-act=close]").focus();
}

// ---------- ficha do ativo
function sheetAtivo(ticker) {
  const a = S.data.idxAtivo.get(ticker);
  if (!a) return null;
  const fav = S.favs.has(a.ticker);
  const pos = posicoes().find(p => p.tipo === "ativo" && p.ref === a.ticker);
  const m = S.data.macro;
  const cdi = m.cdi_ano;
  const stat = (k, rot, val, sub) => `<button type="button" class="stat" data-act="info" data-k="${k}"><span>${rot} ${ic("info")}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</button>`;
  const rsiTxt = !ok(a.rsi) ? "" : a.rsi < 30 ? "Caiu rápido demais" : a.rsi > 70 ? "Subiu rápido demais" : "Faixa normal";
  const volTxt = !ok(a.volatilidade) ? "" : a.volatilidade < 20 ? "Oscila pouco" : a.volatilidade < 35 ? "Oscilação média" : "Oscila muito";
  const acima = (RISCO_N[a.risco] || 2) > PERFIS[S.perfil].risco;
  const codigoBusca = encodeURIComponent(a.codigo + (a.classe === "Cripto e câmbio" ? "" : " ações"));
  const html = `
    <div class="card">
      <div class="small muted">${esc(a.nome)} · ${esc(a.classe)}</div>
      <div class="hero"><div><div class="big num">${moeda(a.preco, a.moeda)}</div>${setaVar(a.var_dia)} <span class="small muted">no dia · cotação de ${esc(a.data)}</span></div>${badge(a.sinal)}</div>
    </div>

    <div class="card">
      <div class="chart-top">
        <div class="seg" role="group" aria-label="Período">${["1M", "3M", "6M", "1A", "2A"].map(f => `<button type="button" data-act="g-faixa" data-v="${f}" aria-pressed="${S.graf.faixa === f}">${f}</button>`).join("")}</div>
        <div class="series-toggles" role="group" aria-label="Linhas do gráfico">
          <button type="button" data-act="g-mm" data-v="mm50" aria-pressed="${S.graf.mm50}"><i style="background:var(--s2)"></i>Média 50d</button>
          <button type="button" data-act="g-mm" data-v="mm200" aria-pressed="${S.graf.mm200}"><i style="background:var(--s3)"></i>Média 200d</button>
        </div>
      </div>
      <div class="chart" id="g-ativo"></div>
      <div class="chart-foot" id="g-foot"></div>
    </div>

    <section class="sec"><div class="sec-h"><h2>Sinal: ${esc(SINAIS[a.sinal] ? SINAIS[a.sinal].t : a.sinal)}</h2><button class="link" data-act="info" data-k="score">${a.score > 0 ? "+" : ""}${a.score} pontos</button></div>
      <div class="card">${regua(a.score)}
        <ul class="reasons">${(a.motivos || []).map(r => `<li class="${r.tipo === "+" ? "p" : r.tipo === "-" ? "m" : "n"}"><b aria-label="${r.tipo === "+" ? "ponto a favor" : r.tipo === "-" ? "ponto contra" : "observação"}">${r.tipo === "+" ? "+" : r.tipo === "-" ? "−" : "i"}</b><span>${esc(r.texto)}</span></li>`).join("") || `<li class="n"><b>i</b><span>Histórico insuficiente para todas as regras.</span></li>`}</ul>
        ${acima ? `<p class="small" style="color:var(--warn);margin-top:10px">Risco ${esc(a.risco)}: acima do perfil ${esc(PERFIS[S.perfil].nome.toLowerCase())}. Se comprar, use uma parte pequena da carteira.</p>` : ""}
      </div></section>

    <section class="sec"><div class="sec-h"><h2>Indicadores</h2></div>
      <div class="stats">
        ${stat("ret12", "12 meses", pct(a.ret_12m, 1, true), ok(a.ret_12m) && ok(cdi) ? (a.ret_12m > cdi ? "Acima do CDI (" + pct(cdi, 1) + ")" : "Abaixo do CDI (" + pct(cdi, 1) + ")") : "")}
        ${stat("queda_max", "Da máxima 12m", pct(a.queda_max_12m, 1), ok(a.max_12m) ? "Máx. " + moeda(a.max_12m, a.moeda) : "")}
        ${stat("volatilidade", "Volatilidade", pct(a.volatilidade, 0), volTxt)}
        ${stat("rsi", "RSI 14", fmt(a.rsi, 0), rsiTxt)}
        ${stat("mm50", "Média 50d", moeda(a.sma50, a.moeda), ok(a.sma50) ? (a.preco > a.sma50 ? "Preço acima" : "Preço abaixo") : "")}
        ${stat("mm200", "Média 200d", moeda(a.sma200, a.moeda), ok(a.sma200) ? (a.preco > a.sma200 ? "Preço acima" : "Preço abaixo") : "")}
        ${stat("dy", "Proventos 12m", ok(a.dy) ? pct(a.dy, 1) : "—", ok(a.dy) && ok(cdi) ? (a.dy >= cdi * 0.85 ? "Perto ou acima do CDI" : "Abaixo do CDI") : "Sem dados ou não paga")}
        ${stat("queda_max", "Mín. 12 meses", moeda(a.min_12m, a.moeda), "")}
      </div></section>

    <section class="sec"><div class="sec-h"><h2>Na sua carteira</h2></div>
      <div class="card">${pos ? `<ul class="kv"><li><span>Quantidade</span><b>${fmt(pos.qtd, pos.qtd % 1 ? 4 : 0)}</b></li><li><span>Preço médio</span><b>${moeda(pos.pm, a.moeda)}</b></li><li><span>Valor atual</span><b>${reais(pos.valor)}</b></li><li><span>Resultado</span><b class="${pos.resultado > 0 ? "up" : pos.resultado < 0 ? "down" : ""}">${ok(pos.resultado) ? (pos.resultado >= 0 ? "+" : "−") + reais(Math.abs(pos.resultado)) + " (" + pct(pos.resPct, 1, true) + ")" : "—"}</b></li></ul>
        <div class="btns" style="margin-top:10px"><button class="btn" data-act="sheet" data-sheet="add" data-param="${esc(pos.id)}">${ic("editar")}Editar posição</button></div>`
        : `<p class="small muted">Você ainda não cadastrou ${esc(a.codigo)} na carteira.</p><div class="btns"><button class="btn primary" data-act="sheet" data-sheet="add" data-param="novo:ativo:${esc(a.ticker)}">${ic("mais")}Adicionar à carteira</button></div>`}
      </div></section>

    <details class="acc"><summary>Como comprar ${esc(a.codigo)}</summary><div class="acc-b">${passosCompra(a)}</div></details>
    <details class="acc"><summary>Antes de decidir</summary><div class="acc-b"><ul>
      <li>Sinais técnicos erram com frequência, principalmente com o mercado andando de lado.</li>
      <li>Confira notícias recentes: uma queda forte pode ser desconto ou problema real na empresa.</li>
      <li>Não concentre muito dinheiro em um só ativo. Veja a divisão sugerida na aba Carteira.</li>
      <li>Defina por quanto tempo pretende ficar e o que faria se cair 20%.</li>
    </ul></div></details>
    <div class="btns" style="margin-top:14px">
      <a class="btn" href="https://news.google.com/search?q=${codigoBusca}&hl=pt-BR&gl=BR&ceid=BR:pt-419" target="_blank" rel="noopener">${ic("externo")}Notícias</a>
      <a class="btn" href="https://finance.yahoo.com/quote/${encodeURIComponent(a.ticker)}" target="_blank" rel="noopener">${ic("externo")}Yahoo Finance</a>
    </div>
    ${disclaimer()}`;
  return {
    titulo: a.codigo,
    acoes: `<button type="button" class="icon-btn fav-btn" data-act="fav" data-id="${esc(a.ticker)}" aria-pressed="${fav}" aria-label="${fav ? "Remover dos favoritos" : "Adicionar aos favoritos"}">${ic("star")}</button>`,
    html,
    depois: () => graficoAtivo(a),
  };
}
function graficoAtivo(a) {
  const el = $("#g-ativo");
  if (!el) return;
  const { datas, vals, aprox } = a.serie;
  const m50 = sma(vals, 50), m200 = sma(vals, 200);
  const dias = { "1M": 31, "3M": 92, "6M": 183, "1A": 366, "2A": 732 }[S.graf.faixa] || 183;
  const ini = datas.length ? datas[datas.length - 1] - dias * 864e5 : 0;
  let k = datas.findIndex(t => t >= ini);
  if (k < 0) k = 0;
  const ds = datas.slice(k), vs = vals.slice(k);
  const c = casasPreco(a.preco);
  const fmtV = (v, eixo) => ok(v) ? (eixo ? fmt(v, v >= 1000 ? 0 : c) : moeda(v, a.moeda, c)) : "—";
  montarGrafico(el, {
    datas: ds, fmtV, rotulo: `Preço de ${a.codigo} no período ${S.graf.faixa}`,
    // A série mais importante vai por último: fica desenhada por cima e aparece primeiro na dica
    series: [
      { nome: "Média 200d", vals: m200.slice(k), cor: "var(--s3)", largura: 1.5, on: S.graf.mm200 },
      { nome: "Média 50d", vals: m50.slice(k), cor: "var(--s2)", largura: 1.5, on: S.graf.mm50 },
      { nome: "Preço", vals: vs, cor: "var(--s1)", largura: 2 },
    ],
  });
  const v0 = vs.find(ok), v1 = vs[vs.length - 1];
  const varP = ok(v0) && ok(v1) ? (v1 / v0 - 1) * 100 : null;
  const nomeFaixa = { "1M": "1 mês", "3M": "3 meses", "6M": "6 meses", "1A": "1 ano", "2A": "2 anos" }[S.graf.faixa];
  $("#g-foot").innerHTML = `${ok(varP) ? `<b class="${varP >= 0 ? "up" : "down"}">${pct(varP, 1, true)}</b> em ${nomeFaixa}. ` : ""}Toque e arraste no gráfico para ver cada dia.${aprox ? " Datas aproximadas até a próxima atualização." : ""}`;
}
function passosCompra(a) {
  if (a.classe === "Cripto e câmbio") {
    if (a.ticker.includes("BRL=X")) return `<p>O dólar pode ser comprado em contas globais de bancos e fintechs ou indiretamente por ETFs e fundos cambiais. Compare o spread (diferença entre o dólar comercial e o cobrado) e o IOF antes.</p>`;
    return `<ol><li>Abra conta em uma corretora de criptomoedas ou em um banco/corretora que ofereça cripto.</li><li>Transfira reais por PIX.</li><li>Compre a quantidade desejada (pode ser fração, como 0,001).</li><li>Alternativa sem lidar com carteira digital: ETFs de cripto na B3, comprados como uma ação.</li></ol><p class="small muted" style="margin-top:8px">Cripto oscila muito: use só uma pequena parte da carteira. Ganhos têm regras próprias de IR.</p>`;
  }
  const lote = a.preco ? Math.round(a.preco * 100) : null;
  return `<ol>
    <li>Abra conta em uma corretora (muitas não cobram taxa de corretagem para ações, FIIs e ETFs).</li>
    <li>Transfira o dinheiro para a conta da corretora (PIX ou TED).</li>
    <li>No app ou home broker, busque <b>${esc(a.codigo)}</b>. ${lote ? `O lote padrão é de 100 unidades (≈ ${reais(lote)}). ` : ""}Para comprar de 1 a 99, use <b>${esc(a.codigo)}F</b> (mercado fracionário).</li>
    <li>Escolha a quantidade e o tipo de ordem: <i>a mercado</i> (compra pelo preço atual) ou <i>limitada</i> (define o preço máximo).</li>
    <li>Confirme. A liquidação acontece em 2 dias úteis, e o ativo aparece na sua carteira da B3.</li>
  </ol><p class="small muted" style="margin-top:8px">Impostos: ações, FIIs e ETFs têm regras de IR diferentes sobre lucro e proventos. Confira a regra vigente com sua corretora ou contador.</p>`;
}

// ---------- título do Tesouro
function sheetTitulo(id) {
  const t = S.data.idxTes.get(id);
  if (!t) return null;
  const info = tipoInfo(t);
  const pos = posicoes().find(p => p.tipo === "tesouro" && p.ref === t.id);
  const sel = info.idx === "Selic";
  const html = `
    <div class="card">
      <div class="small muted">${esc(t.tipo)}</div>
      <div class="hero"><div><div class="big num">${esc(taxaTexto(t))}</div><span class="small muted">${sel ? "rentabilidade ao ano" : "taxa contratada ao ano, se levar até o vencimento"}</span></div>${badge(t.sinal)}</div>
      ${sel ? "" : faixaTaxa(t)}
    </div>
    <div class="card"><p>${esc(t.explicacao)}</p><p class="small muted">${esc(info.desc)}</p></div>
    <section class="sec"><div class="sec-h"><h2>Detalhes</h2></div>
      <div class="stats">
        <div class="stat"><span>Vencimento</span><b>${esc(t.vencimento)}</b><small>${fmt(t.anos, 1)} anos</small></div>
        <div class="stat"><span>Preço do título</span><b>${reais(t.preco)}</b><small>dá para comprar frações</small></div>
        <div class="stat"><span>Investimento mínimo</span><b>${reais(t.minimo ?? Math.max(30, t.preco / 100))}</b><small>1% do título, mín. R$ 30</small></div>
        <button type="button" class="stat" data-act="info" data-k="percentil"><span>Percentil 5 anos ${ic("info")}</span><b>${ok(t.percentil_5a) && !sel ? fmt(t.percentil_5a, 0) : "—"}</b><small>${ok(t.taxa_med_5a) && !sel ? "mediana " + fmt(t.taxa_med_5a) + "%" : ""}</small></button>
        <button type="button" class="stat" data-act="info" data-k="marcacao"><span>Risco ${ic("info")}</span><b>${esc(riscoTesouro(t))}</b><small>${esc(t.risco)}</small></button>
        <button type="button" class="stat" data-act="info" data-k="liquidez"><span>Liquidez ${ic("info")}</span><b>Diária</b><small>dinheiro em até 1 dia útil</small></button>
        ${ok(t.preco_venda) && t.preco_venda > 0 ? `<div class="stat"><span>Preço de resgate hoje</span><b>${reais(t.preco_venda)}</b><small>taxa de venda ${pct(t.taxa_venda)}</small></div>` : ""}
      </div></section>
    <div class="btns" style="margin-top:14px">
      <button class="btn primary" data-act="simular-titulo" data-id="${esc(t.id)}">${ic("calc")}Simular quanto rende</button>
      ${pos ? `<button class="btn" data-act="sheet" data-sheet="add" data-param="${esc(pos.id)}">${ic("editar")}Editar na carteira</button>` : `<button class="btn" data-act="sheet" data-sheet="add" data-param="novo:tesouro:${esc(t.id)}">${ic("mais")}Adicionar à carteira</button>`}
    </div>
    <details class="acc"><summary>Como investir</summary><div class="acc-b">${passosTesouro()}</div></details>
    <details class="acc"><summary>E se eu precisar vender antes?</summary><div class="acc-b"><p>${sel ? "No Tesouro Selic o preço quase não oscila: vender antes do vencimento não costuma dar prejuízo, apenas a cobrança de IR sobre o lucro (maior nos primeiros meses)." : "O preço do título muda todos os dias conforme os juros do mercado (marcação a mercado). Se os juros subirem depois da sua compra, vender antes pode dar prejuízo; se caírem, pode render mais que o contratado. Levando até o vencimento, você recebe exatamente a taxa contratada."}</p></div></details>
    ${disclaimer()}`;
  return { titulo: nomeTitulo(t), html };
}

// ---------- ajustes
function sheetAjustes() {
  const html = `
    <section class="sec"><div class="sec-h"><h2>Perfil de investidor</h2></div>
      <div class="card"><p><b>${esc(PERFIS[S.perfil].nome)}</b>: ${esc(PERFIS[S.perfil].desc)}</p><div class="btns"><button class="btn" data-act="sheet" data-sheet="perfil">Mudar perfil</button><button class="btn ghost" data-act="sheet" data-sheet="ferramenta" data-param="perfil">Fazer o teste</button></div></div></section>
    <section class="sec"><div class="sec-h"><h2>Aparência</h2></div>
      <div class="seg" role="group" aria-label="Tema">${[["auto", "Automático"], ["light", "Claro"], ["dark", "Escuro"]].map(([v, t]) => `<button type="button" data-act="tema" data-v="${v}" aria-pressed="${S.tema === v}">${t}</button>`).join("")}</div></section>
    <section class="sec"><div class="sec-h"><h2>Seus dados neste aparelho</h2></div>
      <div class="card"><p class="small muted">Carteira, favoritos e preferências ficam salvos só neste navegador. Faça backup para levar para outro aparelho.</p>
        <div class="btns"><button class="btn" data-act="exportar">${ic("baixar")}Fazer backup</button><button class="btn" data-act="importar">${ic("subir")}Restaurar backup</button><button class="btn danger" data-act="limpar-tudo">Apagar dados locais</button></div></div></section>
    <section class="sec"><div class="sec-h"><h2>Sobre</h2></div>
      <div class="card small"><p>Monitor de investimentos gratuito e sem IA: o GitHub roda um script a cada 30 minutos no horário do pregão, busca dados públicos (Banco Central, Tesouro Transparente e Yahoo Finance) e calcula sinais por regras fixas e transparentes.</p><p class="muted">Nada aqui é recomendação de investimento.</p>
      <div class="btns"><button class="btn" data-act="sheet" data-sheet="status">Situação dos dados</button>${linkRepo() ? `<a class="btn ghost" href="${linkRepo()}" target="_blank" rel="noopener">${ic("externo")}Repositório</a>` : ""}</div></div></section>`;
  return { titulo: "Ajustes", html };
}
function sheetPerfil() {
  const html = `<p class="muted small" style="margin-top:0">O perfil define quais ativos ficam destacados e a divisão de referência da carteira. Nada fica escondido: você sempre pode ver todos os ativos.</p>
    ${Object.entries(PERFIS).map(([k, p]) => `<label class="opt"><input type="radio" name="perfil" value="${k}" ${S.perfil === k ? "checked" : ""} data-act="set-perfil"><span><b>${p.nome}</b><span>${p.desc}</span><br><span>Referência: ${Object.entries(p.meta).filter(([, v]) => v).map(([c, v]) => `${c} ${v}%`).join(" · ")}</span></span></label>`).join("")}
    <div class="btns" style="margin-top:10px"><button class="btn" data-act="sheet" data-sheet="ferramenta" data-param="perfil">Não sei meu perfil: fazer o teste</button></div>`;
  return { titulo: "Perfil de investidor", html };
}
function sheetInfo(k) {
  const g = GLOSS[k];
  if (!g) return { titulo: "Informação", html: `<p>Sem explicação para este item.</p>` };
  return { titulo: g[0], html: `<div class="card"><p>${esc(g[1])}</p></div><div class="btns" style="margin-top:12px"><button class="btn" data-act="sheet" data-sheet="ferramenta" data-param="glossario">${ic("livro")}Ver glossário completo</button></div>` };
}
function sheetStatus() {
  const d = S.data;
  const erros = (d && d.erros) || [];
  const html = `<div class="card"><ul class="kv">
      <li><span>Última atualização</span><b>${d ? esc(d.atualizado) + " (" + haQuanto(d.quando) + ")" : "—"}</b></li>
      <li><span>Origem</span><b>${S.origem === "cache" ? "Cópia salva neste aparelho" : S.origem === "rede" ? "Servidor (GitHub Pages)" : "—"}</b></li>
      <li><span>Ativos com cotação</span><b>${d ? d.ativos.length : "—"}</b></li>
      <li><span>Títulos do Tesouro</span><b>${d ? d.tes.length : "—"}${d && d.tesouro && d.tesouro.data_base ? " · " + esc(d.tesouro.data_base) : ""}</b></li>
    </ul></div>
    <section class="sec"><div class="sec-h"><h2>Avisos da última rodada</h2></div>
    ${erros.length ? `<div class="list"><ul class="alerts">${erros.map(e => `<li><span>${esc(e)}</span></li>`).join("")}</ul></div><p class="small muted" style="margin-top:8px">Quando uma fonte falha, o app mantém o último dado bom dela e mostra o resto normalmente. O monitor tenta de novo na próxima rodada.</p>` : `<div class="empty">Todas as fontes responderam normalmente.</div>`}</section>
    ${S.erroCarga ? `<p class="small" style="color:var(--sell);margin-top:12px">Falha ao buscar dados agora: ${esc(S.erroCarga)}</p>` : ""}
    <div class="card" style="margin-top:12px"><h3>Quando os dados mudam?</h3><p class="small muted">De segunda a sexta, a cada 30 minutos das 9h às 18h (Brasília). No fim de semana, duas vezes por dia. O GitHub às vezes atrasa execuções em horários de pico. O app busca dados novos sozinho a cada 5 minutos.</p>
      <div class="btns"><button class="btn primary" data-act="refresh">${ic("refresh")}Buscar agora</button>${linkRepo() ? `<a class="btn ghost" href="${linkRepo()}/actions" target="_blank" rel="noopener">${ic("externo")}Execuções no GitHub</a>` : ""}</div></div>`;
  return { titulo: "Situação dos dados", html };
}

// ---------- adicionar / editar investimento
function sheetAdd(param) {
  const d = S.data;
  let p = null, tipo = "ativo", refInicial = "";
  if (param && param.startsWith("novo:")) { const [, t, ...r] = param.split(":"); tipo = t; refInicial = r.join(":"); }
  else if (param) { p = S.carteira.find(x => x.id === param); if (!p) return null; tipo = p.tipo; }
  const tipoAtual = S.addTipo && !p ? S.addTipo : tipo;
  const ref = p ? p.ref : tipoAtual === tipo ? refInicial : "";
  const optsAtivos = ["Ações", "FIIs", "ETFs", "Cripto e câmbio"].map(c => {
    const xs = d.ativos.filter(a => a.classe === c);
    return xs.length ? `<optgroup label="${c}">${xs.map(a => `<option value="${esc(a.ticker)}" ${a.ticker === ref ? "selected" : ""}>${esc(a.codigo)} · ${esc(a.nome)}</option>`).join("")}</optgroup>` : "";
  }).join("");
  const tiposT = [...new Set(d.tes.map(t => t.tipo))];
  const optsTes = tiposT.map(tp => `<optgroup label="${esc(tp)}">${d.tes.filter(t => t.tipo === tp).map(t => `<option value="${esc(t.id)}" ${t.id === ref ? "selected" : ""}>${esc(nomeTitulo(t))} · ${esc(taxaTexto(t))}</option>`).join("")}</optgroup>`).join("");
  const refAtivo = tipoAtual === "ativo" ? d.idxAtivo.get(ref) : null;
  const moedaPm = refAtivo && refAtivo.moeda === "US$" ? "US$" : "R$";
  const v = x => ok(x) ? String(x).replace(".", ",") : "";
  const html = `<form class="form" id="f-add" novalidate>
    ${p ? "" : `<div class="seg" role="group" aria-label="Tipo de investimento">${[["ativo", "Bolsa e cripto"], ["tesouro", "Tesouro"], ["manual", "Outro"]].map(([k, t]) => `<button type="button" data-act="add-tipo" data-v="${k}" aria-pressed="${tipoAtual === k}">${t}</button>`).join("")}</div>`}
    ${tipoAtual === "ativo" ? `
      <div class="field"><label for="a-ref">Ativo</label><select class="input" id="a-ref" name="ref" required>${optsAtivos}</select><small>Só aparecem os ativos acompanhados pelo monitor. Para outros, use “Outro” ou adicione-o no config.json.</small></div>
      <div class="row2"><div class="field"><label for="a-qtd">Quantidade</label><input class="input" id="a-qtd" name="qtd" inputmode="decimal" value="${v(p && p.qtd)}" placeholder="Ex.: 100" required></div>
      <div class="field"><label for="a-pm">Preço médio (${moedaPm})</label><input class="input" id="a-pm" name="pm" inputmode="decimal" value="${v(p && p.pm)}" placeholder="Ex.: 32,50"></div></div>`
    : tipoAtual === "tesouro" ? `
      <div class="field"><label for="a-ref">Título</label><select class="input" id="a-ref" name="ref" required>${optsTes || `<option value="">Sem dados do Tesouro agora</option>`}</select></div>
      <div class="row2"><div class="field"><label for="a-qtd">Quantidade de títulos</label><input class="input" id="a-qtd" name="qtd" inputmode="decimal" value="${v(p && p.qtd)}" placeholder="Ex.: 0,52" required><small>Aparece no extrato. Pode ser fração.</small></div>
      <div class="field"><label for="a-pm">Preço médio pago (R$)</label><input class="input" id="a-pm" name="pm" inputmode="decimal" value="${v(p && p.pm)}" placeholder="Ex.: 14.800,00"></div></div>`
    : `
      <div class="field"><label for="a-nome">Nome</label><input class="input" id="a-nome" name="nome" value="${esc(p ? p.nome : "")}" placeholder="Ex.: CDB Banco X 110% CDI" required></div>
      <div class="field"><label for="a-classe">Classe</label><select class="input" id="a-classe" name="classe">${CLASSES.map(c => `<option ${p && p.classe === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="row2"><div class="field"><label for="a-custo">Valor investido (R$)</label><input class="input" id="a-custo" name="custo" inputmode="decimal" value="${v(p && p.custo)}" placeholder="Ex.: 5.000"></div>
      <div class="field"><label for="a-valor">Valor atual (R$)</label><input class="input" id="a-valor" name="valor" inputmode="decimal" value="${v(p && p.valor)}" placeholder="Ex.: 5.430" required></div></div>
      <small class="muted">Atualize o valor atual de vez em quando, olhando o extrato do banco.</small>`}
    <p class="err-msg" id="f-err" role="alert"></p>
    <div class="btns"><button type="submit" class="btn primary block">${p ? "Salvar alterações" : "Adicionar à carteira"}</button>
      ${p ? `<button type="button" class="btn danger block" data-act="remover-pos" data-id="${esc(p.id)}">Remover da carteira</button>` : ""}</div>
  </form>`;
  return {
    titulo: p ? "Editar investimento" : "Adicionar investimento",
    html,
    depois: corpo => {
      const f = $("#f-add", corpo);
      const sel = $("#a-ref", corpo);
      if (sel && tipoAtual === "ativo") sel.addEventListener("change", () => {
        const a = d.idxAtivo.get(sel.value);
        const lbl = $('label[for="a-pm"]', corpo);
        if (lbl) lbl.textContent = `Preço médio (${a && a.moeda === "US$" ? "US$" : "R$"})`;
      });
      f.addEventListener("submit", ev => {
        ev.preventDefault();
        const fd = new FormData(f), err = $("#f-err", corpo);
        const novo = { id: p ? p.id : uid(), tipo: tipoAtual };
        if (tipoAtual === "manual") {
          novo.nome = String(fd.get("nome") || "").trim();
          novo.classe = fd.get("classe");
          novo.valor = num(fd.get("valor"));
          novo.custo = num(fd.get("custo"));
          if (!novo.nome) { err.textContent = "Informe um nome."; return; }
          if (!ok(novo.valor) || novo.valor < 0) { err.textContent = "Informe o valor atual em reais."; return; }
          if (!ok(novo.custo)) novo.custo = null;
        } else {
          novo.ref = fd.get("ref");
          novo.qtd = num(fd.get("qtd"));
          novo.pm = num(fd.get("pm"));
          if (!novo.ref) { err.textContent = "Escolha o investimento."; return; }
          if (!ok(novo.qtd) || novo.qtd <= 0) { err.textContent = "Informe uma quantidade maior que zero."; return; }
          if (!ok(novo.pm) || novo.pm <= 0) novo.pm = null;
          const dup = S.carteira.find(x => x.tipo === novo.tipo && x.ref === novo.ref && x.id !== novo.id);
          if (dup) { err.textContent = "Esse investimento já está na carteira. Edite o existente."; return; }
        }
        const i = S.carteira.findIndex(x => x.id === novo.id);
        if (i >= 0) S.carteira[i] = novo; else S.carteira.push(novo);
        salvarCarteira();
        S.addTipo = null;
        toast(p ? "Investimento atualizado" : "Adicionado à carteira");
        renderView();
        fecharSheet();
      });
    },
  };
}

// ---------- ferramentas
function sheetFerramenta(k) {
  const fn = { sim: ferrSim, meta: ferrMeta, reserva: ferrReserva, conversor: ferrConversor, perfil: ferrPerfil, sinais: ferrSinais, glossario: ferrGlossario, config: ferrConfig, alertas: ferrAlertas, instalar: ferrInstalar }[k];
  return fn ? fn() : null;
}
function campo(id, rotulo, valor, pref, suf, dica) {
  return `<div class="field"><label for="${id}">${rotulo}</label><div class="input-wrap">${pref ? `<span>${pref}</span>` : ""}<input class="input" id="${id}" inputmode="decimal" value="${esc(valor)}">${suf ? `<span style="padding-right:12px">${suf}</span>` : ""}</div>${dica ? `<small>${dica}</small>` : ""}</div>`;
}
function liveForm(corpo, calc) {
  const run = () => { try { calc(); } catch (e) { console.error(e); } };
  corpo.addEventListener("input", run);
  corpo.addEventListener("change", run);
  run();
}
const IR = dias => dias <= 180 ? 22.5 : dias <= 360 ? 20 : dias <= 720 ? 17.5 : 15;
function taxaAnualPor(modo, valor, m) {
  const cdi = (m.cdi_ano || 0) / 100, selic = (m.selic_meta || 0) / 100, ipca = (m.ipca_12m || 0) / 100, v = valor / 100;
  if (modo === "cdi") { const diaria = (Math.pow(1 + cdi, 1 / 252) - 1) * v; return Math.pow(1 + diaria, 252) - 1; }
  if (modo === "selic") return (1 + selic) * (1 + v) - 1;
  if (modo === "ipca") return (1 + ipca) * (1 + v) - 1;
  return v;
}
function simular({ inicial, aporte, meses, anual, isento }) {
  const im = Math.pow(1 + anual, 1 / 12) - 1;
  let bruto = 0, investido = 0, ir = 0;
  const parcelas = [[0, inicial], ...Array.from({ length: meses }, (_, k) => [k + 1, aporte])].filter(([, v]) => v > 0);
  parcelas.forEach(([mes, v]) => {
    const n = meses - mes;
    const fim = v * Math.pow(1 + im, n);
    bruto += fim; investido += v;
    if (!isento) ir += (fim - v) * IR(n * 30.4) / 100;
  });
  return { bruto, investido, ir, liquido: bruto - ir };
}

function ferrSim() {
  const m = S.data ? S.data.macro : {};
  const pre = S.sim || {};
  const html = `<div class="form">
      <div class="row2">${campo("s-ini", "Valor inicial", pre.inicial ?? "1.000", "R$")}${campo("s-ap", "Aporte por mês", pre.aporte ?? "200", "R$")}</div>
      <div class="field"><label for="s-meses">Prazo</label><div class="row2"><div class="input-wrap"><input class="input" id="s-meses" inputmode="numeric" value="${pre.meses ?? 24}"><span style="padding-right:12px">meses</span></div>
        <div class="chips">${[[6, "6m"], [12, "1 ano"], [24, "2 anos"], [60, "5 anos"], [120, "10 anos"]].map(([v, t]) => `<button type="button" class="chip" data-act="s-prazo" data-v="${v}">${t}</button>`).join("")}</div></div></div>
      <div class="field"><label for="s-modo">Tipo de rendimento</label><select class="input" id="s-modo">
        ${[["cdi", "% do CDI (CDB, LCI, LCA, Tesouro Selic ≈ 100%)"], ["selic", "Selic + taxa (Tesouro Selic)"], ["pre", "Prefixado (taxa fixa ao ano)"], ["ipca", "IPCA + taxa (Tesouro IPCA+, debêntures)"]].map(([v, t]) => `<option value="${v}" ${(pre.modo || "cdi") === v ? "selected" : ""}>${t}</option>`).join("")}
      </select></div>
      ${campo("s-taxa", "Taxa", pre.taxa ?? "100", "", "", "")}
      <label class="toggle"><input type="checkbox" id="s-isento" ${pre.isento ? "checked" : ""}> Isento de IR (LCI, LCA, poupança)</label>
    </div>
    <div class="result" style="margin-top:16px" aria-live="polite" id="s-res"></div>
    <section class="sec"><div class="sec-h"><h2>Comparando no mesmo prazo</h2></div><div class="card"><div class="hbars" id="s-comp"></div>
      <p class="small muted" style="margin-top:10px">Valores líquidos (após IR). Premissas: CDI de ${pct(m.cdi_ano)} e inflação de ${pct(m.ipca_12m)} constantes durante todo o prazo. Na vida real as taxas mudam; use como estimativa.</p></div></section>`;
  return {
    titulo: "Simulador de renda fixa", html,
    depois: corpo => {
      const g = id => $("#" + id, corpo);
      const ajustaRotulo = () => {
        const modo = g("s-modo").value;
        const lbl = $('label[for="s-taxa"]', corpo);
        lbl.textContent = { cdi: "Percentual do CDI (%)", selic: "Taxa acima da Selic (% ao ano)", pre: "Taxa prefixada (% ao ano)", ipca: "Taxa acima do IPCA (% ao ano)" }[modo];
      };
      g("s-modo").addEventListener("change", () => {
        const sug = { cdi: "100", selic: "0,08", pre: S.data ? fmt(S.data.macro.cdi_ano) : "12", ipca: "6,5" }[g("s-modo").value];
        g("s-taxa").value = sug;
      });
      liveForm(corpo, () => {
        ajustaRotulo();
        const inicial = num(g("s-ini").value) || 0, aporte = num(g("s-ap").value) || 0;
        const meses = clamp(Math.round(num(g("s-meses").value) || 0), 1, 600);
        const modo = g("s-modo").value, taxa = num(g("s-taxa").value);
        const isento = g("s-isento").checked;
        S.sim = { inicial: g("s-ini").value, aporte: g("s-ap").value, meses, modo, taxa: g("s-taxa").value, isento };
        if (!ok(taxa) || inicial + aporte <= 0) { g("s-res").innerHTML = `<p>Preencha um valor e uma taxa válidos.</p>`; g("s-comp").innerHTML = ""; return; }
        const anual = taxaAnualPor(modo, taxa, m);
        const r = simular({ inicial, aporte, meses, anual, isento });
        const ganho = r.liquido - r.investido;
        const infl = Math.pow(1 + (m.ipca_12m || 0) / 100, meses / 12);
        const real = r.liquido / infl;
        g("s-res").innerHTML = `<span class="small muted">Você terá, após ${meses} meses (líquido)</span><div class="big">${reais(r.liquido)}</div>
          <ul class="kv"><li><span>Total investido</span><b>${reais(r.investido)}</b></li>
          <li><span>Rendimento bruto</span><b>${reais(r.bruto - r.investido)}</b></li>
          <li><span>Imposto de renda</span><b>${isento ? "isento" : "− " + reais(r.ir)}</b></li>
          <li><span>Ganho líquido</span><b class="up">${reais(ganho)} (${pct(ganho / r.investido * 100, 1, true)})</b></li>
          <li><span>Taxa equivalente ao ano (bruta)</span><b>${pct(anual * 100)}</b></li>
          <li><span>Em dinheiro de hoje (descontando a inflação)</span><b>${reais(real)}</b></li></ul>`;
        const pp = poupancaAno(m);
        const alts = [
          ["Esta simulação", r.liquido, true],
          ["Poupança", ok(pp) ? simular({ inicial, aporte, meses, anual: pp / 100, isento: true }).liquido : null],
          ["CDB 100% do CDI", simular({ inicial, aporte, meses, anual: taxaAnualPor("cdi", 100, m), isento: false }).liquido],
          ["Só guardar (sem render)", r.investido],
        ].filter(x => ok(x[1]));
        const max = Math.max(...alts.map(x => x[1]));
        g("s-comp").innerHTML = alts.sort((a, b) => b[1] - a[1]).map(([n, v, me]) => `<div class="hbar ${me ? "me" : ""}"><span>${n}</span><span class="v">${reais(v)}</span><div class="t"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>`).join("");
      });
    },
  };
}
function ferrMeta() {
  const m = S.data ? S.data.macro : {};
  const sugerida = ok(m.cdi_ano) ? fmt(m.cdi_ano * 0.85, 2) : "10";
  const html = `<div class="form">
      ${campo("mt-alvo", "Quanto quer juntar", "100.000", "R$")}
      <div class="row2">${campo("mt-anos", "Em quantos anos", "5", "", "anos")}${campo("mt-ini", "Já tem guardado", "0", "R$")}</div>
      ${campo("mt-taxa", "Rendimento esperado (líquido, ao ano)", sugerida, "", "%", `Sugestão: CDI após IR ≈ ${sugerida}%. Para objetivos longos, considere descontar a inflação.`)}
    </div>
    <div class="result" style="margin-top:16px" id="mt-res" aria-live="polite"></div>`;
  return {
    titulo: "Meta de investimento", html,
    depois: corpo => liveForm(corpo, () => {
      const g = id => num($("#" + id, corpo).value);
      const alvo = g("mt-alvo"), anos = g("mt-anos"), ini = g("mt-ini") || 0, taxa = g("mt-taxa");
      const box = $("#mt-res", corpo);
      if (!(alvo > 0) || !(anos > 0) || !ok(taxa)) { box.innerHTML = "<p>Preencha os campos com valores válidos.</p>"; return; }
      const n = Math.round(anos * 12), i = Math.pow(1 + taxa / 100, 1 / 12) - 1;
      const fvIni = ini * Math.pow(1 + i, n);
      const falta = alvo - fvIni;
      const pmt = falta <= 0 ? 0 : i === 0 ? falta / n : falta * i / (Math.pow(1 + i, n) - 1);
      const aportado = ini + pmt * n;
      const infl = Math.pow(1 + (m.ipca_12m || 4) / 100, anos);
      box.innerHTML = falta <= 0
        ? `<span class="small muted">Boa notícia</span><div class="big">Você já chega lá</div><p class="small">Só com o que tem guardado, rendendo ${pct(taxa)} ao ano, você terá ${reais(fvIni)} em ${fmt(anos, 0)} anos.</p>`
        : `<span class="small muted">Invista por mês</span><div class="big">${reais(pmt)}</div>
          <ul class="kv"><li><span>Total que você vai depositar</span><b>${reais(aportado)}</b></li><li><span>Juros que vão trabalhar por você</span><b class="up">${reais(alvo - aportado)}</b></li>
          <li><span>${reais(alvo)} em ${fmt(anos, 0)} anos valem hoje</span><b>≈ ${reais(alvo / infl)}</b></li></ul>
          <p class="small muted" style="margin-top:8px">A última linha desconta a inflação atual (${pct(m.ipca_12m || 4, 1)} ao ano). Se a meta é poder de compra, aumente o valor alvo.</p>`;
    }),
  };
}
function ferrReserva() {
  const d = S.data;
  const selic = d ? d.tes.filter(t => tipoInfo(t).idx === "Selic").sort((a, b) => a.anos - b.anos)[0] : null;
  const html = `<div class="form">
      ${campo("r-gasto", "Quanto você gasta por mês", "4.000", "R$")}
      <div class="field"><span class="lbl">Sua situação de trabalho</span>
        ${[["6", "CLT / emprego estável", "6 meses de gastos"], ["3", "Servidor público", "3 a 6 meses"], ["12", "Autônomo, empresário ou renda variável", "12 meses"]].map(([v, t, s], i) => `<label class="opt"><input type="radio" name="r-sit" value="${v}" ${i === 0 ? "checked" : ""}><span><b>${t}</b><span>${s}</span></span></label>`).join("")}</div>
      <div class="row2">${campo("r-tem", "Já tem guardado", "0", "R$")}${campo("r-ap", "Consegue guardar por mês", "500", "R$")}</div>
    </div>
    <div class="result" style="margin-top:16px" id="r-res" aria-live="polite"></div>
    <div class="card" style="margin-top:12px"><h3>Onde deixar a reserva</h3><p class="small">Precisa ser seguro e com resgate rápido. Boas opções: <b>Tesouro Selic</b>${selic ? ` (hoje Selic + ${fmt(selic.taxa)}%)` : ""} ou <b>CDB de liquidez diária que pague 100% do CDI ou mais</b>, de banco coberto pelo FGC. Evite ações, FIIs e cripto para esse dinheiro.</p>
      ${selic ? `<div class="btns"><button class="btn" data-act="titulo" data-id="${esc(selic.id)}">Ver ${esc(nomeTitulo(selic))}</button></div>` : ""}</div>`;
  return {
    titulo: "Reserva de emergência", html,
    depois: corpo => liveForm(corpo, () => {
      const gasto = num($("#r-gasto", corpo).value), tem = num($("#r-tem", corpo).value) || 0, ap = num($("#r-ap", corpo).value) || 0;
      const meses = +($("input[name=r-sit]:checked", corpo) || { value: 6 }).value;
      const box = $("#r-res", corpo);
      if (!(gasto > 0)) { box.innerHTML = "<p>Informe seu gasto mensal.</p>"; return; }
      const alvo = gasto * meses, falta = Math.max(0, alvo - tem);
      let tempo = "";
      if (falta > 0 && ap > 0) {
        const i = Math.pow(1 + ((d && d.macro.cdi_ano) || 10) * 0.85 / 100, 1 / 12) - 1;
        let s = tem, n = 0;
        while (s < alvo && n < 600) { s = s * (1 + i) + ap; n++; }
        tempo = `<li><span>Tempo para completar</span><b>${n >= 600 ? "mais de 50 anos" : n < 12 ? n + " meses" : fmt(n / 12, 1) + " anos"}</b></li>`;
      }
      box.innerHTML = `<span class="small muted">Sua reserva ideal</span><div class="big">${reais(alvo)}</div>
        <ul class="kv"><li><span>Equivale a</span><b>${meses} meses de gastos</b></li><li><span>Já guardado</span><b>${reais(tem)} (${pct(Math.min(100, tem / alvo * 100), 0)})</b></li>
        <li><span>Falta</span><b>${falta > 0 ? reais(falta) : "nada, reserva completa"}</b></li>${tempo}</ul>`;
    }),
  };
}
function ferrConversor() {
  const html = `<div class="card"><h3>Taxa mensal ↔ anual</h3><div class="form" style="margin-top:8px"><div class="row2">${campo("c-mes", "Ao mês", "1", "", "%")}${campo("c-ano", "Ao ano", "12,68", "", "%")}</div></div></div>
    <div class="card"><h3>LCI/LCA (isenta) × CDB (com IR)</h3><p class="small muted">Qual taxa um CDB precisa pagar para empatar com uma LCI ou LCA isenta?</p>
      <div class="form" style="margin-top:8px">${campo("c-lci", "LCI/LCA paga", "90", "", "% do CDI")}
      <div class="field"><label for="c-prazo">Prazo</label><select class="input" id="c-prazo"><option value="180">Até 6 meses (IR 22,5%)</option><option value="360">De 6 meses a 1 ano (IR 20%)</option><option value="720" selected>De 1 a 2 anos (IR 17,5%)</option><option value="721">Mais de 2 anos (IR 15%)</option></select></div></div>
      <div class="result" style="margin-top:12px" id="c-res" aria-live="polite"></div></div>`;
  return {
    titulo: "Conversor de taxas", html,
    depois: corpo => {
      const mes = $("#c-mes", corpo), ano = $("#c-ano", corpo);
      mes.addEventListener("input", () => { const v = num(mes.value); if (ok(v)) ano.value = fmt((Math.pow(1 + v / 100, 12) - 1) * 100, 2); });
      ano.addEventListener("input", () => { const v = num(ano.value); if (ok(v)) mes.value = fmt((Math.pow(1 + v / 100, 1 / 12) - 1) * 100, 3); });
      const calc = () => {
        const lci = num($("#c-lci", corpo).value), dias = +$("#c-prazo", corpo).value;
        const ir = IR(dias);
        $("#c-res", corpo).innerHTML = ok(lci) ? `<span class="small muted">O CDB precisa pagar pelo menos</span><div class="big">${pct(lci / (1 - ir / 100), 1)} do CDI</div><p class="small">para render o mesmo que uma LCI/LCA de ${pct(lci, 0)} do CDI nesse prazo (IR de ${fmt(ir, 1)}%).</p>` : "<p>Informe a taxa da LCI/LCA.</p>";
      };
      $("#c-lci", corpo).addEventListener("input", calc);
      $("#c-prazo", corpo).addEventListener("change", calc);
      calc();
    },
  };
}
const QUIZ = [
  ["Por quanto tempo pretende deixar a maior parte do dinheiro investida?", [["Menos de 1 ano", 0], ["De 1 a 5 anos", 1], ["Mais de 5 anos", 2]]],
  ["Se seus investimentos caíssem 20% em um mês, o que você faria?", [["Venderia tudo para não perder mais", 0], ["Esperaria recuperar", 1], ["Aproveitaria para comprar mais", 2]]],
  ["Qual frase combina mais com você?", [["Prefiro ganhar pouco, mas sem sustos", 0], ["Aceito alguma oscilação para ganhar mais", 1], ["Busco o maior retorno, mesmo com riscos altos", 2]]],
  ["Você já tem uma reserva de emergência?", [["Não", 0], ["Sim, parcial", 1], ["Sim, completa", 2]]],
  ["Quanto você conhece de investimentos?", [["Pouco ou nada", 0], ["Já investi em renda fixa e fundos", 1], ["Já invisto em ações, FIIs ou cripto", 2]]],
];
function ferrPerfil() {
  const html = `<form class="quiz" id="quiz">${QUIZ.map(([q, ops], i) => `<fieldset><legend>${i + 1}. ${q}</legend>${ops.map(([t, p]) => `<label class="opt"><input type="radio" name="q${i}" value="${p}"><span><b>${t}</b></span></label>`).join("")}</fieldset>`).join("")}
    <div class="result" id="quiz-res" aria-live="polite"><p>Responda as ${QUIZ.length} perguntas para ver seu perfil.</p></div></form>`;
  return {
    titulo: "Descubra seu perfil", html,
    depois: corpo => liveForm(corpo, () => {
      const resp = QUIZ.map((_, i) => $(`input[name=q${i}]:checked`, corpo));
      if (resp.some(r => !r)) return;
      const pts = resp.reduce((s, r) => s + +r.value, 0);
      const perfil = pts <= 3 ? "conservador" : pts <= 7 ? "moderado" : "arrojado";
      // Sem reserva de emergência, o perfil fica no máximo moderado
      const final = resp[3].value === "0" && perfil === "arrojado" ? "moderado" : perfil;
      $("#quiz-res", corpo).innerHTML = `<span class="small muted">Seu perfil</span><div class="big">${PERFIS[final].nome}</div><p class="small">${PERFIS[final].desc}</p>${resp[3].value === "0" ? `<p class="small"><b>Primeiro passo:</b> monte sua reserva de emergência antes de investir em renda variável.</p>` : ""}
        <div class="btns" style="margin-top:10px"><button type="button" class="btn primary" data-act="usar-perfil" data-v="${final}">Usar este perfil</button></div>`;
    }),
  };
}
function ferrSinais() {
  const html = `<div class="card"><p>Cada ativo soma ou perde pontos por regras fixas. Não há opinião nem previsão: são critérios técnicos clássicos, aplicados igualmente a todos.</p></div>
    <div class="list" style="margin-top:10px"><ul class="alerts">
      <li><b>Preço acima / abaixo da média de 200 dias</b><span>+1 / −1 · tendência de longo prazo</span></li>
      <li><b>Média de 50 dias acima / abaixo da de 200</b><span>+1 / −1 · força recente</span></li>
      <li><b>RSI abaixo de 30 / acima de 70</b><span>+1 / −1 · queda ou alta exagerada</span></li>
      <li><b>Rentabilidade de 12 meses acima / abaixo do CDI</b><span>+1 / −1 · valeu mais que a renda fixa?</span></li>
      <li><b>Proventos de 12 meses ≥ 85% do CDI</b><span>+1 · para FIIs e boas pagadoras de dividendos</span></li>
    </ul></div>
    <section class="sec"><div class="sec-h"><h2>Da pontuação ao sinal</h2></div>${regua(0)}
      <ul class="kv card" style="margin-top:12px"><li><span>3 pontos ou mais</span>${badge("COMPRA")}</li><li><span>1 a 2</span>${badge("VIÉS DE ALTA")}</li><li><span>−1 a 0</span>${badge("NEUTRO")}</li><li><span>−2</span>${badge("VIÉS DE BAIXA")}</li><li><span>−3 ou menos</span>${badge("VENDA")}</li></ul></section>
    <section class="sec"><div class="sec-h"><h2>Risco e Tesouro</h2></div><div class="card small"><p>O <b>risco</b> vem da volatilidade de 12 meses: abaixo de 20% é baixo, até 35% médio, acima disso alto.</p><p>No Tesouro, o título ganha <b>Taxa alta</b> quando a taxa de hoje supera 80% das taxas daquele tipo nos últimos 5 anos. O Tesouro Selic aparece como <b>Reserva</b>.</p></div></section>
    <section class="sec"><div class="sec-h"><h2>Limites</h2></div><div class="card small"><p>São regras fixas, não previsão. Funcionam melhor como filtro para estudar do que como ordem para executar. Sinais técnicos erram com frequência, principalmente com o mercado andando de lado. Dados gratuitos têm atraso de até 30 minutos.</p></div></section>`;
  return { titulo: "Como os sinais funcionam", html };
}
function ferrGlossario() {
  const itens = Object.entries(GLOSS).sort((a, b) => a[1][0].localeCompare(b[1][0], "pt-BR"));
  const html = `<label class="search">${ic("busca")}<span class="sr">Buscar termo</span><input id="g-busca" type="search" placeholder="Buscar termo" autocomplete="off"></label>
    <dl class="gloss" id="g-lista">${itens.map(([k, [t, d]]) => `<div data-k="${k}"><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join("")}</dl>`;
  return {
    titulo: "Glossário", html,
    depois: corpo => $("#g-busca", corpo).addEventListener("input", e => {
      const q = e.target.value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      $$("#g-lista > div", corpo).forEach(el => { el.hidden = q && !el.textContent.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q); });
    }),
  };
}
function linkRepo() {
  // usuario.github.io/repositorio/ → github.com/usuario/repositorio
  const h = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return h && repo ? `https://github.com/${h[1]}/${repo}` : null;
}
function ferrConfig() {
  const d = S.data, cfg = (d && d.alertas_cfg) || null, repo = linkRepo();
  const porClasse = d ? ["Ações", "FIIs", "ETFs", "Cripto e câmbio"].map(c => [c, d.ativos.filter(a => a.classe === c).map(a => a.codigo)]) : [];
  const html = `<section class="sec" style="margin-top:0"><div class="sec-h"><h2>Regras dos alertas</h2></div>
      ${cfg ? `<div class="card"><ul class="kv">
        <li><span>Avisar quando um ativo entrar em Compra</span><b>${cfg.avisar_sinal_compra ? "Sim" : "Não"}</b></li>
        <li><span>Avisar quando um ativo entrar em Venda</span><b>${cfg.avisar_sinal_venda ? "Sim" : "Não"}</b></li>
        <li><span>Movimento forte no dia</span><b>${pct(cfg.variacao_dia_pct, 0)} ou mais</b></li>
        <li><span>Taxa do Tesouro “alta” a partir do percentil</span><b>${fmt(cfg.tesouro_percentil_atrativo, 0)}</b></li>
        <li><span>Máximo de alertas por rodada (acima disso, vira um resumo)</span><b>${fmt(cfg.max_alertas_por_rodada, 0)}</b></li>
      </ul></div>` : `<div class="empty">As regras aparecem aqui depois da próxima atualização do monitor.</div>`}</section>
    <section class="sec"><div class="sec-h"><h2>Ativos acompanhados</h2></div>
      <div class="card small">${porClasse.map(([c, xs]) => `<p><b>${c} (${xs.length}):</b> ${xs.map(esc).join(", ") || "nenhum"}</p>`).join("")}</div></section>
    <section class="sec"><div class="sec-h"><h2>Como mudar</h2></div>
      <div class="card small"><ol style="margin:0;padding-left:20px">
        <li>Abra o arquivo <b>config.json</b> no GitHub (botão abaixo) e toque no lápis para editar.</li>
        <li>Para incluir um ativo, copie uma linha de <code>ativos</code> e troque o código. Ações, FIIs e ETFs da B3 levam <code>.SA</code> no fim (ex.: <code>ITSA4.SA</code>). Classes aceitas: Ações, FIIs, ETFs, Cripto e câmbio. Use <code>"dividendos": true</code> para considerar proventos.</li>
        <li>Para os alertas, mude os valores em <code>alertas</code> (true = ligado, false = desligado).</li>
        <li>Salve com “Commit changes”. A mudança vale a partir da próxima rodada do monitor.</li>
      </ol>
      ${repo ? `<div class="btns" style="margin-top:12px"><a class="btn primary" href="${repo}/edit/main/config.json" target="_blank" rel="noopener">${ic("editar")}Editar config.json</a><a class="btn" href="${repo}/actions" target="_blank" rel="noopener">${ic("externo")}Rodar o monitor agora</a></div>` : ""}
      <p class="muted" style="margin-top:10px">Para rodar na hora: aba Actions → “Monitor de Investimentos” → “Run workflow”. É preciso estar logado no GitHub.</p></div></section>`;
  return { titulo: "Ativos e alertas", html };
}
function ferrAlertas() {
  const html = `<div class="card"><p>Os alertas chegam pelo app gratuito <b>ntfy</b>, sem cadastro.</p><ol style="padding-left:20px;margin:0">
      <li>Instale o ntfy (Play Store ou App Store).</li>
      <li>Toque em “+” e assine o tópico configurado no GitHub (secret NTFY_TOPIC).</li>
      <li>Pronto: os avisos chegam quando um ativo entra em compra ou venda, se move forte no dia ou quando uma taxa do Tesouro fica alta. Tocar no aviso abre este app.</li></ol></div>
    <div class="card"><p class="small muted">Qualquer pessoa que souber o nome do tópico consegue ler os alertas. Por isso o nome não aparece aqui; prefira nomes difíceis de adivinhar.</p></div>
    <div class="btns" style="margin-top:12px"><a class="btn" href="https://ntfy.sh/" target="_blank" rel="noopener">${ic("externo")}Site do ntfy</a><button class="btn" data-act="sheet" data-sheet="ferramenta" data-param="config">Mudar regras dos alertas</button></div>`;
  return { titulo: "Alertas no celular", html };
}
function ferrInstalar() {
  const html = `<div class="card"><h3>iPhone (Safari)</h3><p class="small">Toque no botão de compartilhar (quadrado com seta) e depois em “Adicionar à Tela de Início”.</p></div>
    <div class="card"><h3>Android (Chrome)</h3><p class="small">Toque no menu ⋮ e depois em “Instalar app” ou “Adicionar à tela inicial”.</p></div>
    <div class="card"><h3>Computador</h3><p class="small">No Chrome ou Edge, clique no ícone de instalar na barra de endereço.</p></div>
    <p class="small muted" style="margin-top:12px">Instalado, ele abre em tela cheia e continua mostrando os últimos dados mesmo sem internet.</p>`;
  return { titulo: "Instalar como app", html };
}

// =============================================================== backup da carteira
function exportar() {
  const blob = new Blob([JSON.stringify({ app: "monitor-investimentos", versao: 1, exportado: new Date().toISOString(), carteira: S.carteira, favoritos: [...S.favs], perfil: S.perfil }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `carteira-monitor-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Backup salvo");
}
function importar() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json,.json";
  inp.addEventListener("change", async () => {
    try {
      const j = JSON.parse(await inp.files[0].text());
      const cart = Array.isArray(j) ? j : j.carteira;
      if (!Array.isArray(cart) || cart.some(p => !p || !["ativo", "tesouro", "manual"].includes(p.tipo))) throw new Error("formato");
      if (S.carteira.length && !confirm(`Substituir os ${S.carteira.length} investimentos atuais pelos ${cart.length} do backup?`)) return;
      S.carteira = cart.map(p => ({ ...p, id: p.id || uid() }));
      salvarCarteira();
      if (Array.isArray(j.favoritos)) { S.favs = new Set(j.favoritos); store.set("favs", j.favoritos); }
      if (PERFIS[j.perfil]) { S.perfil = j.perfil; store.set("perfil", j.perfil); }
      toast("Backup restaurado");
      renderTudo();
    } catch (e) { toast("Arquivo inválido. Use um backup gerado por este app."); }
  });
  inp.click();
}

// =============================================================== eventos
function aplicarTema() {
  if (S.tema === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.tema;
}

document.addEventListener("click", ev => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const irPara = (tab, depois) => {
    if (depois) depois();
    salvarFiltros();
    if (S.sheet) { S.pilha = 0; S.sheet = null; }
    if (S.tab === tab) { location.hash = tab; renderView(); window.scrollTo(0, 0); }
    else location.hash = tab;
  };
  switch (act) {
    case "tab": irPara(el.dataset.tab); break;
    case "refresh": carregar(true); break;
    case "close": fecharSheet(); break;
    case "sheet": S.voltarFoco = el; if (el.dataset.sheet === "add") S.addTipo = null; abrirSheet(el.dataset.sheet, el.dataset.param); break;
    case "ativo": S.voltarFoco = el; abrirSheet("ativo", el.dataset.id); break;
    case "titulo": S.voltarFoco = el; abrirSheet("titulo", el.dataset.id); break;
    case "info": abrirSheet("info", el.dataset.k); break;
    case "fav": {
      const t = el.dataset.id;
      if (S.favs.has(t)) { S.favs.delete(t); toast("Removido dos favoritos"); } else { S.favs.add(t); toast("Adicionado aos favoritos"); }
      store.set("favs", [...S.favs]);
      el.setAttribute("aria-pressed", S.favs.has(t));
      renderView();
      break;
    }
    case "m-classe": S.mercado.classe = el.dataset.v; salvarFiltros(); $$('[data-act="m-classe"]').forEach(b => b.setAttribute("aria-pressed", b.dataset.v === S.mercado.classe)); atualizarListaMercado(); break;
    case "m-limpar": irPara("mercado", () => Object.assign(S.mercado, { q: "", classe: "Todos", sinal: "Todos", soPerfil: false })); break;
    case "mercado-sinal": irPara("mercado", () => Object.assign(S.mercado, { q: "", classe: "Todos", sinal: el.dataset.sinal, ordem: "sinal" })); break;
    case "mercado-ordem": irPara("mercado", () => Object.assign(S.mercado, { q: "", classe: "Todos", sinal: "Todos", ordem: el.dataset.ordem })); break;
    case "mercado-classe": irPara("mercado", () => Object.assign(S.mercado, { q: "", classe: el.dataset.classe, sinal: "Todos" })); break;
    case "rf-grupo": irPara("rf", () => { S.rf.grupo = el.dataset.grupo; }); break;
    case "g-faixa": S.graf.faixa = el.dataset.v; salvarFiltros(); renderSheet(); break;
    case "g-mm": S.graf[el.dataset.v] = !S.graf[el.dataset.v]; salvarFiltros(); renderSheet(); break;
    case "tema": S.tema = el.dataset.v; store.set("tema", S.tema); aplicarTema(); renderSheet(); break;
    case "set-perfil": break; // tratado no evento change
    case "usar-perfil":
      S.perfil = el.dataset.v; store.set("perfil", S.perfil); store.set("perfilQuiz", true);
      toast(`Perfil ${PERFIS[S.perfil].nome.toLowerCase()} salvo`); renderView(); fecharSheet(); break;
    case "add-tipo": S.addTipo = el.dataset.v; renderSheet(); break;
    case "remover-pos":
      if (confirm("Remover este investimento da carteira?")) {
        S.carteira = S.carteira.filter(p => p.id !== el.dataset.id); salvarCarteira(); toast("Removido da carteira"); renderView(); fecharSheet();
      }
      break;
    case "s-prazo": { const i = $("#s-meses"); if (i) { i.value = el.dataset.v; i.dispatchEvent(new Event("input", { bubbles: true })); } break; }
    case "simular-titulo": {
      const t = S.data.idxTes.get(el.dataset.id);
      if (!t) break;
      const idx = tipoInfo(t).idx;
      const meses = clamp(Math.round(t.anos * 12), 1, 600);
      S.sim = { inicial: "1.000", aporte: "0", meses, modo: idx === "Selic" ? "selic" : idx === "pre" ? "pre" : "ipca", taxa: fmt(t.taxa), isento: false };
      abrirSheet("ferramenta", "sim");
      break;
    }
    case "exportar": exportar(); break;
    case "importar": importar(); break;
    case "limpar-tudo":
      if (confirm("Apagar carteira, favoritos e preferências deste aparelho? Faça um backup antes, se quiser guardar.")) {
        ["carteira", "favs", "perfil", "perfilQuiz", "tema", "filtroMercado", "filtroRF", "grafico", "cache"].forEach(store.del);
        location.replace(location.pathname);
      }
      break;
  }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.matches('[data-act="set-perfil"]')) { S.perfil = t.value; store.set("perfil", S.perfil); toast(`Perfil ${PERFIS[S.perfil].nome.toLowerCase()} salvo`); renderView(); }
  if (t.id === "m-sinal") { S.mercado.sinal = t.value; salvarFiltros(); atualizarListaMercado(); }
  if (t.id === "m-ordem") { S.mercado.ordem = t.value; salvarFiltros(); atualizarListaMercado(); }
  if (t.id === "m-perfil") { S.mercado.soPerfil = t.checked; salvarFiltros(); atualizarListaMercado(); }
  if (t.id === "rf-ordem") { S.rf.ordem = t.value; salvarFiltros(); renderView(); }
});
document.addEventListener("input", ev => {
  if (ev.target.id === "busca") { S.mercado.q = ev.target.value; atualizarListaMercado(); }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && S.sheet) fecharSheet();
});
$("#backdrop").addEventListener("click", fecharSheet);
window.addEventListener("hashchange", aplicarRota);
document.addEventListener("visibilitychange", () => {
  // Ao voltar para o app depois de um tempo, busca dados novos
  if (!document.hidden && S.data && Date.now() - (S.ultimaBusca || 0) > 60e3) { S.ultimaBusca = Date.now(); carregar(false); }
});

// =============================================================== início
aplicarTema();
aplicarRota();
S.ultimaBusca = Date.now();
carregar(false);
setInterval(() => { if (!document.hidden) { S.ultimaBusca = Date.now(); carregar(false); } }, 5 * 60 * 1000);
setInterval(renderTopo, 60 * 1000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
