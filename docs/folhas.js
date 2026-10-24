"use strict";
/* Monitor — folhas (janelas por cima da tela), roteamento e ferramentas. */

// =============================================================== rotas: #aba~sub/folha/param
function rotaAtual() { return location.hash.slice(1).split("/").map(p => { try { return decodeURIComponent(p); } catch (e) { return p; } }); }
function hashDe(tab, sub, tipo, param) {
  return "#" + [encodeURIComponent(tab + (sub ? "~" + sub : "")), ...(tipo ? [tipo, param].filter(x => x != null && x !== "").map(encodeURIComponent) : [])].join("/");
}
function abrirSheet(tipo, param) { S.pilha++; location.hash = hashDe(S.tab, S.sub, tipo, param); }
function fecharSheet() {
  if (S.pilha > 0) { S.pilha--; history.back(); }
  else location.replace(hashDe(S.tab, S.sub));
}
function irPara(tab, sub) {
  S.pilha = 0;
  const alvo = hashDe(tab, sub);
  if (location.hash === alvo) { S.sheet = null; renderSheet(); renderTopo(); renderView(true); window.scrollTo(0, 0); }
  else location.hash = alvo;
}
function aplicarRota() {
  const partes = rotaAtual();
  const [tabRaw, sub] = (partes[0] || "").split("~");
  const tab = TABS[tabRaw] ? tabRaw : "inicio";
  const subOk = tab === "explorar" && CATS[sub] ? sub : null;
  const mudou = tab !== S.tab || subOk !== S.sub;
  S.tab = tab; S.sub = subOk;
  S.sheet = partes[1] ? { tipo: partes[1], param: partes.slice(2).join("/") || null } : null;
  if (!S.sheet) S.pilha = 0;
  renderTabbar(); renderTopo();
  if (mudou || !$("#view").innerHTML) { renderView(true); window.scrollTo(0, 0); }
  renderSheet();
}

function renderSheet() {
  const sh = $("#sheet"), bd = $("#backdrop");
  if (!S.sheet) {
    if (!sh.hidden) {
      sh.hidden = true; bd.hidden = true; document.body.classList.remove("sheet-open");
      graficos.forEach((_, el) => { if (sh.contains(el)) graficos.delete(el); });
      if (S.voltarFoco && S.voltarFoco.isConnected) S.voltarFoco.focus({ preventScroll: true });
    }
    return;
  }
  const fn = { ativo: sheetAtivo, titulo: sheetTitulo, fundo: sheetFundo, produto: sheetProduto, info: sheetInfo, status: sheetStatus, ajustes: sheetAjustes,
    perfil: sheetPerfil, add: sheetAdd, oferta: sheetOferta, ferramenta: sheetFerramenta, busca: sheetBusca }[S.sheet.tipo];
  const semDados = ["produto", "info", "status", "ajustes", "perfil", "ferramenta"];
  const r = fn && (S.data || semDados.includes(S.sheet.tipo)) ? fn(S.sheet.param) : null;
  if (!r) {
    if (S.data && !(S.sheet.tipo === "fundo" && !S.fundos)) { S.sheet = null; location.replace(hashDe(S.tab, S.sub)); }
    if (S.sheet && S.sheet.tipo === "fundo") carregarFundos().then(renderSheet);
    return;
  }
  const abrindo = sh.hidden;
  if (abrindo && !S.voltarFoco) S.voltarFoco = document.activeElement;
  const corpo = $("#sheet-body");
  const rolagem = abrindo ? 0 : corpo.scrollTop;
  $("#sheet-title").textContent = r.titulo;
  $("#sheet-actions").innerHTML = r.acoes || "";
  corpo.innerHTML = r.html;
  sh.hidden = false; bd.hidden = false;
  document.body.classList.add("sheet-open");
  corpo.scrollTop = rolagem;
  if (r.depois) r.depois(corpo);
  if (abrindo && !r.foco) $("#sheet .sheet-head [data-act=close]").focus({ preventScroll: true });
}

// =============================================================== ficha do ativo
const COMO_COMPRAR = {
  acoes_br: a => passosBolsa(a, "ação"), fiis: a => passosBolsa(a, "cota"), etfs_br: a => passosBolsa(a, "cota"),
  acoes_global: a => `<ol><li><b>Pela B3, em reais:</b> ${a.bdr ? `compre o BDR <b>${esc(a.bdr)}</b> na sua corretora, como uma ação.` : "procure o BDR na sua corretora (código terminado em 34 ou 39)."}</li><li><b>Direto nos EUA:</b> abra uma conta em corretora internacional, envie dólares e compre <b>${esc(a.codigo)}</b>. Muitas permitem frações de ação.</li></ol><p class="small muted" style="margin-top:8px">BDR: 15% sobre o lucro, sem isenção. Exterior: 15% sobre os ganhos, apurados uma vez por ano. Confira a regra vigente.</p>`,
  etfs_global: a => `<ol><li>Abra uma conta em corretora internacional e compre <b>${esc(a.codigo)}</b> em dólar.</li><li>Alternativa em reais: procure o BDR do ETF ou um ETF brasileiro equivalente (ex.: IVVB11 para S&amp;P 500).</li></ol>`,
  cripto: a => a.grupo === "Stablecoins" ? `<p>Stablecoins são compradas em corretoras de cripto e servem para guardar valor em dólar ou transferir dinheiro. Verifique a reputação do emissor e da corretora.</p>`
    : `<ol><li>Abra conta em uma corretora de cripto ou banco digital que ofereça <b>${esc(a.nome)}</b>.</li><li>Transfira reais por PIX e compre a quantidade desejada (pode ser fração).</li><li>Para quantias grandes, considere guardar em carteira própria (autocustódia).</li><li>Alternativa: ETFs de cripto na B3 (HASH11, QBTC11, ETHE11, SOLH11), comprados como ações.</li></ol><p class="small muted" style="margin-top:8px">Cripto oscila muito: use só uma pequena parte da carteira.</p>`,
  cambio: a => `<p>Para ter exposição a ${esc(a.nome.toLowerCase())}: ETFs na B3 (GOLD11 para ouro, USDB11 para dólar), fundos cambiais, ou conta global em dólar. Compare taxas e IOF.</p>`,
  indices: a => `<p>Índices não são comprados diretamente. Use um ETF que copia o índice: <b>BOVA11</b> (Ibovespa), <b>IVVB11</b> (S&amp;P 500), <b>NASD11</b> (Nasdaq), <b>ACWI11</b> (mundo).</p>`,
};
function passosBolsa(a, unidade) {
  const lote = a.cat === "acoes_br" && a.preco ? Math.round(a.preco * 100) : null;
  return `<ol><li>Abra conta em uma corretora (muitas não cobram corretagem).</li><li>Transfira o dinheiro por PIX ou TED.</li>
    <li>No app ou home broker, busque <b>${esc(a.codigo)}</b>. ${lote ? `O lote padrão é de 100 ações (≈ ${reais(lote)}); para comprar de 1 a 99 use <b>${esc(a.codigo)}F</b>.` : `Dá para comprar a partir de 1 ${unidade}.`}</li>
    <li>Escolha a quantidade e o tipo de ordem: <i>a mercado</i> (preço atual) ou <i>limitada</i> (preço máximo).</li><li>Confirme. A liquidação acontece em 2 dias úteis.</li></ol>`;
}
function noticiasDe(a) {
  const ns = (S.noticias && S.noticias.itens) || [];
  const termo = a.cat === "acoes_br" || a.cat === "fiis" ? a.codigo : null;
  const nome = a.nome.split(/[ (]/)[0];
  return ns.filter(n => (n.ativos || []).includes(a.ticker) || (termo && n.titulo.includes(termo))
    || (nome.length >= 5 && !["indices", "cambio"].includes(a.cat) && new RegExp("\\b" + nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(n.titulo))).slice(0, 5);
}
function sheetAtivo(ticker) {
  const a = S.data.idxAtivo.get(ticker);
  if (!a) return null;
  const fav = S.favs.has(a.ticker), m = S.data.macro, cdi = m.cdi_ano;
  const pos = posicoes().find(p => p.tipo === "ativo" && p.ref === a.ticker);
  const c = CATS[a.cat] || {};
  const brl = a.moeda === "US$" ? emReais(a) : null;
  const stat = (k, rot, val, sub, id) => `<button type="button" class="stat" data-act="info" data-k="${k}" ${id ? `id="${id}"` : ""}><span>${rot} ${ic("info")}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</button>`;
  const rsiTxt = !ok(a.rsi) ? "" : a.rsi < 30 ? "Caiu rápido demais" : a.rsi > 70 ? "Subiu rápido demais" : "Faixa normal";
  const volTxt = !ok(a.volatilidade) ? "" : a.volatilidade < 20 ? "Oscila pouco" : a.volatilidade < 35 ? "Oscilação média" : "Oscila muito";
  const r12 = a.moeda === "US$" && ok(a.ret_12m_brl) ? a.ret_12m_brl : a.ret_12m;
  const rel = noticiasDe(a);
  const busca = encodeURIComponent(a.cat === "acoes_br" || a.cat === "fiis" ? a.codigo + " " + a.nome.split(" ")[0] : a.nome);
  const html = `
    <div class="card quote">
      <div class="top-line"><span>${esc(a.nome)}</span><span>·</span><span>${esc(c.nome || a.cat)}${a.grupo ? " · " + esc(a.grupo) : ""}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-top:6px"><div class="big">${moeda(a.preco, a.moeda)}</div>${badge(a.sinal)}</div>
      <div class="chg">${setaVar(a.var_dia)}<span class="muted">no dia · ${esc(a.data)}</span>${brl ? `<span class="pill">≈ ${moeda(brl, "R$")}</span>` : ""}${a.desatualizado ? `<span class="tag warn">cotação antiga</span>` : ""}</div>
      <div class="perf"><div><span>30 dias</span><b class="${a.ret_1m >= 0 ? "up" : "down"}">${pct(a.ret_1m, 1, true)}</b></div><div><span>No ano</span><b class="${a.ret_ano >= 0 ? "up" : "down"}">${pct(a.ret_ano, 1, true)}</b></div>
        <div><span>12 meses</span><b class="${a.ret_12m >= 0 ? "up" : "down"}">${pct(a.ret_12m, 1, true)}</b></div><div><span>${a.moeda === "US$" ? "12m em R$" : "Volatilidade"}</span><b>${a.moeda === "US$" ? pct(a.ret_12m_brl, 1, true) : pct(a.volatilidade, 0)}</b></div></div>
    </div>
    ${a.bdr ? `<div class="card"><span class="eyebrow">Na B3 via BDR</span><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:6px"><span><b style="font-size:18px">${esc(a.bdr)}</b><br><span class="small muted">Compre em reais pela sua corretora</span></span><span style="text-align:right"><b>${moeda(a.bdr_preco)}</b><br>${setaVar(a.bdr_var)}</span></div></div>` : ""}
    <div class="card">
      <div class="chart-top">
        <div class="seg" role="group" aria-label="Período">${["1M", "3M", "6M", "1A", "2A"].map(f => `<button type="button" data-act="g-faixa" data-v="${f}" aria-pressed="${S.graf.faixa === f}">${f}</button>`).join("")}</div>
        <div class="series-toggles" role="group" aria-label="Linhas do gráfico">
          <button type="button" data-act="g-mm" data-v="mm50" aria-pressed="${S.graf.mm50}"><i style="background:var(--s1)"></i>Média 50d</button>
          <button type="button" data-act="g-mm" data-v="mm200" aria-pressed="${S.graf.mm200}"><i style="background:var(--s3)"></i>Média 200d</button>
        </div>
      </div>
      <div class="chart" id="g-ativo"><div class="skel" style="height:230px;margin:0"></div></div>
      <div class="chart-foot" id="g-foot">Carregando histórico…</div>
    </div>
    <section class="sec"><div class="sec-h"><h2>Sinal: ${esc(SINAIS[a.sinal] ? SINAIS[a.sinal].t : a.sinal)}</h2><button class="link" data-act="info" data-k="score">${a.score > 0 ? "+" : ""}${a.score} pontos</button></div>
      <div class="card">${a.grupo === "Stablecoins" ? "" : regua(a.score)}<ul class="reasons" id="motivos"><li class="n"><b>i</b><span>Carregando os motivos…</span></li></ul>
      ${acimaDoPerfil(a) && a.cat !== "indices" ? `<p class="small" style="color:var(--warn);margin-top:10px">Risco ${esc(a.risco)}: acima do perfil ${esc(PERFIS[S.perfil].nome.toLowerCase())}. Se investir, use uma parte pequena da carteira.</p>` : ""}</div></section>
    <section class="sec"><div class="sec-h"><h2>Indicadores</h2></div><div class="stats">
      ${stat("ret12", a.moeda === "US$" ? "12 meses em R$" : "12 meses", pct(r12, 1, true), ok(r12) && ok(cdi) && a.cat !== "indices" ? (r12 > cdi ? "Acima do CDI (" + pct(cdi, 1) + ")" : "Abaixo do CDI (" + pct(cdi, 1) + ")") : "")}
      ${stat("queda_max", "Da máxima 12m", pct(a.queda_max_12m, 1), "", "st-max")}
      ${stat("volatilidade", "Volatilidade", pct(a.volatilidade, 0), volTxt)}
      ${stat("rsi", "RSI 14", fmt(a.rsi, 0), rsiTxt)}
      ${stat("mm50", "Média 50d", "…", "", "st-mm50")}
      ${stat("mm200", "Média 200d", "…", "", "st-mm200")}
      ${["cripto", "cambio", "indices"].includes(a.cat) ? "" : stat("dy", "Proventos 12m", ok(a.dy) ? pct(a.dy, 1) : "—", ok(a.dy) && ok(cdi) && a.moeda === "R$" ? (a.dy >= cdi * 0.85 ? "Perto ou acima do CDI" : "Abaixo do CDI") : "Sem dados ou não paga")}
      ${ok(a.liquidez) ? stat("liquidez", "Negociado por dia", compacto(a.liquidez, a.moeda === "pts" ? "R$" : a.moeda), "média de 30 pregões") : ""}
    </div></section>
    ${rel.length ? `<section class="sec"><div class="sec-h"><h2>Nas notícias</h2></div><div class="list"><ul class="news">${rel.map(itemNoticia).join("")}</ul></div></section>` : ""}
    ${a.cat === "indices" ? "" : `<section class="sec"><div class="sec-h"><h2>Na sua carteira</h2></div><div class="card">${pos
      ? `<ul class="kv"><li><span>Quantidade</span><b>${fmt(pos.qtd, pos.qtd % 1 ? 4 : 0)}</b></li><li><span>Preço médio</span><b>${moeda(pos.pm, a.moeda)}</b></li><li><span>Valor atual</span><b>${reais(pos.valor)}</b></li><li><span>Resultado</span><b class="${pos.resultado > 0 ? "up" : pos.resultado < 0 ? "down" : ""}">${ok(pos.resultado) ? (pos.resultado >= 0 ? "+" : "−") + reais(Math.abs(pos.resultado)) + " (" + pct(pos.resPct, 1, true) + ")" : "—"}</b></li></ul>
        <div class="btns" style="margin-top:12px"><button class="btn sm" data-act="sheet" data-sheet="add" data-param="${esc(pos.id)}">${ic("editar")}Editar posição</button></div>`
      : `<p class="small muted">Você ainda não tem ${esc(a.codigo)} cadastrado.</p><div class="btns"><button class="btn primary sm" data-act="sheet" data-sheet="add" data-param="novo:ativo:${esc(a.ticker)}">${ic("plus")}Adicionar à carteira</button></div>`}</div></section>`}
    <details class="acc"><summary>Como investir em ${esc(a.codigo)}</summary><div class="acc-b">${(COMO_COMPRAR[a.cat] || COMO_COMPRAR.acoes_br)(a)}</div></details>
    <details class="acc"><summary>Antes de decidir</summary><div class="acc-b"><ul><li>Sinais técnicos erram com frequência, principalmente com o mercado andando de lado.</li><li>Uma queda forte pode ser desconto ou problema real: leia as notícias.</li><li>Não concentre muito em um só ativo; veja a divisão sugerida na Carteira.</li><li>Defina por quanto tempo vai ficar e o que faria se cair 20%.</li></ul></div></details>
    <div class="btns" style="margin-top:16px">
      <a class="btn sm" href="https://news.google.com/search?q=${busca}&hl=pt-BR&gl=BR&ceid=BR:pt-419" target="_blank" rel="noopener">${ic("externo")}Mais notícias</a>
      <a class="btn sm" href="https://finance.yahoo.com/quote/${encodeURIComponent(a.ticker)}" target="_blank" rel="noopener">${ic("externo")}Yahoo Finance</a>
      <button class="btn sm ghost" data-act="sheet" data-sheet="produto" data-param="${esc(c.guia || "acoes")}">${ic("livro")}Guia do produto</button>
    </div>${disclaimer()}`;
  return {
    titulo: a.codigo,
    acoes: `<button type="button" class="icon-btn fav-btn" data-act="fav" data-id="${esc(a.ticker)}" aria-pressed="${fav}" aria-label="${fav ? "Remover dos favoritos" : "Adicionar aos favoritos"}">${ic("star")}</button>`,
    html,
    depois: () => carregarHist(a).then(det => {
      if (!S.sheet || S.sheet.param !== a.ticker) return;
      const ms = det.motivos || [];
      $("#motivos").innerHTML = ms.map(r => `<li class="${r.tipo === "+" ? "p" : r.tipo === "-" ? "m" : "n"}"><b aria-label="${r.tipo === "+" ? "a favor" : r.tipo === "-" ? "contra" : "observação"}">${r.tipo === "+" ? "+" : r.tipo === "-" ? "−" : "i"}</b><span>${esc(r.texto)}</span></li>`).join("") || `<li class="n"><b>i</b><span>Histórico insuficiente para as regras.</span></li>`;
      const setS = (id, v, sub) => { const el = $("#" + id); if (el) { el.querySelector("b").textContent = v; if (sub) el.insertAdjacentHTML("beforeend", `<small>${esc(sub)}</small>`); } };
      setS("st-mm50", moeda(det.sma50, a.moeda), ok(det.sma50) ? (a.preco > det.sma50 ? "Preço acima" : "Preço abaixo") : "");
      setS("st-mm200", moeda(det.sma200, a.moeda), ok(det.sma200) ? (a.preco > det.sma200 ? "Preço acima" : "Preço abaixo") : "");
      if (ok(det.max_12m)) setS("st-max", pct(a.queda_max_12m, 1), "Máx. " + moeda(det.max_12m, a.moeda));
      graficoAtivo(a, det);
    }).catch(() => { const f = $("#g-foot"); if (f) f.textContent = "Não foi possível carregar o histórico agora."; const g = $("#g-ativo"); if (g) g.innerHTML = ""; }),
  };
}
function graficoAtivo(a, det) {
  const el = $("#g-ativo");
  if (!el || !det || !det.serie) return;
  const { datas, vals } = det.serie;
  const m50 = sma(vals, 50), m200 = sma(vals, 200);
  const dias = { "1M": 31, "3M": 92, "6M": 183, "1A": 366, "2A": 732 }[S.graf.faixa] || 183;
  let k = datas.findIndex(t => t >= datas[datas.length - 1] - dias * 864e5);
  if (k < 0) k = 0;
  const ds = datas.slice(k), vs = vals.slice(k), cc = casasPreco(a.preco);
  const fmtV = (v, eixo) => ok(v) ? (eixo ? fmt(v, Math.abs(v) >= 1000 ? 0 : cc) : moeda(v, a.moeda, a.moeda === "pts" ? 0 : cc)) : "—";
  montarGrafico(el, {
    datas: ds, fmtV, rotulo: `Preço de ${a.codigo} no período ${S.graf.faixa}`,
    // a série principal vai por último: fica por cima e aparece primeiro na dica
    series: [
      { nome: "Média 200d", vals: m200.slice(k), cor: "var(--s3)", largura: 1.4, on: S.graf.mm200 },
      { nome: "Média 50d", vals: m50.slice(k), cor: "var(--s1)", largura: 1.4, on: S.graf.mm50 },
      { nome: "Preço", vals: vs, cor: "var(--accent)", largura: 2.2, area: true },
    ],
  });
  const v0 = vs.find(ok), v1 = vs[vs.length - 1];
  const varP = ok(v0) && ok(v1) ? (v1 / v0 - 1) * 100 : null;
  const nome = { "1M": "1 mês", "3M": "3 meses", "6M": "6 meses", "1A": "1 ano", "2A": "2 anos" }[S.graf.faixa];
  $("#g-foot").innerHTML = `${ok(varP) ? `<b class="${varP >= 0 ? "up" : "down"}">${pct(varP, 1, true)}</b> em ${nome}. ` : ""}Toque e arraste no gráfico para ver cada dia.`;
}

// =============================================================== título do Tesouro
function sheetTitulo(id) {
  const t = S.data.idxTes.get(id);
  if (!t) return null;
  const info = tipoInfo(t), sel = info.idx === "Selic";
  const pos = posicoes().find(p => p.tipo === "tesouro" && p.ref === t.id);
  const html = `<div class="card quote"><div class="top-line"><span>${esc(t.tipo)}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-top:6px"><div class="big">${esc(taxaTexto(t))}</div>${badge(t.sinal)}</div>
      <div class="chg muted">${sel ? "Rentabilidade ao ano" : "Taxa contratada ao ano, levando até o vencimento"}</div>${sel ? "" : faixaTaxa(t)}</div>
    <div class="card"><p>${esc(t.explicacao)}</p><p class="small muted">${esc(info.desc)}</p></div>
    <section class="sec"><div class="sec-h"><h2>Detalhes</h2></div><div class="stats">
      <div class="stat"><span>Vencimento</span><b>${esc(t.vencimento)}</b><small>${fmt(t.anos, 1)} anos</small></div>
      <div class="stat"><span>Preço do título</span><b>${reais(t.preco)}</b><small>dá para comprar frações</small></div>
      <div class="stat"><span>Investimento mínimo</span><b>${reais(t.minimo ?? Math.max(30, t.preco / 100))}</b><small>1% do título, mín. R$ 30</small></div>
      <button type="button" class="stat" data-act="info" data-k="percentil"><span>Percentil 5 anos ${ic("info")}</span><b>${ok(t.percentil_5a) && !sel ? fmt(t.percentil_5a, 0) : "—"}</b><small>${ok(t.taxa_med_5a) && !sel ? "mediana " + fmt(t.taxa_med_5a) + "%" : ""}</small></button>
      <button type="button" class="stat" data-act="info" data-k="marcacao"><span>Risco ${ic("info")}</span><b>${esc(riscoTesouro(t))}</b><small>${esc(t.risco)}</small></button>
      ${ok(t.preco_venda) && t.preco_venda > 0 ? `<div class="stat"><span>Resgate hoje</span><b>${reais(t.preco_venda)}</b><small>taxa de venda ${pct(t.taxa_venda)}</small></div>` : ""}
    </div></section>
    <div class="btns" style="margin-top:16px"><button class="btn primary" data-act="simular-titulo" data-id="${esc(t.id)}">${ic("calc")}Simular</button>
      ${pos ? `<button class="btn" data-act="sheet" data-sheet="add" data-param="${esc(pos.id)}">${ic("editar")}Editar na carteira</button>` : `<button class="btn" data-act="sheet" data-sheet="add" data-param="novo:tesouro:${esc(t.id)}">${ic("plus")}Adicionar à carteira</button>`}</div>
    <details class="acc"><summary>Como investir</summary><div class="acc-b"><ol><li>Abra conta em corretora ou banco habilitado.</li><li>Transfira o dinheiro (PIX ou TED).</li><li>Na área de Tesouro Direto, escolha o título e o valor.</li><li>Acompanhe também pelo app oficial Tesouro Direto.</li><li>Para resgatar antes, venda pela corretora: o dinheiro cai em até 1 dia útil, pelo preço do dia.</li></ol><p class="small muted" style="margin-top:8px">Custos: custódia da B3 de 0,20% ao ano (Tesouro Selic isento até R$ 10 mil). IR pela tabela regressiva. Regras atuais.</p></div></details>
    <details class="acc"><summary>E se eu precisar vender antes?</summary><div class="acc-b"><p>${sel ? "No Tesouro Selic o preço quase não oscila: vender antes não costuma dar prejuízo, só IR sobre o lucro (maior nos primeiros meses)." : "O preço muda todos os dias conforme os juros (marcação a mercado). Se os juros subirem depois da compra, vender antes pode dar prejuízo; se caírem, pode render mais que o contratado. Levando até o vencimento, você recebe a taxa combinada."}</p></div></details>
    ${disclaimer()}`;
  return { titulo: nomeTitulo(t), html };
}

// =============================================================== fundo
function sheetFundo(cnpj) {
  if (!S.fundos) return null;
  const f = S.fundos.fundos.find(x => x.cnpj === cnpj);
  if (!f) return null;
  const pos = S.carteira.find(p => p.tipo === "fundo" && p.ref === f.cnpj);
  const html = `<div class="card quote"><div class="top-line"><span>${esc(f.classe)}${f.anbima ? " · " + esc(f.anbima) : ""}</span></div>
      <div style="font:400 26px/1.15 var(--serif);margin:6px 0 4px">${esc(f.curto)}</div>
      <div class="small muted">${esc(f.nome)}</div>
      <div class="perf"><div><span>30 dias</span><b class="${f.ret_1m >= 0 ? "up" : "down"}">${pct(f.ret_1m, 2, true)}</b></div><div><span>12 meses</span><b class="${f.ret_12m >= 0 ? "up" : "down"}">${pct(f.ret_12m, 1, true)}</b></div>
        <div><span>% do CDI</span><b>${ok(f.pct_cdi) ? fmt(f.pct_cdi, 0) + "%" : "—"}</b></div><div><span>Oscilação</span><b>${pct(f.vol, 1)}</b></div></div></div>
    <div class="card"><ul class="kv">
      <li><span>CNPJ</span><b>${esc(f.cnpj)}</b></li><li><span>Gestora</span><b>${esc(tituloCaso(f.gestor || "—"))}</b></li>
      <li><span>Patrimônio</span><b>${compacto(f.pl)}</b></li><li><span>Cotistas</span><b>${fmt(f.cotistas, 0)}</b></li>
      <li><span>Público</span><b>${esc(f.publico || "—")}</b></li><li><span>Tributação de longo prazo</span><b>${f.longo_prazo ? "Sim" : "Não informado"}</b></li>
      <li><span>Data da cota</span><b>${esc(f.data)}</b></li></ul></div>
    <details class="acc" open><summary>Como investir neste fundo</summary><div class="acc-b"><ol><li>Procure pelo nome ou CNPJ na plataforma de fundos do seu banco ou corretora. Nem todo fundo está em todas as plataformas.</li><li>Antes de aplicar, leia a <b>lâmina</b>: taxa de administração, taxa de performance, prazo de resgate e aplicação mínima.</li><li>Compare com alternativas simples: um fundo de renda fixa precisa render acima de um CDB ou do Tesouro Selic depois das taxas e do come-cotas.</li></ol></div></details>
    <div class="btns" style="margin-top:14px">
      <a class="btn sm" href="https://www.google.com/search?q=${encodeURIComponent(f.cnpj + " lâmina fundo")}" target="_blank" rel="noopener">${ic("externo")}Buscar lâmina</a>
      ${pos ? `<button class="btn sm" data-act="sheet" data-sheet="add" data-param="${esc(pos.id)}">${ic("editar")}Editar na carteira</button>` : `<button class="btn sm primary" data-act="sheet" data-sheet="add" data-param="novo:fundo:${esc(f.cnpj)}">${ic("plus")}Adicionar à carteira</button>`}
    </div>
    <p class="disclaimer">Fonte: CVM. Rentabilidade bruta da cota, antes de IR e come-cotas; já descontadas as taxas do fundo. Rentabilidade passada não garante resultado futuro.</p>`;
  return { titulo: "Fundo", html };
}

// =============================================================== guia de produto
function sheetProduto(k) {
  const p = PRODUTOS[k];
  if (!p) return null;
  const atalhos = {
    tesouro: `<button class="btn sm primary" data-act="ir-cat" data-cat="rf" data-aba="tesouro">Ver títulos do Tesouro</button>`,
    cdb: `<button class="btn sm primary" data-act="ir-cat" data-cat="rf" data-aba="ofertas">Comparar ofertas</button>`,
    lci: `<button class="btn sm primary" data-act="sheet" data-sheet="ferramenta" data-param="conversor">LCI × CDB</button>`,
    lca: `<button class="btn sm primary" data-act="sheet" data-sheet="ferramenta" data-param="conversor">LCA × CDB</button>`,
    acoes: `<button class="btn sm primary" data-act="ir-cat" data-cat="acoes_br">Ver ações</button>`,
    fiis: `<button class="btn sm primary" data-act="ir-cat" data-cat="fiis">Ver FIIs</button>`,
    etfs: `<button class="btn sm primary" data-act="ir-cat" data-cat="etfs_br">Ver ETFs</button>`,
    global: `<button class="btn sm primary" data-act="ir-cat" data-cat="acoes_global">Ver ações globais</button>`,
    fundos: `<button class="btn sm primary" data-act="ir-cat" data-cat="fundos">Ver fundos</button>`,
    cripto: `<button class="btn sm primary" data-act="ir-cat" data-cat="cripto">Ver criptomoedas</button>`,
    subscricao: `<button class="btn sm primary" data-act="sheet" data-sheet="ferramenta" data-param="subscricao">Calculadora</button>`,
  }[k] || "";
  const html = `<div class="card"><p class="lead">${esc(p.oque)}</p>
      <div class="facts-list"><div><span>Como ganha</span><b>${esc(p.ganha)}</b></div><div><span>Risco</span><b>${esc(p.risco)}</b></div>
        <div><span>Liquidez</span><b>${esc(p.liquidez)}</b></div><div><span>Imposto</span><b>${esc(p.ir)}</b></div>
        <div><span>Mínimo</span><b>${esc(p.minimo)}</b></div><div><span>Garantia FGC</span><b>${esc(p.fgc)}</b></div></div></div>
    <div class="card"><h3>Onde investir</h3><p class="small" style="color:var(--ink-2)">${esc(p.onde)}</p></div>
    <div class="btns" style="margin-top:14px">${atalhos}<button class="btn sm" data-act="sheet" data-sheet="ferramenta" data-param="sim">${ic("calc")}Simular</button><button class="btn sm ghost" data-act="sheet" data-sheet="ferramenta" data-param="glossario">${ic("livro")}Glossário</button></div>
    <p class="disclaimer">Regras de impostos e garantias descritas conforme a legislação vigente quando este guia foi escrito; elas mudam com frequência. Confirme com sua corretora ou contador.</p>`;
  return { titulo: p.nome, html };
}
function sheetInfo(k) {
  const g = GLOSS[k];
  if (!g) return { titulo: "Informação", html: `<p>Sem explicação para este item.</p>` };
  return { titulo: g[0], html: `<div class="card"><p class="lead">${esc(g[1])}</p></div><div class="btns" style="margin-top:14px"><button class="btn sm" data-act="sheet" data-sheet="ferramenta" data-param="glossario">${ic("livro")}Glossário completo</button></div>` };
}

// =============================================================== busca global
function sheetBusca() {
  if (!S.fundos) carregarFundos();
  return {
    titulo: "Buscar", foco: true,
    html: `<label class="search">${ic("busca")}<span class="sr">Buscar</span><input id="busca-global" type="search" placeholder="Código, nome, setor, fundo, produto…" autocomplete="off" enterkeyhint="search" value="${esc(S.buscaQ || "")}"></label><div id="busca-res"></div>`,
    depois: corpo => {
      const inp = $("#busca-global", corpo);
      const run = () => { S.buscaQ = inp.value; $("#busca-res", corpo).innerHTML = resultadosBusca(inp.value); };
      inp.addEventListener("input", run);
      run();
      setTimeout(() => inp.focus(), 60);
    },
  };
}
function resultadosBusca(qRaw) {
  const q = norm(qRaw.trim());
  if (!q) {
    const sug = ["PETR4", "VALE3", "ITUB4", "HGLG11", "IVVB11", "AAPL", "NVDA", "BTC-USD", "SOL-USD", "USDC-USD"].map(t => S.data.idxAtivo.get(t)).filter(Boolean);
    return `<p class="hint" style="margin-top:6px">Sugestões</p>${lista(sug, a => rowAtivo(a, { cat: true, grupo: false, compacto: true }), "")}
      <section class="sec"><div class="sec-h"><h2>Categorias</h2></div><div class="chips" style="flex-wrap:wrap">${ORDEM_CATS.map(k => `<button class="chip" data-act="ir-cat" data-cat="${k}">${CATS[k].nome}</button>`).join("")}</div></section>`;
  }
  const pont = a => { const c = norm(a.codigo); return c === q ? 0 : c.startsWith(q) ? 1 : norm(a.nome).startsWith(q) ? 2 : 3; };
  const ativos = S.data.ativos.filter(a => norm(a.codigo + " " + a.nome + " " + a.grupo + " " + (a.bdr || "") + " " + a.ticker).includes(q)).sort((a, b) => pont(a) - pont(b)).slice(0, 25);
  const tes = S.data.tes.filter(t => norm(t.id + " " + t.tipo).includes(q)).slice(0, 8);
  const fundos = S.fundos ? S.fundos.fundos.filter(f => norm(f.nome + " " + (f.gestor || "") + " " + f.cnpj).includes(q)).slice(0, 10) : [];
  const prods = Object.entries(PRODUTOS).filter(([k, p]) => norm(p.nome + " " + k + " " + p.oque).includes(q)).slice(0, 6);
  const ferr = FERRAMENTAS.filter(([, , t, s]) => norm(t + " " + s).includes(q)).slice(0, 4);
  let h = "";
  if (ativos.length) h += `<section class="sec" style="margin-top:14px"><div class="sec-h"><h2>Ativos</h2><span class="small muted">${ativos.length}</span></div>${lista(ativos, a => rowAtivo(a, { cat: true, grupo: false, compacto: true }), "")}</section>`;
  if (tes.length) h += `<section class="sec"><div class="sec-h"><h2>Tesouro Direto</h2></div>${lista(tes, rowTitulo, "")}</section>`;
  if (fundos.length) h += `<section class="sec"><div class="sec-h"><h2>Fundos</h2></div>${lista(fundos, rowFundo, "")}</section>`;
  if (prods.length) h += `<section class="sec"><div class="sec-h"><h2>Produtos e guias</h2></div><div class="list">${prods.map(([k, p]) => `<button type="button" class="row no-av" data-act="sheet" data-sheet="produto" data-param="${k}"><span><span class="code">${esc(p.nome)}</span><span class="name">${esc(p.oque)}</span></span><span class="end">${ic("voltar", 'style="transform:rotate(180deg);color:var(--muted)"')}</span></button>`).join("")}</div></section>`;
  if (ferr.length) h += `<section class="sec"><div class="sec-h"><h2>Ferramentas</h2></div><div class="list">${ferr.map(([k, i, t, s]) => `<button type="button" class="row no-av" data-act="sheet" data-sheet="ferramenta" data-param="${k}"><span><span class="code">${t}</span><span class="name">${s}</span></span><span class="end">${ic(i)}</span></button>`).join("")}</div></section>`;
  return h || `<div class="empty" style="margin-top:14px"><b>Nada encontrado</b>Tente o código (ex.: PETR4), o nome ou o setor. Para incluir um ativo novo, edite o config.json.<div class="btns"><button class="btn sm" data-act="sheet" data-sheet="ferramenta" data-param="config">Como adicionar ativos</button></div></div>`;
}

// =============================================================== ajustes, perfil, situação
function linkRepo() {
  const h = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return h && repo ? `https://github.com/${h[1]}/${repo}` : null;
}
function sheetAjustes() {
  return { titulo: "Ajustes", html: `
    <section class="sec" style="margin-top:0"><div class="sec-h"><h2>Aparência</h2></div>
      <div class="seg" role="group" aria-label="Tema">${[["auto", "Automático"], ["light", "Claro"], ["dark", "Escuro"]].map(([v, t]) => `<button type="button" data-act="tema" data-v="${v}" aria-pressed="${S.tema === v}">${t}</button>`).join("")}</div></section>
    <section class="sec"><div class="sec-h"><h2>Perfil</h2></div><div class="card"><p><b>${esc(PERFIS[S.perfil].nome)}</b> · ${esc(PERFIS[S.perfil].desc)}</p><div class="btns"><button class="btn sm" data-act="sheet" data-sheet="perfil">Mudar perfil</button><button class="btn sm ghost" data-act="sheet" data-sheet="ferramenta" data-param="perfil">Fazer o teste</button></div></div></section>
    <section class="sec"><div class="sec-h"><h2>Seus dados</h2></div><div class="card"><p class="small muted">Carteira, favoritos, ofertas e preferências ficam só neste navegador. Faça backup para levar a outro aparelho.</p>
      <div class="btns"><button class="btn sm" data-act="exportar">${ic("baixar")}Backup</button><button class="btn sm" data-act="importar">${ic("subir")}Restaurar</button><button class="btn sm danger" data-act="limpar-tudo">Apagar dados locais</button></div></div></section>
    <section class="sec"><div class="sec-h"><h2>Sobre</h2></div><div class="card small"><p>Monitor de investimentos gratuito e sem IA. O GitHub roda um script que busca dados públicos (Banco Central, Tesouro Transparente, CVM, Yahoo Finance e portais de notícias), calcula sinais por regras fixas e publica este site.</p><p class="muted">Nada aqui é recomendação de investimento.</p>
      <div class="btns"><button class="btn sm" data-act="sheet" data-sheet="status">Situação dos dados</button>${linkRepo() ? `<a class="btn sm ghost" href="${linkRepo()}" target="_blank" rel="noopener">${ic("externo")}Repositório</a>` : ""}</div></div></section>` };
}
function sheetPerfil() {
  return { titulo: "Perfil de investidor", html: `<p class="muted small" style="margin-top:0">O perfil destaca o que combina com você e define a divisão de referência da carteira. Nada fica escondido.</p>
    ${Object.entries(PERFIS).map(([k, p]) => `<label class="opt"><input type="radio" name="perfil" value="${k}" ${S.perfil === k ? "checked" : ""} data-act="set-perfil"><span><b>${p.nome}</b><span>${p.desc}</span><br><span>${Object.entries(p.meta).filter(([, v]) => v).map(([c, v]) => `${c} ${v}%`).join(" · ")}</span></span></label>`).join("")}
    <div class="btns" style="margin-top:12px"><button class="btn sm" data-act="sheet" data-sheet="ferramenta" data-param="perfil">Não sei meu perfil</button></div>` };
}
function sheetStatus() {
  const d = S.data, erros = (d && d.erros) || [];
  return { titulo: "Situação dos dados", html: `<div class="card"><ul class="kv">
      <li><span>Última atualização</span><b>${d ? esc(d.atualizado) + " (" + haQuanto(d.quando) + ")" : "—"}</b></li>
      <li><span>Origem</span><b>${S.origem === "cache" ? "Cópia salva neste aparelho" : S.origem === "rede" ? "Servidor" : "—"}</b></li>
      <li><span>Ativos com cotação</span><b>${d ? d.ativos.filter(a => !a.desatualizado).length + " de " + d.ativos.length : "—"}</b></li>
      <li><span>Títulos do Tesouro</span><b>${d ? d.tes.length : "—"}</b></li>
      <li><span>Fundos (CVM)</span><b>${d && d.fundos_resumo ? (d.fundos_resumo.total || 0) + " · " + esc(d.fundos_resumo.gerado || "—") : "—"}</b></li>
      <li><span>Notícias</span><b>${S.noticias ? (S.noticias.itens || []).length + " · " + esc(S.noticias.atualizado || "") : "—"}</b></li></ul></div>
    <section class="sec"><div class="sec-h"><h2>Avisos da última rodada</h2></div>
    ${erros.length ? `<div class="list"><ul class="alerts">${erros.map(e => `<li><span>${esc(e)}</span></li>`).join("")}</ul></div><p class="small muted" style="margin-top:8px">Quando uma fonte falha, o app mantém o último dado bom dela e mostra o resto normalmente.</p>` : `<div class="empty">Todas as fontes responderam normalmente.</div>`}</section>
    <div class="card" style="margin-top:14px"><h3>Quando os dados mudam?</h3><p class="small muted">A cada 30 minutos no pregão (9h às 18h, dias úteis) e de hora em hora no resto do tempo. O app busca novidades sozinho a cada 5 minutos e quando você volta a ele.</p>
      <div class="btns"><button class="btn primary sm" data-act="refresh">${ic("refresh")}Buscar agora</button>${linkRepo() ? `<a class="btn sm ghost" href="${linkRepo()}/actions" target="_blank" rel="noopener">${ic("externo")}Execuções no GitHub</a>` : ""}</div></div>` };
}

// =============================================================== carteira: adicionar/editar
function sheetAdd(param) {
  const d = S.data;
  let p = null, tipo = "ativo", refInicial = "";
  if (param && param.startsWith("novo:")) { const [, t, ...r] = param.split(":"); tipo = t; refInicial = r.join(":"); }
  else if (param) { p = S.carteira.find(x => x.id === param); if (!p) return null; tipo = p.tipo; }
  const tipoAtual = S.addTipo && !p ? S.addTipo : tipo;
  const ref = p ? p.ref : tipoAtual === tipo ? refInicial : "";
  const v = x => ok(x) ? String(x).replace(".", ",") : "";
  const optsAtivos = CATS_ATIVOS.filter(c => c !== "indices").map(c => {
    const xs = (d.porCat[c] || []).slice().sort((a, b) => a.codigo.localeCompare(b.codigo));
    return xs.length ? `<optgroup label="${esc(CATS[c].nome)}">${xs.map(a => `<option value="${esc(a.ticker)}" ${a.ticker === ref ? "selected" : ""}>${esc(a.codigo)} · ${esc(a.nome)}</option>`).join("")}</optgroup>` : "";
  }).join("");
  const optsTes = [...new Set(d.tes.map(t => t.tipo))].map(tp => `<optgroup label="${esc(tp)}">${d.tes.filter(t => t.tipo === tp).map(t => `<option value="${esc(t.id)}" ${t.id === ref ? "selected" : ""}>${esc(nomeTitulo(t))} · ${esc(taxaTexto(t))}</option>`).join("")}</optgroup>`).join("");
  const refAtivo = tipoAtual === "ativo" ? d.idxAtivo.get(ref) || d.ativos[0] : null;
  const fundoRef = tipoAtual === "fundo" && S.fundos ? S.fundos.fundos.find(f => f.cnpj === ref) : null;
  const campos = {
    ativo: `<div class="field"><label for="a-ref">Ativo</label><select class="input" id="a-ref" name="ref">${optsAtivos}</select><small>Ações, FIIs, ETFs, ações globais, BDRs (pela ação original) e cripto acompanhados pelo app.</small></div>
      <div class="row2"><div class="field"><label for="a-qtd">Quantidade</label><input class="input" id="a-qtd" name="qtd" inputmode="decimal" value="${v(p && p.qtd)}" placeholder="Ex.: 100"></div>
      <div class="field"><label for="a-pm">Preço médio (${refAtivo && refAtivo.moeda === "US$" ? "US$" : "R$"})</label><input class="input" id="a-pm" name="pm" inputmode="decimal" value="${v(p && p.pm)}" placeholder="Ex.: 32,50"></div></div>`,
    tesouro: `<div class="field"><label for="a-ref">Título</label><select class="input" id="a-ref" name="ref">${optsTes || `<option value="">Sem dados do Tesouro agora</option>`}</select></div>
      <div class="row2"><div class="field"><label for="a-qtd">Quantidade de títulos</label><input class="input" id="a-qtd" name="qtd" inputmode="decimal" value="${v(p && p.qtd)}" placeholder="Ex.: 0,52"><small>Está no extrato. Pode ser fração.</small></div>
      <div class="field"><label for="a-pm">Preço médio pago (R$)</label><input class="input" id="a-pm" name="pm" inputmode="decimal" value="${v(p && p.pm)}" placeholder="Ex.: 14.800,00"></div></div>`,
    fundo: `<div class="field"><label for="a-nome">Fundo</label><input class="input" id="a-nome" name="nome" value="${esc(p ? p.nome : fundoRef ? fundoRef.curto : "")}" placeholder="Nome do fundo"><input type="hidden" name="ref" value="${esc(p ? p.ref || "" : ref)}"></div>
      <div class="row2"><div class="field"><label for="a-custo">Valor investido (R$)</label><input class="input" id="a-custo" name="custo" inputmode="decimal" value="${v(p && p.custo)}" placeholder="Ex.: 10.000"></div>
      <div class="field"><label for="a-valor">Valor atual (R$)</label><input class="input" id="a-valor" name="valor" inputmode="decimal" value="${v(p && p.valor)}" placeholder="Ex.: 10.850"></div></div><small class="muted">Atualize o valor atual olhando o extrato de vez em quando.</small>`,
    manual: `<div class="field"><label for="a-nome">Nome</label><input class="input" id="a-nome" name="nome" value="${esc(p ? p.nome : "")}" placeholder="Ex.: CDB Banco X 110% CDI, LCA, previdência…"></div>
      <div class="field"><label for="a-classe">Classe</label><select class="input" id="a-classe" name="classe">${CLASSES.map(c => `<option ${p && p.classe === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="row2"><div class="field"><label for="a-custo">Valor investido (R$)</label><input class="input" id="a-custo" name="custo" inputmode="decimal" value="${v(p && p.custo)}" placeholder="Ex.: 5.000"></div>
      <div class="field"><label for="a-valor">Valor atual (R$)</label><input class="input" id="a-valor" name="valor" inputmode="decimal" value="${v(p && p.valor)}" placeholder="Ex.: 5.430"></div></div>`,
  };
  const html = `<form class="form" id="f-add" novalidate>
    ${p ? "" : `<div class="seg" role="group" aria-label="Tipo">${[["ativo", "Bolsa e cripto"], ["tesouro", "Tesouro"], ["fundo", "Fundo"], ["manual", "Outro"]].map(([k, t]) => `<button type="button" data-act="add-tipo" data-v="${k}" aria-pressed="${tipoAtual === k}">${t}</button>`).join("")}</div>`}
    ${campos[tipoAtual] || campos.manual}
    <p class="err-msg" id="f-err" role="alert"></p>
    <div class="btns"><button type="submit" class="btn primary block">${p ? "Salvar alterações" : "Adicionar à carteira"}</button>${p ? `<button type="button" class="btn danger block" data-act="remover-pos" data-id="${esc(p.id)}">Remover da carteira</button>` : ""}</div></form>`;
  return {
    titulo: p ? "Editar investimento" : "Adicionar investimento", html,
    depois: corpo => {
      const f = $("#f-add", corpo), sel = $("#a-ref", corpo);
      if (sel && tipoAtual === "ativo") sel.addEventListener("change", () => { const a = d.idxAtivo.get(sel.value); $('label[for="a-pm"]', corpo).textContent = `Preço médio (${a && a.moeda === "US$" ? "US$" : "R$"})`; });
      f.addEventListener("submit", ev => {
        ev.preventDefault();
        const fd = new FormData(f), err = $("#f-err", corpo);
        const novo = { id: p ? p.id : uid(), tipo: tipoAtual };
        if (tipoAtual === "manual" || tipoAtual === "fundo") {
          novo.nome = String(fd.get("nome") || "").trim();
          if (tipoAtual === "manual") novo.classe = fd.get("classe"); else novo.ref = fd.get("ref") || null;
          novo.valor = num(fd.get("valor")); novo.custo = num(fd.get("custo"));
          if (!novo.nome) { err.textContent = "Informe um nome."; return; }
          if (!ok(novo.valor) || novo.valor < 0) { err.textContent = "Informe o valor atual em reais."; return; }
          if (!ok(novo.custo)) novo.custo = null;
        } else {
          novo.ref = fd.get("ref"); novo.qtd = num(fd.get("qtd")); novo.pm = num(fd.get("pm"));
          if (!novo.ref) { err.textContent = "Escolha o investimento."; return; }
          if (!ok(novo.qtd) || novo.qtd <= 0) { err.textContent = "Informe uma quantidade maior que zero."; return; }
          if (!ok(novo.pm) || novo.pm <= 0) novo.pm = null;
          if (S.carteira.find(x => x.tipo === novo.tipo && x.ref === novo.ref && x.id !== novo.id)) { err.textContent = "Já está na carteira. Edite o existente."; return; }
        }
        const i = S.carteira.findIndex(x => x.id === novo.id);
        if (i >= 0) S.carteira[i] = novo; else S.carteira.push(novo);
        salvarCarteira(); S.addTipo = null;
        toast(p ? "Investimento atualizado" : "Adicionado à carteira");
        renderView(); fecharSheet();
      });
    },
  };
}

// =============================================================== comparador: oferta
function sheetOferta(id) {
  const o = id ? S.ofertas.find(x => x.id === id) : null;
  if (id && !o) return null;
  const v = x => ok(x) ? String(x).replace(".", ",") : "";
  const html = `<form class="form" id="f-of" novalidate>
    <div class="field"><label for="o-nome">Banco ou descrição</label><input class="input" id="o-nome" name="nome" value="${esc(o ? o.nome : "")}" placeholder="Ex.: Banco X, Corretora Y"></div>
    <div class="row2"><div class="field"><label for="o-tipo">Produto</label><select class="input" id="o-tipo" name="tipo">${Object.keys(TIPOS_OFERTA).map(t => `<option ${o && o.tipo === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="field"><label for="o-idx">Rendimento</label><select class="input" id="o-idx" name="idx">${[["cdi", "% do CDI"], ["pre", "Prefixado (% a.a.)"], ["ipca", "IPCA + %"], ["selic", "Selic + %"], ["poup", "Poupança"]].map(([k, t]) => `<option value="${k}" ${o && o.idx === k ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>
    <div class="row2"><div class="field"><label for="o-taxa">Taxa</label><input class="input" id="o-taxa" name="taxa" inputmode="decimal" value="${v(o && o.taxa) || "110"}"></div>
      <div class="field"><label for="o-dias">Prazo (dias)</label><input class="input" id="o-dias" name="dias" inputmode="numeric" value="${o ? o.dias : 720}"></div></div>
    <div class="chips">${[[180, "6 meses"], [365, "1 ano"], [730, "2 anos"], [1095, "3 anos"], [1825, "5 anos"]].map(([d, t]) => `<button type="button" class="chip" data-act="o-prazo" data-v="${d}">${t}</button>`).join("")}</div>
    <div class="field"><label for="o-liq">Liquidez</label><select class="input" id="o-liq" name="liquidez"><option value="vencimento" ${o && o.liquidez === "vencimento" ? "selected" : ""}>Só no vencimento</option><option value="diaria" ${o && o.liquidez === "diaria" ? "selected" : ""}>Diária</option></select></div>
    <div class="result" id="o-prev" aria-live="polite"></div>
    <p class="err-msg" id="o-err" role="alert"></p>
    <div class="btns"><button type="submit" class="btn primary block">${o ? "Salvar" : "Adicionar oferta"}</button>${o ? `<button type="button" class="btn danger block" data-act="remover-oferta" data-id="${esc(o.id)}">Remover</button>` : ""}</div></form>`;
  return {
    titulo: o ? "Editar oferta" : "Nova oferta", html,
    depois: corpo => {
      const f = $("#f-of", corpo);
      const ler = () => { const fd = new FormData(f); return { id: o ? o.id : uid(), nome: String(fd.get("nome") || "").trim(), tipo: fd.get("tipo"), idx: fd.get("idx"), taxa: num(fd.get("taxa")), dias: Math.round(num(fd.get("dias"))), liquidez: fd.get("liquidez") }; };
      const prev = () => { const x = ler(); if (!(x.idx === "poup" || ok(x.taxa)) || !(x.dias > 0)) { $("#o-prev", corpo).innerHTML = "<p>Preencha taxa e prazo.</p>"; return; }
        const c = calcOferta(x); $("#o-prev", corpo).innerHTML = `<span class="small muted">Rende líquido ao ano</span><div class="big">${pct(c.liqAno * 100)}</div><p class="small">${c.isento ? "Isento de IR." : `IR de ${fmt(IR(x.dias), 1)}% sobre o lucro.`} Equivale a ${ok(c.pctCdi) ? fmt(c.pctCdi, 0) + "% do CDI líquido" : "—"} no mesmo prazo.${["CDB", "LCI", "LCA", "LC", "Poupança"].includes(x.tipo) ? " Coberto pelo FGC até R$ 250 mil." : x.tipo === "Tesouro" ? " Garantia do Tesouro Nacional." : " Sem FGC."}</p>`; };
      f.addEventListener("input", prev); f.addEventListener("change", prev); prev();
      f.addEventListener("submit", ev => {
        ev.preventDefault();
        const x = ler();
        if (x.idx !== "poup" && !ok(x.taxa)) { $("#o-err", corpo).textContent = "Informe a taxa."; return; }
        if (!(x.dias > 0)) { $("#o-err", corpo).textContent = "Informe o prazo em dias."; return; }
        const i = S.ofertas.findIndex(y => y.id === x.id);
        if (i >= 0) S.ofertas[i] = x; else S.ofertas.push(x);
        store.set("ofertas", S.ofertas); toast("Oferta salva"); renderView(); fecharSheet();
      });
    },
  };
}

// =============================================================== ferramentas
function sheetFerramenta(k) {
  const fn = { sim: ferrSim, meta: ferrMeta, reserva: ferrReserva, conversor: ferrConversor, perfil: ferrPerfil, sinais: ferrSinais, glossario: ferrGlossario,
    config: ferrConfig, alertas: ferrAlertas, instalar: ferrInstalar, subscricao: ferrSubscricao }[k];
  return fn ? fn() : null;
}
function campo(id, rotulo, valor, pref, suf, dica) {
  return `<div class="field"><label for="${id}">${rotulo}</label><div class="input-wrap">${pref ? `<span>${pref}</span>` : ""}<input class="input" id="${id}" inputmode="decimal" value="${esc(valor)}">${suf ? `<span style="padding-right:13px">${suf}</span>` : ""}</div>${dica ? `<small>${dica}</small>` : ""}</div>`;
}
function liveForm(corpo, calc) { const run = () => { try { calc(); } catch (e) { console.error(e); } }; corpo.addEventListener("input", run); corpo.addEventListener("change", run); run(); }
function simular({ inicial, aporte, meses, anual, isento }) {
  const im = Math.pow(1 + anual, 1 / 12) - 1;
  let bruto = 0, investido = 0, ir = 0;
  [[0, inicial], ...Array.from({ length: meses }, (_, k) => [k + 1, aporte])].filter(([, v]) => v > 0).forEach(([mes, v]) => {
    const n = meses - mes, fim = v * Math.pow(1 + im, n);
    bruto += fim; investido += v;
    if (!isento) ir += (fim - v) * IR(n * 30.4) / 100;
  });
  return { bruto, investido, ir, liquido: bruto - ir };
}
function ferrSim() {
  const m = S.data ? S.data.macro : {}, pre = S.sim || {};
  const html = `<div class="form">
      <div class="row2">${campo("s-ini", "Valor inicial", pre.inicial ?? "1.000", "R$")}${campo("s-ap", "Aporte por mês", pre.aporte ?? "200", "R$")}</div>
      <div class="field"><label for="s-meses">Prazo</label><div class="input-wrap"><input class="input" id="s-meses" inputmode="numeric" value="${pre.meses ?? 24}"><span style="padding-right:13px">meses</span></div>
        <div class="chips" style="margin-top:6px">${[[6, "6 meses"], [12, "1 ano"], [24, "2 anos"], [60, "5 anos"], [120, "10 anos"]].map(([v, t]) => `<button type="button" class="chip" data-act="s-prazo" data-v="${v}">${t}</button>`).join("")}</div></div>
      <div class="field"><label for="s-modo">Tipo de rendimento</label><select class="input" id="s-modo">${[["cdi", "% do CDI (CDB, LCI, LCA)"], ["selic", "Selic + taxa (Tesouro Selic)"], ["pre", "Prefixado (% ao ano)"], ["ipca", "IPCA + taxa (Tesouro IPCA+, debêntures)"]].map(([v, t]) => `<option value="${v}" ${(pre.modo || "cdi") === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      ${campo("s-taxa", "Taxa", pre.taxa ?? "100", "", "")}
      <label class="toggle"><input type="checkbox" id="s-isento" ${pre.isento ? "checked" : ""}> Isento de IR (LCI, LCA, CRI, CRA, poupança)</label></div>
    <div class="result" style="margin-top:18px" aria-live="polite" id="s-res"></div>
    <section class="sec"><div class="sec-h"><h2>No mesmo prazo</h2></div><div class="card"><div class="hbars" id="s-comp"></div>
      <p class="small muted" style="margin-top:12px">Valores líquidos. Premissas: CDI de ${pct(m.cdi_ano)} e inflação de ${pct(m.ipca_12m)} constantes. As taxas mudam; use como estimativa.</p></div></section>`;
  return { titulo: "Simulador de renda fixa", html, depois: corpo => {
    const g = id => $("#" + id, corpo);
    g("s-modo").addEventListener("change", () => { g("s-taxa").value = { cdi: "100", selic: "0,08", pre: fmt(m.cdi_ano || 12), ipca: "6,5" }[g("s-modo").value]; });
    liveForm(corpo, () => {
      const modo = g("s-modo").value;
      $('label[for="s-taxa"]', corpo).textContent = { cdi: "Percentual do CDI (%)", selic: "Taxa acima da Selic (% ao ano)", pre: "Taxa prefixada (% ao ano)", ipca: "Taxa acima do IPCA (% ao ano)" }[modo];
      const inicial = num(g("s-ini").value) || 0, aporte = num(g("s-ap").value) || 0, meses = clamp(Math.round(num(g("s-meses").value) || 0), 1, 600), taxa = num(g("s-taxa").value), isento = g("s-isento").checked;
      S.sim = { inicial: g("s-ini").value, aporte: g("s-ap").value, meses, modo, taxa: g("s-taxa").value, isento };
      if (!ok(taxa) || inicial + aporte <= 0) { g("s-res").innerHTML = "<p>Preencha um valor e uma taxa válidos.</p>"; g("s-comp").innerHTML = ""; return; }
      const anual = taxaAnualPor(modo, taxa, m), r = simular({ inicial, aporte, meses, anual, isento });
      const ganho = r.liquido - r.investido, real = r.liquido / Math.pow(1 + (m.ipca_12m || 0) / 100, meses / 12);
      g("s-res").innerHTML = `<span class="small muted">Você terá em ${meses} meses (líquido)</span><div class="big">${reais(r.liquido)}</div>
        <ul class="kv"><li><span>Total investido</span><b>${reais(r.investido)}</b></li><li><span>Rendimento bruto</span><b>${reais(r.bruto - r.investido)}</b></li>
        <li><span>Imposto de renda</span><b>${isento ? "isento" : "− " + reais(r.ir)}</b></li><li><span>Ganho líquido</span><b class="up">${reais(ganho)} (${pct(ganho / r.investido * 100, 1, true)})</b></li>
        <li><span>Taxa equivalente ao ano</span><b>${pct(anual * 100)}</b></li><li><span>Em dinheiro de hoje (sem inflação)</span><b>${reais(real)}</b></li></ul>`;
      const pp = poupancaAno(m);
      const alts = [["Esta simulação", r.liquido, true], ["Poupança", ok(pp) ? simular({ inicial, aporte, meses, anual: pp / 100, isento: true }).liquido : null],
        ["CDB 100% do CDI", simular({ inicial, aporte, meses, anual: taxaAnualPor("cdi", 100, m), isento: false }).liquido], ["Só guardar", r.investido]].filter(x => ok(x[1]));
      const max = Math.max(...alts.map(x => x[1]));
      g("s-comp").innerHTML = alts.sort((a, b) => b[1] - a[1]).map(([n, v, me]) => `<div class="hbar ${me ? "me" : ""}"><span>${n}</span><span class="v">${reais(v)}</span><div class="t"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>`).join("");
    });
  } };
}
function ferrMeta() {
  const m = S.data ? S.data.macro : {}, sug = ok(m.cdi_ano) ? fmt(m.cdi_ano * 0.85, 2) : "10";
  const html = `<div class="form">${campo("mt-alvo", "Quanto quer juntar", "100.000", "R$")}<div class="row2">${campo("mt-anos", "Em quantos anos", "5", "", "anos")}${campo("mt-ini", "Já tem guardado", "0", "R$")}</div>
    ${campo("mt-taxa", "Rendimento esperado (líquido, ao ano)", sug, "", "%", `Sugestão: CDI após IR ≈ ${sug}%.`)}</div><div class="result" style="margin-top:18px" id="mt-res" aria-live="polite"></div>`;
  return { titulo: "Meta de investimento", html, depois: corpo => liveForm(corpo, () => {
    const g = id => num($("#" + id, corpo).value), alvo = g("mt-alvo"), anos = g("mt-anos"), ini = g("mt-ini") || 0, taxa = g("mt-taxa"), box = $("#mt-res", corpo);
    if (!(alvo > 0) || !(anos > 0) || !ok(taxa)) { box.innerHTML = "<p>Preencha os campos com valores válidos.</p>"; return; }
    const n = Math.round(anos * 12), i = Math.pow(1 + taxa / 100, 1 / 12) - 1, fvIni = ini * Math.pow(1 + i, n), falta = alvo - fvIni;
    const pmt = falta <= 0 ? 0 : i === 0 ? falta / n : falta * i / (Math.pow(1 + i, n) - 1), aportado = ini + pmt * n, infl = Math.pow(1 + (m.ipca_12m || 4) / 100, anos);
    box.innerHTML = falta <= 0 ? `<span class="small muted">Boa notícia</span><div class="big">Você já chega lá</div><p class="small">Só com o que tem, rendendo ${pct(taxa)} ao ano, terá ${reais(fvIni)}.</p>`
      : `<span class="small muted">Invista por mês</span><div class="big">${reais(pmt)}</div><ul class="kv"><li><span>Total depositado</span><b>${reais(aportado)}</b></li><li><span>Juros trabalhando por você</span><b class="up">${reais(alvo - aportado)}</b></li><li><span>${reais(alvo)} daqui a ${fmt(anos, 0)} anos valem hoje</span><b>≈ ${reais(alvo / infl)}</b></li></ul>`;
  }) };
}
function ferrReserva() {
  const d = S.data, sel = d ? d.tes.filter(t => tipoInfo(t).idx === "Selic").sort((a, b) => a.anos - b.anos)[0] : null;
  const html = `<div class="form">${campo("r-gasto", "Quanto você gasta por mês", "4.000", "R$")}
    <div class="field"><span class="lbl">Sua situação de trabalho</span>${[["6", "CLT / emprego estável", "6 meses de gastos"], ["3", "Servidor público", "3 a 6 meses"], ["12", "Autônomo ou renda variável", "12 meses"]].map(([v, t, s], i) => `<label class="opt"><input type="radio" name="r-sit" value="${v}" ${i === 0 ? "checked" : ""}><span><b>${t}</b><span>${s}</span></span></label>`).join("")}</div>
    <div class="row2">${campo("r-tem", "Já tem guardado", "0", "R$")}${campo("r-ap", "Consegue guardar por mês", "500", "R$")}</div></div>
    <div class="result" style="margin-top:18px" id="r-res" aria-live="polite"></div>
    <div class="card" style="margin-top:12px"><h3>Onde deixar a reserva</h3><p class="small">Seguro e com resgate rápido: <b>Tesouro Selic</b>${sel ? ` (Selic + ${fmt(sel.taxa)}%)` : ""} ou <b>CDB de liquidez diária com 100% do CDI ou mais</b>, de banco coberto pelo FGC. Evite ações, FIIs e cripto para esse dinheiro.</p>${sel ? `<div class="btns"><button class="btn sm" data-act="titulo" data-id="${esc(sel.id)}">Ver ${esc(nomeTitulo(sel))}</button></div>` : ""}</div>`;
  return { titulo: "Reserva de emergência", html, depois: corpo => liveForm(corpo, () => {
    const gasto = num($("#r-gasto", corpo).value), tem = num($("#r-tem", corpo).value) || 0, ap = num($("#r-ap", corpo).value) || 0;
    const meses = +($("input[name=r-sit]:checked", corpo) || { value: 6 }).value, box = $("#r-res", corpo);
    if (!(gasto > 0)) { box.innerHTML = "<p>Informe seu gasto mensal.</p>"; return; }
    const alvo = gasto * meses, falta = Math.max(0, alvo - tem);
    let tempo = "";
    if (falta > 0 && ap > 0) { const i = Math.pow(1 + ((d && d.macro.cdi_ano) || 10) * 0.85 / 100, 1 / 12) - 1; let s = tem, n = 0; while (s < alvo && n < 600) { s = s * (1 + i) + ap; n++; } tempo = `<li><span>Tempo para completar</span><b>${n >= 600 ? "mais de 50 anos" : n < 12 ? n + " meses" : fmt(n / 12, 1) + " anos"}</b></li>`; }
    box.innerHTML = `<span class="small muted">Sua reserva ideal</span><div class="big">${reais(alvo)}</div><ul class="kv"><li><span>Equivale a</span><b>${meses} meses de gastos</b></li><li><span>Já guardado</span><b>${reais(tem)} (${pct(Math.min(100, tem / alvo * 100), 0)})</b></li><li><span>Falta</span><b>${falta > 0 ? reais(falta) : "nada, reserva completa"}</b></li>${tempo}</ul>`;
  }) };
}
function ferrConversor() {
  const html = `<div class="card"><h3>Taxa mensal ↔ anual</h3><div class="form" style="margin-top:10px"><div class="row2">${campo("c-mes", "Ao mês", "1", "", "%")}${campo("c-ano", "Ao ano", "12,68", "", "%")}</div></div></div>
    <div class="card"><h3>LCI/LCA (isenta) × CDB (com IR)</h3><p class="small muted">Qual taxa um CDB precisa pagar para empatar com uma LCI ou LCA?</p>
      <div class="form" style="margin-top:10px">${campo("c-lci", "LCI/LCA paga", "90", "", "% do CDI")}
      <div class="field"><label for="c-prazo">Prazo</label><select class="input" id="c-prazo"><option value="180">Até 6 meses (IR 22,5%)</option><option value="360">6 meses a 1 ano (IR 20%)</option><option value="720" selected>1 a 2 anos (IR 17,5%)</option><option value="721">Mais de 2 anos (IR 15%)</option></select></div></div>
      <div class="result" style="margin-top:12px" id="c-res" aria-live="polite"></div></div>`;
  return { titulo: "Conversor de taxas", html, depois: corpo => {
    const mes = $("#c-mes", corpo), ano = $("#c-ano", corpo);
    mes.addEventListener("input", () => { const v = num(mes.value); if (ok(v)) ano.value = fmt((Math.pow(1 + v / 100, 12) - 1) * 100, 2); });
    ano.addEventListener("input", () => { const v = num(ano.value); if (ok(v)) mes.value = fmt((Math.pow(1 + v / 100, 1 / 12) - 1) * 100, 3); });
    const calc = () => { const lci = num($("#c-lci", corpo).value), ir = IR(+$("#c-prazo", corpo).value);
      $("#c-res", corpo).innerHTML = ok(lci) ? `<span class="small muted">O CDB precisa pagar pelo menos</span><div class="big">${pct(lci / (1 - ir / 100), 1)} do CDI</div><p class="small">para empatar com LCI/LCA de ${pct(lci, 0)} do CDI (IR de ${fmt(ir, 1)}%).</p>` : "<p>Informe a taxa.</p>"; };
    $("#c-lci", corpo).addEventListener("input", calc); $("#c-prazo", corpo).addEventListener("change", calc); calc();
  } };
}
function ferrSubscricao() {
  const html = `<div class="form">
      <div class="row2">${campo("sb-cot", "Cotação hoje", "100,00", "R$")}${campo("sb-preco", "Preço de subscrição", "92,00", "R$")}</div>
      <div class="row2">${campo("sb-qtd", "Cotas/ações que você tem", "100", "")}${campo("sb-fator", "Proporção da oferta", "25", "", "%", "Ex.: 25% = 1 nova para cada 4")}</div></div>
    <div class="result" style="margin-top:18px" id="sb-res" aria-live="polite"></div>
    <div class="card" style="margin-top:12px"><p class="small muted">Simplificação: o valor teórico do direito é a diferença entre a cotação e o preço de subscrição. Na prática, o preço do direito na bolsa pode variar, e a cotação costuma se ajustar depois da data de corte.</p></div>`;
  return { titulo: "Calculadora de subscrição", html, depois: corpo => liveForm(corpo, () => {
    const g = id => num($("#" + id, corpo).value), cot = g("sb-cot"), preco = g("sb-preco"), qtd = g("sb-qtd"), fator = g("sb-fator"), box = $("#sb-res", corpo);
    if (!(cot > 0) || !(preco > 0) || !(qtd > 0) || !(fator > 0)) { box.innerHTML = "<p>Preencha todos os campos.</p>"; return; }
    const desc = (1 - preco / cot) * 100, novas = Math.floor(qtd * fator / 100), custo = novas * preco, ganho = novas * (cot - preco);
    const veredito = desc <= 0 ? "Não vale exercer: o preço de subscrição está igual ou acima da cotação. Se quiser mais cotas, compre na bolsa. Considere vender o direito, se tiver valor."
      : desc < 3 ? "Desconto pequeno. Exercer só faz sentido se você já queria aumentar a posição. Vender o direito também é uma opção."
        : "Desconto relevante. Exercer ou vender o direito tende a valer a pena. Só não deixe vencer.";
    box.innerHTML = `<span class="small muted">Desconto da oferta</span><div class="big">${pct(desc, 1)}</div>
      <ul class="kv"><li><span>Novas cotas que você pode subscrever</span><b>${fmt(novas, 0)}</b></li><li><span>Custo para exercer</span><b>${reais(custo)}</b></li>
      <li><span>Valor teórico do direito (por cota nova)</span><b>${reais(Math.max(0, cot - preco))}</b></li><li><span>Ganho teórico total</span><b class="${ganho >= 0 ? "up" : "down"}">${reais(ganho)}</b></li>
      <li><span>Preço médio se exercer tudo</span><b>${reais((qtd * cot + custo) / (qtd + novas))}</b></li></ul><p class="small" style="margin-top:10px">${veredito}</p>`;
  }) };
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
  return { titulo: "Descubra seu perfil", html, depois: corpo => liveForm(corpo, () => {
    const resp = QUIZ.map((_, i) => $(`input[name=q${i}]:checked`, corpo));
    if (resp.some(r => !r)) return;
    const pts = resp.reduce((s, r) => s + +r.value, 0);
    let perfil = pts <= 3 ? "conservador" : pts <= 7 ? "moderado" : "arrojado";
    if (resp[3].value === "0" && perfil === "arrojado") perfil = "moderado"; // sem reserva, no máximo moderado
    $("#quiz-res", corpo).innerHTML = `<span class="small muted">Seu perfil</span><div class="big">${PERFIS[perfil].nome}</div><p class="small">${PERFIS[perfil].desc}</p>${resp[3].value === "0" ? `<p class="small"><b>Primeiro passo:</b> monte a reserva de emergência antes da renda variável.</p>` : ""}
      <div class="btns" style="margin-top:10px"><button type="button" class="btn primary" data-act="usar-perfil" data-v="${perfil}">Usar este perfil</button></div>`;
  }) };
}
function ferrSinais() {
  return { titulo: "Como os sinais funcionam", html: `<div class="card"><p class="lead">Cada ativo soma ou perde pontos por regras fixas. Não há opinião, previsão nem IA: são critérios técnicos clássicos, aplicados igualmente a todos.</p></div>
    <div class="list" style="margin-top:12px"><ul class="alerts">
      <li><b>Preço acima / abaixo da média de 200 dias</b><span>+1 / −1 · tendência de longo prazo</span></li>
      <li><b>Média de 50 dias acima / abaixo da de 200</b><span>+1 / −1 · força recente</span></li>
      <li><b>RSI abaixo de 30 / acima de 70</b><span>+1 / −1 · queda ou alta exagerada</span></li>
      <li><b>12 meses acima / abaixo do CDI</b><span>+1 / −1 · ativos em dólar são comparados em reais</span></li>
      <li><b>Proventos de 12 meses ≥ 85% do CDI</b><span>+1 · ativos brasileiros que pagam dividendos ou rendimentos</span></li></ul></div>
    <section class="sec"><div class="sec-h"><h2>Da pontuação ao sinal</h2></div>${regua(0)}
      <ul class="kv card" style="margin-top:12px"><li><span>3 pontos ou mais</span>${badge("COMPRA")}</li><li><span>1 a 2</span>${badge("VIÉS DE ALTA")}</li><li><span>−1 a 0</span>${badge("NEUTRO")}</li><li><span>−2</span>${badge("VIÉS DE BAIXA")}</li><li><span>−3 ou menos</span>${badge("VENDA")}</li></ul></section>
    <section class="sec"><div class="sec-h"><h2>Risco, Tesouro e fundos</h2></div><div class="card small"><p>O <b>risco</b> vem da volatilidade de 12 meses: abaixo de 20% baixo, até 35% médio, acima alto. Criptomoedas são sempre risco alto (exceto stablecoins).</p><p>No Tesouro, <b>Taxa alta</b> significa taxa acima de 80% das taxas daquele tipo nos últimos 5 anos.</p><p>Fundos não recebem sinal: mostramos rentabilidade, % do CDI, oscilação e tamanho, com dados oficiais da CVM.</p></div></section>
    <section class="sec"><div class="sec-h"><h2>Limites</h2></div><div class="card small"><p>São regras fixas, não previsão. Funcionam melhor como filtro para estudar do que como ordem para executar. Sinais técnicos erram com frequência. Dados gratuitos têm atraso.</p></div></section>` };
}
function ferrGlossario() {
  const itens = Object.entries(GLOSS).sort((a, b) => a[1][0].localeCompare(b[1][0], "pt-BR"));
  return { titulo: "Glossário", html: `<label class="search">${ic("busca")}<span class="sr">Buscar termo</span><input id="g-busca" type="search" placeholder="Buscar termo" autocomplete="off"></label>
    <dl class="gloss" id="g-lista">${itens.map(([k, [t, d]]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join("")}</dl>`,
    depois: corpo => $("#g-busca", corpo).addEventListener("input", e => { const q = norm(e.target.value); $$("#g-lista > div", corpo).forEach(el => { el.hidden = q && !norm(el.textContent).includes(q); }); }) };
}
function ferrConfig() {
  const d = S.data, cfg = (d && d.alertas_cfg) || null, repo = linkRepo();
  return { titulo: "Ativos e alertas", html: `<section class="sec" style="margin-top:0"><div class="sec-h"><h2>Regras dos alertas</h2></div>
      ${cfg ? `<div class="card"><ul class="kv"><li><span>Avisar quando entrar em Compra</span><b>${cfg.avisar_sinal_compra ? "Sim" : "Não"}</b></li><li><span>Avisar quando entrar em Venda</span><b>${cfg.avisar_sinal_venda ? "Sim" : "Não"}</b></li>
        <li><span>Movimento forte no dia</span><b>${pct(cfg.variacao_dia_pct, 0)} ou mais</b></li><li><span>Tesouro “taxa alta” a partir do percentil</span><b>${fmt(cfg.tesouro_percentil_atrativo, 0)}</b></li>
        <li><span>Máximo por rodada (acima vira resumo)</span><b>${fmt(cfg.max_alertas_por_rodada, 0)}</b></li><li><span>Ativos com alerta ligado</span><b>${d.ativos.filter(a => a.alerta).length}</b></li></ul></div>` : `<div class="empty">As regras aparecem depois da próxima atualização.</div>`}</section>
    <section class="sec"><div class="sec-h"><h2>Ativos acompanhados</h2></div><div class="card small">${d ? CATS_ATIVOS.map(c => `<p><b>${CATS[c].nome} (${(d.porCat[c] || []).length})</b></p>`).join("") : ""}<p class="muted">Os ativos com alerta ligado avisam no celular; os demais aparecem só no app.</p></div></section>
    <section class="sec"><div class="sec-h"><h2>Como mudar</h2></div><div class="card small"><ol style="margin:0;padding-left:20px">
      <li>Abra o <b>config.json</b> no GitHub (botão abaixo) e toque no lápis.</li>
      <li>Em <code>universo</code>, cada categoria tem uma lista. Copie uma linha e troque o código. B3 leva <code>.SA</code> (ex.: <code>ITSA4.SA</code>); EUA usa o código puro (<code>AAPL</code>); cripto termina em <code>-USD</code>.</li>
      <li>Para receber alertas de um ativo, inclua <code>"alerta": true</code> na linha dele.</li>
      <li>Salve com “Commit changes”. Vale a partir da próxima rodada (o site é publicado de novo automaticamente).</li></ol>
      ${repo ? `<div class="btns" style="margin-top:12px"><a class="btn primary sm" href="${repo}/edit/main/config.json" target="_blank" rel="noopener">${ic("editar")}Editar config.json</a><a class="btn sm" href="${repo}/actions" target="_blank" rel="noopener">${ic("externo")}Rodar agora</a></div>` : ""}</div></section>` };
}
function ferrAlertas() {
  return { titulo: "Alertas no celular", html: `<div class="card"><p>Os alertas chegam pelo app gratuito <b>ntfy</b>, sem cadastro.</p><ol style="padding-left:20px;margin:0"><li>Instale o ntfy (Play Store ou App Store).</li><li>Toque em “+” e assine o tópico configurado no GitHub (secret NTFY_TOPIC).</li><li>Os avisos chegam quando um ativo com alerta muda de sinal, se move forte no dia, ou quando uma taxa do Tesouro fica alta. Tocar abre este app.</li></ol></div>
    <div class="card"><p class="small muted">Quem souber o nome do tópico consegue ler os alertas. Por isso ele não aparece aqui.</p></div>
    <div class="btns" style="margin-top:12px"><a class="btn sm" href="https://ntfy.sh/" target="_blank" rel="noopener">${ic("externo")}Site do ntfy</a><button class="btn sm" data-act="sheet" data-sheet="ferramenta" data-param="config">Mudar regras</button></div>` };
}
function ferrInstalar() {
  return { titulo: "Instalar como app", html: `<div class="card"><h3>iPhone (Safari)</h3><p class="small">Toque em compartilhar (quadrado com seta) e depois em “Adicionar à Tela de Início”.</p></div>
    <div class="card"><h3>Android (Chrome)</h3><p class="small">Menu ⋮ → “Instalar app” ou “Adicionar à tela inicial”.</p></div>
    <div class="card"><h3>Computador</h3><p class="small">No Chrome ou Edge, clique no ícone de instalar na barra de endereço.</p></div>
    <p class="small muted" style="margin-top:12px">Instalado, abre em tela cheia e mostra os últimos dados mesmo sem internet.</p>` };
}
