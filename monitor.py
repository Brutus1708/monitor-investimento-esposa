"""
Monitor de Investimentos — gratuito, sem IA.
Coleta dados públicos, calcula sinais por regras transparentes,
grava docs/data.json (lido pelo app web) e envia alertas pelo ntfy.
"""
import io
import json
import math
import os
import time
import datetime as dt

import numpy as np
import pandas as pd
import requests

ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(ROOT, "config.json")
DATA_PATH = os.path.join(ROOT, "docs", "data.json")
STATE_PATH = os.path.join(ROOT, "state.json")

NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
NTFY_SERVER = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
PAGES_URL = os.environ.get("PAGES_URL", "").strip()

BRT = dt.timezone(dt.timedelta(hours=-3))
TESOURO_CSV = (
    "https://www.tesourotransparente.gov.br/ckan/dataset/"
    "df56aa42-484a-4a59-8184-7676580c81e3/resource/"
    "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv"
)

erros = []


def br(x, casas=2):
    """Formata número no padrão brasileiro (1.234,56)."""
    return f"{x:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def agora():
    return dt.datetime.now(BRT)


def num(x, casas=2):
    """Converte para float arredondado, ou None se não for número válido."""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, casas)


# ---------------------------------------------------------------- Macro (BCB)
def sgs(codigo, n=1):
    url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados/ultimos/{n}?formato=json"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return [(d["data"], float(d["valor"])) for d in r.json()]


def coletar_macro():
    macro = {}
    series = {
        "selic_meta": 432,      # Meta Selic (% a.a.)
        "cdi_ano": 4389,        # CDI anualizado base 252 (% a.a.)
        "ipca_12m": 13522,      # IPCA acumulado 12 meses (%)
        "dolar_ptax": 1,        # Dólar PTAX venda
    }
    for nome, codigo in series.items():
        try:
            data, valor = sgs(codigo)[-1]
            macro[nome] = valor
            macro[nome + "_data"] = data
        except Exception as e:
            erros.append(f"Banco Central ({nome}): {e}")
    if macro.get("selic_meta") is not None and macro.get("ipca_12m") is not None:
        real = ((1 + macro["selic_meta"] / 100) / (1 + macro["ipca_12m"] / 100) - 1) * 100
        macro["juro_real"] = num(real)
    return macro


# ------------------------------------------------------------ Tesouro Direto
def classificar_tesouro(tipo, taxa, percentil, macro, cfg):
    limite = cfg["alertas"]["tesouro_percentil_atrativo"]
    if "Selic" in tipo:
        return "RESERVA", "Rende perto da Selic, com resgate diário. Bom para reserva e curto prazo."
    if percentil is not None and percentil >= limite:
        return "ATRATIVO", (
            f"Taxa de {br(taxa)}% supera {percentil:.0f}% das taxas dos últimos 5 anos "
            "para este tipo de título. Historicamente, é um bom momento para travar juros no longo prazo."
        )
    if "Prefixado" in tipo and macro.get("selic_meta"):
        dif = taxa - macro["selic_meta"]
        return "NEUTRO", (
            f"Trava {br(taxa)}% ao ano ({'+' if dif >= 0 else ''}{br(dif)} p.p. vs. Selic). "
            "Ganha se os juros caírem; oscila muito se você vender antes do vencimento."
        )
    pct = f" (percentil {percentil:.0f} em 5 anos)" if percentil is not None else ""
    return "NEUTRO", f"Taxa dentro da faixa histórica{pct}. Leve a mercado só se for ficar até o vencimento."


def baixar_tesouro(tentativas=4):
    """Baixa o CSV do Tesouro, tentando de novo se o servidor limitar (429) ou falhar (5xx)."""
    cabecalho = {"User-Agent": "Mozilla/5.0 (monitor-investimentos)"}
    for i in range(tentativas):
        ultima = i == tentativas - 1
        try:
            r = requests.get(TESOURO_CSV, headers=cabecalho, timeout=180)
        except requests.ConnectionError:
            if ultima:
                raise
            time.sleep(15 * (i + 1))
            continue
        if r.status_code != 429 and r.status_code < 500 or ultima:
            break
        retry = r.headers.get("Retry-After", "")
        espera = min(int(retry), 120) if retry.isdigit() else 0
        time.sleep(max(espera, 15 * (i + 1)))
    r.raise_for_status()
    return r


def coletar_tesouro(macro, cfg):
    r = baixar_tesouro()
    try:
        texto = r.content.decode("utf-8")
    except UnicodeDecodeError:
        texto = r.content.decode("latin-1")
    df = pd.read_csv(io.StringIO(texto), sep=";", decimal=",")
    df.columns = [c.strip() for c in df.columns]
    df["Data Base"] = pd.to_datetime(df["Data Base"], dayfirst=True)
    df["Data Vencimento"] = pd.to_datetime(df["Data Vencimento"], dayfirst=True)

    ultima = df["Data Base"].max()
    hist = df[df["Data Base"] >= ultima - pd.DateOffset(years=5)]
    atual = df[(df["Data Base"] == ultima) & (df["Taxa Compra Manha"] > 0)]

    titulos = []
    for _, row in atual.sort_values(["Tipo Titulo", "Data Vencimento"]).iterrows():
        tipo = str(row["Tipo Titulo"]).strip()
        taxa = float(row["Taxa Compra Manha"])
        serie = hist[(hist["Tipo Titulo"] == row["Tipo Titulo"]) & (hist["Taxa Compra Manha"] > 0)]["Taxa Compra Manha"]
        percentil = float((serie <= taxa).mean() * 100) if len(serie) > 50 else None
        sinal, explicacao = classificar_tesouro(tipo, taxa, percentil, macro, cfg)
        anos = (row["Data Vencimento"] - ultima).days / 365.25
        faixa = len(serie) > 50
        pu = float(row["PU Compra Manha"])
        titulos.append({
            "id": f"{tipo} {row['Data Vencimento']:%Y}",
            "tipo": tipo,
            "vencimento": f"{row['Data Vencimento']:%d/%m/%Y}",
            "anos": num(anos, 1),
            "taxa": num(taxa),
            "preco": num(row["PU Compra Manha"]),
            "percentil_5a": num(percentil, 0),
            "taxa_min_5a": num(serie.min()) if faixa else None,
            "taxa_med_5a": num(serie.median()) if faixa else None,
            "taxa_max_5a": num(serie.max()) if faixa else None,
            "taxa_venda": num(row.get("Taxa Venda Manha")),
            "preco_venda": num(row.get("PU Venda Manha")),
            # Regra do Tesouro Direto: compra mínima de 1% do título, respeitando R$ 30
            "minimo": num(max(30.0, math.ceil(pu) / 100)),
            "sinal": sinal,
            "explicacao": explicacao,
            "risco": "baixo" if "Selic" in tipo else ("médio" if anos < 6 else "alto (se vender antes)"),
        })
    return {"data_base": f"{ultima:%d/%m/%Y}", "titulos": titulos}


# ------------------------------------------------------ Renda variável (Yahoo)
def rsi(close, n=14):
    delta = close.diff()
    alta = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    baixa = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = alta / baixa.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


ROTULOS = [
    (3, "COMPRA"),
    (1, "VIÉS DE ALTA"),
    (-1, "NEUTRO"),
    (-2, "VIÉS DE BAIXA"),
    (-99, "VENDA"),
]


def rotulo(score):
    for minimo, nome in ROTULOS:
        if score >= minimo:
            return nome
    return "VENDA"


def analisar(ativo, df, cdi_ano):
    close = df["Close"].dropna()
    if len(close) < 60:
        return None
    p = float(close.iloc[-1])
    ult_data = close.index[-1]
    um_ano = close[close.index >= ult_data - pd.Timedelta(days=365)]
    retornos = um_ano.pct_change().dropna()

    var_dia = (p / close.iloc[-2] - 1) * 100
    sma50 = close.rolling(50).mean().iloc[-1]
    sma200 = close.rolling(200).mean().iloc[-1] if len(close) >= 200 else np.nan
    r = rsi(close).iloc[-1]
    maxima = um_ano.max()
    queda_max = (p / maxima - 1) * 100
    vol = retornos.std() * math.sqrt(len(retornos)) * 100 if len(retornos) > 20 else np.nan
    ret_12m = (p / um_ano.iloc[0] - 1) * 100 if len(um_ano) > 200 else np.nan

    dy = None
    if ativo.get("dividendos") and "Dividends" in df.columns:
        divs = df["Dividends"].fillna(0)
        soma = divs[divs.index >= ult_data - pd.Timedelta(days=365)].sum()
        dy = soma / p * 100 if soma > 0 else None

    score, motivos = 0, []
    if not np.isnan(sma200):
        if p > sma200:
            score += 1
            motivos.append(("+", "Preço acima da média de 200 dias: tendência de longo prazo positiva."))
        else:
            score -= 1
            motivos.append(("-", "Preço abaixo da média de 200 dias: tendência de longo prazo negativa."))
        if sma50 > sma200:
            score += 1
            motivos.append(("+", "Média de 50 dias acima da de 200: força recente."))
        else:
            score -= 1
            motivos.append(("-", "Média de 50 dias abaixo da de 200: fraqueza recente."))
    if not np.isnan(r):
        if r < 30:
            score += 1
            motivos.append(("+", f"RSI em {r:.0f}: caiu rápido demais, costuma haver repique."))
        elif r > 70:
            score -= 1
            motivos.append(("-", f"RSI em {r:.0f}: subiu rápido demais, risco de correção."))
    if not np.isnan(ret_12m) and cdi_ano:
        if ret_12m > cdi_ano:
            score += 1
            motivos.append(("+", f"Rendeu {br(ret_12m, 1)}% em 12 meses, mais que o CDI ({br(cdi_ano, 1)}%)."))
        else:
            score -= 1
            motivos.append(("-", f"Rendeu {br(ret_12m, 1)}% em 12 meses, menos que o CDI ({br(cdi_ano, 1)}%)."))
    if dy is not None and cdi_ano:
        if dy >= cdi_ano * 0.85:
            score += 1
            motivos.append(("+", f"Pagou {br(dy, 1)}% em proventos no último ano, próximo ou acima do CDI."))
        else:
            motivos.append(("=", f"Pagou {br(dy, 1)}% em proventos no último ano."))
    if queda_max <= -25:
        motivos.append(("=", f"Está {abs(queda_max):.0f}% abaixo da máxima de 12 meses. Desconto ou problema? Vale checar notícias."))

    if np.isnan(vol):
        risco = "médio"
    elif vol < 20:
        risco = "baixo"
    elif vol < 35:
        risco = "médio"
    else:
        risco = "alto"

    spark = [num(v) for v in close.iloc[-90:].tolist()]

    # Histórico de até 2 anos para o gráfico do app: data inicial + diferença em dias entre pregões
    casas = 4 if p < 10 else 2
    hist = close.iloc[-520:]
    dias = [d.date() for d in hist.index]
    hist_dt = [0] + [(dias[i] - dias[i - 1]).days for i in range(1, len(dias))]

    return {
        "ticker": ativo["ticker"],
        "codigo": ativo["ticker"].replace(".SA", ""),
        "nome": ativo.get("nome", ativo["ticker"]),
        "classe": ativo.get("classe", "Outros"),
        "preco": num(p),
        "moeda": "US$" if ativo["ticker"].endswith("-USD") else "R$",
        "data": f"{ult_data:%d/%m %H:%M}" if ult_data.hour else f"{ult_data:%d/%m}",
        "var_dia": num(var_dia),
        "rsi": num(r, 0),
        "sma50": num(sma50),
        "sma200": num(sma200),
        "queda_max_12m": num(queda_max, 1),
        "ret_12m": num(ret_12m, 1),
        "volatilidade": num(vol, 1),
        "dy": num(dy, 1),
        "risco": risco,
        "score": score,
        "sinal": rotulo(score),
        "motivos": [{"tipo": t, "texto": m} for t, m in motivos],
        "spark": spark,
        "max_12m": num(maxima, casas),
        "min_12m": num(um_ano.min(), casas),
        "hist": {"t0": dias[0].isoformat(), "dt": hist_dt, "c": [num(v, casas) for v in hist.tolist()]},
    }


def coletar_ativos(cfg, cdi_ano):
    import yfinance as yf

    tickers = [a["ticker"] for a in cfg["ativos"]]
    dados = yf.download(
        tickers, period="2y", interval="1d", group_by="ticker",
        auto_adjust=True, actions=True, threads=True, progress=False,
    )
    resultado = []
    for ativo in cfg["ativos"]:
        t = ativo["ticker"]
        try:
            df = dados[t] if isinstance(dados.columns, pd.MultiIndex) else dados
            info = analisar(ativo, df, cdi_ano)
            if info:
                resultado.append(info)
            else:
                erros.append(f"{t}: histórico insuficiente")
        except Exception as e:
            erros.append(f"{t}: {e}")
    return resultado


# ------------------------------------------------------------------- Alertas
def carregar_json(caminho, padrao):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return padrao


def montar_alertas(ativos, tesouro, cfg, estado):
    hoje = agora().strftime("%Y-%m-%d")
    enviados = {k: v for k, v in estado.get("enviados", {}).items() if v >= hoje}
    anteriores = estado.get("sinais", {})
    lim = cfg["alertas"]
    alertas = []

    def novo(chave, titulo, msg, prioridade=3, tags=None):
        if chave in enviados:
            return
        enviados[chave] = hoje
        alertas.append({"titulo": titulo, "msg": msg, "prioridade": prioridade, "tags": tags or []})

    for a in ativos:
        antes = anteriores.get(a["ticker"])
        motivo = a["motivos"][0]["texto"] if a["motivos"] else ""
        if a["sinal"] == "COMPRA" and antes != "COMPRA" and lim.get("avisar_sinal_compra"):
            novo(f"{a['ticker']}|compra|{hoje}", f"Sinal de compra: {a['codigo']}",
                 f"{a['nome']} a {a['moeda']} {br(a['preco'])}. {motivo}", 4, ["green_circle"])
        if a["sinal"] == "VENDA" and antes != "VENDA" and lim.get("avisar_sinal_venda"):
            novo(f"{a['ticker']}|venda|{hoje}", f"Sinal de venda: {a['codigo']}",
                 f"{a['nome']} a {a['moeda']} {br(a['preco'])}. {motivo}", 4, ["red_circle"])
        if a["var_dia"] is not None and abs(a["var_dia"]) >= lim["variacao_dia_pct"]:
            direcao = "sobe" if a["var_dia"] > 0 else "cai"
            novo(f"{a['ticker']}|mov|{hoje}", f"{a['codigo']} {direcao} {br(abs(a['var_dia']), 1)}% hoje",
                 f"{a['nome']} a {a['moeda']} {br(a['preco'])}. Movimento forte: confira notícias antes de agir.",
                 3, ["chart_with_upwards_trend" if a["var_dia"] > 0 else "chart_with_downwards_trend"])

    for t in (tesouro or {}).get("titulos", []):
        antes = anteriores.get(t["id"])
        if t["sinal"] == "ATRATIVO" and antes != "ATRATIVO":
            novo(f"{t['id']}|atrativo|{hoje}", f"Taxa alta: {t['id']}",
                 f"{br(t['taxa'])}% ao ano. {t['explicacao']}", 4, ["moneybag"])

    sinais = {a["ticker"]: a["sinal"] for a in ativos}
    sinais.update({t["id"]: t["sinal"] for t in (tesouro or {}).get("titulos", [])})
    return alertas, {"enviados": enviados, "sinais": sinais}


def enviar(alertas, cfg):
    if not alertas:
        return
    if len(alertas) > cfg["alertas"]["max_alertas_por_rodada"]:
        corpo = "\n".join(f"• {a['titulo']}" for a in alertas)
        alertas = [{"titulo": f"{len(alertas)} novos alertas", "msg": corpo, "prioridade": 4, "tags": ["bell"]}]
    for a in alertas:
        if not NTFY_TOPIC:
            print(f"[alerta sem ntfy] {a['titulo']}: {a['msg']}")
            continue
        payload = {"topic": NTFY_TOPIC, "title": a["titulo"], "message": a["msg"],
                   "priority": a["prioridade"], "tags": a["tags"]}
        if PAGES_URL:
            payload["click"] = PAGES_URL
        try:
            resp = requests.post(NTFY_SERVER, json=payload, timeout=20)
            if not resp.ok:
                erros.append(f"ntfy: HTTP {resp.status_code} {resp.text.strip()[:200]}")
        except Exception as e:
            erros.append(f"ntfy: {e}")


# ---------------------------------------------------------------------- Main
def main():
    cfg = carregar_json(CONFIG_PATH, None)
    if not cfg:
        raise SystemExit("config.json não encontrado ou inválido")

    anterior = carregar_json(DATA_PATH, {})
    macro = coletar_macro()

    tesouro = None
    try:
        tesouro = coletar_tesouro(macro, cfg)
    except Exception as e:
        erros.append(f"Tesouro Direto: {e}")
        tesouro = anterior.get("tesouro")  # mantém o último dado bom

    ativos = []
    try:
        ativos = coletar_ativos(cfg, macro.get("cdi_ano"))
    except Exception as e:
        erros.append(f"Cotações: {e}")

    estado = carregar_json(STATE_PATH, {})
    alertas, novo_estado = montar_alertas(ativos, tesouro, cfg, estado)
    enviar(alertas, cfg)

    quando = agora().strftime("%d/%m/%Y %H:%M")
    historico = [{"quando": quando, "titulo": a["titulo"], "msg": a["msg"]} for a in alertas]
    historico += anterior.get("historico_alertas", [])

    saida = {
        "versao": 2,
        "atualizado": quando,
        "macro": macro,
        "tesouro": tesouro,
        "ativos": ativos,
        "alertas_rodada": [a["titulo"] for a in alertas],
        "historico_alertas": historico[:40],
        "alertas_cfg": cfg["alertas"],
        "erros": erros,
    }
    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(novo_estado, f, ensure_ascii=False, indent=1)

    print(f"OK: {len(ativos)} ativos, {len((tesouro or {}).get('titulos', []))} títulos, "
          f"{len(alertas)} alertas, {len(erros)} erros")
    for e in erros:
        print("  erro:", e)


if __name__ == "__main__":
    main()
