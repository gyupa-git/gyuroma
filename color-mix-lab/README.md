# 규로마 계산 엔진 / 규로마's engine

`src/workflows/vertex/core/` 는 규로마 앱(`../rodin-pipeline`)이 `@core/*` 로 불러 쓰는 계산 엔진이에요 —
색 섞기, 팔레트 줄이기, 색 띠, 실 추천, 3MF 읽기·쓰기(PrusaSlicer Full Spectrum · Bambu Studio 프로젝트), 칠하기 번호.

이 엔진은 [Color Mix Lab](https://github.com/michaelhq/color-mix-lab)(MIT, © Color Mix Lab contributors, 커밋 `6b726e7`)에서
갈라져 나왔어요. 원본에서 온 10개 파일과 라이선스는 저장소 루트의 [`LICENSE.md`](../LICENSE.md), 원본의 MIT 라이선스는
[`LICENSE`](LICENSE)에 있어요. 원본의 화면(UI)은 규로마가 쓰지 않아서 이 저장소에는 넣지 않았어요.

```bash
npm test     # 저장소 루트에서 / from the repository root
```

*The engine `src/workflows/vertex/core/` grew out of Color Mix Lab (MIT). The ten files that came from it, and the
licences, are listed in the root [`LICENSE.md`](../LICENSE.md); Color Mix Lab's MIT licence is in [`LICENSE`](LICENSE).
Its original user interface is not used by 규로마 and is not included here.*
