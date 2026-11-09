# GYUROMA guide

GYUROMA takes a painted 3D model's messy colours, tidies them into **a few clean colours**, and writes a file a multi-colour printer prints as it is. The work goes in four steps.

**01 Load → 02 Tidy colours → 03 Filaments & mixing → 04 Export**

Everything is worked out in this browser. Your files stay on your own computer.

![The whole screen](overview)

## The screen at a glance

- **Top bar** — from the left: the file chip (name · face count · save dot · Save to file), steps 01–04 (a tick on the ones done), ↶ ↷ undo and redo (the number = steps left), App guide, ? help (glossary · this guide), ⚙ settings, Export 3MF.
- **Left panel** — the step's own work. The bold button at its foot (02 **Tidy up**, 04 **Export 3MF**) stays in place while the content scrolls.
- **3D view in the middle** — the original, both side by side, or the result; the result as the **palette** (the tidied colours) or the **print simulation** (the colours that will print). The view tools at the top right switch the direction, flat colours, form lines, soft borders and cutting along the lines.
- **Tool dock below** — the hand tools (see below).
- **Right panel** — 02 the colour spectrum, 03 the recipe, 04 the banding check.

In the 3D view: **drag** to turn · **wheel** to zoom · **space + drag** (or right-drag) to move.

## 01 Load

You can put in:

- **Vertex-colour OBJ** — exported with vertex colours from Nomad Sculpt or Blender
- **Face-colour 3MF** — a 3MF exported with face colours (Face Color)
- **.gyuroma work file** — a work saved in GYUROMA (model · colours · cuts · settings in one file)

A **template 3MF** is optional. Put in an empty PrusaSlicer project saved with your printer profile and filaments: the bed size and the loaded filament colours come in and fill the 03 slots.

With a model open, **Work state** turns autosave on or off, goes back to the **original colours**, **saves the work to a file**, or **starts afresh**.

![01 Load](load)

## 02 Tidy colours

### Target colour count

The number at the top left is how many colours you end with (8 · 12 · 16 · 24 to pick quickly). Changing it lays the spectrum's borders again.

### The colour spectrum (the bands on the right)

One band is one final colour. Its height is the area the colour covers; the chip on its right (E1 · VE7 …) is the filament it prints as.

- **Drag a border** — colour moves into the next band. Past the other band's middle, the whole band joins.
- **⇧ + drag** — moves it a little at a time, to set a light/dark border.
- **Press a band twice** — splits it in two.
- **By area / Even** — with many small colours, 'Even' makes them easy to handle.

![02 Tidy colours](tidy)

### Auto tidy presets

Hover a button first: it shows what changes and by how much. Choose **where** (the whole model · picked patches only) and **what** (colour tidy · mixing · both).

| Preset | What it does |
|---|---|
| Crisp borders | straightens the borders between colours; small blotches take the colour around them |
| Keep gradients | keeps light-to-dark shading as several steps |
| Clean solids | one flat colour for each part |
| Keep small details | keeps small colours such as pupils, cheeks and ribbons |
| Trim teeth | trims the thin triangles (spikes) sticking out of borders |
| Smooth borders | draws stepped or zigzag borders again as gentle lines |

### Tidy up

When you like it, press **Tidy up** at the bottom left. The faces take the bands' colours, and jagged borders and tiny pieces are tidied with them. ⌘Z undoes it.

## The hand tools

The tool dock under the view. The letter under each button is its key.

| Tool | Key | What it does |
|---|---|---|
| Select | V | press a patch to pick it · ⇧ adds |
| Brush | B | left-drag paints · `[` `]` size · `S` inside the picked patch only |
| Heal | H | rub, and specks and blotches take the colour around them (no colour to choose) |
| Fill | G | fills the pressed patch with this colour · hovering shows what will be filled |
| Eyedropper | I | picks a colour off the model |
| Gap clean | C | removes slivers of another colour caught between two colours |
| Guide line | L | draws a guide line along the surface (paints nothing · kept per model) |
| Colour map | M | lays the model's surface out flat |
| Fit | F | fits the model in the view |

While painting: left-drag paints · right-drag turns · space + drag moves · wheel zooms.

![The tool dock](tools)

## The colour map and unfolding

The **colour map (M)** is the model's surface laid out flat. Inner and hidden faces that are hard to reach in 3D are painted right on the map, and the 3D view and the map point to the same spot.

- **Unfold the picked patch** — press a patch and it alone is unfolded in one piece (like Blender's unwrap, keeping its angles). Big patches are solved on the graphics card, so they come quickly.
- **With the faces around** — the faces of other colours around the patch are unfolded with it as a band, for widening or fixing the border on the map. **Width** makes the band up to ×8 wider.
- **↩ Fold the picked patch** — back to the whole map. Pressing an empty spot or Esc does the same.

![The colour map](map)

## 03 Filaments & mixing

- **Printer slots** — the filaments in your printer (E1 …). Press a colour box to change it, or type #RRGGBB.
- **Shelf** — put the filaments you have on it and it picks the set that fits this model best.
- **Mixing** — a colour not loaded is made by **stacking filaments layer by layer**. Choose how many to mix (single only · up to 2 · up to 3) and the layer ratio step.

### Reading the mapping table

| Column | Meaning |
|---|---|
| E1–E5 | how many layers of that filament in one cycle (the bar below = its share) |
| Predicted | left = the colour wanted, right = the colour that prints |
| ΔE | the difference between the two — yellow over 5, red over 10 |
| Match | how close it comes to the colour wanted (%) |
| Cycle · layer order | layers in one repeat and the order they are stacked |
| Output | the extruder the slicer shows (E = a filament, VE = a mix) |

Press a row and the **recipe** on the right changes its layer counts or picks **another set**.

![03 Filaments & mixing](mix)

## 04 Export

1. Choose the **printer**. Each opens in its own program with its own filament count, bed and mixing, so the file format and the checks follow it.
   - **Prusa XL · MMU3 · INDX** — PrusaSlicer 2.9.6 or later prints the mixed colours as they are.
   - **Bambu Lab** (AMS · H2D · H2C and more) — opens as a project in Bambu Studio 2.8 or later; the mixes come in as mixed filaments.
   - **Creality · Elegoo · Anycubic · QIDI · Snapmaker · Flashforge** — set up to print the loaded colours as they are (filament colours only).
   - **Full-colour printers** (inkjet · UV · powder) — a colour file with the colours tidied in 02.
2. **Check the printer's tool order** — E1–E5 in the app must be the tools in the printer, in the same order.
3. **Print quality** — as in the template · finest 0.10 · **High · slow outer walls** 0.15 · **Normal · fast** 0.15 · fast 0.20 · draft 0.25. The two 0.15s share the layer height and differ in the outer-wall speed (for figures, where the outside shows: slow outer walls).
4. Look over the size, the face down and the final check; the **banding check** on the right shows whether a mix will read as stripes.
5. **Export 3MF** at the bottom left — **Export for this printer?** shows the printer's name, the program that opens the file and the filament slots. If it is right, press **Export for this printer**; if not, change it right there under **Another printer**. The file goes to the browser's downloads folder. In PrusaSlicer, open it with **⌘O (Open project)**; in Bambu Studio, with **Open Project**.

To print several finished 3MFs on one plate, open **Gather**: it joins PrusaSlicer and Bambu Studio files into one and lays them on the plate without overlap.

![04 Export](export)

<!-- claude -->
## 💬 Consult Claude

In **💬 Consult Claude** on the left of each step, ask and have things changed in your own words (with this computer's Claude login or your API key).

- **🤖 AI flat paint** — paints each part one clean colour, all at once. It takes a few minutes; look at the preview, then **✅ Apply**.
- Ask in words — e.g. "soft on the face, flat colours on the clothes". Paste or drop pictures to send with it (up to 3).
- Changes show as a preview first: **✅ Apply** or **↩ Cancel**.
- Press the title (▾) to fold it; each step remembers its own. It opens again when Claude starts working or an answer comes.
<!-- /claude -->

## ⚙ Speed & memory

⚙ Settings → **Speed & memory…**. Changes apply at once, and the top of the box shows what this computer can do (graphics-card computing · processor cores · memory limit).

| Setting | What it does |
|---|---|
| Unfold on the graphics card | the colour map's unfolding solved on the graphics card (WebGPU) — big patches several times faster. Off: the processor does the same |
| 3D view sharpness | Auto · 1× · 1.5× · 2× — lower draws fewer pixels, so turning and painting feel lighter |
| Highlight blink | newly picked or changed places blink twice. Off: they just show, and it is lighter |
| Save memory | Auto · On · Off — on: 8 undo steps, 2 cut undo steps, smaller caches, and a hidden 3D view lets go of its graphics-card memory. Auto = models over 2 million faces |
| Export on a core of its own | the 3MF written on another processor core — the window stays live while a big model exports (the whole a little longer) |
| 3MF export compression | Small · Fast — fast exports a little quicker, the file ~8% bigger |

![Speed & memory](perf)

## Saving

- **Autosave** — on the public site, inside this browser; started on your computer with 'GYUROMA run', in the user-data folder. The dot on the file chip shows the save state (hover it for words).
- **If a save does not go through** — press **save failed** on the file chip to save at once (left alone, it saves again by itself shortly). GYUROMA on this computer keeps the copy before each save, so a broken record comes back from that copy.
- **Save to file** — keep precious work as a .gyuroma work file. Put it in 01 Load on any computer or browser and it opens as it was.
- **Save settings** — the filament list, mixing and other settings: ⚙ Settings → Save settings, as a JSON file.
- **Download again** — if the exported file is not in your downloads folder, press 'Download again' at the bottom left of 04.

## When…

- **…the view feels heavy** — in ⚙ Speed & memory, set the 3D view sharpness to 1× and the highlight blink off; for a big model, turn Save memory on.
- **…the status bar says 'storage: browser only ⚠'** — start GYUROMA again with the launcher and reload: the work is saved into the folder again.
- **…you want to go on at another computer** — keep a .gyuroma with 01's **Save the work to a file** and put it in 01 Load there. Very large 3MFs (millions of faces) open as they are, too.
- **…you want exports faster** — set the 3MF export compression to Fast.
- **…the colours come in another order in the slicer** — match E1–E5 in 04's tool-order check to the printer's tools, and open the file with ⌘O (Open project) in PrusaSlicer 2.9.6 or later.
- **…you want the tour again** — **App guide** in the top bar walks you round the screen.

## Keys

| Key | Does |
|---|---|
| V · B · H · G · I · C · L · M · F | select · brush · heal · fill · eyedropper · gap clean · guide line · colour map · fit |
| `[` `]` | brush smaller · bigger |
| S | paint inside the picked patch only |
| ⌘Z · ⇧⌘Z | undo · redo (Ctrl on Windows) |
| space + drag | move the view |
| Esc | let go of the pick · close a box |
| Enter | run the gap clean |
