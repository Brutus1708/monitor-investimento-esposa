"use strict";
/*
 * Monitor — núcleo: utilidades, catálogo de produtos, estado, dados e componentes visuais.
 * Lê os arquivos gerados pelo monitor.py (data.json, hist/, noticias.json, fundos.json).
 * Carteira, favoritos, ofertas e preferências ficam só neste aparelho (localStorage).
 */

// =============================================================== utilidades
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ok = v => v != null && v !== "" && isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const store = {
  get(k, padrao) { try { const v = localStorage.getItem("mi:" + k); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } },
  set(k, v) { try { localStorage.setItem("mi:" + k, JSON.stringify(v)); } catch (e) { /* armazenamento cheio ou bloqueado */ } },
  del(k) { try { localStorage.removeItem("mi:" + k); } catch (e) {} },
};

function fmt(v, c = 2) { return ok(v) ? Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }) : "—"; }
function casasPreco(v) { return !ok(v) ? 2 : Math.abs(v) < 0.01 ? 6 : Math.abs(v) < 10 ? 4 : 2; }
function moeda(v, m = "R$", c) {
  if (!ok(v)) return "—";
  if (m === "pts") return fmt(v, c ?? 0) + " pts";
  return `${m} ${fmt(v, c ?? (m === "R$" && Math.abs(v) >= 1 ? 2 : casasPreco(v)))}`;
}
function pct(v, c = 2, sinal = false) { return ok(v) ? (sinal && v > 0 ? "+" : "") + fmt(v, c) + "%" : "—"; }
function reais(v) { return moeda(v, "R$", 2); }
function compacto(v, m = "R$") {
  if (!ok(v)) return "—";
  const a = Math.abs(v), p = m === "pts" ? "" : m + " ";
  if (a >= 1e12) return p + fmt(v / 1e12, 1) + " tri";
  if (a >= 1e9) return p + fmt(v / 1e9, 1) + " bi";
  if (a >= 1e6) return p + fmt(v / 1e6, 1) + " mi";
  if (a >= 1e4) return p + fmt(v / 1e3, 1) + " mil";
  return p + fmt(v, 2);
}
function setaVar(v, c = 2) {
  if (!ok(v)) return `<span class="var muted">—</span>`;
  const cls = v > 0 ? "up" : v < 0 ? "down" : "muted";
  const seta = v > 0 ? "↑" : v < 0 ? "↓" : "·";
  return `<span class="var ${cls}"><span aria-hidden="true">${seta}</span> ${pct(Math.abs(v), c)}<span class="sr">${v > 0 ? " de alta" : v < 0 ? " de queda" : ""}</span></span>`;
}
function num(str) {
  if (str == null) return NaN;
  const s = String(str).trim().replace(/\s|R\$|US\$|%/g, "");
  if (!s) return NaN;
  // aceita 1.234,56 · 1.000 · 1234.56
  const n = s.includes(",") ? s.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  return Number(n);
}
function dataCurta(ms, ano) {
  return new Date(ms).toLocaleDateString("pt-BR", ano ? { month: "short", year: "2-digit", timeZone: "UTC" } : { day: "2-digit", month: "short", timeZone: "UTC" }).replace(/\./g, "");
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
  return d === 1 ? "ontem" : `há ${d} dias`;
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function tituloCaso(s) {
  const minus = new Set(["de", "da", "do", "das", "dos", "e", "em", "a", "o"]);
  return String(s || "").toLowerCase().split(/\s+/).map((w, i) =>
    /^(fi|fic|fif|fia|fim|rf|cp|ls|ii|iii|iv|vi|xp|btg|bb|itau|ipca|cdi|di|esg|us|usd|ima|imab)$/.test(w) ? w.toUpperCase()
      : i > 0 && minus.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}

// =============================================================== ícones (traço fino, desenhados à mão)
const IC = {
  inicio: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  explorar: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  noticias: '<path d="M5 4h11a1 1 0 0 1 1 1v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z"/><path d="M17 9h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2"/><path d="M8 8h5M8 12h5M8 16h3"/>',
  carteira: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M16 15h2"/><path d="M7 6V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1"/>',
  mais: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  rf: '<path d="M3 21h18"/><path d="M5 21V10M9.5 21V10M14.5 21V10M19 21V10"/><path d="M2.5 10h19L12 3.5z"/>',
  mercado: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
  predio: '<path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16"/><path d="M14 9h5a1 1 0 0 1 1 1v11"/><path d="M8 8h2M8 12h2M8 16h2M17 13h0M17 17h0"/><path d="M2 21h20"/>',
  cesta: '<path d="M4 9h16l-1.5 10a2 2 0 0 1-2 1.7h-9A2 2 0 0 1 5.5 19z"/><path d="m9 9 3-5 3 5"/><path d="M9 13v4M15 13v4M12 13v4"/>',
  globo: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  pasta: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 14h8"/>',
  cripto: '<path d="M9 7h5a2.5 2.5 0 0 1 0 5H9zM9 12h6a2.5 2.5 0 0 1 0 5H9z"/><path d="M9 5v14M11 4v2M13 4v2M11 18v2M13 18v2"/>',
  moeda: '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.5A6 6 0 1 1 9.5 15.5"/><path d="M9 6.5v5M7.5 7.5h2.2a1 1 0 0 1 0 2H8.3a1 1 0 0 0 0 2h2.2"/>',
  pulso: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  ticket: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  ajustes: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  voltar: '<path d="m15 18-6-6 6-6"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  escudo: '<path d="M12 3 4.5 6v6c0 4.6 3.2 7.8 7.5 9 4.3-1.2 7.5-4.4 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
  alvo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  alta: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  baixa: '<path d="m3 7 6 6 4-4 8 8"/><path d="M14 17h7v-7"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v3M8 18h.01M12 18h.01"/>',
  troca: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
  pessoa: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  livro: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2.5zM20 19v3H6"/>',
  sino: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  celular: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
  sinal: '<path d="M4 20v-5M10 20V10M16 20V5"/>',
  externo: '<path d="M14 4h6v6M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  baixar: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>',
  subir: '<path d="M12 15V3m0 0L8 7m4-4 4 4M4 21h16"/>',
  editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  balanca: '<path d="M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z"/>',
  faisca: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
function ic(nome, extra = "") { return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${IC[nome] || ""}</svg>`; }

// =============================================================== catálogo
const TABS = {
  inicio: { nome: "Início", titulo: "Bom dia" },
  explorar: { nome: "Explorar", titulo: "Explorar" },
  noticias: { nome: "Notícias", titulo: "Notícias" },
  carteira: { nome: "Carteira", titulo: "Carteira" },
  mais: { nome: "Mais", titulo: "Mais" },
};

const SINAIS = {
  "COMPRA": { t: "Compra", cls: "b-up", cor: "var(--up)" },
  "VIÉS DE ALTA": { t: "Viés de alta", cls: "b-up", cor: "var(--up-2)" },
  "NEUTRO": { t: "Neutro", cls: "b-flat", cor: "var(--flat-2)" },
  "VIÉS DE BAIXA": { t: "Viés de baixa", cls: "b-down", cor: "var(--down-2)" },
  "VENDA": { t: "Venda", cls: "b-down", cor: "var(--down)" },
  "ATRATIVO": { t: "Taxa alta", cls: "b-up" },
  "RESERVA": { t: "Reserva", cls: "b-info" },
};
const ORDEM_SINAIS = ["VENDA", "VIÉS DE BAIXA", "NEUTRO", "VIÉS DE ALTA", "COMPRA"];
function badge(s) { const m = SINAIS[s] || { t: s, cls: "b-flat" }; return `<span class="badge ${m.cls}">${esc(m.t)}</span>`; }

// Categorias navegáveis (as de ativos vêm do data.json; renda fixa, fundos e subscrições têm telas próprias)
const CATS = {
  rf: { nome: "Renda fixa", ico: "rf", desc: "Tesouro Direto, CDB, LCI, LCA, CRI, CRA, debêntures e mais.", guia: "tesouro" },
  acoes_br: { nome: "Ações Brasil", ico: "mercado", desc: "Empresas da B3 separadas por setor.", guia: "acoes", cor: "var(--s2)" },
  fiis: { nome: "Fundos imobiliários", ico: "predio", desc: "FIIs e Fiagros, com rendimentos mensais.", guia: "fiis", cor: "var(--s3)" },
  etfs_br: { nome: "ETFs Brasil", ico: "cesta", desc: "Cestas de ativos em uma só compra na B3.", guia: "etfs", cor: "var(--s4)" },
  acoes_global: { nome: "Ações globais", ico: "globo", desc: "Gigantes dos EUA e do mundo, com o BDR equivalente.", guia: "global", cor: "var(--s1)" },
  etfs_global: { nome: "ETFs globais", ico: "cesta", desc: "ETFs negociados nos EUA.", guia: "etfs_global", cor: "var(--s7)" },
  fundos: { nome: "Fundos de investimento", ico: "pasta", desc: "Renda fixa, multimercado, ações e cambial, com dados oficiais da CVM.", guia: "fundos" },
  cripto: { nome: "Criptomoedas", ico: "cripto", desc: "Bitcoin, Ethereum, Solana, stablecoins e mais.", guia: "cripto", cor: "var(--s5)" },
  cambio: { nome: "Câmbio e commodities", ico: "moeda", desc: "Dólar, euro, ouro, petróleo e agrícolas.", guia: "cambio", cor: "var(--s6)" },
  indices: { nome: "Índices", ico: "pulso", desc: "Ibovespa, S&P 500 e as principais bolsas do mundo.", guia: "indices", cor: "var(--s8)" },
  subscricoes: { nome: "Subscrições", ico: "ticket", desc: "Direito de comprar novas ações e cotas com desconto.", guia: "subscricao" },
};
const ORDEM_CATS = ["rf", "acoes_br", "fiis", "etfs_br", "acoes_global", "etfs_global", "fundos", "cripto", "cambio", "indices", "subscricoes"];
const CATS_ATIVOS = ["acoes_br", "fiis", "etfs_br", "acoes_global", "etfs_global", "cripto", "cambio", "indices"];

// Guias de produto: o que é, riscos, liquidez, impostos e como investir
const PRODUTOS = {
  tesouro: { nome: "Tesouro Direto", oque: "Títulos públicos federais: você empresta dinheiro ao governo e recebe juros. É o investimento de menor risco de crédito do país.", ganha: "Juros pós-fixados (Selic), prefixados ou inflação + taxa fixa.", risco: "Muito baixo de calote. Títulos prefixados e IPCA+ oscilam de preço se vendidos antes do vencimento.", liquidez: "Diária (dinheiro em até 1 dia útil)", ir: "Tabela regressiva: 22,5% a 15% sobre o lucro", minimo: "Cerca de R$ 30", fgc: "Não precisa: garantia do Tesouro Nacional", onde: "Qualquer corretora ou banco habilitado, ou o app Tesouro Direto." },
  cdb: { nome: "CDB", oque: "Certificado de Depósito Bancário: você empresta dinheiro a um banco e recebe juros. É o investimento de renda fixa mais comum.", ganha: "Normalmente um % do CDI (ex.: 110% do CDI), mas há prefixados e IPCA+.", risco: "Baixo, se dentro do limite do FGC. Bancos menores pagam mais porque o risco é maior.", liquidez: "Diária ou só no vencimento, conforme o título", ir: "Tabela regressiva: 22,5% a 15% sobre o lucro", minimo: "A partir de R$ 1 em muitos bancos", fgc: "Sim: até R$ 250 mil por CPF por instituição", onde: "Apps de bancos e corretoras (prateleira de renda fixa)." },
  lci: { nome: "LCI", oque: "Letra de Crédito Imobiliário: empréstimo a um banco, que usa o dinheiro para financiar imóveis.", ganha: "Normalmente % do CDI, isento de IR.", risco: "Baixo, dentro do limite do FGC.", liquidez: "Há carência mínima definida pelo Conselho Monetário (hoje 12 meses em regra)", ir: "Isenta para pessoa física (regra atual)", minimo: "Varia por banco", fgc: "Sim: até R$ 250 mil por CPF por instituição", onde: "Apps de bancos e corretoras." },
  lca: { nome: "LCA", oque: "Letra de Crédito do Agronegócio: igual à LCI, mas o dinheiro financia o agronegócio.", ganha: "Normalmente % do CDI, isento de IR.", risco: "Baixo, dentro do limite do FGC.", liquidez: "Há carência mínima definida pelo Conselho Monetário (hoje 9 meses em regra)", ir: "Isenta para pessoa física (regra atual)", minimo: "Varia por banco", fgc: "Sim: até R$ 250 mil por CPF por instituição", onde: "Apps de bancos e corretoras." },
  lc: { nome: "LC", oque: "Letra de Câmbio: título emitido por financeiras. Funciona como um CDB.", ganha: "% do CDI, prefixado ou IPCA+, em geral acima dos CDBs de bancos grandes.", risco: "Moderado: financeiras são menores que bancos.", liquidez: "Geralmente só no vencimento", ir: "Tabela regressiva", minimo: "Varia", fgc: "Sim: até R$ 250 mil por CPF por instituição", onde: "Corretoras." },
  cri: { nome: "CRI", oque: "Certificado de Recebíveis Imobiliários: você financia uma operação imobiliária (aluguéis, financiamentos) e recebe juros.", ganha: "Geralmente IPCA + taxa ou % do CDI, acima dos bancários.", risco: "Médio: depende de quem paga a dívida. Não tem FGC.", liquidez: "Baixa: em geral só no vencimento", ir: "Isento para pessoa física", minimo: "R$ 1.000 em geral", fgc: "Não", onde: "Corretoras, na área de crédito privado." },
  cra: { nome: "CRA", oque: "Certificado de Recebíveis do Agronegócio: como o CRI, mas financia empresas do agro.", ganha: "Geralmente IPCA + taxa ou % do CDI.", risco: "Médio: depende da empresa devedora. Não tem FGC.", liquidez: "Baixa", ir: "Isento para pessoa física", minimo: "R$ 1.000 em geral", fgc: "Não", onde: "Corretoras." },
  debenture: { nome: "Debêntures", oque: "Títulos de dívida de empresas. As “incentivadas” financiam infraestrutura e são isentas de IR.", ganha: "IPCA + taxa, CDI + spread ou prefixado.", risco: "Médio a alto: depende da saúde da empresa. Não tem FGC.", liquidez: "Baixa a média (mercado secundário)", ir: "Incentivadas: isentas. Comuns: tabela regressiva", minimo: "R$ 1.000 em geral", fgc: "Não", onde: "Corretoras." },
  poupanca: { nome: "Poupança", oque: "Conta de depósito com rendimento definido por lei.", ganha: "0,5% ao mês + TR com Selic acima de 8,5%; senão, 70% da Selic + TR.", risco: "Muito baixo.", liquidez: "Imediata (rende só no aniversário mensal)", ir: "Isenta", minimo: "Nenhum", fgc: "Sim", onde: "Qualquer banco." },
  previdencia: { nome: "Previdência privada", oque: "Planos PGBL e VGBL para longo prazo, com benefícios fiscais e sucessórios.", ganha: "Depende do fundo escolhido (renda fixa, multimercado, ações).", risco: "Depende do fundo. Atenção às taxas de administração e carregamento.", liquidez: "Baixa: resgates têm carência e IR alto no curto prazo (tabela regressiva)", ir: "Progressiva ou regressiva (de 35% a 10%), à escolha", minimo: "Varia", fgc: "Não (patrimônio separado da seguradora)", onde: "Bancos, seguradoras e corretoras." },
  coe: { nome: "COE", oque: "Certificado de Operações Estruturadas: combina renda fixa e derivativos para um resultado pré-definido.", ganha: "Conforme o cenário contratado (ex.: participação na alta de um índice).", risco: "Alto risco de entendimento; pode ter perda do capital em alguns modelos. Não tem FGC.", liquidez: "Muito baixa", ir: "Tabela regressiva", minimo: "Varia", fgc: "Não", onde: "Bancos e corretoras." },
  acoes: { nome: "Ações", oque: "Pequenas partes de empresas listadas na B3. Você ganha com valorização e com dividendos.", ganha: "Valorização das ações e proventos (dividendos e JCP).", risco: "Alto: preços oscilam muito no curto prazo.", liquidez: "Alta (venda em segundos, dinheiro em 2 dias úteis)", ir: "15% sobre o lucro; vendas de até R$ 20 mil por mês isentas (regra atual)", minimo: "1 ação no mercado fracionário (código com F)", fgc: "Não", onde: "Home broker de qualquer corretora." },
  fiis: { nome: "Fundos imobiliários", oque: "Fundos negociados na bolsa que investem em imóveis (galpões, shoppings, escritórios) ou em títulos imobiliários (CRI). Fiagros fazem o mesmo no agronegócio.", ganha: "Rendimentos mensais (aluguéis ou juros) e valorização das cotas.", risco: "Médio: cotas oscilam com juros e vacância.", liquidez: "Média a alta (bolsa)", ir: "Rendimentos isentos para pessoa física em fundos que seguem as regras; 20% sobre lucro na venda", minimo: "1 cota", fgc: "Não", onde: "Home broker de qualquer corretora." },
  etfs: { nome: "ETFs", oque: "Fundos que copiam um índice e são negociados como ações. Uma compra dá acesso a dezenas ou centenas de ativos.", ganha: "Acompanha o índice (Ibovespa, S&P 500, ouro, cripto, renda fixa).", risco: "O mesmo do índice que copia.", liquidez: "Alta", ir: "15% sobre o lucro (sem isenção de R$ 20 mil); ETFs de renda fixa seguem tabela própria", minimo: "1 cota", fgc: "Não", onde: "Home broker de qualquer corretora." },
  etfs_global: { nome: "ETFs globais", oque: "ETFs negociados nas bolsas dos EUA, em dólar.", ganha: "Acompanha índices globais, setores e commodities, em dólar.", risco: "O do índice mais a variação do dólar.", liquidez: "Alta", ir: "15% sobre ganhos no exterior, apurados uma vez por ano (regra atual)", minimo: "Frações de cota em muitas corretoras", fgc: "Não", onde: "Conta em corretora internacional, ou ETFs/BDRs equivalentes na B3." },
  global: { nome: "Ações globais", oque: "Ações de empresas estrangeiras, como Apple e Nvidia. Pode investir direto no exterior ou por BDRs na B3.", ganha: "Valorização em dólar, dividendos e variação cambial.", risco: "Alto: oscilação da ação e do dólar.", liquidez: "Alta", ir: "BDR: 15% sobre o lucro (sem isenção). Exterior: 15% sobre ganhos, apuração anual (regra atual)", minimo: "1 BDR, ou frações de ação no exterior", fgc: "Não", onde: "BDRs: qualquer corretora. Ações: conta internacional." },
  fundos: { nome: "Fundos de investimento", oque: "Um gestor profissional investe o dinheiro de vários cotistas segundo uma política definida.", ganha: "Valorização das cotas, conforme a estratégia (renda fixa, multimercado, ações, cambial).", risco: "Depende da classe: de baixo (renda fixa) a alto (ações).", liquidez: "Definida no regulamento (de D+0 a D+60 ou mais)", ir: "Come-cotas semestral em fundos abertos de renda fixa e multimercado; ações: 15% no resgate", minimo: "Definido por cada fundo", fgc: "Não", onde: "Plataformas de bancos e corretoras. Busque pelo CNPJ." },
  cripto: { nome: "Criptomoedas", oque: "Ativos digitais descentralizados, como Bitcoin e Ethereum. Stablecoins (USDT, USDC) acompanham o dólar.", ganha: "Valorização do ativo (algumas pagam recompensas de staking).", risco: "Muito alto: quedas de 50% ou mais já aconteceram várias vezes.", liquidez: "Alta, 24 horas por dia", ir: "Ganhos em vendas acima de R$ 35 mil por mês pagam IR (regra atual)", minimo: "Frações (ex.: 0,0001 BTC)", fgc: "Não", onde: "Corretoras de cripto, bancos digitais ou ETFs de cripto na B3." },
  cambio: { nome: "Câmbio e commodities", oque: "Moedas estrangeiras e matérias-primas como ouro e petróleo.", ganha: "Variação de preço. Bom para proteger a carteira em crises.", risco: "Médio a alto.", liquidez: "Alta", ir: "Depende do produto (ETF, fundo cambial, conta global)", minimo: "Varia", fgc: "Não", onde: "ETFs (GOLD11, USDB11), fundos cambiais ou contas globais." },
  indices: { nome: "Índices", oque: "Termômetros do mercado: médias de preços de um grupo de ações. Não se compra um índice diretamente.", ganha: "Para investir no índice, use um ETF que o copia (ex.: BOVA11 para Ibovespa, IVVB11 para S&P 500).", risco: "O do mercado como um todo.", liquidez: "—", ir: "Conforme o ETF ou fundo usado", minimo: "—", fgc: "Não", onde: "Via ETFs e fundos de índice." },
  subscricao: { nome: "Subscrição", oque: "Quando uma empresa ou FII emite novas ações ou cotas, quem já é acionista tem preferência para comprar, geralmente com desconto.", ganha: "Desconto em relação ao preço de mercado, ou vendendo o direito na bolsa.", risco: "Se você não fizer nada até o prazo, o direito vence e perde o valor.", liquidez: "O direito pode ser vendido na bolsa durante o período", ir: "Lucro na venda do direito segue a regra do ativo", minimo: "Proporcional às cotas que você já tem", fgc: "Não", onde: "Pela corretora onde estão suas ações ou cotas." },
};

const CLASSES = ["Renda fixa", "Fundos", "Ações Brasil", "FIIs", "ETFs", "Internacional", "Cripto", "Outros"];
const COR_CLASSE = { "Renda fixa": "var(--s1)", "Fundos": "var(--s7)", "Ações Brasil": "var(--s2)", "FIIs": "var(--s3)", "ETFs": "var(--s4)", "Internacional": "var(--s6)", "Cripto": "var(--s5)", "Outros": "var(--s8)" };
const CLASSE_DA_CAT = { acoes_br: "Ações Brasil", fiis: "FIIs", etfs_br: "ETFs", acoes_global: "Internacional", etfs_global: "Internacional", cripto: "Cripto", cambio: "Outros", indices: "Outros" };
const RISCO_N = { "baixo": 1, "médio": 2, "alto": 3 };

const PERFIS = {
  conservador: { nome: "Conservador", risco: 1, desc: "Prioriza não perder dinheiro. Aceita ganhar menos em troca de estabilidade.",
    meta: { "Renda fixa": 70, "Fundos": 10, "Ações Brasil": 5, "FIIs": 8, "ETFs": 2, "Internacional": 5, "Cripto": 0 } },
  moderado: { nome: "Moderado", risco: 2, desc: "Aceita algumas oscilações para buscar um retorno maior no médio prazo.",
    meta: { "Renda fixa": 45, "Fundos": 10, "Ações Brasil": 13, "FIIs": 12, "ETFs": 5, "Internacional": 12, "Cripto": 3 } },
  arrojado: { nome: "Arrojado", risco: 3, desc: "Aceita quedas fortes no caminho buscando o maior retorno no longo prazo.",
    meta: { "Renda fixa": 20, "Fundos": 5, "Ações Brasil": 25, "FIIs": 12, "ETFs": 8, "Internacional": 22, "Cripto": 8 } },
};

const TIPOS_TESOURO = {
  "Tesouro Selic": { grupo: "Selic", idx: "Selic", desc: "Acompanha a taxa Selic e quase não oscila. Indicado para reserva de emergência e curto prazo." },
  "Tesouro Prefixado": { grupo: "Prefixado", idx: "pre", desc: "Você sabe exatamente quanto vai receber no vencimento. Ganha se os juros caírem." },
  "Tesouro Prefixado com Juros Semestrais": { grupo: "Prefixado", idx: "pre", desc: "Prefixado que paga juros a cada 6 meses." },
  "Tesouro IPCA+": { grupo: "IPCA+", idx: "IPCA", desc: "Protege da inflação: IPCA mais uma taxa fixa. Para objetivos de longo prazo." },
  "Tesouro IPCA+ com Juros Semestrais": { grupo: "IPCA+", idx: "IPCA", desc: "IPCA mais taxa fixa, com juros a cada 6 meses." },
  "Tesouro Renda+ Aposentadoria Extra": { grupo: "Aposentadoria e educação", idx: "IPCA", desc: "Acumula até a data escolhida e depois paga 240 parcelas mensais corrigidas pela inflação." },
  "Tesouro Educa+": { grupo: "Aposentadoria e educação", idx: "IPCA", desc: "Acumula até a data escolhida e depois paga 60 parcelas mensais para estudos." },
  "Tesouro IGPM+ com Juros Semestrais": { grupo: "Outros", idx: "IGP-M", desc: "Título antigo corrigido pelo IGP-M mais taxa fixa." },
};
function tipoInfo(t) { return TIPOS_TESOURO[t.tipo] || { grupo: "Outros", idx: t.tipo.includes("IPCA") ? "IPCA" : t.tipo.includes("Selic") ? "Selic" : "pre", desc: "" }; }
function taxaTexto(t) { const i = tipoInfo(t).idx; return i === "pre" ? `${fmt(t.taxa)}% a.a.` : `${i} + ${fmt(t.taxa)}%`; }
function nomeTitulo(t) { return `${t.tipo.replace("Tesouro ", "").replace(" com Juros Semestrais", " Semestral").replace(" Aposentadoria Extra", "")} ${t.vencimento.slice(-4)}`; }
function riscoTesouro(t) { return t.risco.startsWith("baixo") ? "baixo" : t.risco.startsWith("médio") ? "médio" : "alto"; }

const GLOSS = {
  selic: ["Selic", "Taxa básica de juros do Brasil, definida pelo Banco Central a cada 45 dias. Referência para quase toda a renda fixa e para os juros de empréstimos."],
  cdi: ["CDI", "Taxa que os bancos usam para emprestar entre si; anda colada à Selic. Um CDB de “100% do CDI” rende o mesmo que essa taxa."],
  ipca: ["IPCA (inflação)", "Índice oficial de inflação. Mostra quanto os preços subiram em 12 meses. Investir abaixo dele é perder poder de compra."],
  juro_real: ["Juro real", "Quanto a Selic rende acima da inflação. Juro real alto favorece a renda fixa."],
  dolar: ["Dólar (PTAX)", "Cotação oficial do dólar calculada pelo Banco Central."],
  poupanca: ["Poupança", "Com a Selic acima de 8,5% ao ano, rende 0,5% ao mês mais TR (cerca de 6,2% ao ano). É isenta de IR, mas costuma render menos que Tesouro Selic e CDBs de 100% do CDI."],
  rsi: ["RSI (Índice de Força Relativa)", "Vai de 0 a 100 e mede se o preço subiu ou caiu rápido demais nos últimos 14 pregões. Abaixo de 30: queda exagerada. Acima de 70: alta exagerada."],
  mm50: ["Média móvel de 50 dias", "Preço médio dos últimos 50 pregões. Mostra a tendência de médio prazo."],
  mm200: ["Média móvel de 200 dias", "Preço médio dos últimos 200 pregões (cerca de 10 meses). Preço acima dela indica tendência de longo prazo positiva."],
  volatilidade: ["Volatilidade", "Quanto o preço costuma oscilar em um ano. Abaixo de 20%: baixo risco. Acima de 35%: alto."],
  dy: ["Proventos em 12 meses (dividend yield)", "Quanto o ativo pagou em dividendos ou rendimentos no último ano, em % do preço atual."],
  ret12: ["Rentabilidade em 12 meses", "Quanto o preço variou no último ano. Para ativos em dólar, o app também mostra o resultado convertido para reais."],
  queda_max: ["Distância da máxima", "Quanto o preço está abaixo do maior valor dos últimos 12 meses."],
  liquidez: ["Liquidez", "Facilidade de vender sem afetar o preço. Na bolsa, medimos pelo volume médio negociado por dia nos últimos 30 pregões."],
  score: ["Pontuação do sinal", "Soma das regras do app (de −4 a +5). 3 ou mais = Compra; 1 a 2 = viés de alta; −1 a 0 = neutro; −2 = viés de baixa; −3 ou menos = Venda."],
  percentil: ["Percentil de 5 anos", "Compara a taxa de hoje com todas as taxas do mesmo tipo de título nos últimos 5 anos. Percentil 90: a taxa de hoje supera 90% das taxas do período."],
  marcacao: ["Marcação a mercado", "O preço de um título muda todos os dias conforme os juros. Vendendo antes do vencimento você pode ganhar mais ou menos que o contratado. Levando até o fim, recebe a taxa combinada."],
  ir: ["Imposto de renda na renda fixa", "Tabela regressiva sobre o lucro: 22,5% até 180 dias, 20% até 360, 17,5% até 720 e 15% acima. LCI, LCA, CRI, CRA, debêntures incentivadas e poupança são isentas para pessoa física (regra atual)."],
  fgc: ["FGC", "Fundo Garantidor de Créditos: cobre até R$ 250 mil por CPF por instituição (limite total de R$ 1 milhão a cada 4 anos) em CDB, LCI, LCA, LC e poupança se o banco quebrar."],
  fracionario: ["Mercado fracionário", "Ações são negociadas em lotes de 100. Para comprar de 1 a 99, use o código com F no final, por exemplo PETR4F."],
  bdr: ["BDR", "Recibo negociado na B3 que representa ações de empresas estrangeiras. Permite investir na Apple ou na Nvidia em reais, pela corretora brasileira."],
  stablecoin: ["Stablecoin", "Criptomoeda que acompanha uma moeda tradicional, normalmente o dólar (USDT, USDC). Serve para guardar valor e fazer transferências."],
  come_cotas: ["Come-cotas", "Antecipação do IR em fundos abertos de renda fixa e multimercado, cobrada em maio e novembro sobre o rendimento do período."],
  custodia: ["Taxa de custódia", "A B3 cobra 0,20% ao ano sobre o valor em Tesouro Direto. No Tesouro Selic há isenção até R$ 10 mil (regra atual)."],
  reserva: ["Reserva de emergência", "Dinheiro para imprevistos, em investimento seguro e com resgate rápido. Em geral, de 6 a 12 meses dos seus gastos."],
  rebalancear: ["Rebalancear", "Ajustar a carteira para voltar às proporções planejadas, direcionando aportes para o que ficou abaixo da meta."],
  preco_medio: ["Preço médio", "Média do que você pagou por um ativo, considerando todas as compras."],
  diversificacao: ["Diversificação", "Distribuir o dinheiro em tipos diferentes de investimento para que uma queda isolada não comprometa tudo."],
  pct_cdi: ["% do CDI", "Quanto o investimento rendeu em relação ao CDI no mesmo período. 110% do CDI significa que rendeu 10% a mais que o CDI."],
  pl: ["Patrimônio líquido", "Total de dinheiro aplicado no fundo. Fundos muito pequenos podem ter custos maiores por cotista."],
  subscricao: ["Direito de subscrição", "Preferência para comprar novas ações ou cotas emitidas. Aparece na sua carteira com código terminado em 1 ou 2 (ações) ou 12 e 13 (FIIs)."],
};

// =============================================================== estado
const S = {
  data: null, origem: null, erroCarga: null, carregando: false,
  noticias: null, fundos: null, carregandoFundos: false,
  tab: "inicio", sub: null, sheet: null, pilha: 0,
  perfil: store.get("perfil", "moderado"),
  tema: store.get("tema", "auto"),
  favs: new Set(store.get("favs", [])),
  carteira: store.get("carteira", []),
  ofertas: store.get("ofertas", []),
  f: Object.assign({ grupo: "Todos", sinal: "Todos", ordem: "sinal", soPerfil: false, q: "" }, store.get("filtroCat", {}), { q: "" }),
  rf: Object.assign({ aba: "tesouro", grupo: "Todos", ordem: "vencimento" }, store.get("filtroRF", {})),
  fu: Object.assign({ classe: "Renda Fixa", ordem: "ret_12m", publico: false, q: "" }, store.get("filtroFundos", {}), { q: "" }),
  nf: { tema: "Todas", fonte: "Todas", q: "", limite: 30 },
  graf: Object.assign({ faixa: "6M", mm50: true, mm200: true }, store.get("grafico", {})),
  sim: null, addTipo: null, voltarFoco: null,
};
if (!PERFIS[S.perfil]) S.perfil = "moderado";
function salvarFiltros() {
  const tira = ({ q, ...r }) => r;
  store.set("filtroCat", tira(S.f));
  store.set("filtroRF", S.rf);
  store.set("filtroFundos", tira(S.fu));
  store.set("grafico", S.graf);
}

// =============================================================== dados
const HIST = new Map();

async function getJSON(nome) {
  const r = await fetch(nome + (nome.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error(`${nome}: HTTP ${r.status}`);
  return r.json();
}
function decodHist(h) {
  if (!h || !Array.isArray(h.c) || h.c.length < 2) return null;
  let t = Date.parse(h.t0 + "T12:00:00Z");
  const datas = [], vals = [];
  h.c.forEach((v, i) => { t += ((h.dt && h.dt[i]) || 0) * 864e5; if (v != null) { datas.push(t); vals.push(v); } });
  return { datas, vals };
}
const CAT_LEGADA = { "Ações": "acoes_br", "FIIs": "fiis", "ETFs": "etfs_br", "Cripto e câmbio": "cripto" };
function preparar(d) {
  d.macro = d.macro || {};
  d.ativos = (d.ativos || []).map(a => ({ ...a, cat: a.cat || CAT_LEGADA[a.classe] || "acoes_br", h: a.h || a.ticker.replace(/[^A-Za-z0-9]+/g, "_") }));
  d.tes = (d.tesouro && d.tesouro.titulos) || [];
  d.idxAtivo = new Map(d.ativos.map(a => [a.ticker, a]));
  d.idxTes = new Map(d.tes.map(t => [t.id, t]));
  d.porCat = {};
  d.ativos.forEach(a => (d.porCat[a.cat] = d.porCat[a.cat] || []).push(a));
  d.quando = parseBR(d.atualizado);
  d.usd = (d.idxAtivo.get("BRL=X") || {}).preco || d.macro.dolar_ptax || null;
  return d;
}
function emReais(a) {
  if (!a || !ok(a.preco)) return null;
  if (a.moeda === "R$") return a.preco;
  if (a.moeda === "US$" && ok(S.data.usd)) return a.preco * S.data.usd;
  return null;
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
    const bruto = await getJSON("data.json");
    store.set("cache", bruto);
    S.data = preparar(bruto);
    S.origem = "rede";
    S.erroCarga = null;
    carregarNoticias().then(() => { if (S.tab === "noticias" || S.tab === "inicio") renderView(); });
    if (S.fundos) carregarFundos(true);
    if (manual) toast("Dados atualizados");
  } catch (e) {
    S.erroCarga = e.message || String(e);
    if (!S.data) {
      const c = store.get("cache", null);
      if (c) { S.data = preparar(c); S.origem = "cache"; }
      const n = store.get("cacheNoticias", null);
      if (n && !S.noticias) S.noticias = n;
    }
    if (manual) toast(S.data ? "Sem conexão. Mostrando os últimos dados salvos." : "Não foi possível carregar os dados.");
  } finally {
    S.carregando = false;
    $("#btn-refresh").classList.remove("spin");
    renderTudo();
  }
}
async function carregarNoticias() {
  try {
    S.noticias = await getJSON("noticias.json");
    store.set("cacheNoticias", S.noticias);
  } catch (e) {
    if (!S.noticias) S.noticias = store.get("cacheNoticias", null);
  }
}
async function carregarFundos(forcar) {
  if ((S.fundos && !forcar) || S.carregandoFundos) return;
  S.carregandoFundos = true;
  try {
    const f = await getJSON("fundos.json");
    f.fundos = (f.fundos || []).map(x => ({ ...x, curto: nomeFundo(x.nome) }));
    S.fundos = f;
  } catch (e) {
    S.fundos = S.fundos || { fundos: [], erro: e.message };
  } finally {
    S.carregandoFundos = false;
    if (S.tab === "explorar" && S.sub === "fundos") renderView();
    if (S.sheet && S.sheet.tipo === "busca") renderSheet();
  }
}
async function carregarHist(a) {
  if (HIST.has(a.h)) return HIST.get(a.h);
  const d = await getJSON("hist/" + encodeURIComponent(a.h) + ".json");
  d.serie = decodHist(d.hist);
  HIST.set(a.h, d);
  return d;
}
function nomeFundo(n) {
  let s = String(n || "")
    .replace(/FUNDO DE INVESTIMENTO (FINANCEIRO )?(EM COTAS DE FUNDOS DE INVESTIMENTO (FINANCEIRO )?)?/gi, "")
    .replace(/FUNDO DE INVESTIMENTO EM AÇÕES/gi, "Ações")
    .replace(/CLASSE (DE INVESTIMENTO )?(EM COTAS )?(DE )?(FUNDOS? )?(DE INVESTIMENTO )?/gi, "")
    .replace(/RESPONSABILIDADE LIMITADA|RESP(\.)? LIMITADA|RESP(\.)? LTDA|\bLTDA\b|- RL\b|\bRL\b/gi, "")
    .replace(/\b(FIF|FIC|FICFI|FIC FIF|CIC|FI)\b/gi, "")
    .replace(/[-–]\s*$/g, "").replace(/\s{2,}/g, " ").trim();
  return tituloCaso(s || n);
}

// =============================================================== carteira
function classeDoItem(p, ref) {
  if (p.tipo === "tesouro") return "Renda fixa";
  if (p.tipo === "fundo") return ref && ref.classe === "Ações" ? "Fundos" : "Fundos";
  if (p.tipo === "ativo") return ref ? CLASSE_DA_CAT[ref.cat] || "Outros" : "Outros";
  return p.classe || "Outros";
}
function posicoes() {
  const d = S.data;
  return S.carteira.map(p => {
    let valor = null, custo = null, varDia = null, nome = p.nome, sinal = null, ref = null, moedaAtivo = "R$";
    if (p.tipo === "ativo" && d) {
      ref = d.idxAtivo.get(p.ref);
      if (ref) {
        const fx = ref.moeda === "US$" ? d.usd : 1;
        moedaAtivo = ref.moeda;
        valor = ok(fx) ? ref.preco * p.qtd * fx : null;
        custo = ok(fx) && ok(p.pm) ? p.pm * p.qtd * fx : null;
        varDia = ok(ref.var_dia) && ok(valor) ? valor - valor / (1 + ref.var_dia / 100) : null;
        nome = ref.nome; sinal = ref.sinal;
      }
    } else if (p.tipo === "tesouro" && d) {
      ref = d.idxTes.get(p.ref);
      if (ref) {
        const pu = ok(ref.preco_venda) && ref.preco_venda > 0 ? ref.preco_venda : ref.preco;
        valor = pu * p.qtd; nome = ref.tipo + " " + ref.vencimento.slice(-4); sinal = ref.sinal;
      }
      custo = ok(p.pm) ? p.pm * p.qtd : null;
    } else if (p.tipo === "fundo") {
      ref = S.fundos ? S.fundos.fundos.find(f => f.cnpj === p.ref) : null;
      valor = p.valor; custo = p.custo; nome = p.nome || (ref && ref.curto);
    } else {
      valor = p.valor; custo = p.custo;
    }
    const resultado = ok(valor) && ok(custo) ? valor - custo : null;
    return { ...p, nome: nome || p.ref || "Investimento", classe: classeDoItem(p, ref), valor, custo, resultado,
      resPct: ok(resultado) && custo > 0 ? resultado / custo * 100 : null, varDia, sinal, refObj: ref, moedaAtivo };
  });
}
function salvarCarteira() { store.set("carteira", S.carteira); }
function posicaoDe(tipo, ref) { return S.carteira.find(p => p.tipo === tipo && p.ref === ref); }

// =============================================================== componentes
function avatar(a) {
  const cor = (CATS[a.cat] || {}).cor || "var(--s8)";
  const txt = a.codigo.length > 5 ? a.codigo.slice(0, 4) : a.codigo;
  return `<span class="av" style="color:${cor};background:color-mix(in srgb, ${cor} 14%, transparent);border-color:color-mix(in srgb, ${cor} 22%, transparent)" aria-hidden="true">${esc(txt)}</span>`;
}
function spark(vals, w = 62, h = 28, cor) {
  const v = (vals || []).filter(ok);
  if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const min = Math.min(...v), max = Math.max(...v), r = max - min || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 3 - (y - min) / r * (h - 6)).toFixed(1)}`).join(" ");
  const c = cor || (v[v.length - 1] >= v[0] ? "var(--up)" : "var(--down)");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function regua(score) {
  const pos = clamp((score + 4) / 9 * 100, 2, 98);
  const zona = score >= 3 ? 4 : score >= 1 ? 3 : score >= -1 ? 2 : score >= -2 ? 1 : 0;
  const nomes = ["Venda", "Baixa", "Neutro", "Alta", "Compra"];
  const cores = ["var(--down)", "var(--down-2)", "var(--flat-2)", "var(--up-2)", "var(--up)"];
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
    <div class="range-l"><span>mín. 5 anos ${fmt(t.taxa_min_5a)}%</span><span>máx. ${fmt(t.taxa_max_5a)}%</span></div></div>`;
}
function acimaDoPerfil(a) { return (RISCO_N[a.risco] || 2) > PERFIS[S.perfil].risco; }

function rowAtivo(a, opts = {}) {
  const fav = S.favs.has(a.ticker);
  const extra = [];
  if (opts.grupo !== false && a.grupo) extra.push(esc(a.grupo));
  if (opts.cat) extra.push(esc(CATS[a.cat] ? CATS[a.cat].nome : a.cat));
  const sub = esc(a.nome) + (extra.length ? " · " + extra.join(" · ") : "");
  const preco = a.cat === "cripto" && ok(S.data.usd) && opts.reais ? moeda(a.preco * S.data.usd, "R$") : moeda(a.preco, a.moeda);
  const foot = [badge(a.sinal)];
  if (a.cat !== "indices" && a.cat !== "cambio") foot.push(`<span class="tag">risco ${esc(a.risco)}</span>`);
  if (ok(a.dy) && a.dy > 0 && (a.cat === "fiis" || opts.dy)) foot.push(`<span class="pill">DY ${pct(a.dy, 1)}</span>`);
  if (a.bdr) foot.push(`<span class="pill">BDR ${esc(a.bdr)}${ok(a.bdr_preco) ? " · " + moeda(a.bdr_preco) : ""}</span>`);
  if (acimaDoPerfil(a) && a.cat !== "indices") foot.push(`<span class="tag warn">acima do seu perfil</span>`);
  if (posicaoDe("ativo", a.ticker)) foot.push(`<span class="tag">na carteira</span>`);
  if (a.desatualizado) foot.push(`<span class="tag warn">cotação antiga</span>`);
  return `<button type="button" class="row" data-act="ativo" data-id="${esc(a.ticker)}">
    ${avatar(a)}
    <span><span class="code">${esc(a.codigo)}${fav ? ic("star") : ""}</span><span class="name">${sub}</span></span>
    ${spark(a.spark)}
    <span class="end"><span class="price">${preco}</span>${setaVar(a.var_dia)}</span>
    ${opts.compacto ? "" : `<span class="foot">${foot.join("")}</span>`}
  </button>`;
}
function rowTitulo(t) {
  const sel = tipoInfo(t).idx === "Selic";
  return `<button type="button" class="row no-av" data-act="titulo" data-id="${esc(t.id)}">
    <span><span class="code">${esc(nomeTitulo(t))}</span><span class="name">Vence ${esc(t.vencimento)} · ${fmt(t.anos, 1)} anos</span></span>
    <span class="end"><span class="price">${esc(taxaTexto(t))}</span><span class="var muted">${sel ? "liquidez diária" : "ao ano"}</span></span>
    <span class="foot">${badge(t.sinal)}${ok(t.percentil_5a) && !sel ? `<span class="tag">percentil ${fmt(t.percentil_5a, 0)} em 5 anos</span>` : ""}<span class="pill">mín. ${reais(t.minimo ?? Math.max(30, t.preco / 100))}</span></span>
    ${sel ? "" : faixaTaxa(t).replace('class="rangebox"', 'class="rangebox" style="grid-column:1/-1"')}
  </button>`;
}
function rowFundo(f) {
  const cdi = ok(f.pct_cdi) ? `<span class="pill">${fmt(f.pct_cdi, 0)}% do CDI</span>` : "";
  return `<button type="button" class="row no-av" data-act="fundo" data-id="${esc(f.cnpj)}">
    <span><span class="code" style="font-size:14px">${esc(f.curto)}</span><span class="name">${esc(tituloCaso(f.gestor || ""))}${f.anbima ? " · " + esc(f.anbima) : ""}</span></span>
    <span class="end"><span class="price ${f.ret_12m > 0 ? "up" : f.ret_12m < 0 ? "down" : ""}">${pct(f.ret_12m, 1, true)}</span><span class="var muted">12 meses</span></span>
    <span class="foot">${cdi}<span class="pill">PL ${compacto(f.pl)}</span><span class="tag">${fmt(f.cotistas, 0)} cotistas</span>${f.publico && f.publico !== "Público Geral" ? `<span class="tag warn">${esc(f.publico)}</span>` : ""}</span>
  </button>`;
}
function lista(itens, render, vazio, limite) {
  if (!itens.length) return `<div class="empty">${vazio}</div>`;
  const mostra = limite ? itens.slice(0, limite) : itens;
  return `<div class="list">${mostra.map(render).join("")}${limite && itens.length > limite ? `<button class="more" data-act="mais-itens">Mostrar mais ${itens.length - limite}</button>` : ""}</div>`;
}

// ---------- gráfico de linhas com cursor e dica
function niceTicks(min, max, n = 4) {
  if (min === max) { min -= Math.abs(min) * 0.05 || 1; max += Math.abs(max) * 0.05 || 1; }
  const bruto = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map(f => f * mag).find(p => p >= bruto) || 10 * mag;
  const ini = Math.floor(min / passo) * passo, fim = Math.ceil(max / passo) * passo;
  const ticks = [];
  for (let v = ini; v <= fim + passo / 2; v += passo) ticks.push(+v.toPrecision(12));
  return ticks;
}
const graficos = new Map();
function montarGrafico(el, cfg) { graficos.set(el, cfg); desenharGrafico(el); }
function desenharGrafico(el) {
  const cfg = graficos.get(el);
  if (!cfg || !el.isConnected) { graficos.delete(el); return; }
  const { datas, series, fmtV, altura = 230 } = cfg;
  const vis = series.filter(s => s.on !== false);
  const W = Math.max(260, el.clientWidth), H = altura;
  const m = { t: 12, r: 6, b: 26, l: 54 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const todos = vis.flatMap(s => s.vals.filter(ok));
  if (!todos.length || datas.length < 2) { el.innerHTML = `<div class="empty">Sem histórico suficiente para o gráfico.</div>`; return; }
  const ticks = niceTicks(Math.min(...todos), Math.max(...todos));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1], n = datas.length;
  const X = i => m.l + i / (n - 1) * pw;
  const Y = v => m.t + ph - (v - y0) / (y1 - y0 || 1) * ph;
  const caminho = vals => { let d = "", pen = false; vals.forEach((v, i) => { if (!ok(v)) { pen = false; return; } d += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); pen = true; }); return d; };
  const principal = vis[vis.length - 1];
  const gid = "g" + Math.random().toString(36).slice(2, 7);
  const area = principal && principal.area ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${principal.cor}" stop-opacity=".22"/><stop offset="1" stop-color="${principal.cor}" stop-opacity="0"/></linearGradient></defs>
    <path d="${caminho(principal.vals)}L${X(n - 1).toFixed(1)} ${m.t + ph}L${X(principal.vals.findIndex(ok)).toFixed(1)} ${m.t + ph}Z" fill="url(#${gid})"/>` : "";
  const linhas = vis.map(s => `<path d="${caminho(s.vals)}" fill="none" stroke="${s.cor}" stroke-width="${s.largura || 2}" stroke-linejoin="round" stroke-linecap="round"/>`).join("");
  const grid = ticks.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/>
    <text class="tick" x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(fmtV(t, true))}</text>`).join("");
  const span = datas[n - 1] - datas[0];
  const nx = W < 420 ? 3 : 5;
  const xl = Array.from({ length: nx }, (_, k) => Math.round(k / (nx - 1) * (n - 1))).map((i, k) =>
    `<text class="tick" x="${X(i)}" y="${H - 6}" text-anchor="${k === 0 ? "start" : k === nx - 1 ? "end" : "middle"}">${esc(dataCurta(datas[i], span > 300 * 864e5))}</text>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(cfg.rotulo || "Gráfico")}">
      ${grid}${area}${linhas}${xl}
      <g class="cursor" style="display:none"><line y1="${m.t}" y2="${m.t + ph}" stroke="var(--muted)" stroke-dasharray="3 3"/>${vis.map(s => `<circle r="4.5" fill="${s.cor}" stroke="var(--glass-solid)" stroke-width="2"/>`).join("")}</g>
      <rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>
    </svg><div class="tip"></div>`;
  const svg = el.querySelector("svg"), cur = svg.querySelector(".cursor"), tip = el.querySelector(".tip");
  const mover = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    const i = clamp(Math.round((px - m.l) / pw * (n - 1)), 0, n - 1);
    cur.style.display = "";
    const ln = cur.querySelector("line"); ln.setAttribute("x1", X(i)); ln.setAttribute("x2", X(i));
    $$("circle", cur).forEach((c, k) => {
      const v = vis[k].vals[i];
      c.style.display = ok(v) ? "" : "none";
      if (ok(v)) { c.setAttribute("cx", X(i)); c.setAttribute("cy", Y(v)); }
    });
    tip.innerHTML = `<b>${esc(new Date(datas[i]).toLocaleDateString("pt-BR", { timeZone: "UTC" }))}</b><br>` +
      [...vis].reverse().map(s => `<i style="background:${s.cor}"></i>${esc(s.nome)}: ${esc(fmtV(s.vals[i]))}`).join("<br>");
    tip.classList.add("on");
    const tx = X(i) / W * r.width, tw = tip.offsetWidth;
    tip.style.left = clamp(tx + 14 + tw > r.width ? tx - tw - 14 : tx + 14, 0, Math.max(0, r.width - tw)) + "px";
  };
  const sair = () => { cur.style.display = "none"; tip.classList.remove("on"); };
  svg.addEventListener("pointermove", mover);
  svg.addEventListener("pointerdown", mover);
  svg.addEventListener("pointerleave", sair);
  svg.addEventListener("pointercancel", sair);
}
let resizeTimer = 0;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => graficos.forEach((_, el) => desenharGrafico(el)), 120); });
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
function disclaimer() {
  return `<p class="disclaimer">Dados públicos de Banco Central, Tesouro Transparente, CVM, Yahoo Finance e portais de notícias, com atraso. Sinais calculados por regras automáticas, sem opinião humana nem IA. Não é recomendação de investimento nem garantia de resultado. Confira custos, impostos e o seu objetivo antes de decidir.</p>`;
}
