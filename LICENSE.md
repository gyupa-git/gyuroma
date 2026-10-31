# 규로마 GYUROMA — 라이선스 / License

© 2026 규파 (Gyupa) — https://www.youtube.com/@gyupa · gyugyutube@gmail.com

## 한국어

이 저장소의 규로마 코드는 아래 **"Color Mix Lab에서 온 파일"을 빼고** 모두
**크리에이티브 커먼즈 저작자표시-비영리-동일조건변경허락 4.0 국제 (CC BY-NC-SA 4.0)** 로 공개합니다.
원문: [`LICENSE-CC-BY-NC-SA-4.0.txt`](LICENSE-CC-BY-NC-SA-4.0.txt) · https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko

- **누구나 무료로** 쓰고, 고치고, 나눌 수 있어요.
- **출처 표시**: 고치거나 나눌 때 "원작: 규로마 GYUROMA · 규파 (https://github.com/gyupa-git/gyuroma)"를 밝혀 주세요.
  앱 화면 아래 띠의 저작권 줄(© 규파 …)도 지우지 말아 주세요.
- **비영리**: 상업적으로 쓸 수 없어요. 규파는 여기서 말하는 '상업적 사용'에 다음을 모두 포함한다고 봅니다 —
  이 앱이나 고친 판을 파는 것, 유료 서비스에 넣는 것, **이 앱으로 만든 결과물(3MF 파일·G코드·출력물)을 파는 것**.
- **동일조건**: 고친 판은 같은 라이선스(CC BY-NC-SA 4.0)로 공개해야 해요.
- **상업적으로 쓰고 싶다면** 규파에게 따로 허락을 받아 주세요: **gyugyutube@gmail.com** (유튜브 https://www.youtube.com/@gyupa)
- **이름·로고·캐릭터는 이 라이선스에 들어 있지 않아요.** '규로마', 'GYUROMA' 이름과 로고, 규파 캐릭터(얼굴·그림)는
  허락 없이 쓸 수 없어요. 고친 판을 나눌 때는 다른 이름과 로고를 써 주세요(원작 표시는 위처럼 따로 해 주세요).
- **기여**: 코드를 보내 주시면(Pull Request 등), 규로마가 앞으로 어떤 모습으로 나오든 함께 쓸 수 있도록, 보내 주신 코드를
  쓰고·고치고·나누고 다른 라이선스로도 내놓을 수 있는 권리를 규파에게 주는 데 동의하는 것으로 봅니다.
- 이 소프트웨어는 **아무 보증 없이** 있는 그대로 제공됩니다.

### Color Mix Lab에서 온 파일

규로마의 계산 엔진은 [Color Mix Lab](https://github.com/michaelhq/color-mix-lab)(MIT, © Color Mix Lab contributors)을
가져와 고치고 더해서 만들었어요. `color-mix-lab/src/workflows/vertex/core/` 의 다음 10개 파일은 원본에서 왔고,
원본에서 온 부분은 원본의 MIT 라이선스([`color-mix-lab/LICENSE`](color-mix-lab/LICENSE))를 따릅니다
(원본은 위 주소에서 MIT로 그대로 받을 수 있어요). 규로마가 고친 부분과 그 밖의 모든 파일은 위의 CC BY-NC-SA 4.0입니다.

`colour.ts` · `export3mf.ts` · `exportCsv.ts` · `filaments.ts` · `objParser.ts` · `prusaFdmMixer.ts` · `quantize.ts` ·
`template3mf.ts` · `types.ts` · `virtualExtruders.ts`

함께 쓰는 라이브러리(React, three.js, JSZip, fflate, Vite 등)는 각자의 라이선스를 따릅니다.

## English

Except for the files listed under "Files from Color Mix Lab", the 규로마 code in this repository is licensed under
**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**.
Full text: [`LICENSE-CC-BY-NC-SA-4.0.txt`](LICENSE-CC-BY-NC-SA-4.0.txt) · https://creativecommons.org/licenses/by-nc-sa/4.0/

- **Free** to use, change and share.
- **Attribution**: when you change or share it, credit "Original: 규로마 GYUROMA by Gyupa
  (https://github.com/gyupa-git/gyuroma)", and keep the copyright line (© Gyupa …) in the app's footer.
- **NonCommercial**: no commercial use. Gyupa reads commercial use as including selling the app or a changed version,
  putting it in a paid service, and **selling what is made with it (3MF files, G-code, prints)**.
- **ShareAlike**: changed versions must be shared under the same licence (CC BY-NC-SA 4.0).
- **For commercial use**, ask Gyupa for permission: **gyugyutube@gmail.com** (YouTube https://www.youtube.com/@gyupa)
- **The name, logo and character are not licensed.** The names 규로마 and GYUROMA, their logos and the Gyupa character
  (face and drawings) may not be used without permission. Share a changed version under another name and logo
  (and credit the original as above).
- **Contributions**: by contributing (a Pull Request or otherwise), you give Gyupa the right to use, change and share
  your contribution, and to release it under other licences, so it can go wherever 규로마 goes.
- The software is provided **as is, without any warranty**.

### Files from Color Mix Lab

The calculation engine started from [Color Mix Lab](https://github.com/michaelhq/color-mix-lab) (MIT,
© Color Mix Lab contributors). The ten files listed above in `color-mix-lab/src/workflows/vertex/core/` came from it;
what came from the original stays under its MIT licence ([`color-mix-lab/LICENSE`](color-mix-lab/LICENSE)), and the
original is available there under MIT. 규로마's changes to them and every other file are under CC BY-NC-SA 4.0.

The libraries it uses (React, three.js, JSZip, fflate, Vite and others) keep their own licences.
