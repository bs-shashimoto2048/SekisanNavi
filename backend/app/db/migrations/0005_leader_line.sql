-- 0005_leader_line.sql
-- Phase 1.11: 積算Master Itemに紐づくManual BBoxの「引出線」表示対応。
--
-- 引出線のラベル帯(「コード 型式」を表示する水平帯)の表示位置は、BBox本体の
-- 座標(bbox_x/y/w/h)とは独立して保持する (指示書10章/11章: BBox位置 ≠ 引出線
-- ラベル位置)。画面px単位ではなく、既存のbbox_x/y等と同じ0.0〜1.0正規化座標を
-- そのまま踏襲する (指示書12章)。
--
-- NULL(未設定)の場合、Frontend側がBBox右上角を基準に初期位置を自動計算して表示する
-- (指示書13章)。ユーザーがラベル帯をドラッグして初めてこのカラムへ値が入る。
ALTER TABLE detections ADD COLUMN leader_label_x REAL;
ALTER TABLE detections ADD COLUMN leader_label_y REAL;
