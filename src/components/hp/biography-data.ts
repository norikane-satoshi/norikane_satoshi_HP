export type BiographyText = string | { text: string; href: string }

export type BiographyChapter = {
  id: string
  /** 年代の見出し。無い章は前の章の続きとして読む。 */
  period?: string
  title: string
  paragraphs: BiographyText[][]
  image?: {
    src: string
    alt: string
    width: number
    height: number
    caption?: string
  }
}

export const BIOGRAPHY_LEAD = "1989年4月7日、香川県丸亀市生まれ。"

export const BIOGRAPHY_CHAPTERS: BiographyChapter[] = [
  {
    id: "birth",
    period: "1989",
    title: "丸亀に生まれる",
    paragraphs: [
      [
        "1989年4月7日、香川県丸亀市に生まれました。小さい頃はよく転んで、よく泣く子どもでした。一つ上の兄とはよく一緒に遊び、よく泣かされてもいました。",
      ],
    ],
    image: {
      src: "/hp/bio-childhood.jpg",
      alt: "芝生の上で模型飛行機を持つ幼い頃の則兼",
      width: 1600,
      height: 1365,
    },
  },
  {
    id: "grandfather",
    title: "電気に強い祖父",
    paragraphs: [
      [
        "祖父は電気に強い人で、ソーラーパネルで動く湯沸かし器や、家の中のエレベーターまで自分で作っていました。",
      ],
    ],
  },
  {
    id: "elementary",
    period: "1990s",
    title: "昼休みまで描いていた図工の時間",
    paragraphs: [
      [
        "幼稚園から小学校にかけては絵画教室に通い、小学校の6年間は剣道と水泳も続けました。走るのは得意で、運動会のリレーではアンカーを任されていました。",
      ],
      [
        "図工の時間がいちばん好きで、時間内に描き終わらず、昼休みまでつぶして描いていました。",
      ],
    ],
  },
  {
    id: "track",
    period: "2002–2008",
    title: "800m",
    paragraphs: [
      [
        "中学から高校までは、ずっと陸上部でした。高校での専門は800mです。貧血もあって、いろいろな重圧を抱えていた時期でした。",
      ],
      [
        "高校2年生のとき、自己ベストが一気に伸びました。ゴールしたあとの、ふわふわと体が浮くような高揚感は、今も体の感覚として残っています。2008年、香川県立丸亀高等学校を卒業しました。",
      ],
    ],
  },
  {
    id: "atelier",
    period: "2008",
    title: "一日十時間のデッサン",
    paragraphs: [
      [
        "高校を卒業して一浪した一年間は、善通寺の美術研究所「",
        { text: "アトリエ孤路庵", href: "http://koroann.com/" },
        "」で、毎日10時間以上デッサンを描いていました。物の位置と輪郭を捉え、それを紙の上に出力する。その練習をひたすら繰り返した一年です。",
      ],
    ],
    image: {
      src: "/hp/bio-hermes.jpg",
      alt: "ヘルメス像の石膏デッサン",
      width: 1083,
      height: 1400,
      caption: "ヘルメス（石膏デッサン）",
    },
  },
  {
    id: "university",
    period: "2009",
    title: "音楽と映像とデッサン",
    paragraphs: [
      [
        "2009年、静岡文化芸術大学デザイン学部メディア造形学科に入学しました。大学生活は、ほぼ三つでできていました。",
      ],
      [
        "一つ目は軽音サークルで、4年間ギターボーカルとして曲のメロディや歌詞を作っていました。ギターはそれほど上手ではありません。二つ目は映像の課題、三つ目は、特に1年生のときに力を入れたデッサンです。アルバイトはほとんどしていませんでした。",
      ],
    ],
  },
  {
    id: "color",
    title: "3DCG と色との出会い",
    paragraphs: [
      [
        "映像に興味を持ったきっかけは、映像ゼミの 3ds Max の授業です。卒業制作では実写合成の映像作品『",
        { text: "オトシカク", href: "https://www.youtube.com/watch?v=mJcyWAcEMMc" },
        "』を作り、顔の表情を動かすフェイシャルリギングの映像も作りました。",
      ],
      [
        "レンダリングした画像に After Effects でトーンカーブを少し当てるだけで、見違えるほど質が上がる。Magic Bullet Looks のようなプラグインを初めて知ったときの驚きも覚えています。そこから、色の仕事にのめり込んでいきました。",
      ],
    ],
  },
  {
    id: "brother",
    title: "兄のこと",
    paragraphs: [
      [
        "一つ上の兄は、パフォーマンス集団「",
        { text: "白A（SIRO-A）", href: "https://www.siro-a.com/" },
        "」で映像を作っています。",
      ],
      [
        "兄が After Effects に触れたのは、白Aに入る半年から1年ほど前でした。大学でいちばん使い込んでいた After Effects の操作を私が教えると、兄はそこからめきめきと覚えていきました。",
      ],
    ],
  },
  {
    id: "career",
    period: "2013",
    title: "そして色の仕事へ",
    paragraphs: [["2013年、IMAGICA でカラリストアシスタントとして働き始めました。"]],
  },
]
