import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Gap between the pointer's tip and the note: past the spinning wheel the arrow carries at its lower right (at 18 px
 * the words ran under it — 11-05, the owner: "약간 더 우측으로 옮겨서 글자가 겹치지 않도록").
 */
const OFFSET_X = 40;
const OFFSET_Y = 20;

/**
 * What the app is working on, beside the spinning pointer (11-05, the owner: "로딩할때 무엇을 위한 로딩인지 마우스
 * 포인터 로딩아이콘 옆에 글을 같이 적어줘"): the same words as the loader in the middle — "OBJ 읽는 중 42%", "고른 조각을
 * 한 장으로 펼치는 중" — so the reason is where the eye is.  Shown only while the pointer spins (`text` set), only for a
 * mouse or pen (a finger has no pointer to sit by), and turned to the pointer's other side at the window's edge.
 * It is moved by hand on each pointer move, not drawn again by React.
 */
export function PointerNote({ text }: { text: string | null }) {
  const noteRef = useRef<HTMLDivElement | null>(null);
  const at = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const place = () => {
      const note = noteRef.current;
      const p = at.current;
      if (!note) return;
      if (!p) {
        note.style.visibility = "hidden";
        return;
      }
      const w = note.offsetWidth;
      const h = note.offsetHeight;
      let x = p.x + OFFSET_X;
      let y = p.y + OFFSET_Y;
      if (x + w > window.innerWidth - 4) x = Math.max(4, p.x - OFFSET_X / 2 - w);
      if (y + h > window.innerHeight - 4) y = Math.max(4, p.y - OFFSET_Y / 2 - h);
      note.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      note.style.visibility = "visible";
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      at.current = { x: event.clientX, y: event.clientY };
      place();
    };
    const leave = (event: MouseEvent) => {
      if (event.relatedTarget) return;
      at.current = null;
      place();
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("mouseout", leave);
    place();
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("mouseout", leave);
    };
  }, [text]);

  if (!text) return null;
  return createPortal(
    <div ref={noteRef} className="pointer-note" role="status" aria-live="polite">
      {text}
    </div>,
    document.body,
  );
}
