"use strict";
/* Monitor — telas principais (abas e páginas de categoria). */

function saudacao() { const h = new Date().getHours(); return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; }

// =============================================================== moldura
function renderTabbar() {
  $("#tabbar").innerHTML = `<span class="brand">Monitor<i></i></span>` + Object.entries(TABS).map(([k, t]) =>
    `<button type="button" data-act="tab" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ""}>${ic(k)}<span>${t.nome}</span></button>`).join("");
}
function tituloAtual() {
  if (S.tab === "explorar" && S.sub && CATS[S.sub]) return CATS[S.sub].nome;
  if (S.tab === "inicio") return saudacao();
  return TABS[S.tab].titulo;
}
function renderTopo() {
  $("#titulo").textContent = tituloAtual();
  const back = $("#back");
  back.hidden = !(S.tab === "explorar" && S.sub);
  back.innerHTML = `${ic("voltar")}Explorar`;
  const st = $("#status"), d = S.data;
  let cls = "", txt = "Carregando…";
  if (d) {
    const idade = d.quando ? Date.now() - d.quando : Infinity;
    if (S.origem === "cache") { cls = "err"; txt = "Offline · dados " + haQuanto(d.quando); }
    else if (idade > 3 * 3600e3) { cls = "warn"; txt = "Atrasado · atualizado " + haQuanto(d.quando); }
    else { cls = idade < 90 * 60e3 ? "ok" : ""; txt = "Atualizado " + haQuanto(d.quando); }
  } else if (S.erroCarga) { cls = "err"; txt = "Sem dados"; }
  st.className = "status " + cls;
  st.querySelector("span").textContent = txt;
  $("#btn-refresh").innerHTML = ic("refresh");
  $("#btn-busca").innerHTML = ic("busca");
  $("#sheet .sheet-head [data-act=close]").innerHTML = ic("close");
  // a barra de filtros gruda logo abaixo do cabeçalho, que muda de altura com o botão Voltar
  requestAnimationFrame(() => document.documentElement.style.setProperty("--top-h", $(".top").offsetHeight + "px"));
  const avisos = [];
  if (d && S.origem === "cache") avisos.push(["err", "Sem conexão. Você está vendo os últimos dados salvos neste aparelho."]);
  else if (d && d.quando && Date.now() - d.quando > 3 * 3600e3) avisos.push(["", `A última rodada do monitor foi ${haQuanto(d.quando)}: o GitHub atrasou o agendamento.`, "status"]);
  $("#banner").innerHTML = avisos.map(([c, t, folha]) => `<div class="banner ${c}">${ic("info")}<span>${esc(t)}</span>${folha ? `<button type="button" data-act="sheet" data-sheet="${folha}">Ver</button>` : ""}</div>`).join("");
}
function renderTudo() {
  renderTabbar();
  renderTopo();
  renderView();
  // Folhas de consulta acompanham os dados novos; formulários abertos não são redesenhados
  if (S.sheet && ($("#sheet").hidden || ["ativo", "titulo", "status", "fundo"].includes(S.sheet.tipo))) renderSheet();
}
function renderView(animar) {
  const v = $("#view");
  if (!S.data && S.tab !== "mais") {
    v.innerHTML = S.erroCarga
      ? `<div class="empty"><b>Não foi possível carregar os dados</b>Confira sua conexão. Se continuar, verifique se o monitor já rodou na aba Actions do repositório.<div class="btns"><button class="btn primary" data-act="refresh">Tentar de novo</button></div><p class="small muted">Detalhe técnico: ${esc(S.erroCarga)}</p></div>`
      : `<div class="skel" style="height:190px"></div><div class="skel"></div><div class="skel" style="height:150px"></div><div class="skel"></div>`;
    return;
  }
  const telas = { inicio: telaInicio, explorar: telaExplorar, noticias: telaNoticias, carteira: telaCarteira, mais: telaMais };
  const foco = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.busca;
  const pos = foco ? document.activeElement.selectionStart : 0;
  v.innerHTML = telas[S.tab]();
  if (animar) { v.classList.remove("view-in"); void v.offsetWidth; v.classList.add("view-in"); }
  if (S.tab === "explorar" && S.sub && CATS_ATIVOS.includes(S.sub)) atualizarListaCat();
  if (S.tab === "explorar" && S.sub === "fundos") atualizarListaFundos();
  if (S.tab === "noticias") atualizarListaNoticias();
  if (foco) { const b = $(`[data-busca="${foco}"]`); if (b) { b.focus(); b.setSelectionRange(pos, pos); } }
}

// =============================================================== início
function telaInicio() {
  const d = S.data, m = d.macro;
  const ibov = d.idxAtivo.get("^BVSP"), spx = d.idxAtivo.get("^GSPC"), btc = d.idxAtivo.get("BTC-USD");
  const pos = posicoes();
  const total = pos.reduce((s, p) => s + (ok(p.valor) ? p.valor : 0), 0);
  let hero;
  if (total > 0) {
    const hoje = pos.reduce((s, p) => s + (ok(p.varDia) ? p.varDia : 0), 0);
    const custo = pos.reduce((s, p) => s + (ok(p.custo) && ok(p.valor) ? p.custo : 0), 0);
    const comCusto = pos.filter(p => ok(p.custo) && ok(p.valor)).reduce((s, p) => s + p.valor, 0);
    hero = `<span class="eyebrow">${ic("carteira", 'style="width:14px;height:14px"')}Seu patrimônio</span>
      <div class="big">${reais(total)}</div>
      <div class="sub"><span class="${hoje >= 0 ? "up" : "down"}">${hoje >= 0 ? "+" : "−"}${reais(Math.abs(hoje))} hoje</span>${custo ? `<span>·</span><span>${pct((comCusto - custo) / custo * 100, 1, true)} desde a compra</span>` : ""}</div>`;
  } else if (ibov) {
    hero = `<span class="eyebrow">${ic("pulso", 'style="width:14px;height:14px"')}Ibovespa · ${esc(ibov.data)}</span>
      <div class="big">${fmt(ibov.preco, 0)}</div>
      <div class="sub">${setaVar(ibov.var_dia)}<span>no dia</span>${spx ? `<span>·</span><span>S&amp;P 500 ${setaVar(spx.var_dia)}</span>` : ""}</div>
      <div class="spark-hero">${spark(ibov.spark, 300, 96, "var(--accent)").replace('class="spark"', 'class="spark" style="width:100%;height:100%"')}</div>`;
  } else hero = `<div class="big">Mercado</div>`;
  const mini = [
    ["selic", "Selic", pct(m.selic_meta)], ["cdi", "CDI 12m", pct(m.cdi_12m ?? m.cdi_ano)], ["ipca", "IPCA 12m", pct(m.ipca_12m)],
    ["dolar", "Dólar", moeda(d.usd, "R$", 3)], ["btc", "Bitcoin", btc && ok(d.usd) ? compacto(btc.preco * d.usd) : "—"],
  ];
  let h = `<section class="hero glass" style="margin-top:4px">${hero}
    <div class="mini">${mini.map(([k, n, v]) => `<button type="button" ${k === "btc" ? `data-act="ativo" data-id="BTC-USD"` : `data-act="info" data-k="${k}"`}><span>${n}</span><b>${v}</b></button>`).join("")}</div></section>`;

  const cards = radar();
  if (cards.length) h += `<section class="sec"><div class="sec-h"><h2>Radar de oportunidades</h2><button class="link" data-act="sheet" data-sheet="ferramenta" data-param="sinais">Como funciona</button></div>
    <p class="hint">Filtros automáticos sobre os dados de hoje. Ponto de partida para estudar, não ordem de compra.</p><div class="rail">${cards.join("")}</div></section>`;

  h += `<section class="sec"><div class="sec-h"><h2>Próximos passos</h2></div>${planoAcoes().slice(0, 3).join("")}</section>`;
  h += termometro();

  const negociaveis = d.ativos.filter(a => ok(a.var_dia) && !["indices", "cambio"].includes(a.cat) && a.grupo !== "Stablecoins" && !a.desatualizado);
  const altas = [...negociaveis].sort((a, b) => b.var_dia - a.var_dia).slice(0, 4).filter(a => a.var_dia > 0);
  const baixas = [...negociaveis].sort((a, b) => a.var_dia - b.var_dia).slice(0, 4).filter(a => a.var_dia < 0);
  h += `<section class="sec"><div class="sec-h"><h2>Destaques do dia</h2><button class="link" data-act="tab" data-tab="explorar">Explorar tudo</button></div>
    ${lista([...altas, ...baixas], a => rowAtivo(a, { cat: true, grupo: false, compacto: true }), "Sem cotações do dia.")}</section>`;

  const ns = ((S.noticias && S.noticias.itens) || []).slice(0, 4);
  if (ns.length) h += `<section class="sec"><div class="sec-h"><h2>Últimas notícias</h2><button class="link" data-act="tab" data-tab="noticias">Ver todas</button></div>
    <div class="list"><ul class="news">${ns.map(itemNoticia).join("")}</ul></div></section>`;

  const favs = d.ativos.filter(a => S.favs.has(a.ticker));
  if (favs.length) h += `<section class="sec"><div class="sec-h"><h2>Favoritos</h2></div>${lista(favs.slice(0, 8), a => rowAtivo(a, { cat: true, grupo: false }), "")}</section>`;

  const hist = d.historico_alertas || [];
  h += `<section class="sec"><div class="sec-h"><h2>Últimos alertas</h2><button class="link" data-act="sheet" data-sheet="ferramenta" data-param="alertas">Receber no celular</button></div>
    ${hist.length ? `<div class="list"><ul class="alerts">${hist.slice(0, 5).map(a => `<li><b>${esc(a.titulo)}</b><span>${esc(a.msg)}</span><small>${esc(a.quando)}</small></li>`).join("")}</ul></div>`
      : `<div class="empty">Nenhum alerta ainda. Eles aparecem aqui e no celular quando um ativo acompanhado muda de sinal, se move forte no dia ou quando uma taxa do Tesouro fica alta.</div>`}</section>`;
  if (!S.fundos) setTimeout(() => carregarFundos().then(() => { if (S.tab === "inicio" && !S.sheet) renderView(); }), 1500);
  return h + disclaimer();
}

function radar() {
  const d = S.data, cdi = d.macro.cdi_ano, perfil = PERFIS[S.perfil], cards = [];
  const item = a => `<li><button type="button" data-act="ativo" data-id="${esc(a.ticker)}" style="all:unset;cursor:pointer;display:flex;justify-content:space-between;width:100%;gap:10px"><span><b>${esc(a.codigo)}</b> <span class="muted">${esc(a.nome.length > 22 ? a.nome.slice(0, 21) + "…" : a.nome)}</span></span>`;
  const card = (eyebrow, titulo, texto, itens, botao) => `<article class="op"><span class="eyebrow">${eyebrow}</span><h3>${titulo}</h3><p>${texto}</p>${itens ? `<ul>${itens}</ul>` : ""}<div class="btns">${botao}</div></article>`;

  const altas = d.tes.filter(t => t.sinal === "ATRATIVO").sort((a, b) => (b.percentil_5a || 0) - (a.percentil_5a || 0));
  if (altas.length) cards.push(card("Tesouro Direto", `${altas.length} título${altas.length > 1 ? "s" : ""} com taxa alta`, "Taxas entre as maiores dos últimos 5 anos. Bom momento para travar juros, se você puder ficar até o vencimento.",
    altas.slice(0, 3).map(t => `<li><button type="button" data-act="titulo" data-id="${esc(t.id)}" style="all:unset;cursor:pointer;display:flex;justify-content:space-between;width:100%"><span>${esc(nomeTitulo(t))}</span><b>${esc(taxaTexto(t))}</b></button></li>`).join(""),
    `<button class="btn sm" data-act="ir-cat" data-cat="rf">Ver renda fixa</button>`));

  const fiis = (d.porCat.fiis || []).filter(a => ok(a.dy) && ok(cdi) && a.dy >= cdi * 0.85 && a.score >= 0).sort((a, b) => b.dy - a.dy);
  if (fiis.length) cards.push(card("Fundos imobiliários", "Rendimentos perto ou acima do CDI", `Pagaram em 12 meses pelo menos 85% do CDI (${pct(cdi, 1)}), isentos de IR, e não estão em tendência de queda. Confira vacância e qualidade da carteira.`,
    fiis.slice(0, 3).map(a => item(a) + `<b>${pct(a.dy, 1)}</b></button></li>`).join(""), `<button class="btn sm" data-act="ir-cat" data-cat="fiis" data-ordem="dy">Ver todos os FIIs</button>`));

  const compra = (d.porCat.acoes_br || []).filter(a => a.sinal === "COMPRA" && (RISCO_N[a.risco] || 2) <= perfil.risco).sort((a, b) => b.score - a.score || (b.ret_12m || 0) - (a.ret_12m || 0));
  if (compra.length) cards.push(card("Ações Brasil", `${compra.length} em sinal de compra no seu perfil`, "Somaram 3 pontos ou mais nas regras de tendência, força e rentabilidade.",
    compra.slice(0, 3).map(a => item(a) + setaVar(a.ret_12m, 0).replace('class="var', 'class="var tn') + `</button></li>`).join(""), `<button class="btn sm" data-act="ir-cat" data-cat="acoes_br" data-sinal="COMPRA">Ver sinais de compra</button>`));

  const glob = (d.porCat.acoes_global || []).filter(a => a.sinal === "COMPRA").sort((a, b) => b.score - a.score || (b.ret_12m_brl || 0) - (a.ret_12m_brl || 0));
  if (glob.length) cards.push(card("Ações globais", "Gigantes globais em tendência de alta", "Disponíveis na B3 via BDR, em reais, pela sua corretora.",
    glob.slice(0, 3).map(a => item(a) + `<b>${a.bdr ? esc(a.bdr) : ""}</b></button></li>`).join(""), `<button class="btn sm" data-act="ir-cat" data-cat="acoes_global" data-sinal="COMPRA">Ver ações globais</button>`));

  const sobrev = d.ativos.filter(a => ok(a.rsi) && a.rsi < 30 && !["indices", "cambio"].includes(a.cat) && a.grupo !== "Stablecoins").sort((a, b) => a.rsi - b.rsi);
  if (sobrev.length) cards.push(card("Queda exagerada", `${sobrev.length} ativo${sobrev.length > 1 ? "s" : ""} com RSI abaixo de 30`, "Caíram rápido demais e costumam ter algum repique. Pode ser desconto ou problema real: leia as notícias.",
    sobrev.slice(0, 3).map(a => item(a) + `<b>RSI ${fmt(a.rsi, 0)}</b></button></li>`).join(""), `<button class="btn sm" data-act="sheet" data-sheet="info" data-param="rsi">O que é RSI</button>`));

  if (S.fundos && S.fundos.fundos.length) {
    const rf = S.fundos.fundos.filter(f => f.classe === "Renda Fixa" && ok(f.pct_cdi) && f.pct_cdi >= 103 && (f.vol ?? 9) < 3 && f.pl >= 3e8 && (!f.publico || f.publico === "Público Geral")).sort((a, b) => b.pct_cdi - a.pct_cdi);
    if (rf.length) cards.push(card("Fundos de renda fixa", "Bateram o CDI com baixa oscilação", "Fundos abertos ao público geral, com mais de R$ 300 milhões, que renderam acima do CDI em 12 meses (antes do IR).",
      rf.slice(0, 3).map(f => `<li><button type="button" data-act="fundo" data-id="${esc(f.cnpj)}" style="all:unset;cursor:pointer;display:flex;justify-content:space-between;width:100%;gap:10px"><span>${esc(f.curto.length > 28 ? f.curto.slice(0, 27) + "…" : f.curto)}</span><b>${fmt(f.pct_cdi, 0)}% CDI</b></button></li>`).join(""),
      `<button class="btn sm" data-act="ir-cat" data-cat="fundos">Ver fundos</button>`));
  }

  const cripto = (d.porCat.cripto || []).filter(a => a.grupo !== "Stablecoins" && ok(a.ret_1m)).sort((a, b) => b.ret_1m - a.ret_1m);
  if (cripto.length) cards.push(card("Criptomoedas", "Destaques do mês", "Maiores altas em 30 dias. Cripto oscila muito: use só uma pequena parte da carteira.",
    cripto.slice(0, 3).map(a => item(a) + setaVar(a.ret_1m, 1) + `</button></li>`).join(""), `<button class="btn sm" data-act="ir-cat" data-cat="cripto" data-ordem="ret_1m">Ver criptomoedas</button>`));
  return cards;
}

function planoAcoes() {
  const d = S.data, cards = [], perfil = PERFIS[S.perfil];
  const card = (ico, cls, titulo, texto, botoes) => `<div class="card acao"><span class="ico ${cls}">${ic(ico)}</span><div><h3>${titulo}</h3><p>${texto}</p>${botoes ? `<div class="btns">${botoes}</div>` : ""}</div></div>`;
  const pos = posicoes();
  if (!store.get("perfilQuiz", false)) cards.push(card("pessoa", "", "Descubra seu perfil de investidor", `Cinco perguntas rápidas. O app usa o perfil para destacar o que combina com você. Hoje está como <b>${esc(perfil.nome)}</b>.`,
    `<button class="btn primary sm" data-act="sheet" data-sheet="ferramenta" data-param="perfil">Fazer o teste</button>`));
  if (!pos.length) cards.push(card("carteira", "", "Monte sua carteira", "Cadastre o que você já tem — ações, FIIs, cripto, Tesouro, fundos, CDB — e veja resultado, divisão e rebalanceamento. Fica só neste aparelho.",
    `<button class="btn sm" data-act="sheet" data-sheet="add">Adicionar investimento</button>`));
  else {
    const ruins = pos.filter(p => p.sinal === "VENDA" || p.sinal === "VIÉS DE BAIXA");
    if (ruins.length) cards.push(card("baixa", "down", "Revise ativos da sua carteira", `${ruins.map(p => `<b>${esc(p.refObj && p.refObj.codigo ? p.refObj.codigo : p.nome)}</b>`).join(", ")} ${ruins.length > 1 ? "estão" : "está"} com sinal de baixa ou venda. Não é ordem de venda: confira os motivos.`,
      `<button class="btn sm" data-act="tab" data-tab="carteira">Abrir carteira</button>`));
    const desvio = desviosCarteira(pos).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif))[0];
    if (desvio && Math.abs(desvio.dif) >= 10) cards.push(card("balanca", "warn", "Carteira fora da proporção do perfil", `${esc(desvio.classe)}: <b>${fmt(desvio.atual, 0)}%</b> da carteira. A referência para o perfil ${esc(perfil.nome.toLowerCase())} é <b>${fmt(desvio.meta, 0)}%</b>.`,
      `<button class="btn sm" data-act="tab" data-tab="carteira">Ver rebalanceamento</button>`));
  }
  const selic = d.tes.filter(t => tipoInfo(t).idx === "Selic").sort((a, b) => a.anos - b.anos)[0];
  if (selic) cards.push(card("escudo", "", "Reserva de emergência", `Antes da renda variável, guarde de 6 a 12 meses de gastos. O <b>${esc(nomeTitulo(selic))}</b> rende Selic + ${fmt(selic.taxa)}% com resgate em 1 dia útil.`,
    `<button class="btn sm" data-act="sheet" data-sheet="ferramenta" data-param="reserva">Calcular reserva</button>`));
  cards.push(card("balanca", "", "Compare ofertas do seu banco", "CDB, LCI, LCA e outros mudam todo dia em cada banco. Digite as ofertas que você recebeu e o app mostra qual rende mais, já com IR.",
    `<button class="btn sm" data-act="ir-cat" data-cat="rf" data-aba="ofertas">Comparar ofertas</button>`));
  return cards;
}

function termometro() {
  const at = S.data.ativos.filter(a => !["indices", "cambio"].includes(a.cat) && a.grupo !== "Stablecoins");
  if (!at.length) return "";
  const cont = Object.fromEntries(ORDEM_SINAIS.map(s => [s, at.filter(a => a.sinal === s).length]));
  const pos = cont["COMPRA"] + cont["VIÉS DE ALTA"], neg = cont["VENDA"] + cont["VIÉS DE BAIXA"];
  const leitura = pos > neg * 1.5 ? "Maioria dos ativos em tendência positiva pelas regras." : neg > pos * 1.5 ? "Maioria dos ativos em tendência negativa pelas regras. Cautela." : "Mercado dividido entre sinais positivos e negativos.";
  return `<section class="sec"><div class="sec-h"><h2>Termômetro</h2><span class="small muted">${at.length} ativos</span></div>
    <div class="card"><p class="small" style="color:var(--ink-2);margin-bottom:12px">${leitura}</p>
      <div class="stack" role="img" aria-label="${ORDEM_SINAIS.map(s => `${SINAIS[s].t}: ${cont[s]}`).join(", ")}">${ORDEM_SINAIS.filter(s => cont[s]).map(s => `<i style="flex:${cont[s]};background:${SINAIS[s].cor}" title="${SINAIS[s].t}: ${cont[s]}"></i>`).join("")}</div>
      <div class="legend">${ORDEM_SINAIS.map(s => `<span><i style="background:${SINAIS[s].cor}"></i>${SINAIS[s].t} <b>${cont[s]}</b></span>`).join("")}</div>
    </div></section>`;
}

// =============================================================== explorar
function telaExplorar() {
  if (S.sub === "rf") return telaRF();
  if (S.sub === "fundos") return telaFundos();
  if (S.sub === "subscricoes") return telaSubscricoes();
  if (S.sub && CATS_ATIVOS.includes(S.sub)) return telaCategoria(S.sub);
  const d = S.data;
  const fita = ["^BVSP", "^GSPC", "^IXIC", "BRL=X", "EURBRL=X", "GC=F", "BZ=F", "BTC-USD"].map(t => d.idxAtivo.get(t)).filter(Boolean);
  let h = `<button type="button" class="search" data-act="sheet" data-sheet="busca" style="width:100%;text-align:left;cursor:text;margin-top:4px">${ic("busca")}<span class="muted" style="padding:12px 0">Buscar ação, FII, cripto, fundo, título…</span></button>
    <div class="tape" aria-label="Mercado agora">${fita.map(a => `<button type="button" data-act="ativo" data-id="${esc(a.ticker)}"><span class="l">${esc(a.nome)}</span><b>${a.cat === "indices" ? fmt(a.preco, 0) : moeda(a.preco, a.moeda, a.ticker === "BRL=X" || a.ticker === "EURBRL=X" ? 3 : undefined)}</b>${setaVar(a.var_dia)}</button>`).join("")}</div>`;
  h += `<section class="sec"><div class="sec-h"><h2>Categorias</h2></div><div class="tiles">${ORDEM_CATS.map(tileCat).join("")}</div></section>`;
  h += `<section class="sec"><div class="sec-h"><h2>Outros produtos</h2></div><div class="tiles">${["poupanca", "previdencia", "coe"].map(k => `<button type="button" class="tile" data-act="sheet" data-sheet="produto" data-param="${k}"><span class="ico">${ic(k === "poupanca" ? "escudo" : k === "previdencia" ? "relogio" : "faisca")}</span><b>${PRODUTOS[k].nome}</b><span class="meta">${esc(PRODUTOS[k].oque.split(".")[0])}.</span></button>`).join("")}</div></section>`;
  return h + disclaimer();
}
function tileCat(k) {
  const c = CATS[k], d = S.data;
  let n = "", stat = "";
  if (CATS_ATIVOS.includes(k)) {
    const xs = (d.porCat[k] || []).filter(a => ok(a.var_dia));
    const sobe = xs.filter(a => a.var_dia > 0).length;
    const melhor = [...xs].filter(a => a.grupo !== "Stablecoins").sort((a, b) => b.var_dia - a.var_dia)[0];
    n = `${(d.porCat[k] || []).length} ativos`;
    stat = melhor ? `<span>${sobe} de ${xs.length} em alta</span><span><b>${esc(melhor.codigo)}</b> ${setaVar(melhor.var_dia, 1)}</span>` : "";
  } else if (k === "rf") {
    const sel = d.tes.find(t => tipoInfo(t).idx === "Selic");
    n = `${d.tes.length} títulos públicos + bancários`;
    stat = `<span>Selic ${pct(d.macro.selic_meta)}</span><span>CDI ${pct(d.macro.cdi_ano)}</span>`;
  } else if (k === "fundos") {
    n = d.fundos_resumo && d.fundos_resumo.total ? `${d.fundos_resumo.total} fundos · CVM` : "Dados oficiais da CVM";
    stat = `<span>Atualizado 1x por dia</span>`;
  } else if (k === "subscricoes") { n = "Guia e calculadora"; stat = `<span>Vale a pena exercer?</span>`; }
  return `<button type="button" class="tile" data-act="ir-cat" data-cat="${k}"><span class="ico">${ic(c.ico)}</span><div><b>${c.nome}</b><span class="meta">${n}</span></div>${stat ? `<div class="tfoot">${stat}</div>` : ""}</button>`;
}

// ---------- categoria de ativos
const ORDENS = [["sinal", "Sinal mais forte"], ["var", "Variação do dia"], ["ret_1m", "Rentabilidade 30 dias"], ["ret_ano", "No ano"], ["ret", "12 meses"],
  ["dy", "Proventos 12 meses"], ["liquidez", "Mais negociados"], ["queda", "Mais longe da máxima"], ["risco", "Menor risco"], ["nome", "Nome (A–Z)"]];
function cabecalhoProduto(k, extra) {
  const p = PRODUTOS[CATS[k].guia];
  return `<div class="cat-head glass"><span class="eyebrow">${extra || ""}</span><p>${esc(CATS[k].desc)} ${p ? esc(p.oque) : ""}</p>
    ${p ? `<div class="facts"><div><span>Risco</span><b>${esc(p.risco.split(":")[0].split(".")[0])}</b></div><div><span>Liquidez</span><b>${esc(p.liquidez.split("(")[0])}</b></div><div><span>Mínimo</span><b>${esc(p.minimo.split("(")[0])}</b></div></div>
    <div class="btns" style="margin-top:14px"><button class="btn sm" data-act="sheet" data-sheet="produto" data-param="${CATS[k].guia}">${ic("livro")}Guia: impostos, riscos e como investir</button></div>` : ""}</div>`;
}
function telaCategoria(cat) {
  const xs = S.data.porCat[cat] || [];
  if (S.f.cat !== cat) Object.assign(S.f, { cat, grupo: "Todos", sinal: "Todos", q: "", limite: 60, ordem: cat === "fiis" ? "dy" : cat === "indices" ? "var" : "sinal" });
  const grupos = ["Todos", ...[...new Set(xs.map(a => a.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"))];
  const conta = g => g === "Todos" ? xs.length : xs.filter(a => a.grupo === g).length;
  const ordens = ORDENS.filter(([k]) => !(k === "dy" && ["cripto", "cambio", "indices", "etfs_global"].includes(cat)) && !(k === "liquidez" && ["cambio", "indices"].includes(cat)) && !(k === "risco" && cat === "indices"));
  const extraCat = cat === "cripto" ? `<label class="toggle"><input type="checkbox" id="f-reais" ${S.f.reais ? "checked" : ""}> Preços em reais</label>` : `<label class="toggle"><input type="checkbox" id="f-perfil" ${S.f.soPerfil ? "checked" : ""}> Só do meu perfil</label>`;
  return `${cabecalhoProduto(cat, `${xs.length} ativos`)}
    <div class="filters" style="margin-top:14px">
      <label class="search">${ic("busca")}<span class="sr">Buscar</span><input data-busca="cat" type="search" placeholder="Buscar em ${esc(CATS[cat].nome.toLowerCase())}" value="${esc(S.f.q)}" autocomplete="off" enterkeyhint="search"></label>
      <div class="chips" role="group" aria-label="Grupo">${grupos.map(g => `<button type="button" class="chip" data-act="f-grupo" data-v="${esc(g)}" aria-pressed="${S.f.grupo === g}">${esc(g)} <span class="n">${conta(g)}</span></button>`).join("")}</div>
      <div class="filter-row">
        <select class="select" id="f-sinal" aria-label="Sinal">${[["Todos", "Todos os sinais"], ...ORDEM_SINAIS.slice().reverse().map(s => [s, SINAIS[s].t])].map(([v, t]) => `<option value="${v}" ${S.f.sinal === v ? "selected" : ""}>${t}</option>`).join("")}</select>
        <select class="select" id="f-ordem" aria-label="Ordenar">${ordens.map(([v, t]) => `<option value="${v}" ${S.f.ordem === v ? "selected" : ""}>${t}</option>`).join("")}</select>
      </div>
      <div class="filter-row">${extraCat}<span id="f-count"></span></div>
    </div>
    <div id="f-lista"></div>
    ${cat === "acoes_global" ? `<div class="card" style="margin-top:14px"><h3>Como investir de forma simples</h3><p class="small muted">Pela sua corretora brasileira, compre o BDR (código terminado em 34 ou 39), em reais. Ou abra uma conta internacional para comprar a ação original em dólar.</p></div>` : ""}
    <div class="card" style="margin-top:14px"><h3>Falta algum ativo?</h3><p class="small muted">A lista fica no config.json do seu repositório. Dá para incluir qualquer ação, FII, ETF, BDR, ação americana ou cripto do Yahoo Finance.</p><div class="btns"><button class="btn sm" data-act="sheet" data-sheet="ferramenta" data-param="config">Como adicionar</button></div></div>
    ${disclaimer()}`;
}
function filtrarCat() {
  const f = S.f, q = norm(f.q.trim());
  const val = (v, def) => ok(v) ? v : def;
  const it = (S.data.porCat[f.cat] || []).filter(a => (f.grupo === "Todos" || a.grupo === f.grupo) && (f.sinal === "Todos" || a.sinal === f.sinal)
    && !(f.soPerfil && f.cat !== "cripto" && acimaDoPerfil(a)) && (!q || norm(a.codigo + " " + a.nome + " " + a.grupo + " " + (a.bdr || "")).includes(q)));
  const ord = {
    sinal: (a, b) => b.score - a.score || val(b.ret_12m, -1e9) - val(a.ret_12m, -1e9),
    var: (a, b) => val(b.var_dia, -1e9) - val(a.var_dia, -1e9),
    ret_1m: (a, b) => val(b.ret_1m, -1e9) - val(a.ret_1m, -1e9),
    ret_ano: (a, b) => val(b.ret_ano, -1e9) - val(a.ret_ano, -1e9),
    ret: (a, b) => val(b.ret_12m, -1e9) - val(a.ret_12m, -1e9),
    dy: (a, b) => val(b.dy, -1) - val(a.dy, -1),
    liquidez: (a, b) => val(b.liquidez, -1) - val(a.liquidez, -1),
    queda: (a, b) => val(a.queda_max_12m, 0) - val(b.queda_max_12m, 0),
    risco: (a, b) => (RISCO_N[a.risco] || 2) - (RISCO_N[b.risco] || 2) || val(a.volatilidade, 99) - val(b.volatilidade, 99),
    nome: (a, b) => a.codigo.localeCompare(b.codigo),
  }[f.ordem] || (() => 0);
  return it.sort(ord);
}
function atualizarListaCat() {
  const box = $("#f-lista");
  if (!box) return;
  const it = filtrarCat();
  $("#f-count").textContent = `${it.length} ${it.length === 1 ? "ativo" : "ativos"}`;
  box.innerHTML = lista(it, a => rowAtivo(a, { reais: S.f.reais, dy: S.f.ordem === "dy" }),
    `Nenhum ativo com esses filtros.<div class="btns"><button class="btn sm" data-act="f-limpar">Limpar filtros</button></div>`, S.f.limite || 60);
}

// ---------- renda fixa
const GRUPOS_RF = ["Todos", "Taxa alta", "Selic", "Prefixado", "IPCA+", "Aposentadoria e educação", "Outros"];
function taxaAnualPor(modo, valor, m) {
  const cdi = (m.cdi_ano || 0) / 100, selic = (m.selic_meta || 0) / 100, ipca = (m.ipca_12m || 0) / 100, v = valor / 100;
  if (modo === "cdi") { const diaria = (Math.pow(1 + cdi, 1 / 252) - 1) * v; return Math.pow(1 + diaria, 252) - 1; }
  if (modo === "selic") return (1 + selic) * (1 + v) - 1;
  if (modo === "ipca") return (1 + ipca) * (1 + v) - 1;
  return v;
}
const IR = dias => dias <= 180 ? 22.5 : dias <= 360 ? 20 : dias <= 720 ? 17.5 : 15;
function telaRF() {
  const abas = [["tesouro", "Tesouro"], ["bancarios", "Bancários"], ["credito", "Crédito privado"], ["ofertas", "Comparar"]];
  let h = `<div class="seg" role="group" aria-label="Tipo de renda fixa" style="margin-top:4px">${abas.map(([k, t]) => `<button type="button" data-act="rf-aba" data-v="${k}" aria-pressed="${S.rf.aba === k}">${t}</button>`).join("")}</div>`;
  if (S.rf.aba === "bancarios") h += rfBancarios();
  else if (S.rf.aba === "credito") h += rfCredito();
  else if (S.rf.aba === "ofertas") h += rfOfertas();
  else h += rfTesouro();
  return h + disclaimer();
}
function referencias() {
  const m = S.data.macro;
  const cdiAno = (m.cdi_ano || 0) / 100;
  const sel = S.data.tes.filter(t => tipoInfo(t).idx === "Selic").sort((a, b) => a.anos - b.anos)[0];
  const tsBruto = sel ? taxaAnualPor("selic", sel.taxa, m) : cdiAno;
  const liq2 = x => (Math.pow(1 + x, 2) - 1) * (1 - 0.15);
  const cdiEquiv = Math.pow(1 + tsBruto, 1 / 252) - 1;
  const pctTS = cdiAno ? cdiEquiv / (Math.pow(1 + cdiAno, 1 / 252) - 1) * 100 : 100;
  return { sel, tsBruto, pctTS, cdiAno, liq2 };
}
function rfTesouro() {
  const d = S.data, m = d.macro, f = S.rf;
  if (!d.tes.length) return `<div class="empty" style="margin-top:14px"><b>Dados do Tesouro indisponíveis</b>O site do Tesouro não respondeu nas últimas atualizações.</div>`;
  const pp = poupancaAno(m);
  let h = `<div class="card" style="margin-top:14px"><span class="eyebrow">Para comparar hoje</span>
    <ul class="kv"><li><span>CDI</span><b>${pct(m.cdi_ano)} a.a.</b></li><li><span>CDB 100% do CDI após IR (2+ anos)</span><b>≈ ${pct(m.cdi_ano * 0.85)}</b></li>
    <li><span>Poupança (isenta)</span><b>≈ ${pct(pp)} + TR</b></li><li><span>Inflação 12 meses</span><b>${pct(m.ipca_12m)}</b></li></ul>
    <div class="btns" style="margin-top:12px"><button class="btn sm" data-act="sheet" data-sheet="ferramenta" data-param="sim">${ic("calc")}Simular</button><button class="btn sm ghost" data-act="sheet" data-sheet="produto" data-param="tesouro">${ic("livro")}Guia do Tesouro</button></div></div>`;
  const nG = g => g === "Todos" ? d.tes.length : g === "Taxa alta" ? d.tes.filter(t => t.sinal === "ATRATIVO").length : d.tes.filter(t => tipoInfo(t).grupo === g).length;
  h += `<div class="filters" style="margin-top:12px"><div class="chips">${GRUPOS_RF.filter(g => nG(g) || g === f.grupo).map(g => `<button type="button" class="chip" data-act="rf-grupo" data-v="${g}" aria-pressed="${f.grupo === g}">${g} <span class="n">${nG(g)}</span></button>`).join("")}</div>
    <div class="filter-row"><span>Ordenar</span><select class="select" id="rf-ordem">${[["vencimento", "Tipo e vencimento"], ["taxa", "Maior taxa"], ["percentil", "Taxa alta vs. histórico"], ["minimo", "Menor mínimo"]].map(([v, t]) => `<option value="${v}" ${f.ordem === v ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>`;
  const it = d.tes.filter(t => f.grupo === "Todos" || (f.grupo === "Taxa alta" ? t.sinal === "ATRATIVO" : tipoInfo(t).grupo === f.grupo));
  if (!it.length) return h + `<div class="empty">Nenhum título neste grupo agora.</div>`;
  if (f.ordem === "vencimento") {
    const porTipo = new Map();
    it.forEach(t => { if (!porTipo.has(t.tipo)) porTipo.set(t.tipo, []); porTipo.get(t.tipo).push(t); });
    h += `<div class="list">${[...porTipo.entries()].map(([tipo, ts]) => `<div class="group-h"><b>${esc(tipo)}</b><span>${esc((TIPOS_TESOURO[tipo] || {}).desc || "")}</span></div>` + ts.sort((a, b) => a.anos - b.anos).map(rowTitulo).join("")).join("")}</div>`;
  } else {
    const ord = { taxa: (a, b) => b.taxa - a.taxa, percentil: (a, b) => (b.percentil_5a ?? -1) - (a.percentil_5a ?? -1), minimo: (a, b) => (a.minimo ?? a.preco) - (b.minimo ?? b.preco) }[f.ordem];
    h += lista(it.sort(ord), rowTitulo, "");
  }
  return h;
}
function cartaoProduto(k, linha) {
  const p = PRODUTOS[k];
  return `<button type="button" class="tile" data-act="sheet" data-sheet="produto" data-param="${k}"><div><b>${p.nome}</b><span class="meta">${esc(linha || p.ganha)}</span></div>
    <div class="tfoot"><span>${p.fgc.startsWith("Sim") ? "Com FGC" : p.fgc.startsWith("Não precisa") ? "Garantia do governo" : "Sem FGC"}</span><span>IR: ${esc(p.ir.split(" ")[0] === "Tabela" ? "regressivo" : p.ir.split(" ")[0].replace(/[:;]/, "").toLowerCase())}</span></div></button>`;
}
function rfBancarios() {
  const m = S.data.macro, r = referencias();
  const lciEq = (lci, dias) => lci / (1 - IR(dias) / 100);
  return `<div class="card" style="margin-top:14px"><span class="eyebrow">Régua do dia</span>
      <p class="small" style="color:var(--ink-2);margin-top:6px">Calculado com a Selic e o CDI de hoje. Use para saber se a oferta do seu banco vale a pena.</p>
      <ul class="kv">
        <li><span>Tesouro Selic hoje equivale a</span><b>${fmt(r.pctTS, 0)}% do CDI</b></li>
        <li><span>CDB com liquidez diária: bom a partir de</span><b>100% do CDI</b></li>
        <li><span>LCI/LCA de 90% do CDI equivale a um CDB de (1 a 2 anos)</span><b>${fmt(lciEq(90, 700), 0)}% do CDI</b></li>
        <li><span>LCI/LCA de 95% do CDI equivale a um CDB de (2+ anos)</span><b>${fmt(lciEq(95, 800), 0)}% do CDI</b></li>
        <li><span>CDB de 100% do CDI rende após IR (2+ anos)</span><b>≈ ${pct(m.cdi_ano * 0.85)} a.a.</b></li>
      </ul>
      <div class="btns" style="margin-top:12px"><button class="btn primary sm" data-act="rf-aba" data-v="ofertas">${ic("balanca")}Comparar ofertas</button><button class="btn sm" data-act="sheet" data-sheet="ferramenta" data-param="conversor">LCI × CDB</button></div></div>
    <section class="sec"><div class="sec-h"><h2>Produtos bancários</h2></div><div class="tiles">
      ${cartaoProduto("cdb", "O mais comum: % do CDI, prefixado ou IPCA+.")}${cartaoProduto("lci", "Isenta de IR, financia imóveis.")}${cartaoProduto("lca", "Isenta de IR, financia o agro.")}
      ${cartaoProduto("lc", "Emitida por financeiras, paga mais.")}${cartaoProduto("poupanca", "Simples e isenta, mas rende menos.")}</div></section>
    <div class="card" style="margin-top:14px"><h3>Onde estão as taxas de cada banco?</h3><p class="small muted">As prateleiras de CDB, LCI e LCA mudam todo dia e ficam dentro do app de cada banco ou corretora. Não existe uma fonte pública e gratuita com todas elas. Copie as ofertas que você recebeu na aba <b>Comparar</b>: o app calcula o rendimento líquido e mostra qual vale mais.</p></div>`;
}
function rfCredito() {
  return `<div class="card" style="margin-top:14px"><p class="small" style="color:var(--ink-2)">Crédito privado é emprestar para empresas. Paga mais que o Tesouro e os bancos, mas <b>não tem FGC</b>: o risco é a empresa não pagar. Prefira emissores grandes e diversifique.</p></div>
    <section class="sec"><div class="sec-h"><h2>Títulos</h2></div><div class="tiles">
      ${cartaoProduto("debenture", "Dívida de empresas; incentivadas são isentas.")}${cartaoProduto("cri", "Recebíveis imobiliários, isento de IR.")}${cartaoProduto("cra", "Recebíveis do agro, isento de IR.")}
      ${cartaoProduto("coe", "Estruturado com cenário pré-definido.")}${cartaoProduto("previdencia", "PGBL e VGBL para o longo prazo.")}</div></section>
    <section class="sec"><div class="sec-h"><h2>Atalhos com dados ao vivo</h2></div>
      <div class="card"><p class="small muted">Para investir em crédito privado com liquidez diária e diversificação, veja os FIIs de papel (CRI), os Fiagros e os fundos de renda fixa.</p>
      <div class="btns"><button class="btn sm" data-act="ir-cat" data-cat="fiis" data-grupo="Papel (CRI)">FIIs de papel</button><button class="btn sm" data-act="ir-cat" data-cat="fiis" data-grupo="Fiagro">Fiagros</button><button class="btn sm" data-act="ir-cat" data-cat="fundos">Fundos de renda fixa</button></div></div></section>`;
}
const TIPOS_OFERTA = { "CDB": false, "LCI": true, "LCA": true, "LC": false, "CRI": true, "CRA": true, "Debênture incentivada": true, "Debênture": false, "Tesouro": false, "Poupança": true, "Outro": false };
function calcOferta(o) {
  const m = S.data.macro;
  const anual = o.idx === "poup" ? (poupancaAno(m) || 0) / 100 : taxaAnualPor(o.idx, o.taxa, m);
  const dias = Math.max(1, o.dias || 365);
  const isento = TIPOS_OFERTA[o.tipo];
  const bruto = Math.pow(1 + anual, dias / 365) - 1;
  const liq = bruto * (1 - (isento ? 0 : IR(dias) / 100));
  const liqAno = Math.pow(1 + liq, 365 / dias) - 1;
  const cdiBruto = Math.pow(1 + (m.cdi_ano || 0) / 100, dias / 365) - 1;
  return { anual, liq, liqAno, pctCdi: cdiBruto ? liq / (cdiBruto * (1 - IR(dias) / 100)) * 100 : null, isento };
}
function rfOfertas() {
  const os = S.ofertas.map(o => ({ ...o, c: calcOferta(o) })).sort((a, b) => b.c.liqAno - a.c.liqAno);
  const idxTxt = o => o.idx === "cdi" ? `${fmt(o.taxa, 0)}% do CDI` : o.idx === "ipca" ? `IPCA + ${fmt(o.taxa)}%` : o.idx === "selic" ? `Selic + ${fmt(o.taxa)}%` : o.idx === "poup" ? "Poupança" : `${fmt(o.taxa)}% a.a.`;
  return `<div class="card" style="margin-top:14px"><span class="eyebrow">Comparador de ofertas</span><p class="small" style="color:var(--ink-2);margin-top:6px">Digite as ofertas que você recebeu do seu banco ou corretora. O app calcula o rendimento líquido de IR no prazo e ordena da melhor para a pior. As ofertas ficam só neste aparelho.</p>
      <div class="btns" style="margin-top:12px"><button class="btn primary sm" data-act="sheet" data-sheet="oferta">${ic("plus")}Adicionar oferta</button>${os.length ? `<button class="btn sm ghost" data-act="ofertas-exemplo">Comparar com Tesouro e poupança</button>` : `<button class="btn sm ghost" data-act="ofertas-exemplo">Ver um exemplo</button>`}</div></div>
    <div style="margin-top:12px">${os.length ? os.map((o, i) => `<button type="button" class="offer" data-act="sheet" data-sheet="oferta" data-param="${esc(o.id)}" style="width:100%;text-align:left;color:var(--ink)">
        <span class="rank">${i + 1}</span>
        <span><b>${esc(o.nome || o.tipo)}</b><br><small>${esc(o.tipo)} · ${idxTxt(o)} · ${o.dias >= 365 ? fmt(o.dias / 365, 1) + " anos" : o.dias + " dias"} · ${o.liquidez === "diaria" ? "liquidez diária" : "no vencimento"}${o.c.isento ? " · isento" : ""}</small></span>
        <span class="end"><b>${pct(o.c.liqAno * 100)}</b><small>líquido ao ano${ok(o.c.pctCdi) ? ` · ${fmt(o.c.pctCdi, 0)}% do CDI líq.` : ""}</small></span></button>`).join("")
      : `<div class="empty"><b>Nenhuma oferta ainda</b>Adicione as taxas que seu banco ofereceu (ex.: CDB 112% do CDI por 2 anos, LCA 93% do CDI por 1 ano) para ver qual rende mais.</div>`}</div>`;
}

// ---------- fundos
function telaFundos() {
  if (!S.fundos) { carregarFundos(); return `<div class="skel" style="height:140px"></div><div class="skel"></div><div class="skel"></div>`; }
  const fs = S.fundos.fundos || [];
  if (!fs.length) return `${cabecalhoProduto("fundos")}<div class="empty" style="margin-top:14px"><b>Fundos indisponíveis</b>Os dados da CVM ainda não foram gerados. Eles aparecem depois da próxima rodada do monitor.</div>`;
  const classes = ["Renda Fixa", "Multimercado", "Ações", "Cambial", "Todas"].filter(c => c === "Todas" || fs.some(f => f.classe === c));
  const conta = c => c === "Todas" ? fs.length : fs.filter(f => f.classe === c).length;
  if (!S.fu.limite) S.fu.limite = 50;
  return `${cabecalhoProduto("fundos", `${fs.length} fundos · CDI 12 meses ${pct(S.fundos.cdi_12m, 1)}`)}
    <div class="filters" style="margin-top:14px">
      <label class="search">${ic("busca")}<span class="sr">Buscar fundo</span><input data-busca="fundos" type="search" placeholder="Buscar fundo ou gestora" value="${esc(S.fu.q)}" autocomplete="off"></label>
      <div class="chips">${classes.map(c => `<button type="button" class="chip" data-act="fu-classe" data-v="${c}" aria-pressed="${S.fu.classe === c}">${c} <span class="n">${conta(c)}</span></button>`).join("")}</div>
      <div class="filter-row"><select class="select" id="fu-ordem">${[["ret_12m", "Rentabilidade 12 meses"], ["pct_cdi", "% do CDI"], ["ret_1m", "Rentabilidade 30 dias"], ["pl", "Maior patrimônio"], ["cotistas", "Mais cotistas"], ["vol", "Menor oscilação"]].map(([v, t]) => `<option value="${v}" ${S.fu.ordem === v ? "selected" : ""}>${t}</option>`).join("")}</select>
        <label class="toggle"><input type="checkbox" id="fu-publico" ${S.fu.publico ? "checked" : ""}> Só público geral</label></div>
      <div class="filter-row"><span>Rentabilidade bruta, antes de IR e come-cotas</span><span id="fu-count"></span></div>
    </div>
    <div id="fu-lista"></div>
    <p class="disclaimer">Fonte: Comissão de Valores Mobiliários (informe diário e cadastro de fundos), data de referência ${esc((fs[0] || {}).data || "—")}. Mostramos os maiores fundos abertos de cada classe com pelo menos 100 cotistas. Rentabilidade passada não garante rentabilidade futura. Leia a lâmina e o regulamento antes de investir.</p>`;
}
function atualizarListaFundos() {
  const box = $("#fu-lista");
  if (!box || !S.fundos) return;
  const f = S.fu, q = norm(f.q.trim());
  const val = (v, d) => ok(v) ? v : d;
  const it = S.fundos.fundos.filter(x => (f.classe === "Todas" || x.classe === f.classe) && (!f.publico || !x.publico || x.publico === "Público Geral") && (!q || norm(x.nome + " " + (x.gestor || "") + " " + x.cnpj).includes(q)))
    .sort({ ret_12m: (a, b) => val(b.ret_12m, -1e9) - val(a.ret_12m, -1e9), pct_cdi: (a, b) => val(b.pct_cdi, -1e9) - val(a.pct_cdi, -1e9), ret_1m: (a, b) => val(b.ret_1m, -1e9) - val(a.ret_1m, -1e9),
      pl: (a, b) => val(b.pl, 0) - val(a.pl, 0), cotistas: (a, b) => b.cotistas - a.cotistas, vol: (a, b) => val(a.vol, 99) - val(b.vol, 99) }[f.ordem]);
  $("#fu-count").textContent = `${it.length} fundos`;
  box.innerHTML = lista(it, rowFundo, "Nenhum fundo com esses filtros.", f.limite);
}

// ---------- subscrições
function telaSubscricoes() {
  return `${cabecalhoProduto("subscricoes", "Guia")}
    <section class="sec"><div class="sec-h"><h2>Como funciona</h2></div>
      <div class="card acao"><span class="ico">${ic("ticket")}</span><div><h3>1. Você recebe o direito</h3><p>Quem tem a ação ou cota na data de corte recebe direitos proporcionais. Eles aparecem na carteira da corretora com código próprio: <b>final 1 ou 2</b> para ações (ex.: PETR1) e <b>final 12</b> para FIIs (ex.: HGLG12).</p></div></div>
      <div class="card acao"><span class="ico up">${ic("alvo")}</span><div><h3>2. Você decide até o prazo</h3><p><b>Exercer:</b> paga o preço de subscrição e recebe as novas cotas, geralmente com desconto. <b>Vender o direito:</b> negocia o direito na bolsa e embolsa a diferença. <b>Não fazer nada:</b> o direito vence e perde todo o valor.</p></div></div>
      <div class="card acao"><span class="ico warn">${ic("relogio")}</span><div><h3>3. Fique de olho nas datas</h3><p>Cada oferta tem data de corte, período de exercício (cerca de 10 dias úteis) e, às vezes, sobras. A empresa divulga tudo em fato relevante, e a corretora avisa você.</p></div></div>
    </section>
    <div class="card" style="margin-top:14px"><h3>Vale a pena exercer?</h3><p class="small muted">Compare o preço de subscrição com a cotação de hoje e veja quanto vale cada direito.</p>
      <div class="btns"><button class="btn primary sm" data-act="sheet" data-sheet="ferramenta" data-param="subscricao">${ic("calc")}Abrir calculadora</button><button class="btn sm" data-act="ir-cat" data-cat="fiis">Ver cotações de FIIs</button></div></div>
    <div class="card" style="margin-top:12px"><h3>Por que não há uma lista ao vivo aqui?</h3><p class="small muted">As ofertas em andamento são publicadas em comunicados de cada empresa e na área de eventos da sua corretora. Não existe uma fonte pública gratuita e confiável com todas elas em tempo real.</p></div>
    ${disclaimer()}`;
}

// =============================================================== notícias
function itemNoticia(n) {
  const rel = (n.ativos || []).map(t => S.data && S.data.idxAtivo.get(t)).filter(Boolean);
  return `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">
      <span><span class="meta"><b>${esc(n.fonte)}</b><span>${esc(haQuanto(Date.parse(n.quando)))}</span>${(n.temas || []).slice(0, 1).map(t => `<span>· ${esc(t)}</span>`).join("")}</span>
      <h4>${esc(n.titulo)}</h4>${n.resumo ? `<p>${esc(n.resumo)}</p>` : ""}</span>
      ${n.img ? `<span class="thumb" style="background-image:url('${esc(n.img)}')" aria-hidden="true"></span>` : ""}</a>
    ${rel.length ? `<div class="rel">${rel.map(a => `<button type="button" data-act="ativo" data-id="${esc(a.ticker)}">${esc(a.codigo)} ${setaVar(a.var_dia, 1)}</button>`).join("")}</div>` : ""}</li>`;
}
function telaNoticias() {
  if (!S.noticias) { carregarNoticias().then(() => S.tab === "noticias" && renderView()); return `<div class="skel" style="height:240px"></div><div class="skel"></div><div class="skel"></div>`; }
  const ns = S.noticias.itens || [];
  const temas = ["Todas", "Mercado", "Ações", "Economia", "Renda fixa", "FIIs", "Cripto", "Internacional"];
  const fontes = ["Todas", ...[...new Set(ns.map(n => n.fonte))].sort((a, b) => a.localeCompare(b, "pt-BR"))];
  const conta = t => t === "Todas" ? ns.length : ns.filter(n => (n.temas || []).includes(t)).length;
  return `<p class="hint" style="margin-top:2px">${ns.length} manchetes de ${new Set(ns.map(n => n.fonte)).size} fontes · atualizado ${esc(S.noticias.atualizado || "—")}. Toque para ler no site original.</p>
    <div class="filters">
      <label class="search">${ic("busca")}<span class="sr">Buscar notícia</span><input data-busca="noticias" type="search" placeholder="Buscar notícia, empresa ou código" value="${esc(S.nf.q)}" autocomplete="off"></label>
      <div class="chips">${temas.filter(t => conta(t) || t === S.nf.tema).map(t => `<button type="button" class="chip" data-act="nf-tema" data-v="${t}" aria-pressed="${S.nf.tema === t}">${t} <span class="n">${conta(t)}</span></button>`).join("")}</div>
      <div class="filter-row"><select class="select" id="nf-fonte" aria-label="Fonte">${fontes.map(f => `<option ${S.nf.fonte === f ? "selected" : ""} value="${esc(f)}">${f === "Todas" ? "Todas as fontes" : esc(f)}</option>`).join("")}</select><button class="btn sm ghost" data-act="refresh">${ic("refresh")}Atualizar</button></div>
    </div>
    <div id="nf-lista"></div>`;
}
function atualizarListaNoticias() {
  const box = $("#nf-lista");
  if (!box || !S.noticias) return;
  const q = norm(S.nf.q.trim());
  const it = (S.noticias.itens || []).filter(n => (S.nf.tema === "Todas" || (n.temas || []).includes(S.nf.tema)) && (S.nf.fonte === "Todas" || n.fonte === S.nf.fonte)
    && (!q || norm(n.titulo + " " + n.resumo + " " + (n.ativos || []).join(" ")).includes(q)));
  if (!it.length) { box.innerHTML = `<div class="empty">Nenhuma notícia com esses filtros.</div>`; return; }
  const destaque = it.find(n => n.img) || it[0];
  const resto = it.filter(n => n !== destaque);
  box.innerHTML = `<a class="news-feature glass" href="${esc(destaque.link)}" target="_blank" rel="noopener noreferrer">
      ${destaque.img ? `<div class="img" style="background-image:url('${esc(destaque.img)}')"></div>` : ""}
      <div class="txt"><span class="eyebrow">${esc(destaque.fonte)} · ${esc(haQuanto(Date.parse(destaque.quando)))}</span><h3>${esc(destaque.titulo)}</h3>${destaque.resumo ? `<p>${esc(destaque.resumo)}</p>` : ""}</div></a>
    <div class="list" style="margin-top:12px"><ul class="news">${resto.slice(0, S.nf.limite).map(itemNoticia).join("")}</ul>
    ${resto.length > S.nf.limite ? `<button class="more" data-act="nf-mais">Carregar mais ${Math.min(30, resto.length - S.nf.limite)}</button>` : ""}</div>
    <p class="disclaimer">As manchetes pertencem aos veículos citados; o app mostra apenas título, trecho e link para a matéria original. Novas manchetes chegam a cada rodada do monitor (a cada 30 minutos no pregão e de hora em hora fora dele).</p>`;
}

// =============================================================== carteira
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
  if (!pos.length) return `<div class="empty" style="margin-top:6px"><b>Sua carteira está vazia</b>Cadastre ações, FIIs, ETFs, BDRs, cripto, Tesouro, fundos, CDB e o que mais tiver para ver resultado, divisão por classe e rebalanceamento.
      <div class="btns"><button class="btn primary" data-act="sheet" data-sheet="add">${ic("plus")}Adicionar investimento</button><button class="btn" data-act="importar">${ic("subir")}Importar backup</button></div>
      <p class="small muted" style="margin-top:14px">Os dados ficam só neste aparelho.</p></div>`;
  const total = pos.reduce((s, p) => s + (ok(p.valor) ? p.valor : 0), 0);
  const custo = pos.reduce((s, p) => s + (ok(p.custo) && ok(p.valor) ? p.custo : 0), 0);
  const comCusto = pos.filter(p => ok(p.custo) && ok(p.valor)).reduce((s, p) => s + p.valor, 0);
  const res = comCusto - custo, hoje = pos.reduce((s, p) => s + (ok(p.varDia) ? p.varDia : 0), 0);
  const semPreco = pos.filter(p => !ok(p.valor));
  let h = `<section class="hero glass" style="margin-top:4px"><span class="eyebrow">Patrimônio estimado</span><div class="big">${reais(total)}</div>
      <div class="sub"><span class="${hoje >= 0 ? "up" : "down"}">${hoje >= 0 ? "+" : "−"}${reais(Math.abs(hoje))} hoje</span>${custo ? `<span>·</span><span class="${res >= 0 ? "up" : "down"}">${res >= 0 ? "+" : "−"}${reais(Math.abs(res))} (${pct(res / custo * 100, 1, true)}) desde a compra</span>` : ""}</div>
      ${semPreco.length ? `<p class="small" style="color:var(--warn);margin:10px 0 0">${semPreco.length} item(ns) sem cotação nesta atualização ficaram fora do total.</p>` : ""}
      <div class="btns" style="margin-top:16px"><button class="btn primary sm" data-act="sheet" data-sheet="add">${ic("plus")}Adicionar</button><button class="btn sm" data-act="exportar">${ic("baixar")}Backup</button><button class="btn sm ghost" data-act="importar">${ic("subir")}Importar</button></div></section>`;
  const dv = desviosCarteira(pos);
  const outros = pos.filter(p => p.classe === "Outros").reduce((s, p) => s + (ok(p.valor) ? p.valor : 0), 0);
  const fatias = [...dv.filter(x => x.valor > 0).map(x => [x.classe, x.valor]), ...(outros > 0 ? [["Outros", outros]] : [])];
  h += `<section class="sec"><div class="sec-h"><h2>Divisão</h2><button class="link" data-act="sheet" data-sheet="perfil">Perfil ${esc(PERFIS[S.perfil].nome.toLowerCase())}</button></div>
    <div class="card"><div class="stack" role="img" aria-label="${fatias.map(([c, v]) => `${c}: ${pct(v / total * 100, 0)}`).join(", ")}">${fatias.map(([c, v]) => `<i style="flex:${v};background:${COR_CLASSE[c]}" title="${c}: ${pct(v / total * 100, 1)}"></i>`).join("")}</div>
      <ul class="alloc">${dv.map(x => {
        const aj = Math.abs(x.ajuste) < total * 0.02 ? "na medida" : x.ajuste > 0 ? `faltam ${compacto(x.ajuste)} para a referência` : `${compacto(-x.ajuste)} acima da referência`;
        return `<li><i style="background:${COR_CLASSE[x.classe]}"></i><span>${x.classe}</span><span class="v"><b>${pct(x.atual, 0)}</b> · ${compacto(x.valor)}</span><span class="meta">Referência ${x.meta}% · ${aj}</span></li>`;
      }).join("")}${outros > 0 ? `<li><i style="background:${COR_CLASSE.Outros}"></i><span>Outros</span><span class="v"><b>${pct(outros / total * 100, 0)}</b> · ${compacto(outros)}</span></li>` : ""}</ul>
      <p class="small muted" style="margin-top:10px">Referência didática para o perfil escolhido, não recomendação. Para rebalancear, prefira direcionar novos aportes às classes abaixo da referência.</p></div></section>`;
  const porClasse = CLASSES.map(c => [c, pos.filter(p => p.classe === c)]).filter(([, ps]) => ps.length);
  h += `<section class="sec"><div class="sec-h"><h2>Investimentos</h2></div><div class="list">${porClasse.map(([c, ps]) =>
    `<div class="group-h"><b>${c}</b><span>${reais(ps.reduce((s, p) => s + (ok(p.valor) ? p.valor : 0), 0))}</span></div>` + ps.map(rowPosicao).join("")).join("")}</div></section>`;
  return h + `<p class="disclaimer">Valores estimados com a última cotação disponível. Ativos em dólar convertidos pelo câmbio do dia. Tesouro pelo preço de venda. Fundos e outros pelo valor que você informou. Não substitui o extrato da corretora.</p>`;
}
function rowPosicao(p) {
  const cod = p.tipo === "ativo" && p.refObj ? p.refObj.codigo : p.tipo === "tesouro" && p.refObj ? nomeTitulo(p.refObj) : p.nome;
  const sub = p.tipo === "ativo" || p.tipo === "tesouro"
    ? `${fmt(p.qtd, p.qtd % 1 ? (p.tipo === "tesouro" ? 2 : 4) : 0)} × ${p.refObj ? (p.tipo === "tesouro" ? reais(p.valor / p.qtd) : moeda(p.refObj.preco, p.moedaAtivo)) : "sem cotação"}`
    : p.tipo === "fundo" ? "Fundo · valor informado" : (p.classe + " · valor informado");
  return `<button type="button" class="row no-av" data-act="sheet" data-sheet="add" data-param="${esc(p.id)}">
    <span><span class="code">${esc(cod)}</span><span class="name">${esc(sub)}</span></span>
    <span class="end"><span class="price">${reais(p.valor)}</span>${ok(p.resPct) ? setaVar(p.resPct, 1) : `<span class="var muted">—</span>`}</span>
    ${p.sinal ? `<span class="foot">${badge(p.sinal)}${ok(p.resultado) ? `<span class="tag">${p.resultado >= 0 ? "+" : "−"}${reais(Math.abs(p.resultado))}</span>` : ""}</span>` : ""}
  </button>`;
}

// =============================================================== mais
const FERRAMENTAS = [
  ["sim", "calc", "Simulador de renda fixa", "CDB, Tesouro, LCI e outros, já com IR."],
  ["ofertas", "balanca", "Comparar ofertas", "Qual oferta do banco rende mais."],
  ["meta", "alvo", "Meta de investimento", "Quanto investir por mês para chegar lá."],
  ["reserva", "escudo", "Reserva de emergência", "Quanto guardar e onde deixar."],
  ["conversor", "troca", "Conversor de taxas", "Mensal ↔ anual e LCI × CDB."],
  ["subscricao", "ticket", "Calculadora de subscrição", "Vale a pena exercer o direito?"],
  ["perfil", "pessoa", "Descubra seu perfil", "Cinco perguntas rápidas."],
  ["sinais", "sinal", "Como os sinais funcionam", "As regras por trás de cada sinal."],
  ["glossario", "livro", "Glossário", "Termos do mercado explicados."],
  ["config", "editar", "Ativos e alertas", "Mudar a lista e as regras."],
  ["alertas", "sino", "Alertas no celular", "Avisos pelo app ntfy."],
  ["instalar", "celular", "Instalar como app", "Atalho na tela inicial."],
];
function telaMais() {
  return `<div class="tools" style="margin-top:4px">${FERRAMENTAS.map(([k, i, t, s]) =>
    `<button type="button" class="tool" ${k === "ofertas" ? `data-act="ir-cat" data-cat="rf" data-aba="ofertas"` : `data-act="sheet" data-sheet="ferramenta" data-param="${k}"`}><span class="ico">${ic(i)}</span><b>${t}</b><span>${s}</span></button>`).join("")}</div>
    <section class="sec"><div class="sec-h"><h2>Preferências</h2></div>
      <div class="card"><div class="btns"><button class="btn" data-act="sheet" data-sheet="perfil">${ic("pessoa")}Perfil: ${esc(PERFIS[S.perfil].nome)}</button><button class="btn" data-act="sheet" data-sheet="ajustes">${ic("ajustes")}Ajustes e tema</button><button class="btn" data-act="sheet" data-sheet="status">${ic("pulso")}Situação dos dados</button></div></div></section>
    ${disclaimer()}`;
}
