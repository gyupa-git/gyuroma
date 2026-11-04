# 규로마 GYUROMA

**From chaos to chroma.** 이름은 **규**파의 크**로마** — *GYU*pa's ch*ROMA*.

색칠된 3D 모델의 어지러운 색을 **몇 가지 깔끔한 색**으로 정리해 주는 무료 웹 앱이에요.
정리한 색으로 **FDM 멀티컬러 프린트 파일**을 만들고, **풀컬러 · UV 프린터용 색 파일**로 내보내고,
레진으로 뽑는다면 **칠할 색 계획**으로 쓰면 돼요.

**바로 쓰기 (설치 없이): https://gyupa-git.github.io/gyuroma/**
처음이라면 위쪽 **앱 가이드**를 눌러 보세요. 규파가 화면을 돌아다니며 쓰는 법을 알려 줘요.

모든 계산은 브라우저 안에서 끝나고, 넣은 파일은 내 컴퓨터에만 있어요.
이 웹 주소의 규로마는 방문 수와 불러오기·내보내기 횟수만 익명으로 세요([GoatCounter](https://www.goatcounter.com) · 쿠키 없음 · 모델이나 색 정보는 보내지 않아요).

*GYUROMA is a free web app that tidies a coloured 3D model's messy colours into **a few clean ones** — and turns them
into a multi-colour FDM print file, a colour file for full-colour and UV printers, or a paint plan for resin.
New here? Press **App guide** at the top and Gyupa walks you round the screen. Everything runs in your browser and your
files stay on your computer; the hosted copy only counts visits, loads and exports anonymously (GoatCounter, no cookies,
nothing about your model).*

## 작업 순서 / How it works

| 단계 / step | 하는 일 / what happens |
| --- | --- |
| **01 불러오기** · Load | 면 색 "Face Color" 3MF, 정점색 OBJ(노마드 · 블렌더), 저장해 둔 `.gyuroma` 작업 파일 |
| **02 색 정리** · Colours | 규로마의 중심. 색 띠에서 그룹 나누기 · 합치기, 자동 정돈 프리셋, 브러시 · 채우기 · 스포이드 · 틈새 정리, 색지도, **선 따라 자르기**로 매끈한 경계 |
| **03 필라멘트 · 혼합** · Filament & mix | FDM일 때. 가진 필라멘트로 슬롯 정하기와 추천, 꽂지 않은 색은 층을 번갈아 쌓아 섞기 |
| **04 내보내기** · Export | 프린터를 고르면 그 프린터에 맞는 파일로 |

*01 Load → 02 Colours (the heart of it) → 03 Filament & mix (for FDM) → 04 Export.*

## 프린터 방식별로 / By printer type

- **FDM 멀티컬러**
  - 프루사 XL · CORE One · MK4S(MMU3) · INDX — PrusaSlicer 2.9.6 이상(Full Spectrum)에서 섞은 색까지 그대로 뽑아요.
  - 밤부랩 P2S · X1 · P1 · A1 · H2D · H2C · H2S — Bambu Studio 2.8 이상에서 프로젝트로 열려요. 섞은 색은 혼합 필라멘트로 들어가요.
  - 크리얼리티 · 엘레구 · 애니큐빅 · QIDI · 스냅메이커 · 플래시포지 — 꽂은 색 그대로 뽑는 3MF로 맞춰 줘요.
  - 완성한 3MF 여러 개를 한 판에 뽑을 땐 **모아 뽑기** — 같은 섞는 비율은 하나로 합치고, 실 칸을 맞추고, 판 위에 겹치지 않게 놓아요.
- **풀컬러 · UV** — 스트라타시스 폴리젯(J55 · J850), 미마키 UV 잉크젯(3DUJ-2207 · 553), HP 젯퓨전 580 Color, 3D Systems ProJet CJP.
  02에서 정리한 색이 면마다 든 색 파일(3MF · OBJ · VRML · PLY)로 내보내요. 목록에 없는 프린터는 **범용 색 파일**로.
- **레진** — 02 색 정리까지로 칠할 색과 순서가 정해져요. 조각을 골라 솔로 · 엑스레이로 부위마다 보고,
  범용 색 파일로 내보내 칠할 때 옆에 띄워 둘 수도 있어요.

*FDM — Prusa (PrusaSlicer 2.9.6+, Full Spectrum), Bambu Lab (opens in Bambu Studio 2.8+ as a project, mixes as mixed
filaments), Creality, Elegoo, Anycubic, QIDI, Snapmaker and Flashforge (the loaded colours); **Gather** puts several
finished 3MFs on one plate. Full-colour & UV — Stratasys PolyJet, Mimaki UV inkjet, HP Jet Fusion 580 Color,
3D Systems ProJet CJP: a colour file (3MF, OBJ, VRML or PLY), or a **general colour file** for any other printer.
Resin — tidy the colours in 02 to plan the paint job, and keep a general colour file open beside you while you paint.*

## 저장 / Saving

- 작업은 **자동 저장**돼요. 공개 사이트에서는 그 브라우저 안에, 내 컴퓨터에서 실행 파일로 켜면 `rodin-pipeline/user-data/` 폴더에.
- **파일로 저장**을 누르면 모델 · 색 · 자르기 · 설정이 `.gyuroma` 파일 하나에 담겨요.
  어느 컴퓨터, 어느 브라우저에서든 01 불러오기 칸에 넣으면 그대로 열려요.
- 설정만 따로 남길 땐 ⚙ 설정 › **설정 저장**(JSON).

*Work saves automatically — in the browser on the public site, in `rodin-pipeline/user-data/` when run locally.
**Save to file** keeps model, colours, cuts and settings in one `.gyuroma` file: drop it into 01 Load on any computer, in
any browser. Settings alone: ⚙ Settings › Save settings (JSON).*

오른쪽 위 ⚙ 설정에서 **English / 한국어**를 바꿀 수 있어요. *Switch between English and Korean in ⚙ Settings, top right.*

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
