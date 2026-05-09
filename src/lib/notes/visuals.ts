/**
 * v5 説明ビジュアル レジストリ (図解仕様書 v5 / notion-117 準拠)。
 *
 * 旧 [[diagram:slug]] 記法を流用し、slug ごとに「動画」または「静止画」種別と
 * 表示メタデータだけをここで宣言する。実際の描画モジュールは
 * src/components/notes/visuals/<slug>.tsx に分離して dynamic import する。
 *
 * v3 の NoteDiagram (公文書ダンプ + AI 画像) とは別系統で、
 *   - 動画: React+SVG で時間進行を表現する説明アニメ。視界連動でのみ再生。
 *   - 静止画: React+SVG の構造図。常時表示。
 * v5 が登録されていない slug は従来の v3 DIAGRAM_REGISTRY にフォールバックする
 * (移行が完了するまでの一時的な接続)。
 */

export type VisualKind = "video" | "static" | "placeholder"

export type VisualConfig = {
  slug: string
  kind: VisualKind
  title: string
  /** 図の役割を 1〜2 行で。NoteDiagram の caption 相当 */
  caption: string
  /** スクリーンリーダー用の代替テキスト */
  alt: string
  /** 図領域のアスペクト比 (w/h) */
  aspect: { width: number; height: number }
  /** 「5 秒で何を読み取るか」の前置き 1 行 */
  intro?: string
  /** 動画のループ秒数。video のときのみ意味を持つ */
  loopSec?: number
}

export const VISUAL_REGISTRY: Record<string, VisualConfig> = {
  // ---- correction (PoC: 統合動画 1 + placeholder 4) ------------------------
  "correction-labyrinth-to-factor": {
    slug: "correction-labyrinth-to-factor",
    kind: "video",
    title: "迷宮 → 因数分解",
    caption:
      "9 つの混線要因が上空でふわふわ混ざり、フレーム → アングル → カメラ → シーン → 作品 の 5 列に落下して整列する。20 秒で 1 ループ。",
    alt: "9 つの混線要因が上空でふわふわ漂い、フレーム → アングル → カメラ → シーン → 作品 の 5 列に落下して整列するループアニメーション",
    aspect: { width: 16, height: 5 },
    intro: "頭の中の混線が、5 段の粒度に並び直る。",
    loopSec: 20,
  },
  // ---- placeholder (本フェーズでは図そのものは未実装。本文に slug が来てもエラーにしない) ----
  "correction-control-math": {
    slug: "correction-control-math",
    kind: "video",
    title: "操作の数学（オペとノブの対応）",
    caption:
      "ゲイン・ガンマ・オフセット・リフトの 4 ミニ図を横一列に並列ループ。各ミニ図が見出し・入出力カーブ・スライダーの 3 層で、パラメータの動きが曲線にどう波及するかを 6.5 秒で 1 周。",
    alt: "ゲイン・ガンマ・オフセット・リフトの 4 つのミニ図が独立位相で 6.5 秒ループし、スライダーの動きに連動して入出力トーンカーブが変形するアニメーション",
    aspect: { width: 16, height: 5 },
    intro: "ノブを動かすと、曲線がそのまま動く。",
    loopSec: 6.5,
  },
  "correction-reversibility": {
    slug: "correction-reversibility",
    kind: "video",
    title: "戻せる / 戻せない（可逆性の比較）",
    caption:
      "ゲイン×ガンマ（左、RGB 3 本同期で最初と最後にぴったり戻る完全可逆）とリフト×ガンマ（右、RGB ごとに位相と param をずらして中間で大きく揺らぐ非可逆）を 5 op の連続進度で 14 秒 1 ループ。HOLD_START 2.5s で y = x 静止 → 再生 4s で forward 進度 P が 0 → 1 → 逆再生 4s で backward 進度 Q が 0 → 1 → HOLD_END 3.5s で y = x 理想線を点線重ね、左は完全一致 / 右は RGB ごとに違う残差が「くすみ + 色偏り」として可視化される。再生バッジ ▶ と逆再生バッジ ◀ で進行方向を表示。",
    alt: "ゲイン×ガンマ（左、RGB 3 本同期 + 完全可逆）とリフト×ガンマ（右、RGB 位相 / param ずらし + 中間オシレーション + 非可逆）の 2 列比較。HOLD_START 2.5s 静止 → 再生 4s で forward 進度 P が 0→1 → 逆再生 4s で backward 進度 Q が 0→1 → HOLD_END 3.5s で y=x 理想線を点線重ね、左は完全一致 / 右は RGB ごとに違う残差を可視化するアニメーション。14 秒 1 ループ。",
    aspect: { width: 16, height: 5 },
    intro: "戻したつもり、でも戻り切らない。残差が「くすみ」になる。",
    loopSec: 14,
  },
  "correction-space-choice": {
    slug: "correction-space-choice",
    kind: "video",
    title: "作業空間の選択（Log / Linear / Gamma）",
    caption:
      "Log・Linear・Gamma の 3 セルを横並びに置き、各空間で自然な操作（オフセット / ゲイン / γ 固定 + ゲイン）を同じ強さで揺らしたときのトーンカーブの応答を 6.5 秒 1 ループで比較。各セルに「物理（光物理に乗るか）」と「レンジ（0..1 信号レンジに収まるか）」の二判定バッジを置き、Log は物理 △ / レンジ ○、Linear は物理 ○ / レンジ ✗、Gamma は物理 ○ / レンジ ○ となる構図を可視化する。Log セルの「物理 △」横にはアテンションバッジ (i) を置き、クリックで「ACEScは物理 ○、ACEScct のときは ○△」の補足を展開する。",
    alt: "Log・Linear・Gamma の 3 空間でそれぞれオフセット / ゲイン / γ=2.4 固定のゲインを同位相で揺らし、トーンカーブが 0..1 の信号レンジ内外でどう振る舞うかを比較するアニメーション。各セル下部に物理 / レンジの二判定バッジと数値 readout を 1 行に並べる。6.5 秒 1 ループ。",
    aspect: { width: 16, height: 5 },
    intro: "ゲインで物理に乗りつつ、レンジに収まるのはどこか。",
    loopSec: 6.5,
  },
  "correction-failure-modes": {
    slug: "correction-failure-modes",
    kind: "video",
    title: "色のひっくり返り",
    caption:
      "赤主 / 緑主 / 青主 / 黄主 の 4 高彩度サンプルに ch 毎に偏った加算をランプし、ある閾値を超えたところで RGB 順位が反転して chip の hue がジャンプする様を 8 秒 1 ループで可視化。現在 swatch + 起点 inset + RGB バー + 順位ラベル + ひっくり返りバッジで反転の瞬間を見せる。",
    alt: "4 つの高彩度サンプル chip (赤主 / 緑主 / 青主 / 黄主) に偏った加算を当て、RGB 順位反転による hue ジャンプを swatch + バー + バッジで可視化するアニメーション。8 秒 1 ループ。",
    aspect: { width: 16, height: 5 },
    intro: "彩度の高い色は、加算の偏りで順位が反転して hue が跳ぶ。",
    loopSec: 8,
  },
  // ---- grading (A 2 本: 本文マーカー確定) --------------------------------
  "grading-look-decomposition": {
    slug: "grading-look-decomposition",
    kind: "video",
    title: "言葉 → 4 軸の足場",
    caption:
      "現場の 4 つの言葉が、色の広がり・転がり / 濃度 / カーブ / RGB カラーバランスの対応軸へ落ちる。右側は各軸ごとに色味カラーパッチ / グレーランプ / 肌パッチを大きく並べ、刺さった軸だけが hue / saturation、輝度、S 字コントラスト、RGB 偏りとして反応する。12 秒で 1 ループ。",
    alt: "監督や DP の言葉が 4 つの知覚軸のどこに落ちるかを示し、右側の各軸に色味カラーパッチ、グレーランプ、肌パッチを並べて、矢印が刺さった軸だけが反応し他の 3 軸は静止するループアニメーション",
    aspect: { width: 16, height: 5 },
    intro: "同じテストチャートでも、言葉が落ちた軸だけ違う方向に動く。",
    loopSec: 12,
  },
  "grading-secret-pantry": {
    slug: "grading-secret-pantry",
    kind: "video",
    title: "秘伝のタレを重ねる",
    caption:
      "左右の棚に蓄積された 4 軸の因数別パーツが、中央の新作 Log プレビューへ順番に重なる。仮プレースホルダの 5 枚の色面をクロスフェードし、素のフレームが完成ルックへ育つ過程を 9 秒で 1 ループ。",
    alt: "左右の棚に並んだ 4 つのタレ瓶が中央の新作プレビューへ順番に移動し、素の Log 風フレームから 4 軸適用後の完成ルックまでクロスフェードするループアニメーション",
    aspect: { width: 16, height: 5 },
    intro: "蓄積した因数別パーツを、新しい作品の上に一つずつ重ねる。",
    loopSec: 9,
  },
  "grading-natural-vs-normal": {
    slug: "grading-natural-vs-normal",
    kind: "static",
    title: "ナチュラルとノーマルは違う",
    caption:
      "ナチュラル軸 (上が高い) ／ ノーマル軸 (右が高い) の二軸を独立した 4 象限画像で対比し、軸ラベルは外周帯に横書きで配置、4 象限ラベルはすべて CELL 右下に統一して左上「狙う狭い場所」を主役象限としてアクセント枠で強調する図。右上は「設計上の中立」、右下は「現在の感覚とずれる」、左下は「あざとい」を 1 ラベルで整理する。",
    alt: "ナチュラル (縦軸) とノーマル (横軸) の四象限を 2×2 の独立画像で並べ、軸ラベルを上端と右端の外周帯に横書き glass-badge pill で配置、4 象限ラベルをすべて CELL 右下に統一する静止図。左上の狙う狭い場所を主役象限としてアクセント枠で強調し、右上に設計上の中立、右下に現在の感覚とずれる、左下にあざといを 1 ラベルで配置する。",
    aspect: { width: 16, height: 9 },
    intro: "整いすぎず、時代感からも外れず、主張だけが先に立たない場所を見る。",
  },
  "grading-mix-vs-split": {
    slug: "grading-mix-vs-split",
    kind: "video",
    title: "混ぜたまま触る / 分けて触る",
    caption:
      "監督から降りる 4 軸オーダー。1 ノードで一気に処理する左セルと、4 ノードに分けて順次処理する右セルを 10 秒で並列ループ。",
    alt: "左セル＝1 ノードで 4 軸を混在処理し 3 chip が破綻、右セル＝4 ノードに分けて順次適用し 12 chip 全部が安定着地する比較ループ動画。",
    aspect: { width: 16, height: 5 },
    intro: "混ぜると壊れる軸が、分けると独立に動く。",
    loopSec: 10,
  },
}

export function getVisualConfig(slug: string): VisualConfig | null {
  return VISUAL_REGISTRY[slug] ?? null
}
