# 규로마 GYUROMA

**From chaos to chroma.** 이름은 **규**파의 크**로마** — *GYU*pa's ch*ROMA*.

색칠된 3D 모델을 **실 몇 가지를 섞어 뽑는 멀티컬러 3D 프린트 파일**로 바꿔 주는 무료 웹 앱이에요.
Rodin "Face Color" 3MF나 정점색 OBJ를 넣으면, 색을 정리하고 가진 실로 섞는 비율을 정해서
PrusaSlicer(Full Spectrum) 또는 Bambu Studio(혼합 필라멘트)에서 바로 여는 3MF로 내보내요.

**바로 쓰기 (설치 없이): https://gyupa-git.github.io/gyuroma/**
모든 계산은 브라우저 안에서 끝나고, 넣은 파일은 어디로도 올라가지 않아요.
이 웹 주소의 규로마는 방문 수와 불러오기·내보내기 횟수만 익명으로 세요([GoatCounter](https://www.goatcounter.com) · 쿠키 없음 · 모델이나 색 정보는 보내지 않아요).

*A free web app that turns a coloured 3D model into a multi-colour print file that mixes a few filaments:
load a Rodin "Face Color" 3MF or a vertex-colour OBJ, tidy the colours, pick how your spools mix, and export a 3MF
that opens in PrusaSlicer (Full Spectrum) or Bambu Studio (mixed filaments). Everything runs in your browser; the hosted
copy only counts visits, loads and exports anonymously (GoatCounter, no cookies, nothing about your model).*

## 할 수 있는 것 / What it does

1. **불러오기** — Rodin Face Color 3MF, 정점색 OBJ.
2. **색 정리** — 색 띠에서 그룹을 나누고 합치기, 그룹 색 조절, 조각만 떼어 내기·되돌리기, 자동 정돈.
3. **실·섞기** — 가진 실로 색마다 섞는 비율(층 번갈아 쌓기) 정하기, 실 추천.
4. **내보내기** — 프린터별 3MF: Prusa XL·CORE One·MK4S(MMU3), Bambu Lab P2S·X1·P1·A1·H2D·H2C·H2S, Orca 계열 포크, 풀컬러 프린터.
5. **모아 뽑기** — 완성한 3MF 여러 개를 한 판에: 같은 섞는 비율은 하나로 합치고, 실 칸을 맞추고, 판 위에 겹치지 않게 놓아요.

화면 오른쪽 위 **English / 한국어** 버튼으로 언어를 바꿀 수 있어요. *The UI is in Korean and English.*

## 내 컴퓨터에서 실행 / Run it locally

[Node.js](https://nodejs.org) 20 이상이 필요해요. *Needs Node.js 20+.*

- **가장 쉬운 방법**: 저장소를 받은 뒤 **`규로마 실행.command`**(Mac) 또는 **`규로마 실행.bat`**(Windows)을 더블클릭하세요.
  처음 한 번 필요한 것을 설치하고 브라우저를 열어요. 이렇게 켜면 작업이 `rodin-pipeline/user-data/` 폴더에 저장돼요.
- 터미널에서 / in a terminal:

```bash
git clone https://github.com/gyupa-git/gyuroma.git
cd gyuroma
npm install
npm run dev:pipeline     # http://localhost:5173/
npm test                 # 엔진 시험 / engine tests
npm run build            # rodin-pipeline/dist
```

| 폴더 / folder | 내용 / contents |
| --- | --- |
| `rodin-pipeline/` | 규로마 앱 (React · three.js) / the app |
| `color-mix-lab/src/workflows/vertex/core/` | 계산 엔진 — 색 섞기, 팔레트, 3MF 읽기·쓰기 / the engine |

## 라이선스 / License

**무료로 쓰고 고칠 수 있어요. 팔 수는 없어요.** 자세한 내용은 [`LICENSE.md`](LICENSE.md).
*Free to use and change, not to sell. See [`LICENSE.md`](LICENSE.md).*

- CC BY-NC-SA 4.0 — 고쳐서 나눌 때는 원작(규로마 · 규파)을 밝히고 같은 조건으로 공개해 주세요.
- 상업적 사용(앱이나 **앱으로 만든 결과물·출력물** 판매 포함)은 규파의 허락이 필요해요 — 문의 **gyugyutube@gmail.com**.
  *Commercial use needs permission: gyugyutube@gmail.com.*
- '규로마'·'GYUROMA' 이름과 로고, 규파 캐릭터는 허락 없이 쓸 수 없어요.
- 엔진의 일부는 [Color Mix Lab](https://github.com/michaelhq/color-mix-lab)(MIT)에서 왔어요 — 고맙습니다.

## 함께 만들기 / Contributing

버그 제보·제안은 [Issues](https://github.com/gyupa-git/gyuroma/issues)에, 고친 코드는 Pull Request로 보내 주세요.
코드를 보내 주시면(Pull Request 등), 규로마가 앞으로 어떤 모습으로 나오든 함께 쓸 수 있도록, 보내 주신 코드를
쓰고·고치고·나누고 다른 라이선스로도 내놓을 수 있는 권리를 규파에게 주는 데 동의하는 것으로 봅니다.

*Bug reports and ideas go to Issues, code to Pull Requests. By contributing, you give Gyupa the right to use,
change and share your contribution, and to release it under other licences, so it can go wherever 규로마 goes.*

## 만든 사람 / Made by

규파 (Gyupa) — YouTube [@gyupa](https://www.youtube.com/@gyupa) · gyugyutube@gmail.com

규로마가 도움이 됐다면 / If 규로마 helped you:
[투네이션으로 후원](https://toon.at/donate/637376746437296380) · [PayPal](https://paypal.me/gyupa)
