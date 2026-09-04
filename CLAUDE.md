# CLAUDE.md — Claude Code向け開発ガイド

Sekisan Navi (積算ナビ) のリポジトリでClaude Codeが作業する際の運用ルール。
プロジェクト全体の技術詳細は`docs/`配下を参照し、本ファイルは「AIエージェントが
このリポジトリで作業する際に踏むべき手順・注意点」に絞る。

## このプロジェクトについて(最小限)

社内向け積算情報収集Webシステムのプロトタイプ(PoC)。`backend/`(FastAPI+SQLite)と
`frontend/`(React+TypeScript+Vite)からなる。詳細は [`README.md`](README.md) と
[`docs/architecture.md`](docs/architecture.md) を参照。

## Issueを正本として進める運用

このリポジトリの作業は、GitHub Issueへの指示コメントを正本として進める運用が
定着している。

- 作業前に対象Issueの本文・最新コメントを確認する。
- 作業結果はIssueへコメントとして報告する(何を変更したか、テスト結果、
  実ブラウザ確認結果、commit SHA、PR URL等)。
- 複数ラウンドにわたる作業は、同じ作業branch/PRへ追加commitしていく運用が多い
  (新規branch/新規PRを都度作らない)。
- 明示的な指示がない限り、PRをmergeしない。

## 編集してよい領域 / 注意が必要な領域

### 比較的自由に編集してよい

- `docs/*.md`, `README.md`, `CLAUDE.md` — 事実に基づく記述であれば、Issue指示に
  沿って自由に再編・更新してよい。
- 各コンポーネント/モジュール専用のCSS(例: `EstimateAggregation.css`) — 見た目の
  調整は該当コンポーネントのCSSファイル内に閉じることが多い。
- 個別のtestファイル — 実装変更に追従させる形での更新は必須。

### 変更前に既存の設計判断を必ず確認する領域

- **Overlay座標系**(`docs/architecture.md` 9章): Detection/PanelAreaは
  0.0〜1.0正規化座標。zoom/pan/fit操作から独立させる設計を崩さないこと。
- **BBox所属判定**(`frontend/src/domain/estimateAggregationReal.ts::
  assignDetectionToPanel`): 交差面積による判定ロジック。Backend側にも
  `backend/app/services/estimate_confirmation_builder.py`が同じロジックを
  Python移植として持つ(2箇所の実装が乖離しないよう、変更する場合は両方を
  確認する)。
- **decision_events / estimate_confirmations のFK方針**
  (`docs/decision-event-design.md` 6章、`docs/decision-snapshot-design.md`
  6章): `detection_id`等は意図的にFK制約を持たない歴史的参照。安易にFK制約を
  追加しない(`PRAGMA foreign_keys=ON`環境での削除時FK違反を招く)。
- **積算集約(EstimateAggregation)の集約ロジック**
  (`docs/ui-spec.md` 5.5章): 対象別/総合計で異なる集約キーを使う設計。
  変更する際は「総合計での二重計上・欠落が起きないこと」を必ず確認する。
- **Undo/Redo**(`frontend/src/domain/editHistory.ts`): create/delete/bboxの
  3種のみを対象とする。create/deleteのUndo/RedoはSQLiteのAUTOINCREMENTにより
  新しい`detection_id`が払い出される既知の制約がある(意図的な設計、
  バグではない)。
- **引出線(Leader Line)とBBoxの表示分離**(`docs/architecture.md` 15章):
  積算コードに紐づくManual BBoxは通常表示でBBox矩形を出さず、引出線のみを
  表示する。z-index/pointer-eventsの契約(`docs/architecture.md` 15章
  「Overlayレイヤーの明示的なz-index/pointer-events契約」)を変更する際は、
  既存のクリック判定(Pan/BBox追加モード/BBox編集の競合回避)に影響しないか
  確認する。

## 回帰させやすい既知のポイント

- BBox作成・移動・リサイズ・削除・引出線ラベル移動は、いずれも
  `decision_events`への記録を伴う(`backend/app/repositories/detections.py`)。
  Detection関連のrepository関数を変更する際は、対応する
  `backend/tests/test_decision_events.py`が引き続き通ることを確認する。
- `EstimateAggregation`/`EstimateDetail`の対象切替・Viewer盤フォーカスは
  `App.tsx`が状態を一元管理し、複数コンポーネント間で同期する。片方だけを
  変更すると同期が崩れやすい。
- jsdomの制約(`docs/coding-conventions.md`「テスト」節参照)により、
  レイアウト寸法・色のコントラスト等はテストで正しく検証できない場合がある。
  見た目に関わる変更は実ブラウザ(Playwright等)での確認を行うこと。

## 実データを捏造しない

- 価格・数量・座標等、実データに値が無い/未確認の項目を、それらしい数値や
  文言で埋めない。`null`のまま扱うか、「不明」「未設定」と明示する。
- ドキュメントも同様に、リポジトリ内で確認できない事実を「実装済み」であるかの
  ように書かない。不明な場合は「不明」「このプロジェクトでは確認できない」と
  明記する。
- スクリーンショット・デモデータは実在するデモ製番(例: `A1GV2421`)を使う。
  架空の画面を画像生成・捏造しない。
- 公開リポジトリへ画面・データを追加する前に、社外秘・個人情報・実業務データが
  写り込んでいないか必ず確認する。含まれる可能性がある場合は、勝手にcommitせず
  作業を止めてユーザーへ報告する。

## Build / Test 手順

詳細は [`README.md`](README.md) を正とする(重複を避けるためコマンドの
転記はしない)。要点のみ:

```bash
# Backend
cd backend && source .venv/Scripts/activate && python -m pytest -q

# Frontend
cd frontend && npm run test    # = vitest run
cd frontend && npx tsc -b tsconfig.app.json --noEmit
cd frontend && npm run lint
cd frontend && npm run build
```

- コード変更を行った場合、変更した層(Backend/Frontend)のテストは必ず実行する。
- Frontendの見た目に関わる変更は、上記に加えて実ブラウザでの確認を行う
  (テストのみで完了と報告しない)。
- Backend/Frontend双方に影響する変更(APIスキーマ変更等)は両方のテストを
  実行する。

## Git / PR運用

- 作業branchは`issue-<番号>/<内容>`の命名(例: `issue-9/header-title-and-total-emphasis`)。
- コミットメッセージは日本語。変更内容と理由を書き、対応するIssueを
  `Refs #<番号>`で明記する。AIエージェントによるコミットには
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` を付与する。
- 破壊的操作(force push、branch削除、merge等)は、明示的な指示・許可なく
  実行しない。権限上ブロックされた場合は回避策を探さず、その旨をユーザーへ
  報告する。
