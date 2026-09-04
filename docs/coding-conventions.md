# coding-conventions.md — コーディング規約

コードそのものから確認できる命名・構成・エラー処理・テスト方針をまとめる。
「べき論」の一般原則ではなく、現在のコードが実際にそうなっている、という事実を記載する。

## 共通方針

- **推測でダミー値・計算値を作らない**: 価格・数量等、実データに値が無い項目は
  `null`のまま保持し、0や仮の値で埋めない(例: `EstimateMasterItem.total_price_a`)。
  Frontend表示側も「未設定」「-」等、値が無いことを明示する。
- **層の責務を混同しない**: Backendは`domain`(DB/HTTPを知らない業務モデル)・
  `repositories`(SQLを持つ唯一の層)・`schemas`(API入出力契約)・`services`
  (DB以外の外部境界)・`api/routers`(呼び出しをつなぐだけ)に分離する
  (`docs/architecture.md` 2章)。Frontendのコンポーネントは表示に専念し、
  業務ロジック(積算集約の計算等)は`src/domain/*.ts`の純粋関数へ切り出す。
- **大規模リファクタリングを目的外で行わない**: 1つの修正指示の範囲外のコードは
  基本的に変更しない(過去の全PRコミットメッセージに一貫する方針)。

## Backend (Python)

- **命名**: モジュール/関数/変数は`snake_case`、クラスは`PascalCase`
  (`class DetectionStatus(str, Enum)`等)。Enumは`str, Enum`を継承し、値は
  APIのJSON文字列とそのまま一致させる(例: `DetectionSourceType.AI.value == "ai"`)。
- **型ヒント**: 関数シグネチャ・dataclassフィールドに型ヒントを付与する
  (`from __future__ import annotations`を併用するモジュールが多い)。
  Optionalは`X | None`記法(`str | None`)を使う(`Optional[str]`は使わない)。
- **dataclass**: `domain/models.py`のモデルはすべて`@dataclass`。デフォルト値を
  持つフィールドは末尾へ配置する(通常のdataclass制約どおり)。
- **リポジトリ関数の引数**: 位置引数はid等の主キーのみとし、それ以外は
  キーワード専用引数(`*`区切り)にする(例:
  `create_manual_detection(conn, *, drawing_page_id, master_item_id, ...)`)。
- **SQL**: 生SQL文字列をf-stringで組み立てる箇所はあるが、値は必ずプレースホルダ
  (`?`)経由でバインドする(SQLインジェクション対策。文字列結合で値を埋め込まない)。
- **トランザクション**: `app/db/connection.py::get_connection()`が
  「1接続=1トランザクション」を提供する(正常終了時に1回commit、例外時に
  rollback)。個々のrepository関数は自前でcommit/rollbackを呼ばない。
  複数の状態変更(例: Detection更新+decision_events記録)は同じ`conn`を
  使い回すことで自動的に同一トランザクションになる。
- **エラー処理**: 外部境界(`services/data_source.py`等)は独自例外
  (`DataSourceError`のサブクラス)を投げ、router層で日本語メッセージ+適切な
  HTTPステータスへ変換する(内部のスタックトレース・パスを含めない)。
- **コメント**: 「なぜその設計にしたか」を日本語で比較的詳しく書く文化がある
  (採用しなかった代替案・実データ調査で確認した事実等)。関数の呼び出し側に
  「この関数は何をしないか」を明記する箇所が多い(例: 「source_type/statusは
  変更しない」)。

## Frontend (TypeScript / React)

- **命名**: コンポーネントファイル/関数は`PascalCase`(`EstimateAggregation.tsx`)、
  変数/関数は`camelCase`。CSSクラスは`.component-name__element--modifier`
  (BEM風、例: `.estimate-aggregation__grand-total`)。
- **コンポーネント構成**: 1コンポーネント=1ディレクトリに`ComponentName.tsx`+
  `ComponentName.css`+`ComponentName.test.tsx`をまとめる
  (`src/components/<Name>/`)。
- **状態管理**: 外部ライブラリ(Redux等)を使わず、`App.tsx`が主要な状態を
  `useState`で一元管理し、propsで子コンポーネントへ渡す(states down, events up)。
  複数コンポーネントで再利用する共通ロジックはカスタムhook
  (`src/hooks/usePaneWidth.ts`)または純粋関数(`src/domain/*.ts`,
  `src/utils/*.ts`)へ切り出す。
- **props既定値**: 既存コンポーネントへ後から追加した任意機能のprops
  (例: `collapsed?: boolean`)は、呼び出し側の大量修正を避けるため
  オプショナル+デフォルト値(`collapsed = false`)にする。
- **API型**: `src/types/domain.ts`の型はBackendのPydanticスキーマと
  フィールド名をそのまま一致させる(snake_case)。camelCaseへの変換は行わない。
- **CSS変数**: 色・状態表現は`src/index.css`の`:root`で定義したCSSカスタム
  プロパティ(`--status-success`/`--status-error`/`--status-warning-*`等)を
  優先して再利用する。単発の強調色(例: 積算集約「製番合計」の赤`#dc2626`)は
  新しいグローバル変数を増やさず、コンポーネントCSS内へ直接リテラル値で書く
  ことが多い(小規模な色の重複は許容し、無理な共通化はしない方針)。
- **エラー表示**: fetch失敗は`src/api/errors.ts::describeFetchError`で
  安全な日本語メッセージへ変換してから表示する(スタックトレースを画面へ出さない)。

## テスト

- **Backend**: `pytest`。`backend/tests/conftest.py`が`client`(FastAPI
  TestClient、`db_path`にmigration+seed+Master importを適用済み)と
  `db_path`(`tmp_path`配下の一時SQLiteファイル)fixtureを提供する。repository層の
  トランザクション挙動(rollback含む)を直接検証したいテストは
  `app.db.connection.get_connection()`を直接呼ぶ(TestClient経由では
  正常系しか再現できないため)。
- **Frontend**: `vitest` + `@testing-library/react`。`src/setupTests.ts`で
  `ResizeObserver`/`Element.scrollIntoView`をjsdom非対応のためモック/スタブ化する。
  API呼び出しは`vi.mock('../../api/client', () => ({...}))`でモジュール全体を
  モックする。
- **jsdomの既知の制約**(テストを書く/読む際に注意): jsdomはレイアウトエンジンを
  持たないため、`getBoundingClientRect()`/`clientWidth`/`clientHeight`は既定で
  常に`0`を返す(実際の描画寸法比較はPlaywright等の実ブラウザ確認に委ねる)。
  また`getComputedStyle()`は`var(...)`を経由する値や、`font`ショートハンド+
  個別`font-weight`上書きの組み合わせを正しく解決できない場合がある
  (既存テストのコメントに個別の回避策が記録されている)。CSSの`rem`単位は
  jsdomでは`px`へ変換されず文字列のまま返る場合がある(`padding: 0.5rem 1rem`
  のように)。
- **実ブラウザ確認**: 見た目・レイアウト高さ・色のコントラスト等、jsdomで
  検証できない変更はPlaywright等での実ブラウザスクリーンショット確認を
  実装の一部として行う運用が定着している(`docs/implementation-plan.md`の
  各Phase記録に実施結果が残る)。

## Git / Issue運用

- コミットメッセージは日本語、変更内容+理由を記述し、末尾に
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`(AIエージェント実装時)を付与する。
  `Refs #<Issue番号>`で対応Issueを明記する。
- 作業branchは`issue-<番号>/<内容の英語スラッグ>`の命名。
- 1つのIssueに対して複数PRを跨ぐ場合、同じ作業branch上に追加commitしてPRを更新する
  運用が多く見られる(新規branch/新規PRを作らず、既存PRを更新する)。
- PRは作業完了後に作成するが、明示的な指示があるまでmergeしない運用が多い
  (レビュー・確認を挟む前提)。
