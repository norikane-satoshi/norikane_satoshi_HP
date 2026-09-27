export type PressLink = {
  label: string
  href: string
}

export type PressItem = {
  period: string
  title: string
  description: string
  links: PressLink[]
}

export type PressCategory = {
  title: string
  items: PressItem[]
}

export const PRESS_CATEGORIES: PressCategory[] = [
  {
    title: "登壇・セミナー",
    items: [
      {
        period: "2024年11月",
        title: "Inter BEE 2024 / Imagica EMS スペシャルデイ（幕張メッセ）",
        description:
          "Blackmagic Design DaVinci Resolve シアターに登壇。「The Creative Color Grading：DRAMA — カラーグレーディングの分解とリライティング」として、ドラマ作品のカラーグレーディングを構成要素に分解し、リライティングの手法を実演解説した。",
        links: [
          {
            label: "https://bmduser.jp/eve_detail.php?id=95",
            href: "https://bmduser.jp/eve_detail.php?id=95",
          },
        ],
      },
      {
        period: "2024年9月",
        title:
          "Color by IMAGICA「HBO CAS Screening / In-Camera VFX / Grading Demo」（竹芝メディアスタジオ）",
        description:
          "ZEISS・日本映画撮影監督協会との共催イベントで、インカメラVFXのプレゼンテーションと、ARRI AMIRA 撮影作品のカラーグレーディングデモンストレーションを担当した。",
        links: [
          {
            label: "https://www.imagica-ems.co.jp/event/cbi_event_hbo-cas_240927/",
            href: "https://www.imagica-ems.co.jp/event/cbi_event_hbo-cas_240927/",
          },
        ],
      },
      {
        period: "2024年11月",
        title: "バーチャルプロダクション撮影体験イベント（FACTORY ANZEN STUDIO）",
        description:
          "Imagica EMS・日本映画撮影監督協会・日本映画テレビ照明協会の共催イベントに VP カラークリエイターとして参加。リアルタイムカラーマネジメントを担当し、メディア合同取材会にも登壇した。",
        links: [
          {
            label: "https://videosalon.jp/report/imagicaems_vp_event/",
            href: "https://videosalon.jp/report/imagicaems_vp_event/",
          },
        ],
      },
      {
        period: "2025年5月",
        title: "DaVinci Resolve カラーグレーディング トレーニング講師（ブラックマジックデザイン）",
        description:
          "DaVinci Resolve 認定トレーナーとして、他ソフトからのコンフォーム・ショットマッチング・クリエイティブグレーディングなど実務テクニックを少人数セミナーで指導した。",
        links: [
          {
            label: "https://bmduser.jp/eve_detail.php?id=127",
            href: "https://bmduser.jp/eve_detail.php?id=127",
          },
        ],
      },
    ],
  },
  {
    title: "メディア掲載・事例紹介",
    items: [
      {
        period: "2024年",
        title: "Huluドラマ『十角館の殺人』— インカメラVFXによるルック作り",
        description:
          "実写化不可能と言われた綾辻行人原作のドラマ化作品で、カラリストとして撮影現場に立ち会い、照明部と連携した現場カラコレ／オンセットグレーディング（黒浮き対策・LED 調整など）を担当した。",
        links: [
          {
            label: "VIDEO SALON 記事",
            href: "https://videosalon.jp/report/jukkakukannosatsujin/",
          },
          {
            label: "Imagica EMS 事例紹介",
            href: "https://www.imagica-ems.co.jp/case-study/jukkakukannosatsujin_20240515/",
          },
        ],
      },
      {
        period: "2024年",
        title: "ゲキ×シネ『吉原御免状』— Dolby Cinema 版カラー",
        description:
          "ゲキ×シネ20周年記念の Dolby Cinema 作品で、監督と通常版のカラーをディスカッションし、高コントラストを活かした劇場版のルックを制作した（プロデューサーの製作記で紹介）。",
        links: [
          {
            label: "https://gxcblog.exblog.jp/36845321/",
            href: "https://gxcblog.exblog.jp/36845321/",
          },
        ],
      },
      {
        period: "2023年",
        title: "ゲキ×シネ『薔薇とサムライ2 -海賊女王の帰還-』— Dolby Vision グレーディング",
        description:
          "劇団☆新感線の舞台映像作品で Dolby Vision のカラーグレーディングを担当。LUT を要素分解し、舞台の没入感を高めるルックを構築した（事例記事を執筆）。",
        links: [
          {
            label: "https://www.imagica-ems.co.jp/case-study/barasamu2_231005/",
            href: "https://www.imagica-ems.co.jp/case-study/barasamu2_231005/",
          },
        ],
      },
      {
        period: "2025年",
        title: "NHK 放送100年特集ドラマ『火星の女王』— VFX制作ドキュメント",
        description:
          "「100年後の火星」を描くドラマの VFX／ポストプロダクション工程に参加し、各部署と連携して世界観を映像化した（公式ブログで制作の舞台裏が紹介）。",
        links: [
          {
            label: "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pz9aJoZRyz/",
            href: "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pz9aJoZRyz/",
          },
        ],
      },
    ],
  },
  {
    title: "紹介動画制作",
    items: [
      {
        period: "2023年",
        title: "クラウドワークフロー紹介映像『Next Generation Workflow』— ディレクター",
        description:
          "撮影から仕上げまでを全面クラウド化した新ワークフローの紹介映像で、ディレクターを担当した。",
        links: [
          {
            label: "https://www.imagica-ems.co.jp/case-study/next-generation-workflow-230810/",
            href: "https://www.imagica-ems.co.jp/case-study/next-generation-workflow-230810/",
          },
        ],
      },
    ],
  },
]
