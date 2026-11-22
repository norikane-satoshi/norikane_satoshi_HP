# 「AIで不安になる理由」サムネイル

対象: [Notion IB_ノート](https://app.notion.com/p/41f13ee3141a81b2ab01eefc4eb8c5ab)、slug `ai-thoughts`。

## 採用する図

第2章「二つの使い方」を直接図示する。左は色・明るさが異なる3カットがAIを通って揃う流れ。
右は人とAIが一つの道具を作り、それを他の人が使って別の制作物を生む流れ。
記事タイトル、製品名、作品名は画像に入れない。

題字は「自動化と価値創造」。Noto Serif JP の縦書きで左右の図の間に置き、左右を分ける軸にする（「と」だけ小さく、上下に細い線）。見出しの下に説明は付けない。
則兼さんが文字組み3案（縦書きの軸／左右の大見出し／下に大きな題字）から縦書きを選んだ（2026-11-22）。1600×900 PNG で収録する。
参照先は `public/notes/thumbnails/ai-thoughts-diagram.png`。
画像、再描画スクリプト（`render.cjs` の layout 1）、カード確認画像、検証ログは
`~/tmp/hp-thumb-ai-thoughts/v6/` に保存する。写真素材は `../v3/film-source.png` を再利用する。

## 制作方法

- 見出し、人物、汎用的な道具、矢印、配置をSVGコードで描画し、ChromeでPNG化する。
- 書体は実サイトのNoto Serif JP、英字AIはInstrument Serifのイタリック。色は墨色・アイボリーを基調とする。
- 写真素材だけCodex内蔵image_genで生成。匿名の室内・人物・街路の3ショットで、文字や既存作品を含めない。
- 同じ素材にSVGの色変換を施して入力のばらつきを表現し、出力には共通の元の色調を使う。
- 柔らかい局所光、薄い面の重なり、細い輪郭、控えめな粒子をコードで加える。道具一つに琥珀色を置く。
- `render.cjs` はローカルHPから書体を読み、採用する1枚を書き出す。画像生成に文字は描かせない。

## 表示と記事設定

`src/lib/hp/home-notes.ts` の `NOTE_SETTINGS` が記事ごとの設定の正本。
`ai-thoughts` は `kind: "column"`、採用画像の `thumbnailSrc`、`shareThumbnail: true` を持つ。
種別省略はノート。新しいコラムは slug をキーとして `{ kind: "column" }` を追加し、
画像がある場合は `thumbnailSrc`、その画像をOGPにも使う場合は `shareThumbnail: true` を指定する。

一覧と記事ページは `getNoteLabel` を共用する。公開記事をNotion作成日時の古い順に並べ、
ノートとコラムを別々に01から採番する。同時刻の場合はslug順で決める。
新しく作成した記事を公開しても既存番号は変わらず、コラムはノートの番号を消費しない。
カードの掲載順は外部記事を含めて新しい順のまま。番号は永続IDではなく、
過去の作成日時を持つ記事の追加や既存記事の公開停止では変わり得る。

`/notes` は既存の一覧 `/#philosophy` へ転送する。
公開条件はNotionのHP公開に従い、非公開中は一覧・本文・OGPに記事を出さない。
`public/` の画像は記事非公開でも直URLで取得できる。

## 検証

- `src/lib/hp/__tests__/home-notes.test.ts`: 古い順の採番、新規記事追加時の番号維持、
  コラムの独立採番、同時刻の順序、画像ファイルの存在。
- `tests/unit/notes/note-labels.test.tsx`: 実際のトップと記事ページのラベル一致、
  公開後OGP画像、非公開中の一覧・本文・OGPの非表示。
