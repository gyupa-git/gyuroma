/**
 * The app guide: Gyupa walks the screen and explains it, chapter by chapter.
 * Each line says what the app does (checked against its screens) and only
 * that: where a way is closed, the way that works is told instead (the
 * owner: "되는 것만 말하면 되지").  The app is a colour tidier first (02),
 * good for every kind of printer; the FDM steps (03, the slicer 3MF) come on
 * top.  Gyupa's voice is the channel's
 * (AI공장/규파/목소리/persona.json): ~습니다 / ~죠 / ~네요, never ~잖아요.
 *
 * `at` lists where Gyupa walks to, first found wins: a CSS selector, or
 * "a@b" for the element a and then its closest ancestor b.  None found (no
 * model loaded yet, a panel closed): Gyupa talks from the middle of the window.
 * **bold** marks the words to find on the screen.
 */
import type { IconName } from "./ui/Shell";

export type GuidePose = "idle" | "point" | "salute" | "wave" | "cheer" | "think";

export interface GuideStep {
  at?: string[];
  /** The app step (01–04) to open before walking there. */
  step?: 1 | 2 | 3 | 4;
  pose?: GuidePose;
  ko: string;
  en: string;
}

export interface GuideChapter {
  id: "tour" | "printers" | "saving" | "about";
  /** The app's own line icon (ui/Shell ICONS), as in its other menus. */
  icon: IconName;
  ko: string;
  en: string;
  steps: GuideStep[];
}

const GUIDE_BUTTON = ["[data-guide=guide]"];
const PRINTER = [".printer-select@.pane-section", ".sidebar"];

export const GUIDE: GuideChapter[] = [
  {
    id: "about",
    icon: "help",
    ko: "규로마가 하는 일",
    en: "What GYUROMA does",
    steps: [
      {
        pose: "salute",
        ko: "규로마(GYUROMA)는 **[규]파의 크[로마]**, 규파의 색이라는 뜻이에요.",
        en: "GYUROMA means **GYUpa's chROMA** — Gyupa's colours.",
      },
      {
        at: [".stage"],
        ko: "색칠된 3D 모델은 색이 아주 많고 경계도 들쭉날쭉하죠. 규로마는 그걸 **몇 가지 깔끔한 색**으로 정리하고 경계를 매끈하게 다듬어 줍니다.",
        en: "A coloured 3D model comes with a great many colours and ragged borders. GYUROMA tidies them into **a few clean colours** with smooth borders.",
      },
      {
        at: [".steps"],
        ko: "그 중심이 **02 색 정리**예요. 정리한 색으로 **FDM 멀티컬러 파일**도, 풀컬러 · UV 프린터용 **색 파일**도 만들고, 레진이면 **칠할 색 계획**으로 쓰면 되죠.",
        en: "Its heart is **02 Colours**. The tidied colours make an **FDM multi-colour file**, a **colour file** for full-colour and UV printers, or a **paint plan** for resin.",
      },
      {
        at: [".steps"],
        ko: "FDM이면 여기에 더해 꽂을 필라멘트와 섞는 비율을 정하고(03), 슬라이서에서 바로 여는 파일로 내보냅니다(04).",
        en: "For FDM it goes further: which filaments to load and how to mix them (03), and a file that opens straight in your slicer (04).",
      },
      {
        pose: "cheer",
        ko: "모든 계산은 이 브라우저 안에서 끝나요. 넣은 파일은 내 컴퓨터에만 있고, 무료로 쓰고 고칠 수 있습니다.",
        en: "Everything runs right here in your browser; your files stay on your computer. It's free to use and to modify.",
      },
      {
        at: GUIDE_BUTTON,
        pose: "wave",
        ko: "자, 이제 직접 해 볼 차례예요. 막히면 언제든 **앱 가이드**로 불러 주세요.",
        en: "Now it's your turn. If you get stuck, call me with **App guide** anytime.",
      },
    ],
  },
  {
    id: "tour",
    icon: "select",
    ko: "한 바퀴 둘러보기",
    en: "Take the tour",
    steps: [
      {
        pose: "salute",
        ko: "자, 규로마를 한 바퀴 돌아볼게요. 알록달록한 3D 모델을 **프린터로 뽑을 수 있는 색**으로 정리해 주는 앱이죠.",
        en: "Let's take a quick walk around GYUROMA. It turns a colourful 3D model into **colours your printer can actually print**.",
      },
      {
        at: [".steps"],
        ko: "작업은 이 네 단계로 갑니다. **01 불러오기 → 02 색 정리 → 03 필라멘트·혼합 → 04 내보내기**. 끝낸 단계엔 체크가 붙죠.",
        en: "Work moves through four steps: **01 Load → 02 Colours → 03 Filament & mix → 04 Export**. Finished steps get a check mark.",
      },
      {
        step: 1,
        at: [".dropzone", ".sidebar"],
        ko: "먼저 여기에 모델을 넣어 줍니다. Rodin 3D Print에서 **Output Mode를 Face Color**로 받은 3MF, 노마드·블렌더에서 정점색으로 내보낸 OBJ, 저장해 둔 **.gyuroma 작업 파일** 다 됩니다.",
        en: "First, drop your model here: a Rodin 3D Print 3MF downloaded with **Output Mode = Face Color**, a vertex-colour OBJ from Nomad or Blender, or a saved **.gyuroma work file**.",
      },
      {
        step: 1,
        at: [".template-block", ".template-card", ".sidebar"],
        ko: "프루사슬라이서 **템플릿 3MF**는 선택이에요. 넣어 두면 베드 크기와 꽂힌 필라멘트 색을 가져와서 03 슬롯에 바로 채워 줍니다.",
        en: "A **PrusaSlicer template 3MF** is optional. Add one and its bed size and loaded filament colours fill the slots in 03 for you.",
      },
      {
        step: 2,
        at: [".inspector", ".stage"],
        ko: "02 색 정리의 주인공은 오른쪽 **색 띠**입니다. 경계를 끌면 색이 옆 띠로 옮겨 가고, 절반을 넘기면 통째로 합쳐지죠. 띠를 두 번 누르면 나뉘어요.",
        en: "In 02 the star is the **colour strip** on the right. Drag a border to move colour into the next band; past halfway it swallows that band whole. Double-click a band to split it.",
      },
      {
        step: 2,
        at: [".tidy-presets", ".sidebar"],
        ko: "색이 너무 많다 싶으면 왼쪽 **자동 정돈** 프리셋을 눌러 보세요. 마우스를 올리면 뭐가 얼마나 바뀌는지 먼저 보여 줍니다.",
        en: "Too many colours? Try an **auto tidy** preset on the left. Hover one first and it shows exactly what will change.",
      },
      {
        step: 2,
        at: [".sidebar-foot", ".sidebar"],
        ko: "마음에 들면 **정리 실행**으로 면 색을 확정해 줍니다. 경계 톱니와 작은 조각도 이때 같이 정리되고, 되돌릴 수도 있어요.",
        en: "Happy with it? **Clean up** bakes the colours into the faces and tidies jagged borders and specks. You can undo it.",
      },
      {
        step: 2,
        at: [".tool-dock", ".stage"],
        ko: "모델을 열면 여기 아래에 직접 손볼 도구가 나옵니다. **선택 V · 브러시 B · 채우기 G · 스포이드 I · 틈새 정리 C · 색지도 M**. 단축키도 같이 적혀 있죠.",
        en: "With a model open, the tools for touching it up by hand sit down here: **Select V · Brush B · Fill G · Eyedropper I · Gap clean C · Colour map M**, shortcut keys included.",
      },
      {
        step: 2,
        at: ["[data-guide=cut]", ".view-tools", ".stage"],
        ko: "경계를 더 매끈하게 하고 싶으면 **선 따라 자르기**를 켜 주세요. 계단진 경계를 선 따라 잘라 보여 주고, **✂ 자르기 확정**을 누르면 모델에 들어갑니다.",
        en: "For smoother borders, switch on **Cut along lines**. It cuts the stair-stepped borders along a smooth line, and **✂ Confirm cut** puts that into the model.",
      },
      {
        step: 3,
        at: [".sidebar"],
        ko: "03에서는 프린터에 꽂을 **필라멘트**를 정합니다. 집에 있는 필라멘트를 **보관함**에 넣어 두면 이 모델에 제일 잘 맞는 조합을 골라 드리죠.",
        en: "03 is about the **filaments** you load. Put the ones you own on the **shelf** and GYUROMA picks the set that suits this model best.",
      },
      {
        step: 3,
        at: [".matrix", ".stage"],
        ko: "꽂지 않은 색은 필라멘트를 **층마다 번갈아 쌓아서** 만들어요. 표에서 줄을 누르면 오른쪽에서 그 색의 레시피를 고칠 수 있습니다.",
        en: "Colours you haven't loaded are made by **alternating filaments layer by layer**. Click a row in this table to adjust that colour's recipe on the right.",
      },
      {
        step: 4,
        at: PRINTER,
        ko: "04에서 **프린터**를 고르면 그 프린터의 슬라이서가 읽는 파일로 맞춰 줍니다. 필라멘트 수, 베드, 층 섞기 되는지까지 같이 검사하죠.",
        en: "In 04, choose your **printer** and the file is written the way its slicer reads it — slot count, bed size and layer mixing are all checked.",
      },
      {
        step: 4,
        at: [".sidebar-foot .btn.primary", ".sidebar-foot", ".sidebar"],
        ko: "검사를 다 통과하면 이 버튼으로 내보냅니다. 파일은 브라우저 **다운로드 폴더**에 저장돼요.",
        en: "When every check passes, export with this button. The file lands in your browser's **downloads folder**.",
      },
      {
        at: GUIDE_BUTTON,
        pose: "wave",
        ko: "다시 보고 싶으면 언제든 여기 **앱 가이드**를 눌러 주세요. 그럼 또 봐요. 뿅!",
        en: "Want to see this again? Press **App guide** up here anytime. See you!",
      },
    ],
  },
  {
    id: "printers",
    icon: "layers",
    ko: "프린터 방식별로 쓰기",
    en: "By printer type",
    steps: [
      {
        pose: "salute",
        ko: "프린터마다 색을 내는 방법이 달라서, 규로마를 쓰는 길도 조금씩 다릅니다. 자, 하나씩 볼게요.",
        en: "Every kind of printer makes colour its own way, so GYUROMA is used a little differently for each. Let's go through them.",
      },
      {
        step: 4,
        at: PRINTER,
        ko: "어느 쪽이든 시작은 같아요. **04 내보내기**에서 내 프린터부터 골라 주세요. 많이 쓰는 필라멘트 프린터, 그 밖의 프린터, **풀컬러 프린터**로 나뉘어 있죠.",
        en: "Whatever you print on, start by picking your printer in **04 Export**. The list is split into popular filament printers, other filament printers and **full-colour printers**.",
      },
      {
        step: 3,
        at: [".sidebar"],
        ko: "**프루사 XL · MMU3 · INDX**는 프루사슬라이서 2.9.6 이상에서 층을 섞어 만든 색까지 그대로 뽑습니다. 앱의 **E1~E5 순서**가 프린터 툴 순서와 같아야 색이 맞아요.",
        en: "**Prusa XL, MMU3 and INDX**: PrusaSlicer 2.9.6 or newer prints the layer-mixed colours too. Keep the app's **E1–E5 order** the same as the printer's tools so the colours land right.",
      },
      {
        step: 4,
        at: PRINTER,
        ko: "**밤부랩**(AMS · H2D · H2C 등)은 밤부 스튜디오 2.8 이상에서 **프로젝트로** 열려요. 섞는 색은 혼합 필라멘트로 들어가 있으니, 필라멘트 종류와 **AMS 칸 순서**만 확인해 주세요.",
        en: "**Bambu Lab** (AMS, H2D, H2C and more) opens in Bambu Studio 2.8 or newer **as a project**, with the mixes as mixed filaments. Just check the filament type and the **AMS slot order**.",
      },
      {
        step: 4,
        at: PRINTER,
        ko: "**크리얼리티 · 엘레구 · 애니큐빅 · QIDI · 스냅메이커 · 플래시포지**는 고르기만 하면, 꽂은 색 그대로(**실물 색만**) 뽑도록 앱이 알아서 맞춰 줍니다.",
        en: "**Creality, Elegoo, Anycubic, QIDI, Snapmaker and Flashforge**: just pick yours and the app sets itself to print the loaded colours as they are (**loaded colours only**).",
      },
      {
        step: 4,
        at: PRINTER,
        ko: "**풀컬러 프린터** — 잉크젯 레진(스트라타시스 폴리젯), UV 잉크젯(미마키), 분말(HP 젯퓨전), 3D시스템즈 — 는 잉크로 색을 직접 만들어요. 03은 건너뛰고, 02에서 정리한 색이 면마다 그대로 든 **색 파일(3MF · OBJ · VRML · PLY)**로 내보냅니다.",
        en: "**Full-colour printers** — Stratasys PolyJet (inkjet resin), Mimaki (UV inkjet), HP Jet Fusion (powder), 3D Systems — make colour from ink themselves. Skip 03: your 02 colours go out face by face in a **colour file (3MF, OBJ, VRML or PLY)**.",
      },
      {
        step: 2,
        at: [".view-tools", ".stage"],
        ko: "**레진**이면 02 색 정리까지만 해도 충분해요. 어지러운 색이 몇 가지 깔끔한 색으로 정리되니 칠할 색과 순서를 정하기 좋고, 조각을 골라 **솔로 · 엑스레이**로 부위마다 볼 수 있죠.",
        en: "Printing in **resin**? 02 Colours is all you need. With the colours tidied into a few clean ones, choosing paints and their order is easy — pick a part and look at it with **Solo and X-ray**.",
      },
      {
        step: 4,
        at: PRINTER,
        ko: "정리한 색을 파일로 갖고 싶으면 04에서 **다른 풀컬러 프린터 · 범용 색 파일**을 골라 주세요. 3MF · OBJ · VRML · PLY로 나가니, 칠할 때 옆에 띄워 두거나 색이 든 3D 파일을 받는 **UV 프린터**에 넣으면 되죠.",
        en: "Want the tidied colours as a file? In 04 choose **Other full-colour printer · general colour file**. It comes out as 3MF, OBJ, VRML or PLY — keep it open beside you while you paint, or load it into a **UV printer** that takes coloured 3D files.",
      },
      {
        step: 1,
        at: [".load-gather", ".dropzone", ".sidebar"],
        ko: "완성한 3MF 여러 개를 한 판에 뽑고 싶을 땐 **모아 뽑기**를 열어 주세요. 프루사슬라이서 · 밤부 스튜디오 파일을 하나로 합쳐서 판 위에 겹치지 않게 놓아 줍니다.",
        en: "To print several finished 3MFs on one plate, open **Gather**. It merges PrusaSlicer or Bambu Studio files into one and lays them out without overlapping.",
      },
      {
        at: GUIDE_BUTTON,
        pose: "wave",
        ko: "프린터를 바꾸면 04에서 다시 골라 주기만 하면 돼요. 그럼 멋진 출력 되세요!",
        en: "Switching printers? Just pick the new one in 04. Happy printing!",
      },
    ],
  },
  {
    id: "saving",
    icon: "download",
    ko: "저장 방법",
    en: "Saving your work",
    steps: [
      {
        pose: "salute",
        ko: "저장은 신경 쓸 게 거의 없어요. 그래도 작업이 어디에 남는지는 알아 두면 좋죠.",
        en: "You barely need to think about saving — but it's good to know where your work goes.",
      },
      {
        at: [".storage-mode", ".statusbar"],
        ko: "작업은 **자동 저장**됩니다. 공개 사이트에서는 **이 브라우저 안**에, 내 컴퓨터에서 **규로마 실행** 파일로 켜면 규로마 폴더의 **user-data**에 파일로 남아요. 지금 어느 쪽인지는 여기 적혀 있죠.",
        en: "Your work **saves automatically** — **inside this browser** on the public site, or as files in the **user-data** folder when you start GYUROMA from its launcher on your computer. This tells you which one you're on.",
      },
      {
        at: [".file-chip .save-file", ".save-work", ".dropzone", ".sidebar"],
        step: 1,
        ko: "브라우저 저장은 그 브라우저 안에 있어요. **파일로 저장**을 눌러 **.gyuroma 작업 파일**로 남겨 두면 어디서든 열 수 있죠. 모델 · 색 · 자르기 · 설정이 파일 하나에 다 들어갑니다.",
        en: "Browser storage lives in that browser. Press **Save to file** and keep a **.gyuroma work file** to open it anywhere — model, colours, cuts and settings, all in one file.",
      },
      {
        step: 1,
        at: [".dropzone", ".sidebar"],
        ko: "작업 파일은 **01 불러오기 칸**에 넣으면 그대로 열려요. 다른 컴퓨터, 다른 브라우저에서도 마찬가지죠.",
        en: "To reopen it, drop the work file into the **01 Load** box — on any computer, in any browser.",
      },
      {
        step: 1,
        at: [".work-state", ".dropzone", ".sidebar"],
        ko: "모델을 열면 여기 **작업 상태**에서 자동 저장을 켜고 끄고, **원본 색으로** 되돌리거나 **새로 시작**할 수 있어요.",
        en: "With a model open, the **Work** box here turns autosave on and off, goes back **to the original colours**, or **starts over**.",
      },
      {
        at: ["[data-guide=undo]"],
        ko: "실수했으면 **⌘Z**(윈도우는 Ctrl+Z)로 되돌리고 **⇧⌘Z**로 다시 하면 됩니다. 옆 숫자는 몇 번 더 되돌릴 수 있는지예요.",
        en: "Made a mistake? **⌘Z** (Ctrl+Z on Windows) undoes and **⇧⌘Z** redoes. The number shows how many more steps you can undo.",
      },
      {
        at: ["[data-guide=settings]"],
        ko: "필라멘트 목록 · 혼합 같은 **설정**은 ⚙ 설정의 **설정 저장**으로 JSON 파일로 따로 받아 둘 수 있어요.",
        en: "Your **settings** — filament list, mixing and the rest — can be kept separately as a JSON file with **Save settings** in ⚙ Settings.",
      },
      {
        step: 4,
        at: [".sidebar-foot .btn.primary", ".sidebar-foot", ".sidebar"],
        ko: "내보낸 출력 파일은 브라우저 **다운로드 폴더**로 갑니다. 안 보이면 04의 **다시 받기**를 눌러 주세요.",
        en: "Exported print files go to your browser's **downloads folder**. If one doesn't show up, press **Download again** in 04.",
      },
      {
        at: GUIDE_BUTTON,
        pose: "wave",
        ko: "이것만 기억해 주세요. 소중한 작업은 **파일로 저장**! 그럼 또 봐요.",
        en: "Just remember: for work that matters, **Save to file**! See you.",
      },
    ],
  },
];

/**
 * First-time hints, each shown once in this browser (remembered in
 * localStorage), never again after — then only the guide button opens the
 * guide: the order of the steps on the first visit, and what a step is for
 * (and which comes next) the first time 02, 03 or 04 opens.  Taking the tour
 * counts as having seen the step hints.
 */
export type GuideHintKey = "welcome" | 2 | 3 | 4;

export const HINTS: Record<GuideHintKey, GuideStep> = {
  welcome: {
    at: [".steps"],
    ko: "어서와요! 규로마는 색칠된 3D 모델의 어지러운 색을 **몇 가지 깔끔한 색**으로 정리해 주는 앱이에요. 작업은 **01 불러오기 → 02 색 정리 → 03 필라멘트·혼합 → 04 내보내기** 순서로 가고, 03은 FDM일 때 쓰죠. 처음이면 한 바퀴 둘러보기부터 보셔도 좋습니다.",
    en: "Welcome! GYUROMA tidies a coloured 3D model's messy colours into **a few clean ones**. Work goes **01 Load → 02 Colours → 03 Filament & mix → 04 Export**; 03 is for FDM. First time? The tour shows you round.",
  },
  2: {
    at: [".inspector", ".sidebar"],
    ko: "02 색 정리예요. 오른쪽 **색 띠**나 왼쪽 **자동 정돈**으로 색을 정리하고, 마음에 들면 **정리 실행**을 눌러 주세요. 다 됐으면 FDM은 **03 필라멘트·혼합**으로, 다른 프린터는 **04 내보내기**로 가요.",
    en: "This is 02 Colours. Tidy the colours with the **colour strip** on the right or an **auto tidy** preset on the left, then press **Clean up**. Then go on to **03 Filament & mix** for FDM, or straight to **04 Export** for other printers.",
  },
  3: {
    at: [".sidebar"],
    ko: "03에서는 프린터에 꽂을 **필라멘트**를 정합니다. 꽂지 않은 색은 층을 섞어서 만들어 주죠. 정해졌으면 **04 내보내기**로 가요.",
    en: "In 03 you choose the **filaments** to load; colours you haven't loaded are mixed layer by layer. Once that's settled, go on to **04 Export**.",
  },
  4: {
    at: PRINTER,
    ko: "마지막 04예요. **프린터**를 고르고, 검사가 다 통과하면 내보내기를 눌러 주세요. 설명이 다시 필요하면 위의 **앱 가이드**를 누르시면 됩니다.",
    en: "Last, 04. Choose your **printer**, and when every check passes, export. Need the explanations again? Press **App guide** up top.",
  },
};

const SEEN_KEY = "rodin-pipeline-guide-seen";

function seenHints(): Array<GuideHintKey> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(value) ? (value as Array<GuideHintKey>) : [];
  } catch {
    return [];
  }
}

export function markHintsSeen(keys: Array<GuideHintKey | number>): void {
  const seen = new Set<GuideHintKey | number>(seenHints());
  for (const key of keys) seen.add(key);
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // ignore: without storage a hint may come again
  }
}

/** The hint due now, if any: the welcome first, then the open step's (02–04) first visit. */
export function dueHint(step: number): GuideHintKey | null {
  const seen = seenHints();
  if (!seen.includes("welcome")) return "welcome";
  if ((step === 2 || step === 3 || step === 4) && !seen.includes(step)) return step;
  return null;
}
