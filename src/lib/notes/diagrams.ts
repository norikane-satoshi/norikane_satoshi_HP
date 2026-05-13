/**
 * Notion 本文に [[diagram:<slug>]] という marker paragraph を置くと、
 * RenderBlocks が NoteDiagram コンポーネントへ差し替える。
 *
 * grading / filmlook 等を追加するときは、画像 (public/notes/diagrams/<slug>.webp)
 * と meta (public/notes/diagrams/<slug>.meta.json) を生成したうえで
 * このオブジェクトに 1 エントリ足すだけで済むようにしている。
 *
 * layout は 5 種類:
 *   - "chaos-vs-structured": 左右対比 (correction-factor-map / filmlook-density-mixture)
 *   - "centered-axes":       中心ルック + 4方向軸 (grading-look-decomposition)
 *   - "horizontal-flow":     左→右 4 列ステップ
 *   - "horizontal-flow-8":   8 段ステップ (filmlook-physics-flow)。desktop は md:grid-cols-4 で 4×2、mobile は 1 列。
 *   - "keypoint-row":        2〜5 項目の番号付きキーポイント (5秒で腹落ち用)
 *   - "photo-strip":         実写 5 枚の横一列ストリップ (correction-exposure-bracket)。AI ヒーロー画像を持たず、写真自体がヒーロー。
 *   - "quad-cards":          2x2 のカード行列 (correction-control-math)。算数オペ × ノブ対応表。
 *   - "compare-pair":        左右 2 列のノード経路比較 (correction-reversibility-compare)。
 *   - "triple-compare":      3 列の空間比較 (correction-space-choice)。Log / Linear / Gamma。
 */

type DiagramBase = {
  slug: string
  title: string
  caption: string
  alt: string
  aspect: { width: number; height: number }
  /**
   * 図に入る前の「5秒で何を読み取るか」一行宣言。
   * keypoint-row では必須、その他 layout では任意 (与えれば Body 冒頭で表示)。
   */
  intro?: string
}

export type ChaosStructuredDiagram = DiagramBase & {
  layout: "chaos-vs-structured"
  chaosHeading: string
  chaosLabels: string[]
  structuredHeading: string
  // structuredLayers は { label, sublabel? } で受ける。
  // 仕様書 v3 では correction-factor-map のように label + 1行説明が対になる
  // ケースと、filmlook-density-mixture のように label のみのケースが両方ある。
  structuredLayers: { label: string; sublabel?: string }[]
}

export type CenteredAxesDiagram = DiagramBase & {
  layout: "centered-axes"
  centerLabel: string
  centerSubLabel: string
  axesHeading: string
  axes: { label: string; sublabel: string }[]
  hintHeading: string
  hints: string[]
}

export type HorizontalFlowDiagram = DiagramBase & {
  layout: "horizontal-flow"
  flowHeading: string
  steps: { label: string; sublabel: string }[]
  takeaway: string
}

/**
 * horizontal-flow-8: 8 段の物理パイプライン (filmlook-physics-flow 専用)。
 * desktop は md:grid-cols-4 で 4×2 派生、mobile は 1 列縦積み。
 * group は仕様書 v3 の塊 (入力 1-2 / 内部 3-7 / 出力 8) を表し、
 * note-diagram.tsx 側で行替えなしの薄い区切り線として描く。
 */
export type HorizontalFlow8Group = "input" | "internal" | "output"
export type HorizontalFlow8Diagram = DiagramBase & {
  layout: "horizontal-flow-8"
  flowHeading: string
  steps: { label: string; sublabel: string; group: HorizontalFlow8Group }[]
  takeaway: string
}

/**
 * keypoint-row: 2〜5 項目の番号付きキーポイント図解。
 * 各項目は1つの「読み解きの軸」を表し、glyph で軽い視覚アイコンを与える。
 * 図に入る前の一行宣言は DiagramBase.intro を使う。takeaway = 出口の一行。
 */
export type KeypointRowGlyph =
  | "scope"
  | "word-axis-knob"
  | "density"
  | "mixture"
export type KeypointRowDiagram = DiagramBase & {
  layout: "keypoint-row"
  itemsHeading: string
  items: {
    label: string
    sublabel: string
    glyph: KeypointRowGlyph
  }[]
  takeaway: string
}

/**
 * photo-strip: 実写 5 枚の横一列ストリップ。
 * AI ヒーロー画像は持たず、写真そのものがヒーロー。
 * mobile は grid-cols-2 (5枚目を中央寄せ)、desktop は md:grid-cols-5。
 * 各写真の下に HTML/CSS で minimal label (例: -2EV / -1EV / 0 / +1EV / +2EV) を載せる。
 */
export type PhotoStripDiagram = DiagramBase & {
  layout: "photo-strip"
  itemsHeading: string
  photos: { src: string; label: string; sublabel?: string }[]
  takeaway: string
}

/**
 * quad-cards: 2x2 のカード行列。
 * Lift / Gamma / Gain / Offset を 1 セルずつに置き、
 * ノブ名 + 算数オペ (加算 / べき乗 / 乗算 / 複合) + 効く帯 (暗部 / 中間 / 明部 / 全帯) を並べる。
 * AI 画像は背景・気分のみ。
 */
export type QuadCardsItem = {
  label: string
  opLabel: string
  scopeLabel: string
  sublabel: string
}
export type QuadCardsDiagram = DiagramBase & {
  layout: "quad-cards"
  itemsHeading: string
  items: QuadCardsItem[]
  takeaway: string
}

/**
 * compare-pair: 左右 2 列のノード経路比較。
 * 左 = clean / reversible (乗算中心 1 段)、右 = nested / irreversible (加算 + べき乗の入れ子)。
 * 各列内には縦並びの小箱 (ノード) を置く。
 */
export type CompareSide = {
  heading: string
  verdict: string
  nodes: { label: string; sublabel: string }[]
}
export type ComparePairDiagram = DiagramBase & {
  layout: "compare-pair"
  cleanSide: CompareSide
  nestedSide: CompareSide
  takeaway: string
}

/**
 * triple-compare: 3 列の空間比較。
 * mobile grid-cols-1, desktop md:grid-cols-3。横スクロールなしを保証する。
 * 各列に「操作感 / 信号範囲 / 色抽出」の 3 行を等しい構造で並べる。
 */
export type TripleCompareColumn = {
  label: string
  feel: string
  range: string
  extraction: string
  verdict: string
}
export type TripleCompareDiagram = DiagramBase & {
  layout: "triple-compare"
  itemsHeading: string
  rowLabels: { feel: string; range: string; extraction: string }
  columns: TripleCompareColumn[]
  takeaway: string
}

export type DiagramConfig =
  | ChaosStructuredDiagram
  | CenteredAxesDiagram
  | HorizontalFlowDiagram
  | HorizontalFlow8Diagram
  | KeypointRowDiagram
  | PhotoStripDiagram
  | QuadCardsDiagram
  | ComparePairDiagram
  | TripleCompareDiagram

export const DIAGRAM_REGISTRY: Record<string, DiagramConfig> = {
  "correction-factor-map": {
    slug: "correction-factor-map",
    layout: "chaos-vs-structured",
    title: "カラーコレクションの因数分解マップ",
    caption:
      "ライブのカラコレでは、補正要因が同じ画に重なる。混ざったままでは戻せないが、粒度に分ければ独立に制御できる。",
    alt: "左半分に補正要因が緩く混ざるカオス、右半分にカメラ単位から作品単位までの5段に整列した状態を示す左右対比の横長図解",
    aspect: { width: 1536, height: 1024 },
    intro: "混ぜたら迷う。粒度に分けると制御できる。",
    chaosHeading: "混ざると迷宮",
    chaosLabels: [
      "カメラの種類",
      "露出",
      "色温度",
      "VEさんのアイリスフォロー",
      "肌色の一貫性",
      "スモークで生まれる大気の色",
      "作品全体のトーン",
      "曲ごとの方向性",
    ],
    structuredHeading: "分けると制御できる",
    structuredLayers: [
      { label: "カメラ単位", sublabel: "カメラ差を揃える" },
      { label: "フレーム単位", sublabel: "露出を追う" },
      { label: "アングル単位", sublabel: "色味を揃える" },
      { label: "シーン単位", sublabel: "トーンを設計する" },
      { label: "作品単位", sublabel: "ルックを当てる" },
    ],
  },
  "grading-look-decomposition": {
    slug: "grading-look-decomposition",
    layout: "centered-axes",
    title: "Look Decomposition 4軸マップ",
    caption:
      "ルックは独立した4軸の合成。中心の作品ルックから、色相弧・濃度バー・S曲線・RGB3ビームへ等しい重みで手が伸びる足場。",
    alt: "中心に作品のルックを置き、色相弧・濃度バー・S曲線・RGB3ビームの4軸が等重みで放射状に分かれることを示す抽象図解",
    aspect: { width: 1536, height: 1024 },
    intro: "中心 → 4軸の順で読む。ルックは独立した4軸の合成として扱える。",
    centerLabel: "作品のルック",
    centerSubLabel: "監督の言葉が、ここに落ちる",
    axesHeading: "4 軸（等重み）",
    axes: [
      {
        label: "色相弧",
        sublabel: "色の広がり・転がり",
      },
      {
        label: "濃度バー",
        sublabel: "どこをどれだけ重く",
      },
      {
        label: "S 曲線",
        sublabel: "トーンの肩・トー",
      },
      {
        label: "RGB 3 ビーム",
        sublabel: "カラーバランス",
      },
    ],
    hintHeading: "軸独立性",
    hints: [
      "軸同士は交差しない",
      "色だけで意味を区別しない（軸位置と末端表象で区別）",
    ],
  },
  "filmlook-physics-flow": {
    slug: "filmlook-physics-flow",
    layout: "horizontal-flow-8",
    title: "フィルムルックを作る物理の 8 段フロー",
    caption:
      "フィルムルックは雰囲気ではなく、入力 → 内部 → 出力の物理連鎖として読み直せる。デジタル信号と露光が左、フィルム内部の 5 段が中央、最終ルックが右に収束する。",
    alt: "デジタル信号と露光の入力 2 段、3 層の染料・分光密度曲線・S 字カーブ・プリンタ光・グレインのフィルム内部 5 段、最終ルックの出力 1 段が左から右へ等間隔で並ぶ 8 段フロー図解",
    aspect: { width: 1536, height: 1024 },
    intro: "左→右で読む。入力 2 段 → フィルム内部 5 段 → 出力 1 段の物理パイプライン。",
    flowHeading: "物理の 8 段フロー",
    steps: [
      { label: "デジタル信号", sublabel: "入力", group: "input" },
      { label: "露光", sublabel: "入力", group: "input" },
      { label: "3 層の染料", sublabel: "フィルム内部", group: "internal" },
      { label: "分光密度曲線", sublabel: "フィルム内部", group: "internal" },
      { label: "S 字カーブ", sublabel: "フィルム内部", group: "internal" },
      { label: "プリンタ光", sublabel: "フィルム内部", group: "internal" },
      { label: "グレイン", sublabel: "フィルム内部", group: "internal" },
      { label: "最終ルック", sublabel: "出力", group: "output" },
    ],
    takeaway: "フィルムルックは、物理の流れで読める。",
  },
  "correction-scope-map": {
    slug: "correction-scope-map",
    layout: "keypoint-row",
    title: "粒度 = 適用範囲",
    caption:
      "同じ補正でも、どこまで効くかは粒度ごとに違う。5段を並べると、混ぜてはいけない理由が分かる。",
    alt: "カメラ単位、フレーム単位、アングル単位、シーン単位、作品単位の5段それぞれが支配する適用範囲を、5段の同心円クラスタで示すヒーロービジュアルに並ぶキーポイント図解",
    aspect: { width: 1536, height: 1024 },
    intro: "粒度 = 適用範囲。",
    itemsHeading: "粒度 = 適用範囲",
    items: [
      {
        glyph: "scope",
        label: "カメラ単位",
        sublabel: "同じカメラ全カットに効く",
      },
      {
        glyph: "scope",
        label: "フレーム単位",
        sublabel: "同条件 ±EV の 1 枚ぶん",
      },
      {
        glyph: "scope",
        label: "アングル単位",
        sublabel: "同アングル別テイクに効く",
      },
      {
        glyph: "scope",
        label: "シーン単位",
        sublabel: "シーン全体のトーンに効く",
      },
      {
        glyph: "scope",
        label: "作品単位",
        sublabel: "作品全体のルックに効く",
      },
    ],
    takeaway: "粒度を取り違えると、迷宮に戻る。",
  },
  "correction-exposure-bracket": {
    slug: "correction-exposure-bracket",
    layout: "photo-strip",
    title: "露出ブラケット — フレーム単位で追う",
    caption:
      "同じカメラ・同じアングル・同じチャートでも、露出が ±2EV 動けば信号は別物になる。だから露出はフレーム単位で追う必要がある。",
    alt: "ColorChecker チャートを 5 段階の露出 ( -2EV / -1EV / 0 / +1EV / +2EV ) で撮影した実写写真 5 枚を横一列に並べた図解",
    aspect: { width: 1536, height: 1024 },
    intro: "同条件でも露出だけが動くと、フレーム単位で追う必要がある。",
    itemsHeading: "5 段の露出ブラケット",
    photos: [
      { src: "/demo/-2STOP.jpg", label: "-2EV", sublabel: "アンダー" },
      { src: "/demo/-1STOP.jpg", label: "-1EV", sublabel: "" },
      { src: "/demo/%E3%83%81%E3%83%A3%E3%83%BC%E3%83%88%E3%83%8E%E3%83%BC%E3%83%9E%E3%83%AB.jpg", label: "0", sublabel: "ノーマル" },
      { src: "/demo/%2B1STOP.jpg", label: "+1EV", sublabel: "" },
      { src: "/demo/%2B2STOP.jpg", label: "+2EV", sublabel: "オーバー" },
    ],
    takeaway: "露出はフレーム単位で動く。粒度を取り違えない。",
  },
  "correction-control-math": {
    slug: "correction-control-math",
    layout: "quad-cards",
    title: "プライマリは、ただの算数",
    caption:
      "暗部・中間・明部・全帯の 4 つのノブは、それぞれ加算 / べき乗 / 乗算 / 複合という算数オペに対応している。難しいテクニックではなく、4 つの算数。",
    alt: "Lift / Gamma / Gain / Offset の 4 つのプライマリコントロールが、加算・べき乗・乗算・複合の 4 種類の算数オペに対応する 2x2 カード行列の図解",
    aspect: { width: 1536, height: 1024 },
    intro: "あるのは算数だけ。4 つのノブ = 4 つの操作。",
    itemsHeading: "4 ノブ × 4 算数オペ",
    items: [
      {
        label: "Lift",
        opLabel: "加算 (+)",
        scopeLabel: "暗部に効く",
        sublabel: "黒側を持ち上げる / 沈める",
      },
      {
        label: "Gamma",
        opLabel: "べき乗 (^γ)",
        scopeLabel: "中間に効く",
        sublabel: "中間調の重さを変える",
      },
      {
        label: "Gain",
        opLabel: "乗算 (×)",
        scopeLabel: "明部に効く",
        sublabel: "白側のスケールを動かす",
      },
      {
        label: "Offset",
        opLabel: "全帯一律 (+)",
        scopeLabel: "全帯に効く",
        sublabel: "信号を丸ごと上下に平行移動",
      },
    ],
    takeaway: "4 つの算数で、ほとんどの一次補正は組み立てられる。",
  },
  "correction-reversibility-compare": {
    slug: "correction-reversibility-compare",
    layout: "compare-pair",
    title: "戻しやすさは、構造で決まる",
    caption:
      "乗算だけで組んだ補正は順序を入れ替えても戻せる。一方、加算とべき乗を入れ子にした補正は、後段から開いても元には戻らない。くすみは、この入れ子構造の中で生まれる。",
    alt: "左に乗算中心の clean / reversible な 1 段ノード列、右に加算とべき乗が入れ子になった nested / irreversible な多段ノード列を置いた、戻しやすさの左右対比図解",
    aspect: { width: 1536, height: 1024 },
    intro: "乗算は戻せる。加算とべき乗の入れ子は戻せない。",
    cleanSide: {
      heading: "Clean / Reversible",
      verdict: "戻せる",
      nodes: [
        { label: "Gain (×)", sublabel: "明部のスケール" },
        { label: "Gain (×)", sublabel: "色味の倍率" },
        { label: "Gain (×)", sublabel: "全体ゲイン" },
      ],
    },
    nestedSide: {
      heading: "Nested / Irreversible",
      verdict: "戻しにくい",
      nodes: [
        { label: "Lift (+)", sublabel: "暗部を加算で持ち上げる" },
        { label: "Gamma (^γ)", sublabel: "持ち上げた暗部にべき乗をかける" },
        { label: "Lift (+)", sublabel: "さらに加算で被せる" },
        { label: "Gamma (^γ)", sublabel: "もう一度べき乗を入れ子にする" },
      ],
    },
    takeaway: "乗算中心は戻る。加算とべき乗の入れ子は、くすみとして残る。",
  },
  "correction-space-choice": {
    slug: "correction-space-choice",
    layout: "triple-compare",
    title: "ログ / リニア / ガンマ — 操作する空間の選び方",
    caption:
      "同じ補正でも、どの空間で操作するかで結果が変わる。ログは収録のままで広いが操作感が物理から外れる。リニアは光に正直だが扱いにくい。ガンマは物理に近く、人の目にも合い、実務では一番扱いやすい。",
    alt: "Log / Linear / Gamma の 3 空間を、操作感・信号範囲・色抽出のしやすさの 3 行で横並びに比較する 3 列対比図解",
    aspect: { width: 1536, height: 1024 },
    intro: "リニアとガンマは光の物理に乗りやすい。実務はガンマ空間が扱いやすい。",
    itemsHeading: "3 空間の比較",
    rowLabels: {
      feel: "操作感",
      range: "信号範囲",
      extraction: "色抽出",
    },
    columns: [
      {
        label: "Log",
        feel: "オフセット ≒ 露出 (近似)",
        range: "とても広い (収録ネイティブ)",
        extraction: "肌・空などの色抽出は難しい",
        verdict: "広いが操作感は物理から外れる",
      },
      {
        label: "Linear",
        feel: "ゲイン = 露出 (厳密)",
        range: "広い (光に正直)",
        extraction: "色抽出は素直だが、トーンの感覚が掴みにくい",
        verdict: "光の物理には正直、ただし扱いにくい",
      },
      {
        label: "Gamma",
        feel: "人の目に近く、操作感が直感的",
        range: "実務に十分 (2.2 / 2.4 / 2.6)",
        extraction: "色抽出も自然で扱いやすい",
        verdict: "実務上は一番扱いやすい",
      },
    ],
    takeaway: "迷ったらガンマ空間。物理に近く、目にも合う。",
  },
  "filmlook-density-mixture": {
    slug: "filmlook-density-mixture",
    layout: "chaos-vs-structured",
    title: "フィルムらしさ = 濃度 + 色の混ざり",
    caption:
      "フィルム固有の差は、ルック 4 軸のうち縦軸 (濃度) と横軸 (色の混ざり) の二軸に集約される。残り 2 軸は結果として動くだけ。",
    alt: "左半分に縦方向の濃度 wedge と S 字カーブ、右半分に 3 層染料のヴェン状重なりと RGB 3 ビームを置き、濃度と色の混ざりの 2 軸を左右で対比する図解",
    aspect: { width: 1536, height: 1024 },
    intro: "フィルムの正体は、二軸に絞れる。",
    chaosHeading: "濃度（縦軸）",
    chaosLabels: ["暗部の粘り", "S 字の肩", "対数応答"],
    structuredHeading: "色の混ざり（横軸）",
    structuredLayers: [
      { label: "3 層染料" },
      { label: "分光密度曲線" },
      { label: "DIR カプラー" },
      { label: "プリンター光" },
    ],
  },
}

const MARKER_RE = /^\[\[diagram:([a-z0-9_-]+)\]\]$/i

export function parseDiagramMarker(text: string): string | null {
  const m = text.trim().match(MARKER_RE)
  return m ? m[1] : null
}

export function getDiagramConfig(slug: string): DiagramConfig | null {
  return DIAGRAM_REGISTRY[slug] ?? null
}
