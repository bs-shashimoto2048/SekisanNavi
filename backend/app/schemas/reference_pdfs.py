"""「資料」ウィンドウ(複数PDF参照)APIのスキーマ。

`app.config.REFERENCE_PDF_DIR`配下のPDF一覧・個別配信に使う(旧「積算資料PDF
Help」単一固定ファイルAPIは資料機能の一本化によりこちらへ統合し廃止した)。
"""
from pydantic import BaseModel


class ReferencePdfItemOut(BaseModel):
    """フォルダ内のPDF1件分。

    ファイル名を最初のアンダーバーで分割できた場合のみ`code`/`target`を
    設定し、`valid=True`とする。分割できない(アンダーバーが無い、または
    コード/積算対象のどちらかが空になる)場合は`code`/`target`を`None`のまま
    `valid=False`とし、Frontend側はファイル名だけを「形式不正」として表示する
    (推測で架空のコード/積算対象を補わない)。
    """

    filename: str
    code: str | None
    target: str | None
    valid: bool


class ReferencePdfListOut(BaseModel):
    """一覧API全体の応答。

    `folder_exists=False`(フォルダ自体が無い)と`folder_exists=True`かつ
    `items=[]`(フォルダはあるがPDFが無い)をFrontend側で区別できるように
    分けて返す(実際のファイルシステム状態をそのまま伝えるだけで、
    どちらも「アプリは停止させない」対象)。
    """

    folder_exists: bool
    items: list[ReferencePdfItemOut]
