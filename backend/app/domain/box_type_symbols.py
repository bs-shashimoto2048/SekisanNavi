"""箱体型式(キュービクル等)の記号マスタ (Issue #40 追加機能: 箱体型式解析)。

正本資料は「QS-SA020-N 箱体記号一覧表 N版（2026/02/20）」(積算担当からの提示)。
本リポジトリ内には、これより詳細・別系統の記号表は見つからなかった
(docs/配下・backend/配下を検索したが、実データ中に"OS2"等の値そのものは
現れるものの、記号の意味を定義した資料は無かった)。そのため、ここでの
記号定義は提示された資料の記載内容をそのまま転記したものであり、資料に
根拠の無い記号・意味をここで創作しない(`CLAUDE.md`「実データを捏造しない」
方針)。資料と異なる記載を見つけた場合は、このファイルを直さず先に差異を
報告すること。

解析ロジック本体 (`app/services/box_type_parser.py`) から記号定義を分離し、
追加・変更しやすいマスタとして管理する。記号は次の3種類に分けて管理する。

  - `PrimarySymbol` (第1記号): 正式規格の記号そのものの定義
      (意味・分類見出し・使用区分・設置環境・処理対象・IP55該当有無)。
  - `Aux1Symbol`/`Aux2Symbol`/`Aux3Symbol` (補助記号): 正式規格の記号定義。
      独自の積算条件(ZA→メタリコン等の読み替え)は`box_type_parser.py`側の
      専用テーブルに分離し、ここには混在させない(指示: 「正式規格の記号定義と、
      次の独自積算条件は別のマスタとして管理してください」)。

型式の記号だけから製作可否・正式承認・未記載の仕様を確定してはいけない。
解析できる記号は抽出し、不明・競合・曖昧な箇所は解析側で「要確認」として
残す。
"""
from __future__ import annotations

from dataclasses import dataclass

ProcessingTarget = str  # "complete_box" | "partial_fabrication" | "other_vendor_product"


@dataclass(frozen=True)
class PrimarySymbol:
    """第1記号(箱体型式の先頭を構成する記号)。"""

    code: str
    #: 資料記載の意味(「／使用区分」より前の部分)をそのまま保持する。
    meaning: str
    #: 資料の見出し(箱体分類の根拠)。`box_type_parser.py`の
    #: `PRODUCT_CATEGORY_BY_GROUP`で「製品区分」へ変換する。
    group: str
    #: 資料が「記号：意味／使用区分」の形式で明記した使用区分
    #: (標準/旧型/原則使用しない/都度確認/物件対応/補用・旧型)。
    #: 明記の無い記号はNoneのままとし、使用区分を推測で埋めない。
    usage: str | None = None
    #: 資料本文・見出しに「屋外」「屋内」が明記されている場合のみ設定する。
    #: 明記の無い記号(OP/OPA/OPK、ダクト・PB類、他社製品等)はNoneのままとし、
    #: 「O始まりだから屋外だろう」という未記載の推測で埋めない。
    environment: str | None = None
    #: 処理対象の粗い分類。「部分のみ製作」節の記号は"partial_fabrication"、
    #: 「他社製品・特殊形状」節のうち他社完成品を前提とする記号は
    #: "other_vendor_product"、それ以外は箱体一式を指す"complete_box"とする。
    processing_target: ProcessingTarget = "complete_box"
    #: IP55(防塵防噴流)仕様として資料に明記されている記号か。
    ip55: bool = False
    #: IP55記号の元になった通常記号(表示の参考情報、積算条件の根拠には使わない)。
    ip55_base_code: str | None = None


@dataclass(frozen=True)
class Aux1Symbol:
    """補助記号1(材質・表面処理・塗装系の正式規格の記号定義。複数指定可)。"""

    code: str
    meaning: str


@dataclass(frozen=True)
class Aux2Symbol:
    """補助記号2(認定品・推奨品の正式規格の記号定義)。"""

    code: str
    meaning: str
    #: 単独では確定できない事項への注記(例: Kは告示番号を特定できない)。
    caution: str | None = None


@dataclass(frozen=True)
class Aux3Symbol:
    """補助記号3(内部構造・その他)。"""

    code: str
    meaning: str


# --- 第1記号 --------------------------------------------------------------
# 資料の見出し単位でタプルを分け、`PRIMARY_SYMBOLS`へ連結する
# (見出し自体が「箱体分類」の根拠になるため、グループ分割はそのまま残す)。

_GROUP_A_OUTDOOR = "A製品用・屋外キュービクル"
_GROUP_A_INDOOR = "A製品用・屋内キュービクル"
_GROUP_A_INDOOR_SIMPLE = "A製品用・屋内簡易式キュービクル"
_GROUP_A_OPEN = "A製品用・垂直開放型"
_GROUP_BCGHDEF_OUTDOOR = "B・C・G・H・D・E・F製品用・屋外"
_GROUP_BCGHDEF_INDOOR = "B・C・G・H・D・E・F製品用・屋内自立型"
_GROUP_DUCT = "ダクト・PB類"
_GROUP_WALL = "屋内壁掛型・関連形式"
_GROUP_OTHER_VENDOR = "他社製品・特殊形状"
_GROUP_IP55 = "IP55仕様"
_GROUP_LEGACY = "補用箱体・旧型・物件対応"
_GROUP_PARTIAL = "部分のみ製作"

_A_OUTDOOR: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("OS2", "標準アングルレス型", _GROUP_A_OUTDOOR, usage="標準", environment="屋外"),
    PrimarySymbol("OA", "簡易アングル組", _GROUP_A_OUTDOOR, usage="標準", environment="屋外"),
    PrimarySymbol("OAT", "総アングル組", _GROUP_A_OUTDOOR, usage="標準", environment="屋外"),
    PrimarySymbol("OS", "旧型屋外キュービクル", _GROUP_A_OUTDOOR, usage="原則使用しない", environment="屋外"),
    PrimarySymbol("OST2", "旧型屋外キュービクル", _GROUP_A_OUTDOOR, usage="旧型", environment="屋外"),
    PrimarySymbol("OR", "経済型", _GROUP_A_OUTDOOR, usage="都度確認", environment="屋外"),
    PrimarySymbol(
        "CDC", "蓄電池コンテナ（東京電力HD）", _GROUP_A_OUTDOOR, usage="物件対応", environment="屋外"
    ),
)

_A_INDOOR: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("IS2", "標準アングルレス型", _GROUP_A_INDOOR, usage="標準", environment="屋内"),
    PrimarySymbol("IS2P", "アングルレス防塵型", _GROUP_A_INDOOR, usage="標準", environment="屋内"),
    PrimarySymbol("IA", "簡易アングル組", _GROUP_A_INDOOR, usage="標準", environment="屋内"),
    PrimarySymbol("IAP", "簡易アングル組防塵型", _GROUP_A_INDOOR, usage="標準", environment="屋内"),
    PrimarySymbol("IAT", "総アングル組", _GROUP_A_INDOOR, usage="標準", environment="屋内"),
    PrimarySymbol("IATP", "総アングル組防塵型", _GROUP_A_INDOOR, usage="標準", environment="屋内"),
    PrimarySymbol("SS4", "薄型キュービクル", _GROUP_A_INDOOR, usage="標準", environment="屋内"),
    PrimarySymbol("IS", "準標準アングルレス型", _GROUP_A_INDOOR, usage="補用・旧型", environment="屋内"),
    PrimarySymbol("IST2", "旧型屋内キュービクル", _GROUP_A_INDOOR, usage="旧型", environment="屋内"),
)

_A_INDOOR_SIMPLE: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("ISK", "アングルレス型", _GROUP_A_INDOOR_SIMPLE, environment="屋内"),
    PrimarySymbol("IAK", "簡易アングル組", _GROUP_A_INDOOR_SIMPLE, environment="屋内"),
    PrimarySymbol("IATK", "総アングル組", _GROUP_A_INDOOR_SIMPLE, environment="屋内"),
)

# OP/OPA/OPKは資料の意味欄に「屋外」「屋内」の明記が無いため、environmentは
# Noneのままとする(UI側では「要確認」として表示する)。
_A_OPEN: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("OP", "パネル式", _GROUP_A_OPEN),
    PrimarySymbol("OPA", "アングル枠付パネル式", _GROUP_A_OPEN),
    PrimarySymbol("OPK", "金網", _GROUP_A_OPEN),
)

_BCGHDEF_OUTDOOR: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("SCY", "標準屋根有り屋外自立盤", _GROUP_BCGHDEF_OUTDOOR, environment="屋外"),
    PrimarySymbol("SAY", "アングル組屋根有り屋外自立盤", _GROUP_BCGHDEF_OUTDOOR, environment="屋外"),
    PrimarySymbol("SCW", "準標準屋根無し屋外自立盤", _GROUP_BCGHDEF_OUTDOOR, environment="屋外"),
    PrimarySymbol("SAW", "準標準アングル組屋根無し屋外自立盤", _GROUP_BCGHDEF_OUTDOOR, environment="屋外"),
    PrimarySymbol("CYA", "標準屋根分離型・屋根傾斜有り", _GROUP_BCGHDEF_OUTDOOR, environment="屋外"),
    PrimarySymbol("CYB", "標準屋根分離型・屋根傾斜無し", _GROUP_BCGHDEF_OUTDOOR, environment="屋外"),
    PrimarySymbol("CSW", "屋根無防雨壁掛型", _GROUP_BCGHDEF_OUTDOOR, environment="屋外"),
)

_BCGHDEF_INDOOR: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("SL", "標準屋内自立盤", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
    PrimarySymbol("SLP", "標準屋内簡易防塵自立盤", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
    PrimarySymbol("SAN", "屋内アングル組", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
    PrimarySymbol("SAP", "アングル組防塵", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
    PrimarySymbol("MK3", "日粉・母線室無", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
    PrimarySymbol("MJP", "尾上・防塵型", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
    PrimarySymbol("CCSA", "新型片面コントロールセンター（D400）", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
    PrimarySymbol("CCDA", "新型両面コントロールセンター（D600）", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
    PrimarySymbol("CCSN", "旧型片面コントロールセンター（D400）", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
    PrimarySymbol("CCDN", "旧型両面コントロールセンター（D550）", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
    PrimarySymbol("SBD", "ベンチ・デスク", _GROUP_BCGHDEF_INDOOR, environment="屋内"),
)

_DUCT: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("FS", "ビス止めタイプ", _GROUP_DUCT),
    PrimarySymbol("FC", "かぶせビス止めタイプ", _GROUP_DUCT),
    PrimarySymbol("SLF", "SLタイプのダクト", _GROUP_DUCT),
    PrimarySymbol("FCW", "防雨かぶせビス止めタイプ", _GROUP_DUCT),
)

_WALL: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("DHN", "露出分電盤タイプ（壁掛・自立）", _GROUP_WALL, environment="屋内"),
    PrimarySymbol("DHNR", "露出分電盤R付", _GROUP_WALL, environment="屋内"),
    PrimarySymbol("DHNE", "露出分電盤ドア無し（壁掛・自立）", _GROUP_WALL, environment="屋内"),
    PrimarySymbol("DGN", "埋込分電盤タイプ（壁掛・自立）", _GROUP_WALL, environment="屋内"),
    PrimarySymbol("EHN", "露出端子盤タイプ", _GROUP_WALL, environment="屋内"),
    PrimarySymbol("EHNR", "露出端子盤R付", _GROUP_WALL, environment="屋内"),
    PrimarySymbol("EGN", "埋込端子盤タイプ", _GROUP_WALL, environment="屋内"),
    PrimarySymbol("CS", "標準かぶせタイプ", _GROUP_WALL, environment="屋内"),
    PrimarySymbol("AL", "警報盤", _GROUP_WALL, environment="屋内"),
)

# 他社製品・特殊形状: RB/RT/RKは他社完成品への追加加工を前提とする記号
# (`box_type_parser.py`側で個別の注意事項を付与する)。XXは特殊BOXで、
# 他社製品とは限らないためcomplete_boxのまま扱う。
_OTHER_VENDOR: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("RB", "板金加工有", _GROUP_OTHER_VENDOR, processing_target="other_vendor_product"),
    PrimarySymbol(
        "RT", "板金加工無・塗装加工有", _GROUP_OTHER_VENDOR, processing_target="other_vendor_product"
    ),
    PrimarySymbol("RK", "組立加工のみ", _GROUP_OTHER_VENDOR, processing_target="other_vendor_product"),
    PrimarySymbol("XX", "特殊BOX", _GROUP_OTHER_VENDOR),
)

# IP55仕様: 「SCY5をSCYと5へ分解しない」指示のとおり、1つの記号として登録する。
_IP55: tuple[PrimarySymbol, ...] = (
    PrimarySymbol(
        "SCY5", "防塵防噴流・屋根有り屋外自立盤", _GROUP_IP55, environment="屋外", ip55=True, ip55_base_code="SCY"
    ),
    PrimarySymbol(
        "SCW5", "防塵防噴流・屋根無し屋外自立盤", _GROUP_IP55, environment="屋外", ip55=True, ip55_base_code="SCW"
    ),
    PrimarySymbol(
        "CYA5", "防塵防噴流・屋根分離型", _GROUP_IP55, environment="屋外", ip55=True, ip55_base_code="CYA"
    ),
    PrimarySymbol(
        "CSW5", "防塵防噴流・屋根無防雨壁掛型", _GROUP_IP55, environment="屋外", ip55=True, ip55_base_code="CSW"
    ),
)

# 補用箱体・旧型・物件対応: 資料は個別の「／使用区分」を明記していないが、
# 見出し自体が「補用・旧型・物件対応」区分であることを示しているため、
# `box_type_parser.py`側で`group`を根拠に使用前確認の注記を付与する
# (ここで個別usageを未記載のまま埋めない)。環境は、意味欄に「屋内」等の
# 明記がある記号のみ設定する。
_LEGACY: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("ML", "旧型屋内自立盤（組立式）", _GROUP_LEGACY, environment="屋内"),
    PrimarySymbol("SC", "旧型屋内自立盤", _GROUP_LEGACY, environment="屋内"),
    PrimarySymbol("SA", "旧型屋内アングル組自立盤", _GROUP_LEGACY, environment="屋内"),
    PrimarySymbol("SCP", "旧型屋内防塵自立盤", _GROUP_LEGACY, environment="屋内"),
    PrimarySymbol("DH", "旧型露出分電盤", _GROUP_LEGACY),
    PrimarySymbol("DG", "旧型埋込分電盤", _GROUP_LEGACY),
    PrimarySymbol("EH", "旧型露出端子盤", _GROUP_LEGACY),
    PrimarySymbol("EG", "旧型埋込端子盤", _GROUP_LEGACY),
    PrimarySymbol("CSX", "かぶせタイプ", _GROUP_LEGACY),
    PrimarySymbol("YX", "屋根一体型", _GROUP_LEGACY),
    PrimarySymbol("MK2", "日粉・母線室有", _GROUP_LEGACY),
    PrimarySymbol("MJ2", "尾上", _GROUP_LEGACY),
    PrimarySymbol("Y", "住公", _GROUP_LEGACY),
    PrimarySymbol("NJ", "住公中部", _GROUP_LEGACY),
    PrimarySymbol("RAC", "ラック（IBM）", _GROUP_LEGACY),
    PrimarySymbol("SH", "露出表面枠ビス止め", _GROUP_LEGACY),
    PrimarySymbol("SG", "埋込表面枠ビス止め", _GROUP_LEGACY),
    PrimarySymbol("CSG", "埋込かぶせタイプ", _GROUP_LEGACY),
    PrimarySymbol("MBF", "NTT試験用分電盤", _GROUP_LEGACY),
    PrimarySymbol("CDB", "村田製バッテリー収納盤（LiB盤）", _GROUP_LEGACY),
)

_PARTIAL: tuple[PrimarySymbol, ...] = (
    PrimarySymbol("DP", "ドア", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("RP", "屋根", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("VP", "底板", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("SP", "側面板", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("BP", "背面板", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("M", "基板・内器・C/Cユニット", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("V", "ベース・スタンド・架台のみ", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("B", "ボックス・本体・枠", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("HB", "保護板・バリヤ", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("RW", "屋根枠", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol(
        "YY", "A3・A5・A7等で板金製作有・金網類", _GROUP_PARTIAL, processing_target="partial_fabrication"
    ),
    PrimarySymbol(
        "ZZ",
        "A3・A5・A7等で板金製作無・塩ビ、ベーク類",
        _GROUP_PARTIAL,
        processing_target="partial_fabrication",
    ),
    PrimarySymbol("DB", "出戻り品・板金再加工", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("DTO", "出戻り品・再塗装", _GROUP_PARTIAL, processing_target="partial_fabrication"),
    PrimarySymbol("DK", "出戻り品・組立加工のみ", _GROUP_PARTIAL, processing_target="partial_fabrication"),
)

PRIMARY_SYMBOLS: tuple[PrimarySymbol, ...] = (
    _A_OUTDOOR
    + _A_INDOOR
    + _A_INDOOR_SIMPLE
    + _A_OPEN
    + _BCGHDEF_OUTDOOR
    + _BCGHDEF_INDOOR
    + _DUCT
    + _WALL
    + _OTHER_VENDOR
    + _IP55
    + _LEGACY
    + _PARTIAL
)

# 見出し(group) → 製品区分 の変換表 (`box_type_parser.py`の「製品区分」出力用)。
PRODUCT_CATEGORY_BY_GROUP: dict[str, str] = {
    _GROUP_A_OUTDOOR: "A製品",
    _GROUP_A_INDOOR: "A製品",
    _GROUP_A_INDOOR_SIMPLE: "A製品",
    _GROUP_A_OPEN: "A製品",
    _GROUP_BCGHDEF_OUTDOOR: "B・C・G・H・D・E・F製品",
    _GROUP_BCGHDEF_INDOOR: "B・C・G・H・D・E・F製品",
    _GROUP_DUCT: "ダクト・PB類",
    _GROUP_WALL: "屋内壁掛型",
    _GROUP_OTHER_VENDOR: "他社製品",
    _GROUP_IP55: "B・C・G・H・D・E・F製品",
    _GROUP_LEGACY: "補用・旧型・物件対応",
    _GROUP_PARTIAL: "部分製作",
}

# 資料で「使用区分」が明記されている、または見出し自体が旧型・物件対応区分で
# あることを示す記号は、解析結果に「使用前に確認してください」の注記を出す
# (`box_type_parser.py`側で判定に使う)。
_PRE_USE_CHECK_USAGE_VALUES = frozenset(
    {"原則使用しない", "旧型", "都度確認", "物件対応", "補用・旧型"}
)


def primary_requires_pre_use_check(symbol: PrimarySymbol) -> bool:
    """旧型・原則使用しない・都度確認・物件対応・補用旧型の記号かどうか。"""
    if symbol.usage in _PRE_USE_CHECK_USAGE_VALUES:
        return True
    return symbol.group == _GROUP_LEGACY


def primary_product_category(symbol: PrimarySymbol) -> str:
    return PRODUCT_CATEGORY_BY_GROUP.get(symbol.group, symbol.group)


# --- 補助記号1(材質・仕上加工、正式規格の記号定義) -------------------------
# 複数指定を許容する。本体/ベースの区別・ZA等の独自積算条件への読み替えは
# `box_type_parser.py`側の専用テーブル(`AUX1_SPEC_BY_CODE`)で管理し、
# ここには正式な記号の意味のみを保持する。
AUX1_SYMBOLS: tuple[Aux1Symbol, ...] = (
    Aux1Symbol("X", "特殊加工"),
    Aux1Symbol("SU", "SUS304の上に塗装仕上"),
    Aux1Symbol("HL", "SUS304・ヘアライン仕上"),
    Aux1Symbol("TZ", "SPCC・SS400等の特殊材質に塗装仕上"),
    Aux1Symbol("GT", "厚膜塗装（3コート・外面100μm以上）"),
    Aux1Symbol("ST", "特殊塗装（マジックアート塗装等）"),
    Aux1Symbol("D", "溶融亜鉛めっき"),
    Aux1Symbol("DT", "溶融亜鉛めっきの上に塗装"),
    Aux1Symbol("VD", "ベースのみ溶融亜鉛めっき"),
    Aux1Symbol("VDT", "ベースのみ溶融亜鉛めっきの上に塗装"),
    Aux1Symbol("ZA", "亜鉛・アルミニウム擬合金溶射の上に塗装（当社標準）"),
    Aux1Symbol("VZA", "ベースのみ亜鉛・アルミニウム擬合金溶射の上に塗装（当社標準）"),
    Aux1Symbol("ZN", "亜鉛溶射の上に塗装（準標準）"),
    Aux1Symbol("VZN", "ベースのみ亜鉛溶射の上に塗装（準標準）"),
)

# 補助記号2: 認定品・推奨品。
AUX2_SYMBOLS: tuple[Aux2Symbol, ...] = (
    Aux2Symbol("ニン", "認定キュービクル、または耐火性収納箱認定品"),
    Aux2Symbol("スイ", "推奨キュービクル"),
    Aux2Symbol("コニン", "個別認定キュービクル"),
    Aux2Symbol("コスイ", "個別推奨キュービクル"),
    Aux2Symbol(
        "K",
        "告示キュービクル",
        caution="単独では告示番号を特定できないため、詳細は別資料で確認してください。",
    ),
    Aux2Symbol("ニンP", "加圧送水装置制御盤"),
    Aux2Symbol("ニン1", "一種耐熱形分電盤"),
    Aux2Symbol("ニン2", "二種耐熱形分電盤"),
)

# 補助記号3: 内部構造・その他。基本記号のF系列(FS/FC/FCW等)や他の記号内に
# 含まれる"F"とは、解析フェーズが異なるため混同しない(第1記号は文字列先頭で
# 1回だけ最長一致判定し、補助記号3はその残り文字列に対してのみ判定する)。
AUX3_SYMBOLS: tuple[Aux3Symbol, ...] = (Aux3Symbol("F", "Fフロントタイプキュービクル"),)


def _assert_no_duplicate_codes() -> None:
    """同一記号グループ内でのコード重複を起動時に検出する(定義ミスの早期発見用)。"""
    for name, symbols in (
        ("PRIMARY_SYMBOLS", PRIMARY_SYMBOLS),
        ("AUX1_SYMBOLS", AUX1_SYMBOLS),
        ("AUX2_SYMBOLS", AUX2_SYMBOLS),
        ("AUX3_SYMBOLS", AUX3_SYMBOLS),
    ):
        codes = [s.code for s in symbols]
        if len(codes) != len(set(codes)):
            raise AssertionError(f"{name} にコードの重複があります: {codes}")


_assert_no_duplicate_codes()
