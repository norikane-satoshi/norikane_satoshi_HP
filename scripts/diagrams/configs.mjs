/**
 * Notion 本文の [[diagram:<slug>]] marker から呼び出す図解の生成設定。
 *
 * 設計方針 (2026-04-29 改訂、図解仕様書 v3 = 8b38762c に同期):
 *   - HP 実コード (src/app/globals.css) の Glass Design System が正本。
 *     背景 = --bg-base #F8F6FF (白〜ごく薄いラベンダー)、アクセント = --accent-primary #8B7FFF。
 *     aurora は 3 色のみ ── --aurora-purple rgba(139,127,255,0.28) /
 *     --aurora-pink rgba(255,143,171,0.20) / --aurora-sky rgba(125,211,252,0.20)。
 *     orange / teal / 緑系は HP 実装に存在しない。新規色相を発明しない。
 *   - 1 図 = 1 主張。背景画像は構図と気分だけを担い、ラベル・番号・小箱・グリフは
 *     note-diagram.tsx 側 (glass トークン) で確定させる役割分担。
 *   - GPT Image 2 に任せるのは背景の構図・質感・余白だけ。
 *     画像内に文字 (kana / kanji / ascii / 数字) ・記号・矢印・UI 要素・ロゴは絶対に描かせない。
 *   - リポジトリ内の AGENTS.md にあるニューモーフィズム記述は実装と乖離しているため無視。
 *
 * 各 slug ごとに以下を持つ:
 *   - referenceAssets.used: 構図・トーン・形状の根拠としたローカル素材
 *     (どの素材をどの図のどの部分に反映したかは prompt と generationRationale に明記)
 *   - referenceAssets.checkedButNotUsed: 仕様書に名前があるが直接寄与しない素材
 *   - sourceSpecNotionUrl / sourceSpecSummary
 *   - targetArticleNotionUrl
 *   - overlayLabels: HP 側で HTML/CSS で後載せするラベル
 *   - successCriteria: 仕様書「成功基準」をそのまま転記
 *   - generationRationale: prompt が仕様書とローカル素材をどう満たすかの記録
 */

const COMMON_NEGATIVE = [
  "STRICT NEGATIVE CONSTRAINTS — do NOT include any of the following:",
  "text, letters, words, numbers, captions, labels, titles, sentences, characters in any language",
  "(especially Japanese kana / kanji / Latin / numerals),",
  "UI elements, icons with letters, logos, watermarks, signatures,",
  "button shapes, screenshots, photos of people, faces, hands,",
  "arrows, arrowheads, connectors, callouts,",
  "dark backgrounds, navy or charcoal fills, heavy black, neon-on-black aesthetics, cinematic noir,",
  "saturated bold colors, vivid orange, teal, green, hard outlines, thick borders, busy compositions.",
].join(" ")

const COMMON_STYLE = [
  "Light, airy editorial illustration aligned with the host site's Glass Design System.",
  "Background is overwhelmingly bright: a calm white-to-soft-lavender canvas (~#F8F6FF) with very subtle aurora gradients used only as quiet directional light.",
  "Palette is strictly limited to the HP tokens: base #F8F6FF, accent #8B7FFF (soft lavender purple),",
  "and the three aurora washes ── aurora-purple ~rgba(139,127,255,0.28), aurora-pink ~rgba(255,143,171,0.20), aurora-sky ~rgba(125,211,252,0.20).",
  "All other colors (orange / teal / green / vivid saturated tones) are forbidden — they are not part of the HP implementation.",
  "Compositions feel spacious and uncluttered: generous negative space (at least 35% of the frame), few elements, low color count, soft thin lines, no thick borders.",
  "Contrast is tuned for in-article reading: shapes are visible but never demand attention — they are scaffolding only; HTML labels, numbers, and small boxes are overlaid in post by note-diagram.tsx.",
  "Output: 16:9 horizontal banner that sits inside an article body column, comfortably readable next to body text.",
].join(" ")

export const DIAGRAM_GEN_CONFIGS = {
  "correction-factor-map": {
    sourceSpecNotionUrl: "https://www.notion.so/8b38762c77fc4a048787c83ee7e8cb56",
    targetArticleNotionUrl: "https://www.notion.so/1510399661d64891aee912320df39b91",
    sourceSpecSummary:
      "図解仕様書 v3 (2026-04-29 / 8b38762c) chaos-vs-structured。主張『混ざると迷宮 / 分けると制御できる』。左半=ゆるく交差する 8 本の細い帯テクスチャ、中央=細い luminous seam、右半=水平バンドの陰影 5 段。色域は #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) のみ。文字・記号・矢印は note-diagram.tsx 側で描画。",
    overlayLabels: [
      "混ざると迷宮",
      "カメラの種類",
      "露出",
      "色温度",
      "VEさんのアイリスフォロー",
      "肌色の一貫性",
      "スモークで生まれる大気の色",
      "作品全体のトーン",
      "曲ごとの方向性",
      "分けると制御できる",
      "カメラ単位",
      "フレーム単位",
      "アングル単位",
      "シーン単位",
      "作品単位",
      "混ぜたら迷う。粒度に分けると制御できる。",
    ],
    successCriteria: [
      "左半分=混線/右半分=整列、の左右対比が一目で読める",
      "左半の 8 本リボンが重なって混ざっている感覚が伝わる",
      "右半の 5 段水平バンドが等高・等幅で揃って見える",
      "中央の luminous seam が左右の境界を補助している (主役にはならない)",
      "HTML overlay の左右ヘッダー + 8 chaosLabels + 5 structuredLayers が乗る空白がある",
      "色域が #F8F6FF + #8B7FFF + aurora 3 色だけで構成され、orange / teal が出てこない",
    ],
    referenceAssets: {
      used: [
        "public/slides/11分解と整理によるアプローチ.png",
        "public/slides/5複合操作の影響と復元性.png",
        "public/demo/+2STOP.jpg",
        "public/demo/+1STOP.jpg",
        "public/demo/チャートノーマル.jpg",
        "public/demo/-1STOP.jpg",
        "public/demo/-2STOP.jpg",
      ],
      checkedButNotUsed: [
        {
          path: "public/slides/4プライマリーコントロール概要.png",
          reason: "コントロール粒度参考だが、本図解の「混線→粒度」軸とはレイヤーが異なるので不採用",
        },
      ],
    },
    generationRationale: [
      "v3 (2026-04-29 / 8b38762c) chaos-vs-structured 左右対比に再アライン。",
      "左半: 8 要因の細い帯がゆるく交差する柔らかいテクスチャ。slides/11 の三幕構成『分解前』を抽象化。帯の太さ/透明度のばらつきは demo の ±STOP 露出ブラケットを反映。",
      "中央: 細い luminous seam (ハードラインなし)。左右の境界を示すだけで、漏斗のように主張しない。",
      "右半: 5 段の水平バンドの陰影。上から per-camera / per-frame / per-angle / per-scene / per-project の支配域を均等高さで配置 (HTML 5 ラベル + サブラベルが乗る前提)。",
      "色域は HP 実コードのトークンに同期: #F8F6FF base、#8B7FFF accent、aurora purple/pink/sky の 3 色のみ。",
      "両半は同じ縦幅・同じ余白。",
    ].join(" "),
    size: "1536x1024",
    quality: "high",
    output_format: "webp",
    prompt: [
      COMMON_STYLE,
      "DESIGN INTENT — chaos-vs-structured: two states placed side by side. Left half = entangled mix. Right half = sorted into 5 calm horizontal bands. Both halves share the same vertical area and identical breathing space.",
      "Background: bright white-to-soft-lavender canvas (~#F8F6FF) with very faint aurora wash (purple / pink / sky only).",
      "Composition rule: the frame is split into two equal halves by a thin luminous seam at the horizontal center. No hard line — just a quiet brighter ridge (subtle aurora-pink hairline) so the eye reads the seam as a soft boundary. Identical top and bottom margins on both halves.",
      "LEFT HALF (state A — 'mixed') — EIGHT slender translucent ribbons drift loosely and gently CROSS each other in a relaxed cluster around the middle of the half. Each ribbon represents one mixed correction factor (camera type, exposure, color temperature, VE iris-follow, skin-tone consistency, smoke-born atmospheric color, overall film tone, per-song direction). Ribbons use ONLY the HP palette: faint aurora-purple body, with occasional aurora-pink and aurora-sky tints, and the lavender accent #8B7FFF as the most saturated note. Ribbon thickness and opacity vary subtly to echo the +2 / +1 / normal / -1 / -2 STOP exposure bracket — a quiet non-uniform vibration, not chaos. The ribbons read as 'mixed but bright' — never crashed-dark, never warm-peach, never teal.",
      "MIDDLE SEAM — a single quiet luminous ridge running top-to-bottom, slightly brighter than the rest of the canvas. No arrowheads, no funnel walls, no hard boundaries. The ridge is built from the aurora-pink wash only, kept extremely subtle.",
      "RIGHT HALF (state B — 'sorted') — FIVE clean horizontal bands stacked top-to-bottom with generous breathing space between them. Each band is a thin softly-glowing horizon line of subtle aurora gradient (top band uses aurora-purple, second mixes purple-into-pink, middle is pure aurora-pink, fourth blends pink-into-sky, bottom is aurora-sky). All five bands are IDENTICAL in height, length, and spacing — equal-weight is critical because HTML labels of identical size will sit one per band. Each band casts a faint diffused shadow of the same aurora hue as itself.",
      "Empty negative space (>= 35% of frame) above, below, and between the two halves so HTML overlay (left header '混ざると迷宮', right header '分けると制御できる', 8 chaosLabels stacked along the left, and 5 structured-layer labels with sublabels per band on the right) lands cleanly.",
      "Visual reference (tone only, do not reproduce any text): public/slides/11分解と整理によるアプローチ.png (calm three-act feel) and public/slides/5複合操作の影響と復元性.png (sober contrast tone — adopt the rhythm, not the dark aesthetic).",
      "No arrows, no symbols, no glyphs, no text, no UI elements, no orange, no teal.",
      COMMON_NEGATIVE,
    ].join(" "),
  },

  "correction-scope-map": {
    sourceSpecNotionUrl: "https://www.notion.so/8b38762c77fc4a048787c83ee7e8cb56",
    targetArticleNotionUrl: "https://www.notion.so/1510399661d64891aee912320df39b91",
    sourceSpecSummary:
      "図解仕様書 v3 (2026-04-29 / 8b38762c) keypoint-row。主張『粒度 = 適用範囲』。ヒーロービジュアルとして 5 段の同心円クラスタが奥から手前へ柔らかく重なる。色域は #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) のみ。文字・番号・グリフは note-diagram.tsx 側で描画。",
    overlayLabels: [
      "粒度 = 適用範囲",
      "カメラ単位",
      "フレーム単位",
      "アングル単位",
      "シーン単位",
      "作品単位",
      "粒度を取り違えると、迷宮に戻る。",
    ],
    successCriteria: [
      "5 段の同心円クラスタが奥から手前へ柔らかく重なるヒーロービジュアルとして読める",
      "「粒度 = 適用範囲」が一目で伝わる",
      "色域が #F8F6FF + #8B7FFF + aurora 3 色だけで構成され、orange / teal / 高彩度色が出てこない",
      "HTML overlay の itemsHeading + 5 items + takeaway が乗る空白がある",
      "correction-factor-map (chaos-vs-structured) と並べたときに、形状で補完関係になる (左右対比 vs ヒーロー同心円)",
    ],
    referenceAssets: {
      used: [
        "public/slides/11分解と整理によるアプローチ.png",
        "public/slides/5複合操作の影響と復元性.png",
      ],
      checkedButNotUsed: [
        {
          path: "public/slides/4プライマリーコントロール概要.png",
          reason: "コントロール粒度よりも適用範囲(支配範囲)を視覚化したいので不採用",
        },
      ],
    },
    generationRationale: [
      "v3 (2026-04-29 / 8b38762c) keypoint-row のヒーロービジュアルに再アライン。",
      "5 段の同心円クラスタが奥から手前へ柔らかく重なる構図に変更 (旧版の左→右 5 個並びは廃止)。各リングが順次広がり、奥側=narrow scope (per-camera) → 手前=broad scope (per-project) の支配域拡大を暗示する。",
      "factor-map (chaos-vs-structured) の左右対比とは別形状 (奥行きのある同心円重なり) で補完関係。",
      "色域は HP 実コードのトークンに同期: #F8F6FF base、#8B7FFF accent、aurora purple/pink/sky の 3 色のみ。",
      "ラベル・番号・グリフは note-diagram.tsx の keypoint-row 側で全て描画する役割分担なので、画像はヒーロー背景として気分だけを担う。",
    ].join(" "),
    size: "1536x1024",
    quality: "high",
    output_format: "webp",
    prompt: [
      COMMON_STYLE,
      "DESIGN INTENT — A hero-style background visual for a keypoint-row diagram about 'scope = grain'. FIVE concentric-ring clusters that softly overlap from back to front, suggesting how the same correction reaches a wider area at coarser grain. The image is background only — labels, numbers, and small boxes are NOT drawn here; they are overlaid in HTML by note-diagram.tsx.",
      "Background: bright white-to-soft-lavender canvas (~#F8F6FF) with very faint aurora wash (purple / pink / sky only).",
      "FIVE concentric-ring clusters share a roughly common center (slightly off-center to the left so the right side has breathing space), arranged so the smallest cluster sits in the deepest layer and the largest cluster sits in the front layer. The clusters overlap softly, with translucency creating gentle depth — never hard-edged. Each cluster is built from 2-3 thin softly-glowing rings of the same aurora hue.",
      "Cluster 1 (back, smallest, narrow per-camera scope) — aurora-purple thin rings.",
      "Cluster 2 — purple-blending-into-pink rings.",
      "Cluster 3 (middle) — aurora-pink rings, with the lavender accent #8B7FFF as a quiet inner highlight.",
      "Cluster 4 — pink-blending-into-sky rings.",
      "Cluster 5 (front, largest, broad project-wide scope) — aurora-sky rings, very pale.",
      "All clusters are open thin outlines — NO filled disks, NO hard borders, NO thick strokes. The overlap regions deepen to a slightly more saturated lavender-pink-sky blend without ever becoming dark.",
      "Negative space: keep the right ~30% of the canvas mostly empty so the HTML overlay (heading '粒度 = 適用範囲', 5 grid items with monospace numbers, and the takeaway line) lands cleanly. The top edge and bottom edge also stay soft and uncluttered.",
      "Visual reference (tone only): public/slides/11分解と整理によるアプローチ.png and public/slides/5複合操作の影響と復元性.png — inherit the calm structural feel.",
      "No arrows, no symbols, no glyphs, no text, no orange, no teal.",
      COMMON_NEGATIVE,
    ].join(" "),
  },

  "grading-look-decomposition": {
    sourceSpecNotionUrl: "https://www.notion.so/8b38762c77fc4a048787c83ee7e8cb56",
    targetArticleNotionUrl: "https://www.notion.so/2d61194573e140789602864a9040affe",
    sourceSpecSummary:
      "図解仕様書 v3 (2026-04-29 / 8b38762c) grading-look-decomposition。layout=centered-axes。主張『ルックは独立した4軸の合成』。中心に soft glowing orb、四方向 (upper-left / upper-right / lower-left / lower-right) に等重み・等長の柔らかい光の帯が伸びる。色域は #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) のみ。文字・番号・グリフは note-diagram.tsx 側で描画。",
    overlayLabels: [
      "作品のルック",
      "監督の言葉が、ここに落ちる",
      "色相弧",
      "濃度バー",
      "S 曲線",
      "RGB 3 ビーム",
      "軸独立性",
    ],
    successCriteria: [
      "中心 + 4 方向放射のヒーロービジュアルとして読める",
      "4 軸が等重み (等長・等線幅) で並んで見える",
      "色域が #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) だけで構成され、orange / teal / warm peach / muted teal が出てこない",
      "HTML overlay の中心ラベル + 4 軸ラベル + ヒントリストが乗る空白がある",
      "correction-factor-map (左右対比) や grading-words-to-knobs (横フロー) と並べたとき、形状で補完関係になる (放射 vs 横並び)",
    ],
    referenceAssets: {
      used: [
        "public/slides/7カラーグレーディングのフレームワーク.png",
        "public/slides/10カラーグレーディングのフレームワーク - まとめ.png",
        "public/slides/8フレームワーク関連コントロール.png",
        "public/slides/3カラーグレーディングの基本概念.png",
      ],
      checkedButNotUsed: [
        {
          path: "~/Library/CloudStorage/GoogleDrive-norikane.satoshi@gmail.com/マイドライブ/ルックコミュニケーションツール（仮名） — ピッチスライド.gslides",
          reason: "ツールビジョン資料 (27枚) で、Look Decomposition 概念図そのものは含まれない。中心+4軸構図の下敷きにはならないので不採用。",
        },
        {
          path: "~/Library/CloudStorage/GoogleDrive-norikane.satoshi@gmail.com/マイドライブ/mars_queen_grading_workflow_20260112094639.gslides",
          reason: "実プロジェクトのワークフロー図。4軸構造とは別の関心事 (作業順序) なので不採用",
        },
      ],
    },
    generationRationale: [
      "v3 (2026-04-29 / 8b38762c) grading-look-decomposition (centered-axes) に再アライン。AI 画像は中心+4軸の放射構図で、気分・空気感だけを担う背景レイヤー。軸末端のコントロール表象 (色相弧 / 濃度バー / S曲線 / RGB3ビーム) は note-diagram.tsx 側のラベルで意味付けし、画像内には文字・番号・矢印を描かない。",
      "slides/7 → 中心+周辺軸の framework 構図を継承。",
      "slides/10 → 4 軸が等重み (等長・等線幅) で並ぶ整列感を、4 方向の柔らかい光の帯の太さ・長さを揃えることで反映。",
      "slides/8 → 各軸が「具体的なコントロールに対応する」感覚を、各軸末端の極めて控えめな表象 (色相弧フラグメント / 短い縦バンド3本 / 緩いS字ライン / 平行ビーム3本) に反映。すべて aurora 3 色のみ。",
      "slides/3 → 軸同士が交差せず独立に描かれる構図に反映。",
      "色域は HP 実コードのトークンに同期: #F8F6FF base、#8B7FFF accent、aurora purple/pink/sky の 3 色のみ。orange / teal / warm peach / muted teal は実装に存在しないため除去。",
    ].join(" "),
    size: "1536x1024",
    quality: "high",
    output_format: "webp",
    prompt: [
      COMMON_STYLE,
      "DESIGN INTENT — Look Decomposition centered-axes hero background. ONE luminous central orb at the geometric center of the frame, with FOUR equal-weight soft glowing axis bands radiating toward upper-left, upper-right, lower-left, lower-right. The image is background only — labels, numbers, and small boxes are NOT drawn here; they are overlaid in HTML by note-diagram.tsx (centered-axes layout).",
      "Background: bright white-to-soft-lavender canvas (~#F8F6FF) with very faint aurora wash (purple / pink / sky only). No dark fills, no cinematic noir.",
      "CENTER — a soft glowing orb, bright and pale, distilling the 'look of a film' into one luminous nucleus. The orb body is built ONLY from the HP palette: a quiet blend of aurora-purple core, aurora-pink mid, aurora-sky outer halo, with the lavender accent #8B7FFF as the most saturated note at the very center. Abstract — no eyes, no faces, no scenery, no warm peach, no teal.",
      "FOUR RADIAL AXIS BANDS — extending outward toward upper-left, upper-right, lower-left, lower-right at roughly 45 degree angles. The four bands have IDENTICAL length, identical line weight, identical opacity, and identical end-cap size, so they read as equal-weight at a glance (slides/10 'まとめ' rule of equal weight).",
      "AXIS 1 (upper-left, hue arc) — a thin softly-glowing band that terminates in a small soft chromatic arc fragment using aurora-purple-into-pink hint of hue rotation. No saturated colors, no full color wheel.",
      "AXIS 2 (upper-right, density bar) — a thin softly-glowing band that terminates in a small stack of three short vertical translucent bars of varying luminance (all built from aurora-purple at different opacities). No warm peach.",
      "AXIS 3 (lower-left, S-curve) — a thin softly-glowing band that terminates in a small smooth S-shaped luminous line drawn in aurora-pink over a faint pale lavender plane.",
      "AXIS 4 (lower-right, RGB 3 beams) — a thin softly-glowing band that terminates in three short faint parallel beams using aurora-purple, aurora-pink, aurora-sky (one per beam) gently shifting an underlying soft plane. NO orange, NO teal, NO warm peach.",
      "The four axis bands connect to the central orb via thin softly-glowing filaments. Axes never cross each other (slides/3 'independent axes' rule). Plenty of empty negative space (>= 35% of frame) between axes so HTML labels overlay cleanly.",
      "Tone: calm, structural, framework-like. Use ONLY the HP palette: base #F8F6FF, accent #8B7FFF, aurora purple/pink/sky. No vivid saturated colors. No arrows, no symbols, no glyphs, no text.",
      "Visual reference (tone only, do not reproduce any text): public/slides/7カラーグレーディングのフレームワーク.png (center+axes structure), public/slides/10カラーグレーディングのフレームワーク - まとめ.png (equal-weight 4-axis layout), public/slides/8フレームワーク関連コントロール.png (axis-end control glyph feel), public/slides/3カラーグレーディングの基本概念.png (independent axes).",
      COMMON_NEGATIVE,
    ].join(" "),
  },

  "grading-words-to-knobs": {
    sourceSpecNotionUrl: "https://www.notion.so/8b38762c77fc4a048787c83ee7e8cb56",
    targetArticleNotionUrl: "https://www.notion.so/2d61194573e140789602864a9040affe",
    sourceSpecSummary:
      "図解仕様書 v3 (2026-04-29 / 8b38762c) grading-words-to-knobs。layout=horizontal-flow。主張『言葉 → 軸 → 操作 の 3 段ホップ』。4 列の柔らかい縦バンドが等幅で並び、上から下へ『さざ波 → 断片 → 細い帯』と段階的に変化する横フロー。色域は #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) のみ。文字・番号・矢印は note-diagram.tsx 側で描画。",
    overlayLabels: [
      "言葉 → 軸 → 操作",
      "「もう少し暖かく」",
      "「もう少し抜けを」",
      "「青を深く」",
      "「映画っぽく」",
      "色相弧の方向に振る",
      "濃度バーで暗部を整理する",
      "RGB 3 ビームで青のバランスを下げる",
      "S 曲線の肩を作る",
      "監督の言葉は、4 軸のどこかに落ちる。",
    ],
    successCriteria: [
      "4 列の縦バンドが等幅・等高で並んで見える (3 段ホップの土台として読める)",
      "各列の上 (さざ波) → 中 (断片) → 下 (細い帯) の段階変化が一目で分かる",
      "色域が #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) だけで構成され、orange / teal / warm peach / muted teal が出てこない",
      "HTML overlay の flowHeading + 4 列ラベル + takeaway が乗る空白がある",
      "grading-look-decomposition (中心+4軸の放射) と並べたとき、形状で補完関係になる (放射 vs 横並び 3 段ホップ)",
    ],
    referenceAssets: {
      used: [
        "public/slides/8フレームワーク関連コントロール.png",
        "public/slides/7カラーグレーディングのフレームワーク.png",
      ],
      checkedButNotUsed: [
        {
          path: "public/slides/3カラーグレーディングの基本概念.png",
          reason: "前提知識スライド。3段ホップ構図とは別レイヤーなので不採用",
        },
      ],
    },
    generationRationale: [
      "v3 (2026-04-29 / 8b38762c) grading-words-to-knobs (horizontal-flow) に再アライン。AI 画像は 4 列の縦バンド + 段階変化を担う背景レイヤーで、文字・番号・矢印は描かない。",
      "slides/8 → 「コントロール = ノブ・スライダー・ホイール」の表象を、各列下段の細い帯 (knob / slider 抽象) に反映。ただし aurora 3 色のみで描く。",
      "slides/7 → 「フレームワーク = 軸の整列」感を、4 列を等幅・等高で並べることで反映。",
      "grading-look-decomposition との重複回避: あちらは 1 中心+4 軸の放射、こちらは 4 列の縦並び 3 段ホップ (さざ波 → 断片 → 細い帯)。構図形状で補完関係。",
      "色域は HP 実コードのトークンに同期: #F8F6FF base、#8B7FFF accent、aurora purple/pink/sky の 3 色のみ。orange / teal / warm peach / muted teal は実装に存在しないため除去。",
    ].join(" "),
    size: "1536x1024",
    quality: "high",
    output_format: "webp",
    prompt: [
      COMMON_STYLE,
      "DESIGN INTENT — A 3-hop translation lane background: spoken word → axis → control. FOUR parallel vertical translation lanes side by side, one per phrase. The image is background only — labels, numbers, arrows, and small boxes are NOT drawn here; they are overlaid in HTML by note-diagram.tsx (horizontal-flow layout).",
      "Background: bright white-to-soft-lavender canvas (~#F8F6FF) with very faint aurora wash (purple / pink / sky only). No dark fills, no cinematic noir.",
      "Layout: FOUR identical-width vertical lanes, equally spaced left to right with generous gaps between lanes. Each lane occupies the full vertical height of the canvas with the same top and bottom margins. Lane width and lane height are IDENTICAL across all four — equal-weight is critical because HTML labels of identical size will sit one per lane.",
      "Each lane has THREE stages stacked top-to-bottom with IDENTICAL vertical spacing across all lanes (so all four lanes' top stages align horizontally, all middle stages align, all bottom stages align). Stages within a lane are visually connected by a single thin vertical softly-glowing filament so the eye reads top-to-bottom.",
      "TOP STAGE (per lane) — a small soft luminous ripple, like a gentle sound wave or speech wave. All four ripples have IDENTICAL size and identical line weight; they differ only in aurora hue: lane 1 = aurora-purple ripple, lane 2 = aurora-pink ripple, lane 3 = aurora-sky ripple, lane 4 = a balanced aurora-purple-into-pink ripple. NO warm peach, NO teal.",
      "MIDDLE STAGE (per lane) — a small abstract fragment of the colorist's framework, drawn ONLY in aurora 3-color palette: lane 1 = a small soft chromatic hue arc fragment (aurora-purple-into-pink), lane 2 = a short vertical density bar stack (aurora-purple at varying opacity), lane 3 = a small 3-beam parallel cluster (aurora-purple / aurora-pink / aurora-sky), lane 4 = a small smooth S-curve segment (aurora-pink). Identical bounding-box size across lanes.",
      "BOTTOM STAGE (per lane) — a small thin softly-glowing horizontal band (knob / slider abstraction) glowing in the lane's destination aurora hue. Identical band length and band height across all four lanes.",
      "Lanes are visually independent — clear empty negative space between lanes. Plenty of empty space (>= 35% of frame) at top, between lanes, and at bottom for HTML labels (flowHeading at top, 4 step labels with sublabels in each lane, takeaway at bottom).",
      "Use ONLY the HP palette: base #F8F6FF, accent #8B7FFF, aurora purple/pink/sky. No arrows, no text, no symbols beyond the abstract ripple/fragment/band shapes. NO warm peach. NO teal. NO muted teal. NO orange. NO green.",
      "Visual reference (tone only, do not reproduce any text): public/slides/8フレームワーク関連コントロール.png (knob/slider feel), public/slides/7カラーグレーディングのフレームワーク.png (equal-weight axis layout).",
      COMMON_NEGATIVE,
    ].join(" "),
  },

  "filmlook-physics-flow": {
    sourceSpecNotionUrl: "https://www.notion.so/8b38762c77fc4a048787c83ee7e8cb56",
    targetArticleNotionUrl: "https://www.notion.so/7202c1ee64c04c97a4821b8e4f2e0f67",
    sourceSpecSummary:
      "図解仕様書 v3 (2026-04-29 / 8b38762c) filmlook-physics-flow。layout=horizontal-flow-8 (新)。主張『フィルムルックは物理の流れで読める』。左から右へ 8 段の柔らかいバンドが等間隔に並び、塊 (入力 1-2 / 内部 3-7 / 出力 8) の境界に少しだけ余白が空く。色域は #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) のみ。文字・記号・矢印は note-diagram.tsx 側で描画。",
    overlayLabels: [
      "物理の 8 段フロー",
      "デジタル信号",
      "露光",
      "3 層の染料",
      "分光密度曲線",
      "S 字カーブ",
      "プリンタ光",
      "グレイン",
      "最終ルック",
      "フィルムルックは、物理の流れで読める。",
    ],
    successCriteria: [
      "8 段の柔らかいバンドが等間隔・等幅で左から右へ並んで見える",
      "塊 (入力 1-2 / 内部 3-7 / 出力 8) の境界に少しだけ余白があり、塊が読み取れる",
      "色域が #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) だけで構成され、orange / teal / warm peach / muted teal が出てこない",
      "HTML overlay の flowHeading + 8 step ラベル + takeaway が乗る空白がある",
      "filmlook-density-mixture (左右二分割) と並べたときに、形状で補完関係になる (時系列フロー vs 二軸の本質抽出)",
    ],
    referenceAssets: {
      used: [
        "../FilmLookEmulator_project/analysis/stage2/wu8_basis_vectors.png",
        "../FilmLookEmulator_project/analysis/stage2/wu8_weight_functions.png",
        "../FilmLookEmulator_project/analysis/stage2/wu8_variance_explained.png",
        "../FilmLookEmulator_project/analysis/stage2/wu8_mean_residual.png",
        "../FilmLookEmulator_project/analysis/phaseE/wu1_plots/svd_spectrum_iems1.png",
        "../FilmLookEmulator_project/analysis/phaseE/wu1_plots/svd_spectrum_rochp.png",
        "../FilmLookEmulator_project/analysis/phaseE/wu1_plots/separability.png",
        "../Tetra_Reverse/ANALYSIS.md",
      ],
      checkedButNotUsed: [
        {
          path: "../FilmLookEmulator_project/analysis/phaseE/wu1_plots/pareto_front.png",
          reason: "別議論 (分離可能性) のプロット。本図解は時系列フローなので不採用",
        },
      ],
    },
    generationRationale: [
      "v3 (2026-04-29 / 8b38762c) filmlook-physics-flow (horizontal-flow-8) に再アライン。AI 画像は 8 段の柔らかいバンドの構図と気分だけを担う背景レイヤーで、文字・番号・矢印・stage 表象は描かない。",
      "wu8_basis_vectors.png → Stage 3 (3 層の染料) のバンドが 3 本の柔らかい層として読める根拠。色は cyan / magenta / yellow ではなく、HP palette の aurora purple / pink / sky に置き換える (実装トークン外の色相は禁止)。",
      "wu8_weight_functions.png → Stage 5 (S 字カーブ) のバンドがゆるい S ライン的なリズムを持つ根拠。",
      "wu8_variance_explained.png → 各バンドの透明度に微差を与える根拠 (重みは等しくない)。ただし bar plot 形状は描かない。",
      "wu8_mean_residual.png → Stage 7 (グレイン) のバンドが非一様な微粒テクスチャを持つ根拠。中間調で密、端で疎。",
      "phaseE/wu1_plots/svd_spectrum_(iems1/rochp).png → Stage 4 (分光密度曲線) のバンドが波長方向に滑らかな波を内包する根拠。",
      "phaseE/wu1_plots/separability.png → 8 段の境界がぼやけすぎず、隣接バンドが識別できる根拠。塊 (入力 / 内部 / 出力) の境界には少しだけ余白を確保。",
      "Tetra_Reverse/ANALYSIS.md → Stage 6 (プリンタ光) を 3 ビーム抽象として描く根拠。aurora purple / pink / sky の 3 ビームに置き換える。",
      "色域は HP 実コードのトークンに同期: #F8F6FF base、#8B7FFF accent、aurora purple/pink/sky の 3 色のみ。orange / teal / warm peach / muted teal は実装に存在しないため除去。",
    ].join(" "),
    size: "1536x1024",
    quality: "high",
    output_format: "webp",
    prompt: [
      COMMON_STYLE,
      "DESIGN INTENT — Background hero for an 8-stage physical pipeline that turns a digital signal into a film look. Left-to-right read. The image is background only — labels, numbers, stage glyphs, and arrows are NOT drawn here; they are overlaid in HTML by note-diagram.tsx (horizontal-flow-8 layout, md:grid-cols-4 4×2 derivative on desktop, single column on mobile).",
      "Background: bright white-to-soft-lavender canvas (~#F8F6FF) with very faint aurora wash (purple / pink / sky only). No dark fills, no cinematic noir, no warm peach, no teal, no green.",
      "Layout: EIGHT softly-glowing vertical bands span the frame from left to right at roughly equal horizontal intervals, each band occupying a similar horizontal slot. Bands 1-2 (input cluster) sit on the left, bands 3-7 (film-internal cluster) in the middle, band 8 (output) on the right. Insert slightly larger gap between band 2 and band 3, and between band 7 and band 8, so the three clusters are subtly readable as separate groups while still feeling like one pipeline.",
      "Each band's body is built ONLY from the HP palette (aurora purple / pink / sky and the lavender accent #8B7FFF), with bright base #F8F6FF showing through. Band hue rotates gently across the 8 slots — bands 1-2 lean aurora-sky (cool input), bands 3-5 mix aurora-purple-into-pink (the film internal), bands 6-7 add the lavender accent #8B7FFF as a quiet highlight, band 8 resolves into a soft balanced aurora orb that is slightly brighter than the others (the resolved final look).",
      "Each band carries a tiny embedded structural hint (background only, no labels): band 3 = three faint stacked horizontal sub-layers (3 dye layers, shape from FilmLookEmulator wu8_basis_vectors.png), band 4 = faint smooth wavelength-like ridges (shape from phaseE/wu1_plots/svd_spectrum_iems1 / svd_spectrum_rochp), band 5 = one gentle S-shaped luminous ridge (shape from wu8_weight_functions), band 6 = three short faint parallel filaments (printer light, hue = aurora purple / pink / sky, NO warm peach, NO teal), band 7 = delicate non-uniform fine-grain texture (denser in the middle, sparser at edges; shape from wu8_mean_residual). All hints are extremely subtle — each band still reads first as a soft vertical band.",
      "A single thin softly-glowing horizontal flow filament passes through all eight bands at the vertical center so the banner reads as one pipeline. The filament is built from the lavender accent #8B7FFF at low opacity. No arrowheads, no hard joins.",
      "Generous empty negative space (>= 35% of frame) above and below the bands so HTML overlay (flowHeading at top, 8 step labels with sublabels in 4×2 grid below the image, bottom takeaway) lands cleanly. Bands themselves stay in the central horizontal band of the image.",
      "Visual reference (tone only, do not reproduce any text): wu8_basis_vectors.png (dye-layer stack), wu8_weight_functions.png (S-curve shape), wu8_variance_explained.png (subtle weight differences as opacity micro-variation), wu8_mean_residual.png (grain non-uniformity), phaseE/wu1_plots/svd_spectrum_iems1 / svd_spectrum_rochp (smooth wavelength ridges), phaseE/wu1_plots/separability.png (clean band boundaries), Tetra_Reverse/ANALYSIS.md (3-beam printer-light abstraction). Do NOT inherit any saturated R/G/B color — re-paint everything in aurora purple / pink / sky only.",
      "Use ONLY the HP palette: base #F8F6FF, accent #8B7FFF, aurora purple/pink/sky. NO orange. NO teal. NO warm peach. NO muted teal. NO green. No arrows. No text. No axis labels.",
      COMMON_NEGATIVE,
    ].join(" "),
  },

  "correction-control-math": {
    sourceSpecNotionUrl: "https://www.notion.so/8b38762c77fc4a048787c83ee7e8cb56",
    targetArticleNotionUrl: "https://www.notion.so/1510399661d64891aee912320df39b91",
    sourceSpecSummary:
      "追加図解 (2026-04-29 / correction 記事) quad-cards。主張『プライマリは加算 / べき乗 / 乗算 / 複合の 4 種類の算数』。AI 画像は 2x2 グリッドの背景レイヤーで、各セルに 1 種類のオペが暗示する曲線・トーン感だけを置く (文字・式・記号は HTML/CSS 側)。色域は #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) のみ。",
    overlayLabels: [
      "4 ノブ × 4 算数オペ",
      "Lift",
      "Gamma",
      "Gain",
      "Offset",
      "暗部に効く",
      "中間に効く",
      "明部に効く",
      "全帯に効く",
      "4 つの算数で、ほとんどの一次補正は組み立てられる。",
    ],
    successCriteria: [
      "2x2 グリッドの 4 セルが等サイズ・等余白で並んで見える",
      "各セルに『加算 / べき乗 / 乗算 / 全帯一律』の気分を伝える曲線・トーンが極めて控えめに乗っている",
      "色域が #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) だけで構成され、orange / teal / warm peach / muted teal が出てこない",
      "HTML overlay (4 セル × ラベル + オペ + 効く帯 + 一行説明) が乗る空白が確保されている",
      "correction-factor-map / correction-scope-map と並べたときに、形状で補完関係になる (左右対比 vs ヒーロー同心円 vs 2x2 行列)",
    ],
    referenceAssets: {
      used: [
        "public/slides/4プライマリーコントロール概要.png",
        "public/slides/5複合操作の影響と復元性.png",
      ],
      checkedButNotUsed: [
        {
          path: "public/slides/11分解と整理によるアプローチ.png",
          reason: "粒度の分解は別図 (correction-factor-map / correction-scope-map) で扱うのでここでは不採用",
        },
      ],
    },
    generationRationale: [
      "追加図解 (correction 記事 / quad-cards) 専用。AI 画像は 2x2 グリッドの背景レイヤーで、各セルに 1 種類のオペの曲線・トーン感だけを暗示する。",
      "slides/4 プライマリーコントロール概要 → 4 ノブが暗部・中間・明部・全帯に効くという対応関係を、4 セルの位置 (左上=暗部、右上=中間、左下=明部、右下=全帯) に反映。",
      "slides/5 複合操作の影響と復元性 → 加算 / べき乗 / 乗算 / 全帯一律の曲線形状を、各セルに極めて控えめに置く根拠。",
      "色域は HP 実コードのトークンに同期: #F8F6FF base、#8B7FFF accent、aurora purple/pink/sky の 3 色のみ。",
    ].join(" "),
    size: "1536x1024",
    quality: "high",
    output_format: "webp",
    prompt: [
      COMMON_STYLE,
      "DESIGN INTENT — A 2x2 grid background hero for a quad-cards diagram about 'four primary controls = four pieces of arithmetic'. The frame is split into 4 equal cells of identical size and identical padding, organized in a clean 2-column × 2-row grid with a thin luminous gutter (subtle aurora-pink hairline) between cells. The image is background only — labels, operation names, knob names, and small boxes are NOT drawn here; they are overlaid in HTML by note-diagram.tsx (quad-cards layout).",
      "Background: bright white-to-soft-lavender canvas (~#F8F6FF) with very faint aurora wash (purple / pink / sky only). No dark fills, no cinematic noir.",
      "CELL TOP-LEFT (Lift = additive on shadows) — a soft luminous curve that rises gently from the lower-left and flattens toward the upper-right, suggesting addition on the dark end. Built ONLY from aurora-purple at varying opacity, with the lavender accent #8B7FFF as a quiet luminous note. The dark-end region is slightly more saturated to show 'lift on shadows', but never crashes to dark.",
      "CELL TOP-RIGHT (Gamma = exponent on midtones) — a soft S-shaped luminous ridge centered in the cell, with the bend in the middle to suggest power-curve behavior on midtones. Built ONLY from aurora-pink at varying opacity, with #8B7FFF as a quiet midtone highlight. Symmetric around the cell center.",
      "CELL BOTTOM-LEFT (Gain = multiplicative on highlights) — a soft luminous wedge that fans outward from the lower-left toward the upper-right, suggesting multiplication scaling the bright end. Built ONLY from aurora-sky at varying opacity, with #8B7FFF as a quiet highlight at the bright corner.",
      "CELL BOTTOM-RIGHT (Offset = uniform additive across the whole signal) — a soft uniform luminous plane with a single thin horizontal ridge passing straight through the middle of the cell, suggesting a parallel translation of the entire signal. Built from a balanced blend of aurora-purple / aurora-pink / aurora-sky at low opacity. Very subtle — no exaggerated curve, just a steady lift across the whole cell.",
      "All four cells share IDENTICAL bounding-box size, IDENTICAL inner padding, and IDENTICAL line weight — equal-weight is critical because HTML labels of identical size will sit one per cell. Each curve / wedge / ridge is extremely subtle so that HTML labels remain the dominant reading element.",
      "Plenty of empty negative space (>= 35% of frame) inside each cell so HTML overlay (cell number, knob name, op label, scope label, sublabel) lands cleanly in the upper portion of each cell.",
      "Visual reference (tone only, do not reproduce any text or saturated color): public/slides/4プライマリーコントロール概要.png (4-knob structure), public/slides/5複合操作の影響と復元性.png (curve shape feel).",
      "Use ONLY the HP palette: base #F8F6FF, accent #8B7FFF, aurora purple/pink/sky. NO orange. NO teal. NO warm peach. NO muted teal. NO green. No arrows. No text. No equations. No symbols.",
      COMMON_NEGATIVE,
    ].join(" "),
  },

  "correction-reversibility-compare": {
    sourceSpecNotionUrl: "https://www.notion.so/8b38762c77fc4a048787c83ee7e8cb56",
    targetArticleNotionUrl: "https://www.notion.so/1510399661d64891aee912320df39b91",
    sourceSpecSummary:
      "追加図解 (2026-04-29 / correction 記事) compare-pair。主張『乗算中心は戻せる、加算とべき乗の入れ子は戻せない』。AI 画像は左右二分割の背景レイヤーで、左 = 1 段の真っ直ぐな経路 (clean / reversible)、右 = 多段に絡まった経路 (nested / irreversible) を暗示する。色域は #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) のみ。",
    overlayLabels: [
      "Clean / Reversible",
      "Nested / Irreversible",
      "戻せる",
      "戻しにくい",
      "Gain (×)",
      "Lift (+)",
      "Gamma (^γ)",
      "乗算中心は戻る。加算とべき乗の入れ子は、くすみとして残る。",
    ],
    successCriteria: [
      "左 = 真っ直ぐで透明な 1 経路、右 = 絡まり合う多段経路、の左右対比が一目で読める",
      "左の経路は薄く半透明で『どこを通っても元に戻せそうな』軽さがある",
      "右の経路は半透明の交差・重なりで『戻すのが面倒そうな』粘性がある (ただし暗くしない)",
      "中央の luminous seam が左右の境界を補助している (主役にはならない)",
      "色域が #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) だけで構成され、orange / teal / warm peach / muted teal が出てこない",
      "HTML overlay (左右ヘッダー + verdict バッジ + ノードリスト + takeaway) が乗る空白が確保されている",
    ],
    referenceAssets: {
      used: [
        "public/slides/5複合操作の影響と復元性.png",
        "public/slides/11分解と整理によるアプローチ.png",
      ],
      checkedButNotUsed: [
        {
          path: "public/slides/4プライマリーコントロール概要.png",
          reason: "ノブ概要は別図 (correction-control-math) で扱うのでここでは不採用",
        },
      ],
    },
    generationRationale: [
      "追加図解 (correction 記事 / compare-pair) 専用。AI 画像は左右二分割の背景レイヤーで、左 = 1 段経路、右 = 多段絡まりを暗示する。",
      "slides/5 複合操作の影響と復元性 → 戻しやすさは『重ねる順』で決まるという主張の根拠。乗算中心 = 戻せる、加算とべき乗の入れ子 = 戻せない。",
      "slides/11 分解と整理によるアプローチ → 整列 (左) と混線 (右) の左右対比トーンの根拠。ただしこちらでは『戻せる/戻せない』という別の意味付け。",
      "色域は HP 実コードのトークンに同期: #F8F6FF base、#8B7FFF accent、aurora purple/pink/sky の 3 色のみ。",
    ].join(" "),
    size: "1536x1024",
    quality: "high",
    output_format: "webp",
    prompt: [
      COMMON_STYLE,
      "DESIGN INTENT — chaos-vs-structured-style left/right split, but with a different meaning: left = clean single-stage path that can be reversed, right = nested multi-stage tangle that cannot be cleanly reversed. The image is background only — labels, node names, verdicts, and small boxes are NOT drawn here; they are overlaid in HTML by note-diagram.tsx (compare-pair layout).",
      "Background: bright white-to-soft-lavender canvas (~#F8F6FF) with very faint aurora wash (purple / pink / sky only). No dark fills, no cinematic noir, no warm peach, no teal, no green.",
      "Composition rule: the frame is split into two equal halves by a thin luminous seam at the horizontal center. No hard line — just a quiet brighter ridge (subtle aurora-pink hairline) so the eye reads the seam as a soft boundary. Identical top and bottom margins on both halves.",
      "LEFT HALF (clean / reversible) — a single thin softly-glowing horizontal path runs left-to-right, calm and parallel to the image axis. The path is built from aurora-sky at low opacity, with #8B7FFF as a quiet luminous head at the right end. 2-3 evenly spaced soft luminous nodes sit on the path (small open rings, NOT filled disks), all aligned and identical in size — suggesting 'all multiplications, same family, easy to reverse'. Plenty of negative space above and below the path.",
      "RIGHT HALF (nested / irreversible) — multiple thin softly-glowing paths curve, cross, and overlap in a relaxed cluster around the middle of the half. The paths interweave above and below each other (some translucent crossings deepen slightly without becoming dark), suggesting 'addition + exponent stacked into each other'. Each path is built ONLY from the HP palette (aurora-purple, aurora-pink, with the lavender accent #8B7FFF as a quiet highlight at one of the crossings). 4-5 small soft luminous nodes sit at irregular crossings — not aligned, varying in size, suggesting 'cannot cleanly walk back through'. Stay BRIGHT — never crash to dark, never use saturated colors. The tangle reads as 'sticky, not catastrophic'.",
      "MIDDLE SEAM — a single quiet luminous ridge running top-to-bottom, slightly brighter than the rest of the canvas. The ridge is built from the aurora-pink wash only, kept extremely subtle. No arrowheads, no funnel walls, no hard boundaries.",
      "Empty negative space (>= 35% of frame) above, below, and between the two halves so HTML overlay (left header 'Clean / Reversible' + verdict '戻せる' + 3 nodes, right header 'Nested / Irreversible' + verdict '戻しにくい' + 4 nodes, takeaway at the bottom) lands cleanly.",
      "Visual reference (tone only, do not reproduce any text or saturated color): public/slides/5複合操作の影響と復元性.png (reversibility tone), public/slides/11分解と整理によるアプローチ.png (left/right contrast feel).",
      "Use ONLY the HP palette: base #F8F6FF, accent #8B7FFF, aurora purple/pink/sky. NO orange. NO teal. NO warm peach. NO muted teal. NO green. No arrowheads. No hard outlines. No text. No symbols.",
      COMMON_NEGATIVE,
    ].join(" "),
  },

  "correction-space-choice": {
    sourceSpecNotionUrl: "https://www.notion.so/8b38762c77fc4a048787c83ee7e8cb56",
    targetArticleNotionUrl: "https://www.notion.so/1510399661d64891aee912320df39b91",
    sourceSpecSummary:
      "追加図解 (2026-04-29 / correction 記事) triple-compare。主張『Log / Linear / Gamma の 3 空間で操作感が変わる、実務はガンマ空間が一番扱いやすい』。AI 画像は 3 列縦バンドの背景レイヤーで、各列のトーン応答カーブを極めて控えめに暗示する。色域は #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) のみ。",
    overlayLabels: [
      "3 空間の比較",
      "Log",
      "Linear",
      "Gamma",
      "操作感",
      "信号範囲",
      "色抽出",
      "迷ったらガンマ空間。物理に近く、目にも合う。",
    ],
    successCriteria: [
      "3 列の縦バンドが等幅・等高で並んで見える",
      "各列のカーブ気分 (log = 対数 / linear = 直線 / gamma = べき乗) が極めて控えめに伝わる",
      "色域が #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) だけで構成され、orange / teal / warm peach / muted teal が出てこない",
      "HTML overlay (3 列 × ラベル + 3 行 + verdict + takeaway) が乗る空白が確保されている",
      "mobile (縦積み) でも desktop (3 列) でも横スクロールが起きない構図 (背景の中央 70% に主要素が収まる)",
    ],
    referenceAssets: {
      used: [
        "public/slides/5複合操作の影響と復元性.png",
      ],
      checkedButNotUsed: [
        {
          path: "public/slides/4プライマリーコントロール概要.png",
          reason: "ノブの分類は別図 (correction-control-math) で扱うのでここでは不採用",
        },
      ],
    },
    generationRationale: [
      "追加図解 (correction 記事 / triple-compare) 専用。AI 画像は 3 列縦バンドの背景レイヤーで、各列のカーブ気分だけを担う。",
      "slides/5 複合操作の影響と復元性 → 対数・直線・べき乗のカーブ形状の根拠。3 列に対応させる。",
      "色域は HP 実コードのトークンに同期: #F8F6FF base、#8B7FFF accent、aurora purple/pink/sky の 3 色のみ。",
    ].join(" "),
    size: "1536x1024",
    quality: "high",
    output_format: "webp",
    prompt: [
      COMMON_STYLE,
      "DESIGN INTENT — A 3-column compare-band background for a triple-compare diagram about working spaces (Log / Linear / Gamma). Three identical-width vertical lanes side by side, equally spaced left to right with thin luminous gutters between lanes. Each lane carries one extremely subtle response-curve hint that suggests the kind of math that lane represents. The image is background only — labels, column headings, row labels, verdicts, and small boxes are NOT drawn here; they are overlaid in HTML by note-diagram.tsx (triple-compare layout).",
      "Background: bright white-to-soft-lavender canvas (~#F8F6FF) with very faint aurora wash (purple / pink / sky only). No dark fills, no cinematic noir, no warm peach, no teal, no green.",
      "Layout: THREE vertical lanes of identical width, equally spaced. Each lane has IDENTICAL top and bottom margins. Lane gutters are subtle aurora-pink hairlines, not hard lines.",
      "LANE 1 (Log) — a soft logarithmic-like luminous curve climbs steeply at the bottom and flattens slowly toward the top, suggesting log compression on a wide signal range. Built ONLY from aurora-purple at varying opacity, with #8B7FFF as a quiet luminous note at the bottom (where the curve compresses the dark end).",
      "LANE 2 (Linear) — a soft straight luminous diagonal line runs from the lower-left corner to the upper-right corner of the lane, suggesting a 1:1 linear response. Built ONLY from aurora-sky at varying opacity, with #8B7FFF as a quiet luminous note where the diagonal crosses the lane center.",
      "LANE 3 (Gamma) — a soft gentle power-curve luminous ridge bows from the lower-left toward the upper-right with a small dip in the lower-third, suggesting a midtone-friendly power response. Built ONLY from aurora-pink at varying opacity, with #8B7FFF as a quiet luminous note at the midtone bend.",
      "All three curves have IDENTICAL line weight, identical opacity envelope, and identical bounding box — equal-weight is critical because HTML labels of identical size will sit one per lane. Each curve is extremely subtle so HTML labels remain the dominant reading element.",
      "All main visual elements stay inside the central ~70% of the frame so that on mobile (single-column stack) and desktop (3-column row), the image scales without horizontal overflow. Plenty of empty negative space at top, between lanes, and at bottom for HTML labels.",
      "Visual reference (tone only, do not reproduce any text or saturated color): public/slides/5複合操作の影響と復元性.png (curve shapes for log/linear/gamma feel).",
      "Use ONLY the HP palette: base #F8F6FF, accent #8B7FFF, aurora purple/pink/sky. NO orange. NO teal. NO warm peach. NO muted teal. NO green. No arrows. No text. No axis labels.",
      COMMON_NEGATIVE,
    ].join(" "),
  },

  "filmlook-density-mixture": {
    sourceSpecNotionUrl: "https://www.notion.so/8b38762c77fc4a048787c83ee7e8cb56",
    targetArticleNotionUrl: "https://www.notion.so/7202c1ee64c04c97a4821b8e4f2e0f67",
    sourceSpecSummary:
      "図解仕様書 v3 (2026-04-29 / 8b38762c) filmlook-density-mixture。layout=chaos-vs-structured。主張『フィルムらしさ = 濃度（縦軸） + 色の混ざり（横軸）』。左半=縦方向の濃度 wedge (S 字の肩・対数応答)、中央=細い luminous seam、右半=3 層染料のヴェン状重なり + RGB 3 ビーム。色域は #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) のみ。文字・記号・矢印は note-diagram.tsx 側で描画。",
    overlayLabels: [
      "濃度（縦軸）",
      "色の混ざり（横軸）",
      "暗部の粘り",
      "S 字の肩",
      "対数応答",
      "3 層染料",
      "分光密度曲線",
      "DIR カプラー",
      "プリンター光",
      "フィルムの正体は、二軸に絞れる。",
    ],
    successCriteria: [
      "左半=縦方向の濃度 wedge、右半=3 層染料 + 3 ビーム、の左右対比が一目で読める",
      "中央の luminous seam が左右の境界を補助している (主役にはならない)",
      "色域が #F8F6FF + #8B7FFF + aurora 3 色 (purple / pink / sky) だけで構成され、orange / teal / warm peach / muted teal が出てこない",
      "HTML overlay の左右ヘッダー + 3 chaosLabels + 4 structuredLayers + intro が乗る空白がある",
      "filmlook-physics-flow (8 段時系列) と並べたときに、形状で補完関係になる (左右二分割の本質抽出 vs 横フロー時系列)",
    ],
    referenceAssets: {
      used: [
        "../FilmLookEmulator_project/analysis/stage2/wu8_weight_functions.png",
        "../FilmLookEmulator_project/analysis/stage2/wu8_basis_vectors.png",
        "../FilmLookEmulator_project/analysis/phaseE/wu1_plots/svd_spectrum_iems1.png",
      ],
      checkedButNotUsed: [
        {
          path: "../FilmLookEmulator_project/analysis/stage2/wu8_variance_explained.png",
          reason: "寄与度のバープロットで、二軸の視覚化に直接寄与しないので不採用",
        },
        {
          path: "../FilmLookEmulator_project/analysis/phaseE/wu1_plots/pareto_front.png",
          reason: "別議論 (分離可能性) のプロット。本図解の「濃度+色の混ざり」とは関心が違うので不採用",
        },
      ],
    },
    generationRationale: [
      "v3 (2026-04-29 / 8b38762c) filmlook-density-mixture (chaos-vs-structured) に再アライン。AI 画像は左右対比の構図と気分だけを担う背景レイヤーで、文字・番号・矢印・3 層染料の R/G/B 表象は描かない (色は HP palette に置き換え)。",
      "wu8_weight_functions.png → 左半 (濃度) の S 字の肩・対数応答ロールオフの形状根拠。S ライン全体を aurora-purple-into-pink で描く。",
      "wu8_basis_vectors.png → 右半 (色の混ざり) の 3 層基底の重なり構図根拠。3 層は R/G/B / C/M/Y ではなく aurora purple / pink / sky に置き換える (HP palette 外の色相は禁止)。",
      "phaseE/wu1_plots/svd_spectrum_iems1.png → 右半のプリンタ光 3 ビームの構図根拠。3 ビームを aurora purple / pink / sky で描く。",
      "filmlook-physics-flow との重複回避: あちらは 8 段時系列フロー、こちらは 2 軸の本質抽出。構図 (左右二分割) で補完。",
      "色域は HP 実コードのトークンに同期: #F8F6FF base、#8B7FFF accent、aurora purple/pink/sky の 3 色のみ。orange / teal / warm peach / muted teal は実装に存在しないため除去。",
    ].join(" "),
    size: "1536x1024",
    quality: "high",
    output_format: "webp",
    prompt: [
      COMMON_STYLE,
      "DESIGN INTENT — chaos-vs-structured: film-ness reduces to TWO axes laid out side by side. Left half = density axis (how each brightness sinks). Right half = color mixture axis (how three dye layers cross-contaminate). Both halves share the same vertical area and identical breathing space. The image is background only — labels, numbers, and small boxes are NOT drawn here; they are overlaid in HTML by note-diagram.tsx (chaos-vs-structured layout).",
      "Background: bright white-to-soft-lavender canvas (~#F8F6FF) with very faint aurora wash (purple / pink / sky only). No dark fills, no cinematic noir, no warm peach, no teal, no green.",
      "Composition rule: the frame is split into two equal halves by a thin luminous seam at the horizontal center. No hard line — just a quiet brighter ridge (subtle aurora-pink hairline) so the eye reads the seam as a soft boundary. Identical top and bottom margins on both halves.",
      "LEFT HALF (density axis) — a vertical luminance wedge: bright highlights at the top softly rolling off (a gentle shoulder), neutral midtones in the middle, deeper tones at the bottom that linger and never crash to pure black. A faint S-shaped luminous ridge crosses the wedge from upper-right to lower-left, shape inherited from FilmLookEmulator wu8_weight_functions.png — gentle toe at the bottom, gentle shoulder at the top, log-like response. The wedge body is built ONLY from aurora-purple at varying opacity (densest at the bottom, palest at the top), with the lavender accent #8B7FFF as the most saturated note along the S ridge. NO warm peach, NO teal.",
      "RIGHT HALF (color-mixture axis) — three translucent layers overlap in a soft Venn-like cluster (one upper-left, one upper-right, one lower-center), with subtle inter-layer offsets suggesting cross-contamination. The three layers use ONLY the HP palette: layer A = aurora-purple, layer B = aurora-pink, layer C = aurora-sky. Where any two layers overlap, the blend deepens slightly without becoming dark. Three short faint parallel beams cross the cluster horizontally — one aurora-purple, one aurora-pink, one aurora-sky — gently shifting the resulting blend (printer light reference from phaseE/wu1_plots/svd_spectrum_iems1.png, but re-painted in HP palette only). Layer overlap shape inherited from wu8_basis_vectors.png. NO warm peach, NO teal, NO cyan/magenta/yellow saturated tones.",
      "MIDDLE SEAM — a single quiet luminous ridge running top-to-bottom, slightly brighter than the rest of the canvas. The ridge is built from the aurora-pink wash only, kept extremely subtle. No arrowheads, no funnel walls, no hard boundaries. The seam reads as 'these two axes belong to the same film'.",
      "Empty negative space (>= 35% of frame) above, below, and between the two halves so HTML overlay (left header '濃度（縦軸）', right header '色の混ざり（横軸）', 3 chaosLabels stacked along the left, 4 structured-layer labels along the right, and a short intro tagline) lands cleanly.",
      "Visual reference (tone only, do not reproduce any text or saturated color): wu8_weight_functions.png (S-curve shape), wu8_basis_vectors.png (Venn-like layer overlap), phaseE/wu1_plots/svd_spectrum_iems1.png (3-beam printer-light abstraction). Re-paint everything in aurora purple / pink / sky only.",
      "Use ONLY the HP palette: base #F8F6FF, accent #8B7FFF, aurora purple/pink/sky. NO orange. NO teal. NO warm peach. NO muted teal. NO cyan/magenta/yellow saturated tones. NO green. No arrows. No text. No axis labels.",
      COMMON_NEGATIVE,
    ].join(" "),
  },
}

export function getDiagramGenConfig(slug) {
  const cfg = DIAGRAM_GEN_CONFIGS[slug]
  if (!cfg) {
    throw new Error(`unknown diagram slug: ${slug}. known: ${Object.keys(DIAGRAM_GEN_CONFIGS).join(", ")}`)
  }
  return cfg
}
