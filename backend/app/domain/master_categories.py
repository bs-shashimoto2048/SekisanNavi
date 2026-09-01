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

