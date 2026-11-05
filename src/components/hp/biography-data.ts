export type BiographyText = string | { text: string; href: string }

export type BiographyBlock =
  | { type: "paragraph"; parts: BiographyText[] }
  | {
      type: "image"
      src: string
      alt: string
      width: number
      height: number
      caption?: string
    }

export type BiographyChapter = {
  id: string
  /** 年代の見出し。無い章は前の章の続きとして読む。 */
  period?: string
  title?: string
  body: BiographyBlock[]
}

export const BIOGRAPHY_LEAD = "1989年4月7日、香川県丸亀市生まれ。"

const p = (...parts: BiographyText[]): BiographyBlock => ({ type: "paragraph", parts })

export const BIOGRAPHY_CHAPTERS: BiographyChapter[] = [
  {
    id: "birth",
    period: "1989",
    title: "丸亀に生まれる",
    body: [
      p("1989年4月7日、香川県丸亀市に生まれました。小さい頃はよく転んで、よく泣く子どもでした。"),
      {
        type: "image",
        src: "/hp/bio-childhood.jpg",
        alt: "芝生の上で模型飛行機を持つ幼い頃の則兼",
        width: 1600,
        height: 1365,
      },
      p(
        "祖父によく可愛がられていました。じいちゃんは電気に強い人で、ソーラーパネルで動く湯沸かし器や、貨物用エレベーターまで自作していたのをよく覚えてます。",
      ),
    ],
  },
  {
    id: "childhood",
    period: "1990〜",
    title: "少年期",
    body: [
      p(
        "幼稚園から小学校にかけては絵画教室に通い、小学校の6年間は剣道と水泳も続けました。走るのは得意で、運動会ではアンカーをよく任されていました。",
      ),
      p("図工の時間が好きで、昼休みまで絵を描いていたことも。"),
    ],
  },
  {
    id: "school",
    period: "2000〜",
    title: "学生期",
    body: [
      p(
        "中学から高校までは、ずっと陸上部でした。高校での専門は800mです。高校2年、貧血もあっていろいろな重圧を抱えていた時期、そこから抜け出して自己ベストが一気に伸びました。",
      ),
      p(
        "ゴールしたあとの、体が浮くような高揚感が体感としてまだ残っています。2008年、香川県立丸亀高等学校を卒業しました。",
      ),
      {
        type: "image",
        src: "/hp/bio-track.jpg",
        alt: "高校の陸上 800m のレースで走る則兼（ゼッケン669）",
        width: 1600,
        height: 1202,
      },
    ],
  },
  {
    id: "dessin",
    period: "2008",
    title: "デッサン期",
    body: [
      p(
        "高校を卒業した後の一年間は、美術研究所「",
        { text: "アトリエ孤路庵", href: "http://koroann.com/" },
        "」で、夜まで10時間以上デッサンを描いていました。光と空間と量感を捉え、考え、それを紙の上に出力する。その練習をひたすら繰り返した一年です。",
      ),
      {
        type: "image",
        src: "/hp/bio-hermes.jpg",
        alt: "ヘルメス像の石膏デッサン",
        width: 1083,
        height: 1400,
        caption: "ヘルメス（石膏デッサン）",
      },
    ],
  },
  {
    id: "university",
    period: "2009",
    title: "大学期",
    body: [
      p(
        "2009年、静岡文化芸術大学デザイン学部メディア造形学科に入学しました。大学生活は、下の三つに明け暮れてました。",
      ),
      p(
        "一つ目は大学講義でデザインを中心に同じ学科のみんなと刺激を受け合いながら課題やグループ活動してました。二つ目は映像制作、三つ目は軽音サークルで、静岡のいろんなライブハウスをまわって、オリジナル曲を演奏していました。",
      ),
    ],
  },
  {
    id: "color",
    title: "3DCG と色との出会い",
    body: [
      p(
        "映像に興味を持ったきっかけは、映像ゼミの 3ds Max の授業です。モデリング、リギング、アニメーション、ライティング、撮影、まで行える映像作りの魅力に惹かれました。",
      ),
      p({ text: "フェイシャルリギング　メイキング", href: "https://vimeo.com/norikane/for-seitoku" }),
      p(
        "卒業制作では実写合成の映像作品『",
        { text: "オトシカク", href: "https://www.youtube.com/watch?v=mJcyWAcEMMc" },
        "』を作りました。",
      ),
      p(
        "レンダリングした画像にグレーディングを当てると、見違えるほど質が上がることを初めて知って、色の仕事にのめり込んでいきました。",
      ),
      p(
        "大学でいちばん使い込んでいた After Effects の操作を兄に教えたことがあり、兄はそこからめきめきと覚えていき、今ではパフォーマンス集団「",
        { text: "白A（SIRO-A）", href: "https://www.siro-a.com/" },
        "」で映像を作っています。",
      ),
    ],
  },
  {
    id: "career",
    period: "2013",
    body: [
      p(
        "そして2013年、IMAGICA でカラリストアシスタントとして働き始め、テレシネ作業を通してフィルムと出会いました。",
      ),
    ],
  },
]
