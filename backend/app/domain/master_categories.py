"""Sekisan Naviで使用する品名(category)の一覧と表示順 (Phase 1.7 追加指示)。

`data/master/estimate_master_a.xlsx` (Sheet2) には様々なcategoryが存在するが、
Sekisan Naviの積算Masterとして採用するのは以下13種類のみとする。表示順(タブの並び順)も
業務指定のこの順序で固定する。

Backend側 (Master Importerのフィルタ条件、APIの並び順) からのみこの一覧を参照し、
Frontendへは一覧そのものをハードコードしない。APIが返す一覧の並び順自体が
この順序を反映しているため、Frontendは受け取った順序をそのまま使う
(EstimateMasterPicker.tsxのタブ生成ロジック参照。二重管理を避ける)。
"""

ALLOWED_CATEGORIES: tuple[str, ...] = (
    "箱･単独",
    "箱･左右",
    "箱･中",
    "内部ﾊﾟﾈﾙ",
    "底板",
    "盤間の仕切・遮蔽",
    "附属品加算価格",
    "箱体価格倍率",
    "ﾊﾟﾈﾙ",
    "OPA用ｱﾝｸﾞﾙ枠",
    "金網",
    "入力（主回路銅帯）",
    "銅帯",
)

# 主回路銅帯コード選択UI (Issue #40 Phase 6-H) が対象とする品名(仕様区分)。
# `ALLOWED_CATEGORIES`のうち「主回路銅帯」に該当する2品名のみを使う
# (新しい分類を作らず、既存の実データ品名をそのまま「仕様区分」として使う)。
COPPER_BUS_CODE_CATEGORIES: tuple[str, ...] = (
    "入力（主回路銅帯）",
    "銅帯",
)

