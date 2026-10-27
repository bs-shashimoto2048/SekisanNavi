"""箱体型式(キュービクル等)の記号解析 (Issue #40 追加機能)。

正本資料は「QS-SA020-N 箱体記号一覧表 N版（2026/02/20）」。記号定義そのものは
`app/domain/box_type_symbols.py`に分離してあり、本モジュールは

  1. 入力文字列の正規化
  2. 第1記号の最長一致判定
  3. 残り文字列の補助記号(1/2/3)への分割(動的計画法によるメモ化探索)
  4. 独自積算条件(`AUX1_ESTIMATE_RULES`等、正式規格の記号定義とは別のマスタ)
     の適用
  5. 競合・曖昧さの検出と「要確認」情報の組み立て

のみを担当する。型式の記号だけから製作可否・正式承認・未記載の仕様を
確定しない。解析できる記号は抽出し、不明・競合・曖昧な箇所は`conflicts`/
`warnings`/`notes`/`requires_review`として残し、呼び出し側が安易に
自動確定しないようにする。

## 解析アルゴリズムの要点

1. 第1記号は文字列の先頭から最長一致で1つだけ特定する。特定できなければ
   `status="unknown"`とし、残りを補助記号として解析しない。
2. 残り文字列は、補助記号1/2/3の全マスタを1つの辞書として動的計画法で
   分割する(先頭最長一致の貪欲法だけでは、例えば「ニン1」を「ニン」+「1」
   のように誤って分割してしまう恐れがあるため採用しない)。
3. 複数の分割候補は、以下の優先順で絞り込む(資料の指示順)。
     (a) 未認識文字数が少ない
     (b) 標準順序(第1記号→補助記号1→補助記号2→補助記号3)との整合性が高い
     (c) 分割数(トークン数)が少ない
     (d) 同一対象での競合(`conflicts`)が少ない
   これらすべてが同点の候補が複数残る場合は、1つに決め付けず
   `status="ambiguous"`として全候補(`alternatives`)を保持する。
4. 正式規格の記号の意味(`box_type_symbols.py`、1項目1行表示用)と、
   積算担当独自の積算条件(本モジュールの`AUX1_ESTIMATE_RULES`等)は
   別のテーブルとして管理し、混同しない。
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field, replace

from app.domain.box_type_symbols import (
    AUX1_SYMBOLS,
    AUX2_SYMBOLS,
    AUX3_SYMBOLS,
    PRIMARY_SYMBOLS,
    Aux1Symbol,
    Aux2Symbol,
    Aux3Symbol,
    PrimarySymbol,
    primary_product_category,
    primary_requires_pre_use_check,
)

ParseStatus = str  # "parsed" | "partial" | "ambiguous" | "conflict" | "unknown"

#: DP探索の組合せ爆発を避けるための保険(実際の記号数・型式の長さでは
#: まず到達しない上限。安全装置であり、解析仕様そのものを変えるものではない)。
_MAX_CANDIDATES_PER_INDEX = 8
#: 曖昧時に保持する候補(alternatives)の最大数(表示・ペイロード肥大化の保険)。
_MAX_ALTERNATIVES = 8

_WHITESPACE_RE = re.compile(r"\s+")


def normalize_box_type(raw: str) -> str:
    """型式文字列を解析用に正規化する。

    手順(資料の指示順): 前後空白を除去 → 英字を大文字化 → 全角英数字を半角・
    半角/全角カタカナを統一(Unicode NFKC正規化で同時に行う) → 記号間の空白を
    除去する。元の`raw`文字列自体は呼び出し元が別途保持する(このモジュールは
    正規化後の文字列のみを解析対象とする)。
    """
    s = raw.strip()
    # NFKC: 全角英数字→半角、半角カタカナ→全角カタカナを同時に正規化する
    # (例: "ｏｓ２"→"os2"、"ﾆﾝ"→"ニン")。独自の文字変換テーブルを作らず、
    # Unicode標準の正規化のみを使う。
    s = unicodedata.normalize("NFKC", s)
    s = s.upper()
    s = _WHITESPACE_RE.sub("", s)
    return s


@dataclass(frozen=True)
class SymbolMatch:
    """解析済み記号1件(1項目1行表示用)。"""

    group: str  # "primary" | "aux1" | "aux2" | "aux3"
    code: str
    meaning: str


@dataclass(frozen=True)
class SpecConflict:
    """同一の積算対象項目に対して異なる値を主張する記号があった場合の記録。"""

    field: str
    values: tuple[tuple[str, str], ...]  # (code, value) の組、登場順


@dataclass(frozen=True)
class BoxTypeAnalysis:
    """箱体型式1件分の解析結果。画面表示だけでなく、API・積算・検索・Excel出力へ
    連携できるよう、根拠(どの記号からその値が来たか)を失わない構造化データとして
    保持する。"""

    raw: str
    normalized: str
    status: ParseStatus
    #: 利用者が解釈を確定していない(=自動積算確定を抑止すべき)かどうか。
    #: `status != "parsed"`、または資料上の注意事項(`notes`)がある場合に立つ。
    requires_review: bool

    primary: SymbolMatch | None
    #: 補助記号1/2/3の一致結果(順序・所属区分を保持した配列)。
    aux_matches: tuple[SymbolMatch, ...]
    #: 正規化後文字列を過不足なく再現できる区切り列
    #: (kind, text)。kindは"primary"/"aux1"/"aux2"/"aux3"/"unparsed"。
    #: `"".join(text for _, text in segments) == normalized` が常に成立する
    #: (unknownの場合を除く。テストで保証する)。
    segments: tuple[tuple[str, str], ...]
    #: 認識できなかった文字列(連続した未知文字はまとめて1要素とする)。
    unparsed: tuple[str, ...]

    # --- 仕様 (正式規格の記号定義由来) ---
    box_category: str | None  # 箱体分類(資料の見出し)
    product_category: str | None  # 製品区分(A製品/B・C・G・H・D・E・F製品/他社製品等)
    environment: str | None  # 設置環境(屋外/屋内。資料に明記が無ければNone)
    usage: str | None  # 使用区分(標準/旧型/原則使用しない/都度確認/物件対応等)
    structure: str | None  # 構造(第1記号の正式な意味)

    # --- 仕様 (独自積算条件由来。正式規格の記号定義とは別マスタ) ---
    material: str | None
    coating: str | None  # 塗装(本体)
    surface_treatment: str | None  # 金属表面処理(本体、めっき・溶射等)
    base_finish: str | None  # ベース表面処理(ベースのみの表面処理+塗装)
    certification: str | None  # 認定区分
    ip55: bool  # 防塵防噴流(IP55)仕様か
    processing_target: str  # "complete_box"|"partial_fabrication"|"other_vendor_product"|"unknown"
    #: 正式規格の記号定義と区別した、独自積算条件の適用結果(資料5章の
    #: SU/HL/ZA/VZA/OP/OPAのルールが適用された場合のみ、1件1行で記載する)。
    custom_estimate_conditions: tuple[str, ...]
    #: 上記のいずれにも当てはまらないその他特殊仕様(例: Xの「特殊加工」、
    #: Fの「Fフロントタイプ」)。
    other_notes: tuple[str, ...]

    #: 規格上の注意事項(防雨構造・IP55・他社製品・旧型/物件対応・告示番号等)。
    #: 解析の成否とは別に、積算担当が確認すべき業務上の注記。
    notes: tuple[str, ...]
    #: 同一対象への競合する記号の組(どちらか一方を勝手に採用しない)。
    conflicts: tuple[SpecConflict, ...]
    #: 解析品質に関する警告(未解析文字・競合・曖昧・非標準順序等)。
    warnings: tuple[str, ...]

    #: 曖昧(ambiguous)時に保持する、同点の他候補(自分自身は含まない)。
    alternatives: tuple["BoxTypeAnalysis", ...] = field(default_factory=tuple)
    #: 将来、利用者が複数候補から1つを選んで確定した結果を記録できるように
    #: するための識別子(0=最有力候補、1以降=alternativesのindex+1に対応)。
    #: 本ラウンドでは候補の提示までを実装し、確定結果の永続化は行わない。
    candidate_index: int = 0


# ---------------------------------------------------------------------------
# 独自積算条件マスタ(正式規格の記号定義=`box_type_symbols.py`とは別に管理する)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Aux1EstimateRule:
    material: str | None = None
    body_coating: str | None = None
    body_surface: str | None = None
    base_coating: str | None = None
    base_surface: str | None = None
    other_note: str | None = None


# 資料5章「独自積算条件」+ 特殊判定の対応表。本体への処理とベースのみの処理は
# 必ず別フィールドに分ける(「本体とベースに両処理を重ねて実施」と確定しない)。
AUX1_ESTIMATE_RULES: dict[str, _Aux1EstimateRule] = {
    "X": _Aux1EstimateRule(other_note="特殊加工"),
    "SU": _Aux1EstimateRule(material="SUS304", body_coating="塗装仕上"),
    "HL": _Aux1EstimateRule(material="SUS304", body_surface="ヘアライン仕上"),
    "TZ": _Aux1EstimateRule(material="特殊材質(SPCC、SS400等)", body_coating="塗装仕上"),
    "GT": _Aux1EstimateRule(body_coating="厚膜塗装(3コート・外面100μm以上)"),
    "ST": _Aux1EstimateRule(body_coating="特殊塗装(マジックアート塗装等)"),
    "D": _Aux1EstimateRule(body_surface="溶融亜鉛めっき"),
    "DT": _Aux1EstimateRule(body_surface="溶融亜鉛めっき", body_coating="塗装仕上"),
    "VD": _Aux1EstimateRule(base_surface="溶融亜鉛めっき"),
    "VDT": _Aux1EstimateRule(base_surface="溶融亜鉛めっき", base_coating="塗装仕上"),
    # 特殊判定: ZAは「メタリコン(ZS-50)＋ウレタン塗装」。VZAは箱体本体全体への
    # 処理ではなく、ベースのみの処理として分類する(指示: 「VZAを箱体本体全体への
    # ZA処理と扱わないでください」)。
    "ZA": _Aux1EstimateRule(body_surface="メタリコン(ZS-50)", body_coating="ウレタン塗装"),
    "VZA": _Aux1EstimateRule(base_surface="メタリコン(ZS-50)", base_coating="ウレタン塗装"),
    "ZN": _Aux1EstimateRule(body_surface="亜鉛溶射", body_coating="塗装仕上"),
    "VZN": _Aux1EstimateRule(base_surface="亜鉛溶射", base_coating="塗装仕上"),
}

_AUX3_NOTE_BY_CODE: dict[str, str] = {"F": "Fフロントタイプ"}

_SPEC_FIELDS = ("material", "body_coating", "body_surface", "base_surface", "base_coating")

FIELD_LABEL_JA: dict[str, str] = {
    "material": "材質",
    "body_coating": "塗装(本体)",
    "body_surface": "金属表面処理(本体)",
    "base_surface": "表面処理(ベース)",
    "base_coating": "塗装(ベース)",
    "certification": "認定区分",
    "finish": "仕上",
}

# 資料6章「競合例」のうち、同一フィールドの値比較だけでは検出できない
# (フィールドをまたぐ、または単に注記したい)組み合わせのみ、ここで明示的に
# 扱う。それ以外の組み合わせ(D+ZA、DT+ZN、ZA+GT等)は、`_aggregate`の
# フィールド単位の競合検出で自動的に検出される。
#   - is_conflict=True:  `conflicts`へ追加し、status="conflict"へ波及させる。
#   - is_conflict=False: `notes`への注記のみ(解析自体は競合扱いにしない)。
_PAIRWISE_RULES: tuple[tuple[frozenset[str], str, bool], ...] = (
    (
        frozenset({"SU", "HL"}),
        "SUとHLは仕上条件(塗装仕上／ヘアライン仕上)が競合しています。要確認。",
        True,
    ),
    (
        frozenset({"ZA", "VDT"}),
        "ZA(本体の表面処理)とVDT(ベース専用の処理)を別範囲の処理として保持しています。"
        "本体とベースへ重ねて実施すると確定したものではありません。",
        False,
    ),
    (
        frozenset({"GT", "VD"}),
        "GT(本体の厚膜塗装)とVD(ベースのめっき)を別範囲の処理として保持しています。",
        False,
    ),
)

_RAIN_DOOR_NOTE_CODES = frozenset({"CSW", "SCW", "SAW"})
_RAIN_ROW_NOTE_CODE = "FCW"
_RAIN_STRUCTURE_NOTE = (
    "観音構造の場合、防雨タイプとして扱いません。列盤構造の場合も防雨タイプとして"
    "扱わないため、防雨性能が必要な場合は設置後のコーキング指示、または盤間パッキンを"
    "確認してください(観音・列盤いずれの入力も無い場合、記号だけでは該当構造と"
    "決め付けられません)。"
)
_RAIN_ROW_ONLY_NOTE = (
    "列盤構造の場合、防雨タイプとして扱いません。防雨性能が必要な場合は設置後の"
    "コーキング指示、または盤間パッキンを確認してください。"
)

_OTHER_VENDOR_NOTE_BY_CODE: dict[str, str] = {
    "RB": "購入後に板金追加加工が必要です。塗装の有無、塗装ありの場合は色番号を確認してください。",
    "RT": "板金加工は不要です(当社で塗装加工を行います)。塗装色を確認してください。",
    "RK": "板金加工は不要、当社色への塗り直しもありません。購入時の色を確認してください。",
}
_OTHER_VENDOR_GENERIC_NOTE = (
    "他社完成品の塗り直しは、部品再利用不可・コスト増・製作不可の可能性があります。"
)
_XX_NOTE = "特殊BOXです。仕様の詳細は個別に確認してください。"
_IP55_NOTE = (
    "IP55(防塵防噴流)仕様です。寸法・形状・換気の制限、基準図の確認が必要です"
    "(記号だけで全構造条件への適合を保証するものではありません)。"
)
_CDC_NIN_NOTE = (
    "CDC(蓄電池コンテナ)とニンの組み合わせのため、耐火性収納箱認定品に該当します"
    "(資料の物件対応・旧型に関する章を参照)。"
)


# ---------------------------------------------------------------------------
# 第1記号の最長一致
# ---------------------------------------------------------------------------

_PRIMARY_BY_LENGTH_DESC: tuple[PrimarySymbol, ...] = tuple(
    sorted(PRIMARY_SYMBOLS, key=lambda p: len(p.code), reverse=True)
)


def _match_primary(normalized: str) -> tuple[PrimarySymbol | None, str]:
    """先頭から最長一致で第1記号を1つ特定する。

    `OPA > OP`、`IS2P > IS2`、`DHNR > DHN`、`SCY5 > SCY`、`IATP > IAT`のように、
    同じ接頭辞を持つより長い記号を優先する(長さ降順に走査するだけで実現できる。
    同じ長さの記号同士が同じ接頭辞に同時一致することは無い)。
    """
    for p in _PRIMARY_BY_LENGTH_DESC:
        if normalized.startswith(p.code):
            return p, normalized[len(p.code) :]
    return None, normalized


# ---------------------------------------------------------------------------
# 補助記号(1/2/3)の動的計画法による分割
# ---------------------------------------------------------------------------

_AUX1_BY_CODE: dict[str, Aux1Symbol] = {a.code: a for a in AUX1_SYMBOLS}
_AUX2_BY_CODE: dict[str, Aux2Symbol] = {a.code: a for a in AUX2_SYMBOLS}
_AUX3_BY_CODE: dict[str, Aux3Symbol] = {a.code: a for a in AUX3_SYMBOLS}

_GROUP_RANK = {"aux1": 1, "aux2": 2, "aux3": 3}

# op: ("match", group, code) | ("skip", char, None)
_Op = tuple[str, str, str | None]


def _build_aux_dict(
    aux1: tuple[Aux1Symbol, ...], aux2: tuple[Aux2Symbol, ...], aux3: tuple[Aux3Symbol, ...]
) -> dict[str, list[tuple[str, str]]]:
    d: dict[str, list[tuple[str, str]]] = {}
    for a in aux1:
        d.setdefault(a.code, []).append(("aux1", a.code))
    for a in aux2:
        d.setdefault(a.code, []).append(("aux2", a.code))
    for a in aux3:
        d.setdefault(a.code, []).append(("aux3", a.code))
    return d


_AUX_DICT = _build_aux_dict(AUX1_SYMBOLS, AUX2_SYMBOLS, AUX3_SYMBOLS)
_AUX_CODE_LENGTHS: tuple[int, ...] = tuple(sorted({len(c) for c in _AUX_DICT}, reverse=True))


def _segment(rest: str) -> list[tuple[int, tuple[_Op, ...]]]:
    """残り文字列を補助記号1/2/3の辞書で分割する(メモ化探索)。

    未認識文字数(`u`)のみを最小化の基準としてメモ化する。未認識文字数は
    区間ごとに加算的(どの分割方法を選んでも合計は各区間の和)なので、
    「各開始位置から末尾までの最小未認識文字数」を局所的に最小化すれば、
    全体の最小値も必ず達成できる(区間分割問題の標準的な最適性)。
    その他の評価基準(標準順序との整合性・分割数・競合数)は、全体の
    トークン列が決まらないと判定できない大域的な性質のため、ここでは
    未認識文字数が同点の候補を可能な限り(`_MAX_CANDIDATES_PER_INDEX`件まで)
    保持しておき、呼び出し元(`parse_box_type`)でまとめて評価する。
    """
    n = len(rest)
    memo: dict[int, list[tuple[int, tuple[_Op, ...]]]] = {}

    def solve(i: int) -> list[tuple[int, tuple[_Op, ...]]]:
        if i == n:
            return [(0, ())]
        cached = memo.get(i)
        if cached is not None:
            return cached

        best_unparsed: int | None = None
        best_ops: list[tuple[_Op, ...]] = []

        def consider(u: int, ops: tuple[_Op, ...]) -> None:
            nonlocal best_unparsed, best_ops
            if best_unparsed is None or u < best_unparsed:
                best_unparsed = u
                best_ops = [ops]
            elif u == best_unparsed:
                if ops not in best_ops and len(best_ops) < _MAX_CANDIDATES_PER_INDEX:
                    best_ops.append(ops)

        for length in _AUX_CODE_LENGTHS:
            if i + length > n:
                continue
            piece = rest[i : i + length]
            matches = _AUX_DICT.get(piece)
            if not matches:
                continue
            for group, code in matches:
                for u, ops in solve(i + length):
                    consider(u, (("match", group, code),) + ops)

        for u, ops in solve(i + 1):
            consider(u + 1, (("skip", rest[i], None),) + ops)

        result = [(best_unparsed if best_unparsed is not None else 0, ops) for ops in best_ops]
        memo[i] = result
        return result

    return solve(0)


# ---------------------------------------------------------------------------
# 独自積算条件の集約・競合検出
# ---------------------------------------------------------------------------


def _tokens_from_ops(ops: tuple[_Op, ...]) -> tuple[tuple[str, str], ...]:
    return tuple((g, c) for (kind, g, c) in ops if kind == "match")


def _order_rank(tokens: tuple[tuple[str, str], ...]) -> int:
    """標準順序(補助記号1→2→3)と整合していれば0、そうでなければ1。

    特注品を考慮し、非標準順序の解析候補も受け付けるが(`nonstandard_order`
    警告を付けて保持する)、他の条件が同点の場合は標準順序の候補を優先する。
    """
    ranks = [_GROUP_RANK[g] for g, _ in tokens]
    return 0 if ranks == sorted(ranks) else 1


def _aggregate(tokens: tuple[tuple[str, str], ...]) -> tuple[
    dict[str, str | None],
    tuple[SpecConflict, ...],
    tuple[str, ...],
    str | None,
    tuple[str, ...],
    bool,
]:
    """トークン列から仕様フィールド・競合・その他特殊仕様・認定区分・注記を集約する。

    戻り値: (resolved_fields, conflicts, other_notes, certification, extra_notes,
    extra_attention)。`extra_attention`は、単独では確定できない事項(例: 補助記号2
    「K」の告示番号)等、型式固有の確認が必要な注記が含まれる場合にTrueにする。
    """
    contributions: dict[str, list[tuple[str, str]]] = {f: [] for f in _SPEC_FIELDS}
    other_notes: list[str] = []
    aux1_codes_present: list[str] = []
    cert_contributions: list[tuple[str, str]] = []
    extra_notes: list[str] = []
    extra_attention = False

    for group, code in tokens:
        if group == "aux1":
            aux1_codes_present.append(code)
            rule = AUX1_ESTIMATE_RULES.get(code)
            if rule is not None:
                for f in _SPEC_FIELDS:
                    attr = {
                        "material": rule.material,
                        "body_coating": rule.body_coating,
                        "body_surface": rule.body_surface,
                        "base_surface": rule.base_surface,
                        "base_coating": rule.base_coating,
                    }[f]
                    if attr is not None:
                        contributions[f].append((code, attr))
                if rule.other_note is not None and rule.other_note not in other_notes:
                    other_notes.append(rule.other_note)
        elif group == "aux2":
            sym = _AUX2_BY_CODE[code]
            cert_contributions.append((code, sym.meaning))
            if sym.caution is not None:
                extra_notes.append(sym.caution)
                extra_attention = True
        elif group == "aux3":
            note = _AUX3_NOTE_BY_CODE.get(code)
            if note is not None and note not in other_notes:
                other_notes.append(note)

    conflicts: list[SpecConflict] = []
    resolved: dict[str, str | None] = {}
    for f in _SPEC_FIELDS:
        distinct = {v for _, v in contributions[f]}
        if len(distinct) >= 2:
            conflicts.append(SpecConflict(field=f, values=tuple(contributions[f])))
            resolved[f] = None
        elif len(distinct) == 1:
            resolved[f] = contributions[f][0][1]
        else:
            resolved[f] = None

    distinct_cert = {v for _, v in cert_contributions}
    if len(distinct_cert) >= 2:
        conflicts.append(SpecConflict(field="certification", values=tuple(cert_contributions)))
        certification = None
    elif len(distinct_cert) == 1:
        certification = cert_contributions[0][1]
    else:
        certification = None

    present = set(aux1_codes_present)
    for pair, message, is_conflict in _PAIRWISE_RULES:
        if pair <= present:
            if is_conflict:
                conflicts.append(
                    SpecConflict(
                        field="finish",
                        values=tuple((code, message) for code in sorted(pair)),
                    )
                )
            else:
                extra_notes.append(message)

    return resolved, tuple(conflicts), tuple(other_notes), certification, tuple(extra_notes), extra_attention


def _custom_estimate_conditions(primary: PrimarySymbol, tokens: tuple[tuple[str, str], ...]) -> tuple[str, ...]:
    """資料5章の独自積算条件のうち、フィールド単位の構造化出力だけでは表現
    しきれない(=記号そのものの適用有無を明示したい)ものを1件1行で記録する。
    """
    conditions: list[str] = []
    codes_present = {code for group, code in tokens if group == "aux1"}
    if "SU" in codes_present:
        conditions.append("SU: 材質SUS、仕上は塗装(独自積算条件)")
    if "HL" in codes_present:
        conditions.append("HL: 材質SUS、仕上はヘアライン仕上げ(独自積算条件)")
    if "ZA" in codes_present:
        conditions.append("ZA: メタリコン(ZS-50)＋ウレタン塗装(独自積算条件)")
    if "VZA" in codes_present:
        conditions.append("VZA: ベースのみメタリコン(ZS-50)＋ウレタン塗装(独自積算条件)")
    # OP/OPAの箱体構造追加条件。OPKには適用しない(指示: 「OPKにはOP・OPA専用
    # 条件を適用しない」)。A2・アングル枠+ベースは積算条件であり、第1記号
    # マスタ(`box_type_symbols.py`)には追加しない。
    if primary.code == "OP":
        conditions.append("OP: A2（チャンネルベース含）(独自積算条件)")
    elif primary.code == "OPA":
        conditions.append("OPA: アングル枠＋ベース(独自積算条件)")
    return tuple(conditions)


def _primary_notes(
    primary: PrimarySymbol, tokens: tuple[tuple[str, str], ...]
) -> tuple[tuple[str, ...], bool]:
    """第1記号に付随する規格上の注意事項を組み立てる。

    戻り値は`(notes, attention_required)`。`attention_required`は、単なる一般的な
    注意書き(防雨構造の一般的な注記・特殊BOXの一般的な注記等、型式によらず
    毎回同じ内容を案内するもの)ではなく、**この型式固有の事情により積算担当の
    確認が必要**な場合のみTrueにする(使用区分が旧型・原則使用しない・都度確認・
    物件対応の記号、IP55仕様、他社製品で塗装要確認、等)。
    """
    notes: list[str] = []
    attention = False
    if primary_requires_pre_use_check(primary):
        if primary.usage is not None:
            notes.append(f"使用区分: {primary.usage}。使用前に確認してください。")
        else:
            notes.append("補用箱体・旧型・物件対応区分の記号です。使用前に確認してください。")
        attention = True
    if primary.ip55:
        notes.append(_IP55_NOTE)
        attention = True
    if primary.code in _RAIN_DOOR_NOTE_CODES:
        notes.append(_RAIN_STRUCTURE_NOTE)
    elif primary.code == _RAIN_ROW_NOTE_CODE:
        notes.append(_RAIN_ROW_ONLY_NOTE)
    vendor_note = _OTHER_VENDOR_NOTE_BY_CODE.get(primary.code)
    if vendor_note is not None:
        notes.append(vendor_note)
        notes.append(_OTHER_VENDOR_GENERIC_NOTE)
        attention = True
    if primary.code == "XX":
        notes.append(_XX_NOTE)
    if primary.code == "CDC" and ("aux2", "ニン") in tokens:
        notes.append(_CDC_NIN_NOTE)
        attention = True
    return tuple(notes), attention


def _base_finish(resolved: dict[str, str | None]) -> str | None:
    surface = resolved["base_surface"]
    coating = resolved["base_coating"]
    if surface and coating:
        return f"{surface}＋{coating}"
    return surface or coating


def _meaning_for(group: str, code: str) -> str:
    if group == "aux1":
        return _AUX1_BY_CODE[code].meaning
    if group == "aux2":
        return _AUX2_BY_CODE[code].meaning
    if group == "aux3":
        return _AUX3_BY_CODE[code].meaning
    raise ValueError(f"unknown group: {group}")


def _build_analysis(
    raw: str, normalized: str, primary: PrimarySymbol, ops: tuple[_Op, ...]
) -> BoxTypeAnalysis:
    segments: list[tuple[str, str]] = [("primary", primary.code)]
    unparsed_runs: list[str] = []
    current: list[str] = []
    for kind, g, c in ops:
        if kind == "skip":
            current.append(g)  # skip opは(char, None)なのでgに文字が入る
            continue
        if current:
            run = "".join(current)
            unparsed_runs.append(run)
            segments.append(("unparsed", run))
            current = []
        segments.append((g, c))
    if current:
        run = "".join(current)
        unparsed_runs.append(run)
        segments.append(("unparsed", run))

    tokens = _tokens_from_ops(ops)
    resolved, conflicts, other_notes, certification, extra_notes, extra_attention = _aggregate(tokens)
    order_rank = _order_rank(tokens)

    aux_matches = tuple(SymbolMatch(group=g, code=c, meaning=_meaning_for(g, c)) for g, c in tokens)

    warnings: list[str] = []
    for conflict in conflicts:
        label = FIELD_LABEL_JA.get(conflict.field, conflict.field)
        if conflict.field == "finish":
            # _PAIRWISE_RULESのmessageをそのまま使う(valuesの2件目以降に
            # 重複して埋め込んでいるため、1件目のmessageのみ採用する)。
            warnings.append(conflict.values[0][1])
        else:
            detail = " / ".join(f"{code}:{value}" for code, value in conflict.values)
            warnings.append(f"{label}が競合しています({detail})。要確認。")
    if unparsed_runs:
        warnings.append(f"未解析の文字があります: {', '.join(unparsed_runs)}")
    if order_rank != 0:
        warnings.append(
            "補助記号が標準順序(補助記号1→2→3)と異なります(nonstandard_order)。"
            "特注品の可能性があるため要確認。"
        )

    primary_notes, primary_attention = _primary_notes(primary, tokens)
    notes = primary_notes + extra_notes
    custom_conditions = _custom_estimate_conditions(primary, tokens)

    unparsed_count = sum(len(r) for r in unparsed_runs)
    status: ParseStatus = "conflict" if conflicts else ("partial" if unparsed_count > 0 else "parsed")
    requires_review = status != "parsed" or primary_attention or extra_attention

    return BoxTypeAnalysis(
        raw=raw,
        normalized=normalized,
        status=status,
        requires_review=requires_review,
        primary=SymbolMatch(group="primary", code=primary.code, meaning=primary.meaning),
        aux_matches=aux_matches,
        segments=tuple(segments),
        unparsed=tuple(unparsed_runs),
        box_category=primary.group,
        product_category=primary_product_category(primary),
        environment=primary.environment,
        usage=primary.usage,
        structure=primary.meaning,
        material=resolved["material"],
        coating=resolved["body_coating"],
        surface_treatment=resolved["body_surface"],
        base_finish=_base_finish(resolved),
        certification=certification,
        ip55=primary.ip55,
        processing_target=primary.processing_target,
        custom_estimate_conditions=custom_conditions,
        other_notes=other_notes,
        notes=notes,
        conflicts=conflicts,
        warnings=tuple(warnings),
    )


def _unknown_analysis(raw: str, normalized: str) -> BoxTypeAnalysis:
    if normalized == "":
        warning = "型式が空のため解析できません"
        segments: tuple[tuple[str, str], ...] = ()
        unparsed: tuple[str, ...] = ()
    else:
        warning = f'第1記号を特定できませんでした: "{normalized}"'
        segments = (("unparsed", normalized),)
        unparsed = (normalized,)
    return BoxTypeAnalysis(
        raw=raw,
        normalized=normalized,
        status="unknown",
        requires_review=True,
        primary=None,
        aux_matches=(),
        segments=segments,
        unparsed=unparsed,
        box_category=None,
        product_category=None,
        environment=None,
        usage=None,
        structure=None,
        material=None,
        coating=None,
        surface_treatment=None,
        base_finish=None,
        certification=None,
        ip55=False,
        processing_target="unknown",
        custom_estimate_conditions=(),
        other_notes=(),
        notes=(),
        conflicts=(),
        warnings=(warning,),
    )


def parse_box_type(raw: str) -> BoxTypeAnalysis:
    """箱体型式の文字列を解析する(公開エントリーポイント)。

    型式の記号だけから製作可否・正式承認・未記載の仕様を確定しない。
    解析できる記号は抽出し、不明・競合・曖昧な箇所は`status`/`conflicts`/
    `warnings`/`requires_review`として残す。
    """
    normalized = normalize_box_type(raw)
    primary, rest = _match_primary(normalized)
    if primary is None:
        return _unknown_analysis(raw, normalized)

    candidates = _segment(rest)  # 全候補、未解析文字数は全候補で同点(最小値)

    scored = []
    for unparsed_count, ops in candidates:
        tokens = _tokens_from_ops(ops)
        order_rank = _order_rank(tokens)
        token_count = len(tokens)
        _, conflicts, _, _, _, _ = _aggregate(tokens)
        scored.append((order_rank, token_count, len(conflicts), ops))

    min_order = min(s[0] for s in scored)
    stage1 = [s for s in scored if s[0] == min_order]
    min_tokens = min(s[1] for s in stage1)
    stage2 = [s for s in stage1 if s[1] == min_tokens]
    min_conflicts = min(s[2] for s in stage2)
    finalists = [s for s in stage2 if s[2] == min_conflicts]

    unique_ops: list[tuple[_Op, ...]] = []
    seen: set[tuple[_Op, ...]] = set()
    for _, _, _, ops in finalists:
        if ops not in seen:
            seen.add(ops)
            unique_ops.append(ops)
    unique_ops.sort()

    results = [_build_analysis(raw, normalized, primary, ops) for ops in unique_ops[: _MAX_ALTERNATIVES + 1]]
    primary_result = results[0]
    if len(results) > 1:
        alternatives = tuple(replace(r, candidate_index=i + 1) for i, r in enumerate(results[1:]))
        primary_result = replace(
            primary_result,
            status="ambiguous",
            requires_review=True,
            warnings=primary_result.warnings
            + (f"複数の同等な解析候補があります({len(results)}件)。1つに決定できないため要確認。",),
            alternatives=alternatives,
        )
    return primary_result
