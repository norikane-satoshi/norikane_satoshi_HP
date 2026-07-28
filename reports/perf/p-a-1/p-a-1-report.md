# P-A-1 frontend audit

Generated at: 2026-07-27T13:48:08.856Z
Audit commit: 80b373f40e6cddff1ecca912d27dbd47d9e59736
Measured server commit: 80b373f40e6cddff1ecca912d27dbd47d9e59736

## Lighthouse medians

| Route | Profile | Samples | LCP ms | INP ms | CLS | TTFB ms | Transfer | Final URL |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| home | mobile | 3 | 12457.7 | null | 0 | 71 | 10.7 MB | http://127.0.0.1:41238/ |
| reservation | mobile | 3 | 11965.6 | 68.3 | 0 | 33 | 10.4 MB | http://127.0.0.1:41238/login?callbackUrl=%2Fbooking |
| chatbot | mobile | 3 | 62398.8 | 42.2 | 0 | 66 | 10.7 MB | http://127.0.0.1:41238/#contact |
| home | desktop | 3 | 12949.1 | 75.8 | 0 | 58 | 10.7 MB | http://127.0.0.1:41238/ |
| reservation | desktop | 3 | 11995.8 | 52.2 | 0 | 36 | 10.4 MB | http://127.0.0.1:41238/login?callbackUrl=%2Fbooking |
| chatbot | desktop | 3 | 61939.6 | 32.5 | 0 | 51 | 10.7 MB | http://127.0.0.1:41238/#contact |

## Top heavy assets

| Asset | Type | Format | Transfer | Resource | Routes | Lazy loading |
| --- | --- | --- | ---: | ---: | --- | --- |
| /demo/-2STOP.jpg | image | jpg | 0 B | 3.1 MB |  | not-loaded-on-audited-routes |
| /demo/-1STOP.jpg | image | jpg | 0 B | 2.8 MB |  | not-loaded-on-audited-routes |
| /demo/チャートノーマル.jpg | image | jpg | 0 B | 2.6 MB |  | not-loaded-on-audited-routes |
| /notes-assets/grading/natural-vs-normal/_archive/candidate-step5-01.png | image | png | 0 B | 2.3 MB |  | not-loaded-on-audited-routes |
| /notes-assets/grading/natural-vs-normal/_archive/step5-main.png | image | png | 0 B | 2.2 MB |  | not-loaded-on-audited-routes |
| /demo/+1STOP.jpg | image | jpg | 0 B | 2.2 MB |  | not-loaded-on-audited-routes |
| /demo/+2STOP.jpg | image | jpg | 0 B | 1.9 MB |  | not-loaded-on-audited-routes |
| /notes-assets/grading/natural-vs-normal/quadrant-aza.png | image | png | 0 B | 1.7 MB |  | not-loaded-on-audited-routes |
| /notes-assets/grading/natural-vs-normal/quadrant-natural-not-normal.png | image | png | 0 B | 1.7 MB |  | not-loaded-on-audited-routes |
| /notes-assets/grading/natural-vs-normal/quadrant-normal.png | image | png | 0 B | 1.6 MB |  | not-loaded-on-audited-routes |
| /notes-assets/grading/natural-vs-normal/quadrant-outdated.png | image | png | 0 B | 1.5 MB |  | not-loaded-on-audited-routes |
| /profile-hero.png | image | png | 25.8 KB | 1.4 MB | chatbot, home | lazy |
| /profile-hero.jpg | image | jpg | 0 B | 1.2 MB |  | not-loaded-on-audited-routes |
| /profile.jpg | image | jpg | 0 B | 1.2 MB |  | not-loaded-on-audited-routes |
| /slides/5複合操作の影響と復元性.png | image | png | 0 B | 1.1 MB |  | not-loaded-on-audited-routes |
| /slides/11分解と整理によるアプローチ.png | image | png | 0 B | 1 MB |  | not-loaded-on-audited-routes |
| /slides/8フレームワーク関連コントロール.png | image | png | 0 B | 1 MB |  | not-loaded-on-audited-routes |
| /slides/7カラーグレーディングのフレームワーク.png | image | png | 0 B | 1005.8 KB |  | not-loaded-on-audited-routes |
| /slides/4プライマリーコントロール概要.png | image | png | 0 B | 1004.7 KB |  | not-loaded-on-audited-routes |
| /slides/2目次.png | image | png | 0 B | 921.9 KB |  | not-loaded-on-audited-routes |
| /slides/10カラーグレーディングのフレームワーク - まとめ.png | image | png | 0 B | 916 KB |  | not-loaded-on-audited-routes |
| /slides/6カラースペーストランスフォームで作業空間を作る.png | image | png | 0 B | 904.6 KB |  | not-loaded-on-audited-routes |
| /slides/9実践.png | image | png | 0 B | 866.5 KB |  | not-loaded-on-audited-routes |
| /slides/3カラーグレーディングの基本概念.png | image | png | 0 B | 847.4 KB |  | not-loaded-on-audited-routes |
| /slides/1カラーグレーディングの基礎.png | image | png | 0 B | 795.9 KB |  | not-loaded-on-audited-routes |
| /slides/color_grading_lp.png | image | png | 0 B | 794.5 KB |  | not-loaded-on-audited-routes |
| /notes/diagrams/correction-factor-map.preview.png | image | png | 0 B | 765.2 KB |  | not-loaded-on-audited-routes |
| /notes/diagrams/correction-scope-map.preview.png | image | png | 0 B | 705.4 KB |  | not-loaded-on-audited-routes |
| /slides/12さいごに.png | image | png | 0 B | 692.8 KB |  | not-loaded-on-audited-routes |
| /notes/diagrams/correction-space-choice.preview.png | image | png | 0 B | 625.9 KB |  | not-loaded-on-audited-routes |

## Build bundle analysis

| Route | Next route | JS gzip | CSS gzip | JS files | CSS files | Exclusive chunks |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| home | / | 285.9 KB | 267.4 KB | 15 | 4 | 0 |
| reservation | /booking | 393.1 KB | 267.4 KB | 19 | 4 | 4 |
| chatbot | /#contact | 285.9 KB | 267.4 KB | 15 | 4 | 0 |
