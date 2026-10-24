"""
Monitor de Investimentos — gratuito, sem IA.
Coleta dados públicos, calcula sinais por regras transparentes e gera o site (pasta docs/):
  data.json       resumo de todos os ativos, Tesouro, indicadores e alertas
  hist/*.json     histórico de 2 anos e motivos do sinal de cada ativo (carregado sob demanda)
  fundos.json     fundos de investimento (dados oficiais da CVM, atualizado 1x por dia)
  noticias.json   manchetes das principais fontes de mercado
  state.json      memória entre rodadas (para não repetir alertas)
Também envia alertas pelo ntfy.
"""
import io
import json
import math
import os
import re
import time
import zipfile
import datetime as dt
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from html import unescape

import numpy as np
import pandas as pd
import requests

ROOT = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(ROOT, "docs")
HIST_DIR = os.path.join(DOCS, "hist")
CONFIG_PATH = os.path.join(ROOT, "config.json")

NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
NTFY_SERVER = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
PAGES_URL = os.environ.get("PAGES_URL", "").strip()
if PAGES_URL and not PAGES_URL.endswith("/"):
    PAGES_URL += "/"

BRT = dt.timezone(dt.timedelta(hours=-3))
UA = {"User-Agent": "Mozilla/5.0 (monitor-investimentos; +https://github.com)"}
TESOURO_CSV = (
    "https://www.tesourotransparente.gov.br/ckan/dataset/"
    "df56aa42-484a-4a59-8184-7676580c81e3/resource/"
    "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv"
)
CVM = "https://dados.cvm.gov.br/dados/FI"

# Categorias do universo de ativos (chave do config.json → rótulo do app)
CATEGORIAS = {
    "acoes_br": "Ações Brasil",
    "fiis": "Fundos imobiliários",
    "etfs_br": "ETFs Brasil",
    "acoes_global": "Ações globais",
    "etfs_global": "ETFs globais",
    "cripto": "Criptomoedas",
    "cambio": "Câmbio e commodities",
    "indices": "Índices",
}

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


def carregar_json(caminho, padrao):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return padrao


def salvar_json(caminho, obj, compacto=True):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        if compacto:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)


def anterior(nome, padrao):
    """Arquivo publicado na rodada anterior: lê do site no ar; se não der, da pasta local."""
    if PAGES_URL:
        try:
            r = requests.get(PAGES_URL + nome, params={"t": int(time.time())}, headers=UA, timeout=30)
            if r.ok:
                return r.json()
        except Exception:
            pass
    return carregar_json(os.path.join(DOCS, nome), padrao)


def arquivo_seguro(ticker):
    return re.sub(r"[^A-Za-z0-9]+", "_", ticker).strip("_")


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
    try:
        # CDI efetivamente acumulado nos últimos 12 meses (série diária)
        fim = agora().date()
        url = (f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json"
               f"&dataInicial={fim - dt.timedelta(days=365):%d/%m/%Y}&dataFinal={fim:%d/%m/%Y}")
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        diarios = [(d["data"], float(d["valor"])) for d in r.json()]
        macro["cdi_12m"] = num((np.prod([1 + v / 100 for _, v in diarios]) - 1) * 100)
    except Exception as e:
        erros.append(f"Banco Central (CDI 12 meses): {e}")
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
    for i in range(tentativas):
        ultima = i == tentativas - 1
        try:
            r = requests.get(TESOURO_CSV, headers=UA, timeout=180)
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
            "preco": num(pu),
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


def moeda_de(ticker):
    if ticker.startswith("^"):
        return "pts"
    if ticker.endswith(".SA") or ticker.endswith("BRL=X") or ticker == "BRL=X":
        return "R$"
    return "US$"


def baixar_cotacoes(tickers, lote=60):
    """Baixa 2 anos de cotações diárias em lotes; tenta de novo os que falharem."""
    import yfinance as yf

    def baixar(ts):
        d = yf.download(ts, period="2y", interval="1d", group_by="ticker", auto_adjust=True,
                        actions=True, threads=True, progress=False)
        saida = {}
        for t in ts:
            try:
                df = d[t] if isinstance(d.columns, pd.MultiIndex) else d
                if df["Close"].dropna().shape[0] >= 30:
                    saida[t] = df
            except Exception:
                pass
        return saida

    dados = {}
    for i in range(0, len(tickers), lote):
        dados.update(baixar(tickers[i:i + lote]))
        time.sleep(1)
    faltando = [t for t in tickers if t not in dados]
    if faltando:
        time.sleep(5)
        dados.update(baixar(faltando))
    return dados


def analisar(ativo, cat, df, cdi_ano, fx):
    """Calcula indicadores e sinal. Devolve (resumo para data.json, detalhe para hist/)."""
    close = df["Close"].dropna()
    close = close[~close.index.duplicated(keep="last")]
    if len(close) < 30:
        return None, None
    t = ativo["ticker"]
    moeda = moeda_de(t)
    p = float(close.iloc[-1])
    ult_data = close.index[-1]
    um_ano = close[close.index >= ult_data - pd.Timedelta(days=365)]
    retornos = um_ano.pct_change().dropna()

    def ret_desde(dias):
        base = close[close.index <= ult_data - pd.Timedelta(days=dias)]
        return (p / float(base.iloc[-1]) - 1) * 100 if len(base) else np.nan

    var_dia = (p / close.iloc[-2] - 1) * 100
    sma50 = close.rolling(50).mean().iloc[-1] if len(close) >= 50 else np.nan
    sma200 = close.rolling(200).mean().iloc[-1] if len(close) >= 200 else np.nan
    r = rsi(close).iloc[-1]
    maxima = um_ano.max()
    queda_max = (p / maxima - 1) * 100
    vol = retornos.std() * math.sqrt(len(retornos)) * 100 if len(retornos) > 20 else np.nan
    ret_12m = (p / um_ano.iloc[0] - 1) * 100 if len(um_ano) > 200 else np.nan
    inicio_ano = close[close.index < pd.Timestamp(year=ult_data.year, month=1, day=1, tz=ult_data.tz)]
    ret_ano = (p / float(inicio_ano.iloc[-1]) - 1) * 100 if len(inicio_ano) else np.nan

    # Para ativos em dólar, a comparação com o CDI usa o retorno convertido para reais
    ret_12m_brl = np.nan
    if moeda == "US$" and fx is not None and not np.isnan(ret_12m):
        try:
            fx0 = float(fx[fx.index <= um_ano.index[0]].iloc[-1])
            fx1 = float(fx.iloc[-1])
            ret_12m_brl = ((1 + ret_12m / 100) * fx1 / fx0 - 1) * 100
        except Exception:
            pass
    ret_cmp = ret_12m_brl if moeda == "US$" else ret_12m

    dy = None
    if cat not in ("cripto", "cambio", "indices") and "Dividends" in df.columns:
        divs = df["Dividends"].fillna(0)
        soma = divs[divs.index >= ult_data - pd.Timedelta(days=365)].sum()
        dy = soma / p * 100 if soma > 0 else None
        if dy is not None and dy > 30:
            dy = None  # proventos acima de 30% ao ano quase sempre são erro da fonte (grupamento, amortização)

    liquidez = None
    if "Volume" in df.columns and cat not in ("cambio", "indices"):
        v = (df["Volume"].fillna(0) * df["Close"]).iloc[-30:].mean()
        liquidez = num(v, 0) if v and v > 0 else None

    score, motivos = 0, []
    estavel = ativo.get("grupo") == "Stablecoins"
    if estavel:
        motivos.append(("=", "Stablecoin: o preço acompanha o dólar. As regras de tendência não se aplicam; serve para guardar valor em dólar dentro do mundo cripto."))
    else:
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
        if not np.isnan(ret_cmp) and cdi_ano and cat != "indices":
            conv = " (em reais)" if moeda == "US$" else ""
            if ret_cmp > cdi_ano:
                score += 1
                motivos.append(("+", f"Rendeu {br(ret_cmp, 1)}% em 12 meses{conv}, mais que o CDI ({br(cdi_ano, 1)}%)."))
            else:
                score -= 1
                motivos.append(("-", f"Rendeu {br(ret_cmp, 1)}% em 12 meses{conv}, menos que o CDI ({br(cdi_ano, 1)}%)."))
        if dy is not None and cdi_ano and moeda == "R$":
            if dy >= cdi_ano * 0.85:
                score += 1
                motivos.append(("+", f"Pagou {br(dy, 1)}% em proventos no último ano, próximo ou acima do CDI."))
            else:
                motivos.append(("=", f"Pagou {br(dy, 1)}% em proventos no último ano."))
        if queda_max <= -25:
            motivos.append(("=", f"Está {abs(queda_max):.0f}% abaixo da máxima de 12 meses. Desconto ou problema? Vale checar notícias."))
        if len(close) < 200:
            motivos.append(("=", "Menos de 200 pregões de histórico: parte das regras ainda não se aplica."))

    if estavel or (not np.isnan(vol) and vol < 20):
        risco = "baixo"
    elif np.isnan(vol) or vol < 35:
        risco = "médio"
    else:
        risco = "alto"
    if cat == "cripto" and not estavel:
        risco = "alto"

    casas = 6 if p < 0.01 else 4 if p < 10 else 2
    hist = close.iloc[-520:]
    dias = [d.date() for d in hist.index]
    hist_dt = [0] + [(dias[i] - dias[i - 1]).days for i in range(1, len(dias))]
    codigo = "USDBRL" if t == "BRL=X" else t.replace(".SA", "").replace("=X", "").replace("=F", "").lstrip("^")
    codigo = re.sub(r"\d{3,}-USD$", "", codigo).replace("-USD", "")

    resumo = {
        "ticker": t,
        "codigo": codigo,
        "nome": ativo.get("nome", t),
        "cat": cat,
        "grupo": ativo.get("grupo", ""),
        "preco": num(p, casas),
        "moeda": moeda,
        "data": f"{ult_data:%d/%m}",
        "var_dia": num(var_dia),
        "ret_1m": num(ret_desde(30), 1),
        "ret_ano": num(ret_ano, 1),
        "ret_12m": num(ret_12m, 1),
        "ret_12m_brl": num(ret_12m_brl, 1),
        "rsi": num(r, 0),
        "volatilidade": num(vol, 1),
        "dy": num(dy, 1),
        "queda_max_12m": num(queda_max, 1),
        "liquidez": liquidez,
        "risco": risco,
        "score": score,
        "sinal": "NEUTRO" if estavel else rotulo(score),
        "spark": [num(v, casas) for v in close.iloc[-30:].tolist()],
        "h": arquivo_seguro(t),
    }
    if ativo.get("bdr"):
        resumo["bdr"] = ativo["bdr"]
    if ativo.get("alerta"):
        resumo["alerta"] = True
    detalhe = {
        "ticker": t,
        "atualizado": agora().strftime("%d/%m/%Y %H:%M"),
        "sma50": num(sma50, casas),
        "sma200": num(sma200, casas),
        "max_12m": num(maxima, casas),
        "min_12m": num(um_ano.min(), casas),
        "motivos": [{"tipo": tp, "texto": m} for tp, m in motivos],
        "hist": {"t0": dias[0].isoformat(), "dt": hist_dt, "c": [num(v, casas) for v in hist.tolist()]},
    }
    return resumo, detalhe


def coletar_ativos(cfg, cdi_ano, anteriores):
    universo = cfg.get("universo") or {"acoes_br": cfg.get("ativos", [])}
    lista = [(cat, a) for cat in CATEGORIAS for a in universo.get(cat, [])]
    tickers = list(dict.fromkeys(a["ticker"] for _, a in lista))
    bdrs = list(dict.fromkeys(a["bdr"] + ".SA" for _, a in lista if a.get("bdr")))
    dados = baixar_cotacoes(tickers + bdrs)

    fx = dados["BRL=X"]["Close"].dropna() if "BRL=X" in dados else None
    resultado, falhas = [], []
    for cat, ativo in lista:
        t = ativo["ticker"]
        try:
            if t not in dados:
                raise ValueError("sem cotação nesta rodada")
            resumo, detalhe = analisar(ativo, cat, dados[t], cdi_ano, fx)
            if not resumo:
                raise ValueError("histórico insuficiente")
            b = ativo.get("bdr")
            if b and b + ".SA" in dados:
                cb = dados[b + ".SA"]["Close"].dropna()
                resumo["bdr_preco"] = num(cb.iloc[-1])
                resumo["bdr_var"] = num((cb.iloc[-1] / cb.iloc[-2] - 1) * 100) if len(cb) > 1 else None
            salvar_json(os.path.join(HIST_DIR, resumo["h"] + ".json"), detalhe)
            resultado.append(resumo)
        except Exception as e:
            velho = anteriores.get(t)
            if velho:
                velho["desatualizado"] = True  # mantém o último dado bom; o histórico já está publicado
                resultado.append(velho)
            falhas.append(f"{t}: {e}")
    if falhas:
        amostra = ", ".join(falhas[:5]) + (f" e mais {len(falhas) - 5}" if len(falhas) > 5 else "")
        erros.append(f"Cotações ({len(falhas)} de {len(lista)} ativos): {amostra}")
    return resultado


# ------------------------------------------------- Fundos de investimento (CVM)
def baixar_zip_csv(url, **kw):
    r = requests.get(url, headers=UA, timeout=300)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    nomes = kw.pop("nomes", None) or z.namelist()
    return {n: pd.read_csv(z.open(n), sep=";", encoding="latin-1", dtype=str, **kw) for n in nomes}


def coletar_fundos(macro, anteriores):
    hoje = agora().date()
    velho = anteriores or {}
    if velho.get("gerado") == hoje.isoformat() and velho.get("fundos"):
        return velho  # já calculado hoje: a CVM atualiza uma vez por dia

    cad = baixar_zip_csv(f"{CVM}/CAD/DADOS/registro_fundo_classe.zip", nomes=["registro_classe.csv", "registro_fundo.csv"])
    cl, fu = cad["registro_classe.csv"], cad["registro_fundo.csv"]
    cl = cl[(cl["Situacao"] == "Em Funcionamento Normal") & (cl["Forma_Condominio"] == "Aberto")
            & (cl["Exclusivo"] != "S") & cl["Tipo_Classe"].str.contains("FIF", na=False)
            & ~cl["Publico_Alvo"].fillna("").str.contains("Profissional")]
    cl = cl.assign(PL=pd.to_numeric(cl["Patrimonio_Liquido"], errors="coerce"))
    cl = cl[cl["PL"] >= 30e6]
    gestores = fu.set_index("ID_Registro_Fundo")["Gestor"].to_dict()
    cl = cl.assign(cnpj=cl["CNPJ_Classe"].str.zfill(14))
    alvo = set(cl["cnpj"])

    def mes_menos(d, n):
        a, m = d.year, d.month - n
        while m <= 0:
            m += 12
            a -= 1
        return dt.date(a, m, 1)

    def informe(mes):
        nome = f"inf_diario_fi_{mes:%Y%m}"
        d = baixar_zip_csv(f"{CVM}/DOC/INF_DIARIO/DADOS/{nome}.zip",
                           usecols=["CNPJ_FUNDO_CLASSE", "ID_SUBCLASSE", "DT_COMPTC", "VL_QUOTA", "VL_PATRIM_LIQ", "NR_COTST"])
        df = next(iter(d.values()))
        df["cnpj"] = df["CNPJ_FUNDO_CLASSE"].str.replace(r"\D", "", regex=True).str.zfill(14)
        df = df[df["cnpj"].isin(alvo)]
        # Classes com subclasses: usa a cota da classe (sem subclasse) quando existir, senão a primeira subclasse
        df = df.assign(sub=df["ID_SUBCLASSE"].fillna(""))
        df = df.sort_values(["cnpj", "sub"]).groupby(["cnpj", "DT_COMPTC"], as_index=False).first()
        df["q"] = pd.to_numeric(df["VL_QUOTA"], errors="coerce")
        df["dia"] = pd.to_datetime(df["DT_COMPTC"])
        return df.dropna(subset=["q"])[["cnpj", "dia", "q", "VL_PATRIM_LIQ", "NR_COTST"]]

    mes = hoje.replace(day=1)
    atual = informe(mes)
    if atual["dia"].nunique() < 3:  # começo do mês: inclui o mês anterior inteiro
        mes = mes_menos(mes, 1)
        atual = pd.concat([informe(mes), atual])
    recente = pd.concat([informe(mes_menos(mes, 1)), atual]).sort_values(["cnpj", "dia"])
    # Cota de 12 meses atrás: mês correspondente do ano anterior (a data mais próxima de 365 dias)
    antigo = {c: g for c, g in informe(mes_menos(mes, 12)).sort_values("dia").groupby("cnpj")}

    info = cl.set_index("cnpj")
    cdi12 = macro.get("cdi_12m") or macro.get("cdi_ano")
    fundos = []
    for cnpj, g in recente.groupby("cnpj"):
        if len(g) < 15:
            continue
        ult = g.iloc[-1]
        d1 = ult["dia"]
        q1 = float(ult["q"])
        base1m = g[g["dia"] <= d1 - pd.Timedelta(days=30)]
        a = antigo.get(cnpj)
        if a is not None and len(a):
            antes = a[a["dia"] <= d1 - pd.Timedelta(days=365)]
            a = antes.iloc[-1] if len(antes) else a.iloc[0]
        ret_1m = (q1 / float(base1m.iloc[-1]["q"]) - 1) * 100 if len(base1m) else None
        ret_12m = (q1 / float(a["q"]) - 1) * 100 if a is not None and len(a) else None
        rets = g["q"].astype(float).pct_change().dropna().iloc[-40:]
        vol = float(rets.std() * math.sqrt(252) * 100) if len(rets) > 10 else None
        cot = pd.to_numeric(ult["NR_COTST"], errors="coerce")
        if pd.isna(cot) or cot < 100:
            continue
        i = info.loc[cnpj]
        if isinstance(i, pd.DataFrame):
            i = i.iloc[0]
        txt = lambda v: v.strip() if isinstance(v, str) else ""
        classe = txt(i.get("Classificacao")) or "Outros"
        nome = txt(i.get("Denominacao_Social"))
        # Fora da lista: privatização (só FGTS) e previdenciários (só dentro de planos PGBL/VGBL)
        if "FGTS" in classe or re.search(r"PREVID|\bFIFE\b|\bPGBL\b|\bVGBL\b", nome.upper()):
            continue
        fundos.append({
            "cnpj": f"{cnpj[:2]}.{cnpj[2:5]}.{cnpj[5:8]}/{cnpj[8:12]}-{cnpj[12:]}",
            "nome": txt(i.get("Denominacao_Social")),
            "classe": classe,
            "anbima": txt(i.get("Classificacao_Anbima")) or None,
            "gestor": txt(gestores.get(i.get("ID_Registro_Fundo"))) or None,
            "publico": txt(i.get("Publico_Alvo")) or None,
            "longo_prazo": txt(i.get("Tributacao_Longo_Prazo")) == "S",
            "pl": num(ult["VL_PATRIM_LIQ"], 0),
            "cotistas": int(cot),
            "ret_1m": num(ret_1m),
            "ret_12m": num(ret_12m),
            "pct_cdi": num(ret_12m / cdi12 * 100, 0) if ret_12m is not None and cdi12 and classe in ("Renda Fixa", "Multimercado") else None,
            "vol": num(vol, 1),
            "data": d1.strftime("%d/%m/%Y"),
        })
    # Mantém os maiores de cada classe para o arquivo não ficar pesado
    por_classe = {}
    for f in sorted(fundos, key=lambda f: -(f["pl"] or 0)):
        por_classe.setdefault(f["classe"], [])
        if len(por_classe[f["classe"]]) < 200:
            por_classe[f["classe"]].append(f)
    lista = [f for fs in por_classe.values() for f in fs]
    return {"gerado": hoje.isoformat(), "cdi_12m": cdi12, "total_avaliados": len(fundos), "fundos": lista}


# ------------------------------------------------------------------ Notícias
FEEDS = [
    ("InfoMoney", "https://www.infomoney.com.br/feed/"),
    ("Money Times", "https://www.moneytimes.com.br/feed/"),
    ("Seu Dinheiro", "https://www.seudinheiro.com/feed/"),
    ("Exame", "https://exame.com/feed/"),
    ("Bloomberg Línea", "https://www.bloomberglinea.com.br/arc/outboundfeeds/rss/?outputType=xml"),
    ("Livecoins", "https://livecoins.com.br/feed/"),
    ("Google Notícias", "https://news.google.com/rss/search?q=ibovespa+OR+%22mercado+financeiro%22+OR+investimentos+OR+%22renda+fixa%22&hl=pt-BR&gl=BR&ceid=BR:pt-419"),
]
TEMAS = [  # palavras inteiras (\b), para "ações" não casar com "informações"
    ("Cripto", r"\b(bitcoin|cripto\w*|ethereum|solana|blockchain|stablecoins?|btc|altcoins?|binance|tokens?)\b"),
    ("Renda fixa", r"\b(tesouro direto|tesouro selic|tesouro ipca|renda fixa|cdbs?|lcis?|lcas?|debêntures?|selic|copom|juros futuros|crédito privado)\b"),
    ("FIIs", r"\b(fiis?|fundos? imobiliários?|fiagros?|ifix)\b"),
    ("Ações", r"\b(ações|ibovespa|bolsa de valores|bolsa brasileira|dividendos|balanço|lucro líquido|b3|small caps|resultado trimestral)\b"),
    ("Internacional", r"\b(wall street|nasdaq|s&p 500|fed|dow jones|treasuries)\b"),
    ("Economia", r"\b(inflação|ipca|pib|dólar|câmbio|fiscal|banco central|desemprego|arrecadação|juros)\b"),
]
ALIAS_CRIPTO = {"bitcoin": "BTC-USD", "ethereum": "ETH-USD", "solana": "SOL-USD", "cardano": "ADA-USD",
                "xrp": "XRP-USD", "ripple": "XRP-USD", "dogecoin": "DOGE-USD", "tether": "USDT-USD", "usdc": "USDC-USD"}


def limpar_html(s, limite=240):
    s = re.sub(r"<[^>]+>", " ", unescape(s or ""))
    s = re.sub(r"\((?:Foto|Imagem|Crédito)[^)]*\)", " ", s, flags=re.I)  # legendas de foto
    s = re.sub(r"\S*https?://\S+", " ", s)                                # endereços de imagem soltos
    s = re.sub(r"\s+", " ", s).strip()
    return (s[:limite].rsplit(" ", 1)[0] + "…") if len(s) > limite else s


def coletar_noticias(ativos):
    codigos = {a["codigo"].upper(): a["ticker"] for a in ativos if a["cat"] in ("acoes_br", "fiis", "etfs_br")}
    itens, falhas = [], []
    ns = {"media": "http://search.yahoo.com/mrss/"}
    for fonte, url in FEEDS:
        try:
            r = requests.get(url, headers=UA, timeout=30)
            r.raise_for_status()
            root = ET.fromstring(r.content)
            for it in root.findall(".//item")[:40]:
                titulo = limpar_html(it.findtext("title"), 300)
                link = (it.findtext("link") or "").strip()
                if not titulo or not link.startswith("http"):
                    continue
                origem = fonte
                if fonte == "Google Notícias":
                    src = it.find("source")
                    if src is not None and src.text:
                        origem = src.text.strip()
                        titulo = re.sub(r"\s+-\s+" + re.escape(origem) + r"$", "", titulo)
                quando = it.findtext("pubDate") or ""
                try:
                    ts = parsedate_to_datetime(quando)
                except Exception:
                    try:
                        ts = dt.datetime.fromisoformat(quando.replace("Z", "+00:00"))
                    except Exception:
                        continue
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=BRT)
                img = None
                for tag in ("media:content", "media:thumbnail"):
                    m = it.find(tag, ns)
                    if m is not None and m.get("url"):
                        img = m.get("url")
                        break
                enc = it.find("enclosure")
                if not img and enc is not None and (enc.get("type") or "").startswith("image"):
                    img = enc.get("url")
                resumo = "" if fonte == "Google Notícias" else limpar_html(it.findtext("description"))
                texto = (titulo + " " + resumo).lower()
                temas = [nome for nome, rx in TEMAS if re.search(rx, texto)]
                rel = [codigos[c] for c in re.findall(r"\b([A-Z]{4}\d{1,2})\b", titulo + " " + resumo) if c in codigos]
                rel += [t for nome, t in ALIAS_CRIPTO.items() if re.search(r"\b" + nome + r"\b", texto)]
                if rel and "Ações" not in temas and any(t.endswith(".SA") for t in rel):
                    temas.append("Ações")
                if not temas and fonte != "Google Notícias":
                    continue  # portais gerais publicam de tudo: fica só o que fala de mercado e economia
                itens.append({
                    "titulo": titulo, "link": link, "fonte": origem, "quando": ts.astimezone(BRT).isoformat(timespec="minutes"),
                    "resumo": resumo, "img": img if img and img.startswith("https") else None,
                    "temas": temas or ["Mercado"], "ativos": list(dict.fromkeys(rel))[:6],
                })
        except Exception as e:
            falhas.append(f"{fonte}: {e}")
    if len(falhas) == len(FEEDS):
        raise RuntimeError("; ".join(falhas))
    vistos, unicos = set(), []
    for n in sorted(itens, key=lambda n: n["quando"], reverse=True):
        chave = re.sub(r"\W+", "", n["titulo"].lower())[:60]
        if chave in vistos:
            continue
        vistos.add(chave)
        unicos.append(n)
    return {"atualizado": agora().strftime("%d/%m/%Y %H:%M"), "fontes": [f for f, _ in FEEDS], "falhas": falhas, "itens": unicos[:150]}


# ------------------------------------------------------------------- Alertas
def montar_alertas(ativos, tesouro, cfg, estado, motivos):
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
        if not a.get("alerta") or a.get("desatualizado"):
            continue
        antes = anteriores.get(a["ticker"])
        motivo = motivos.get(a["ticker"], "")
        preco = f"{a['moeda']} {br(a['preco'], 2 if a['preco'] >= 10 else 4)}"
        if a["sinal"] == "COMPRA" and antes != "COMPRA" and lim.get("avisar_sinal_compra"):
            novo(f"{a['ticker']}|compra|{hoje}", f"Sinal de compra: {a['codigo']}",
                 f"{a['nome']} a {preco}. {motivo}", 4, ["green_circle"])
        if a["sinal"] == "VENDA" and antes != "VENDA" and lim.get("avisar_sinal_venda"):
            novo(f"{a['ticker']}|venda|{hoje}", f"Sinal de venda: {a['codigo']}",
                 f"{a['nome']} a {preco}. {motivo}", 4, ["red_circle"])
        if a["var_dia"] is not None and abs(a["var_dia"]) >= lim["variacao_dia_pct"]:
            direcao = "sobe" if a["var_dia"] > 0 else "cai"
            novo(f"{a['ticker']}|mov|{hoje}", f"{a['codigo']} {direcao} {br(abs(a['var_dia']), 1)}% hoje",
                 f"{a['nome']} a {preco}. Movimento forte: confira notícias antes de agir.",
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
    inicio = time.time()

    velho = anterior("data.json", {})
    # Memória da rodada anterior; o state.json da raiz só serve de ponto de partida na primeira publicação
    estado = anterior("state.json", carregar_json(os.path.join(ROOT, "state.json"), {}))
    macro = coletar_macro()

    tesouro = None
    try:
        tesouro = coletar_tesouro(macro, cfg)
    except Exception as e:
        erros.append(f"Tesouro Direto: {e}")
        tesouro = velho.get("tesouro")  # mantém o último dado bom

    ativos = []
    try:
        anteriores = {a["ticker"]: a for a in velho.get("ativos", []) if "cat" in a}
        ativos = coletar_ativos(cfg, macro.get("cdi_ano"), anteriores)
    except Exception as e:
        erros.append(f"Cotações: {e}")
        ativos = [a for a in velho.get("ativos", []) if "cat" in a]

    try:
        noticias = coletar_noticias(ativos)
    except Exception as e:
        erros.append(f"Notícias: {e}")
        noticias = anterior("noticias.json", {"itens": []})
    salvar_json(os.path.join(DOCS, "noticias.json"), noticias)

    try:
        fundos = coletar_fundos(macro, anterior("fundos.json", {}))
    except Exception as e:
        erros.append(f"Fundos (CVM): {e}")
        fundos = anterior("fundos.json", {"fundos": []})
    salvar_json(os.path.join(DOCS, "fundos.json"), fundos)

    motivos = {}
    for a in ativos:
        if a.get("alerta"):
            det = carregar_json(os.path.join(HIST_DIR, a["h"] + ".json"), {})
            ms = det.get("motivos") or []
            motivos[a["ticker"]] = ms[0]["texto"] if ms else ""
    alertas, novo_estado = montar_alertas(ativos, tesouro, cfg, estado, motivos)
    enviar(alertas, cfg)

    quando = agora().strftime("%d/%m/%Y %H:%M")
    historico = [{"quando": quando, "titulo": a["titulo"], "msg": a["msg"]} for a in alertas]
    historico += velho.get("historico_alertas", [])

    saida = {
        "versao": 3,
        "atualizado": quando,
        "macro": macro,
        "tesouro": tesouro,
        "categorias": CATEGORIAS,
        "ativos": ativos,
        "fundos_resumo": {"gerado": fundos.get("gerado"), "total": len(fundos.get("fundos", []))},
        "noticias_resumo": {"atualizado": noticias.get("atualizado"), "total": len(noticias.get("itens", []))},
        "alertas_rodada": [a["titulo"] for a in alertas],
        "historico_alertas": historico[:40],
        "alertas_cfg": {k: v for k, v in cfg["alertas"].items() if k != "comentario"},
        "erros": erros,
    }
    salvar_json(os.path.join(DOCS, "data.json"), saida)
    salvar_json(os.path.join(DOCS, "state.json"), novo_estado, compacto=False)

    print(f"OK em {time.time() - inicio:.0f}s: {len(ativos)} ativos, {len((tesouro or {}).get('titulos', []))} títulos, "
          f"{len(fundos.get('fundos', []))} fundos, {len(noticias.get('itens', []))} notícias, "
          f"{len(alertas)} alertas, {len(erros)} erros")
    for e in erros:
        print("  erro:", e)


if __name__ == "__main__":
    main()
