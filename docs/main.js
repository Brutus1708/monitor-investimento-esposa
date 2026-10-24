"use strict";
/* Monitor — eventos, backup e inicialização. */

function exportar() {
  const blob = new Blob([JSON.stringify({ app: "monitor-investimentos", versao: 2, exportado: new Date().toISOString(), carteira: S.carteira, ofertas: S.ofertas, favoritos: [...S.favs], perfil: S.perfil }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `monitor-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
      if (!Array.isArray(cart) || cart.some(p => !p || !["ativo", "tesouro", "fundo", "manual"].includes(p.tipo))) throw new Error("formato");
      if (S.carteira.length && !confirm(`Substituir os ${S.carteira.length} investimentos atuais pelos ${cart.length} do backup?`)) return;
      S.carteira = cart.map(p => ({ ...p, id: p.id || uid() }));
      salvarCarteira();
      if (Array.isArray(j.ofertas)) { S.ofertas = j.ofertas; store.set("ofertas", S.ofertas); }
      if (Array.isArray(j.favoritos)) { S.favs = new Set(j.favoritos); store.set("favs", j.favoritos); }
      if (PERFIS[j.perfil]) { S.perfil = j.perfil; store.set("perfil", j.perfil); }
      toast("Backup restaurado");
      renderTudo();
    } catch (e) { toast("Arquivo inválido. Use um backup gerado por este app."); }
  });
  inp.click();
}
function aplicarTema() {
  if (S.tema === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.tema;
}
function irCategoria(el) {
  const cat = el.dataset.cat;
  if (CATS_ATIVOS.includes(cat)) {
    Object.assign(S.f, { cat, grupo: el.dataset.grupo || "Todos", sinal: el.dataset.sinal || "Todos", q: "", limite: 60,
      ordem: el.dataset.ordem || (cat === "fiis" ? "dy" : cat === "indices" ? "var" : "sinal") });
  }
  if (cat === "rf" && el.dataset.aba) S.rf.aba = el.dataset.aba;
  if (cat === "fiis" && el.dataset.grupo) S.f.grupo = el.dataset.grupo;
  salvarFiltros();
  irPara("explorar", cat);
}

document.addEventListener("click", ev => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act, v = el.dataset.v;
  switch (act) {
    case "tab": irPara(el.dataset.tab); break;
    case "voltar-sub": irPara("explorar"); break;
    case "ir-cat": irCategoria(el); break;
    case "refresh": carregar(true); break;
    case "close": fecharSheet(); break;
    case "sheet": S.voltarFoco = el; if (el.dataset.sheet === "add") S.addTipo = null; abrirSheet(el.dataset.sheet, el.dataset.param); break;
    case "ativo": S.voltarFoco = el; abrirSheet("ativo", el.dataset.id); break;
    case "titulo": S.voltarFoco = el; abrirSheet("titulo", el.dataset.id); break;
    case "fundo": S.voltarFoco = el; abrirSheet("fundo", el.dataset.id); break;
    case "info": abrirSheet("info", el.dataset.k); break;
    case "fav": {
      const t = el.dataset.id;
      if (S.favs.has(t)) { S.favs.delete(t); toast("Removido dos favoritos"); } else { S.favs.add(t); toast("Adicionado aos favoritos"); }
      store.set("favs", [...S.favs]);
      el.setAttribute("aria-pressed", S.favs.has(t));
      renderView();
      break;
    }
    case "f-grupo": S.f.grupo = v; S.f.limite = 60; $$('[data-act="f-grupo"]').forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v)); atualizarListaCat(); break;
    case "f-limpar": Object.assign(S.f, { grupo: "Todos", sinal: "Todos", q: "", soPerfil: false }); renderView(); break;
    case "mais-itens":
      if (el.closest("#fu-lista")) { S.fu.limite += 50; atualizarListaFundos(); }
      else { S.f.limite = (S.f.limite || 60) + 60; atualizarListaCat(); }
      break;
    case "rf-aba": S.rf.aba = v; salvarFiltros(); renderView(); break;
    case "rf-grupo": S.rf.grupo = v; salvarFiltros(); renderView(); break;
    case "fu-classe": S.fu.classe = v; S.fu.limite = 50; salvarFiltros(); $$('[data-act="fu-classe"]').forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v)); atualizarListaFundos(); break;
    case "nf-tema": S.nf.tema = v; S.nf.limite = 30; $$('[data-act="nf-tema"]').forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v)); atualizarListaNoticias(); break;
    case "nf-mais": S.nf.limite += 30; atualizarListaNoticias(); break;
    case "g-faixa": S.graf.faixa = v; salvarFiltros(); $$('[data-act="g-faixa"]').forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v)); redesenharGraficoAtivo(); break;
    case "g-mm": S.graf[v] = !S.graf[v]; salvarFiltros(); el.setAttribute("aria-pressed", S.graf[v]); redesenharGraficoAtivo(); break;
    case "tema": S.tema = v; store.set("tema", S.tema); aplicarTema(); renderSheet(); break;
    case "usar-perfil":
      S.perfil = v; store.set("perfil", S.perfil); store.set("perfilQuiz", true);
      toast(`Perfil ${PERFIS[S.perfil].nome.toLowerCase()} salvo`); renderView(); fecharSheet(); break;
    case "add-tipo": S.addTipo = v; renderSheet(); break;
    case "remover-pos":
      if (confirm("Remover este investimento da carteira?")) { S.carteira = S.carteira.filter(p => p.id !== el.dataset.id); salvarCarteira(); toast("Removido da carteira"); renderView(); fecharSheet(); }
      break;
    case "remover-oferta":
      S.ofertas = S.ofertas.filter(o => o.id !== el.dataset.id); store.set("ofertas", S.ofertas); toast("Oferta removida"); renderView(); fecharSheet(); break;
    case "ofertas-exemplo": {
      const sel = S.data.tes.filter(t => tipoInfo(t).idx === "Selic").sort((a, b) => a.anos - b.anos)[0];
      const refs = [];
      if (!S.ofertas.length) refs.push({ nome: "Exemplo: CDB banco médio", tipo: "CDB", idx: "cdi", taxa: 112, dias: 730, liquidez: "vencimento" }, { nome: "Exemplo: LCA", tipo: "LCA", idx: "cdi", taxa: 92, dias: 365, liquidez: "vencimento" });
      if (sel && !S.ofertas.some(o => o.tipo === "Tesouro")) refs.push({ nome: "Tesouro Selic (referência)", tipo: "Tesouro", idx: "selic", taxa: sel.taxa, dias: 730, liquidez: "diaria" });
      if (!S.ofertas.some(o => o.tipo === "Poupança")) refs.push({ nome: "Poupança (referência)", tipo: "Poupança", idx: "poup", taxa: 0, dias: 365, liquidez: "diaria" });
      S.ofertas.push(...refs.map(r => ({ ...r, id: uid() })));
      store.set("ofertas", S.ofertas); renderView(); break;
    }
    case "s-prazo": case "o-prazo": {
      const i = $(act === "s-prazo" ? "#s-meses" : "#o-dias");
      if (i) { i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }
      break;
    }
    case "simular-titulo": {
      const t = S.data.idxTes.get(el.dataset.id);
      if (!t) break;
      const idx = tipoInfo(t).idx;
      S.sim = { inicial: "1.000", aporte: "0", meses: clamp(Math.round(t.anos * 12), 1, 600), modo: idx === "Selic" ? "selic" : idx === "pre" ? "pre" : "ipca", taxa: fmt(t.taxa), isento: false };
      abrirSheet("ferramenta", "sim");
      break;
    }
    case "exportar": exportar(); break;
    case "importar": importar(); break;
    case "limpar-tudo":
      if (confirm("Apagar carteira, favoritos, ofertas e preferências deste aparelho? Faça um backup antes, se quiser guardar.")) {
        ["carteira", "favs", "ofertas", "perfil", "perfilQuiz", "tema", "filtroCat", "filtroRF", "filtroFundos", "grafico", "cache", "cacheNoticias"].forEach(store.del);
        location.replace(location.pathname);
      }
      break;
  }
});
function redesenharGraficoAtivo() {
  if (!S.sheet || S.sheet.tipo !== "ativo") return;
  const a = S.data.idxAtivo.get(S.sheet.param);
  if (a && HIST.has(a.h)) graficoAtivo(a, HIST.get(a.h));
}
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.matches('[data-act="set-perfil"]')) { S.perfil = t.value; store.set("perfil", S.perfil); toast(`Perfil ${PERFIS[S.perfil].nome.toLowerCase()} salvo`); renderView(); return; }
  const mapa = {
    "f-sinal": () => { S.f.sinal = t.value; atualizarListaCat(); }, "f-ordem": () => { S.f.ordem = t.value; atualizarListaCat(); },
    "f-perfil": () => { S.f.soPerfil = t.checked; atualizarListaCat(); }, "f-reais": () => { S.f.reais = t.checked; atualizarListaCat(); },
    "rf-ordem": () => { S.rf.ordem = t.value; renderView(); }, "fu-ordem": () => { S.fu.ordem = t.value; atualizarListaFundos(); },
    "fu-publico": () => { S.fu.publico = t.checked; atualizarListaFundos(); }, "nf-fonte": () => { S.nf.fonte = t.value; S.nf.limite = 30; atualizarListaNoticias(); },
  };
  if (mapa[t.id]) { mapa[t.id](); salvarFiltros(); }
});
document.addEventListener("input", ev => {
  const b = ev.target.dataset && ev.target.dataset.busca;
  if (b === "cat") { S.f.q = ev.target.value; atualizarListaCat(); }
  if (b === "fundos") { S.fu.q = ev.target.value; atualizarListaFundos(); }
  if (b === "noticias") { S.nf.q = ev.target.value; atualizarListaNoticias(); }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && S.sheet) fecharSheet();
  if ((ev.key === "/" || (ev.key === "k" && (ev.ctrlKey || ev.metaKey))) && !S.sheet && !/input|textarea|select/i.test(document.activeElement.tagName)) { ev.preventDefault(); abrirSheet("busca"); }
});
$("#backdrop").addEventListener("click", fecharSheet);
window.addEventListener("hashchange", aplicarRota);
document.addEventListener("visibilitychange", () => {
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
