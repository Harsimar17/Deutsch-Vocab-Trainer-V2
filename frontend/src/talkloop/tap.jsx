import React, { useRef } from "react";

// Runs a handler on a tap without taking focus from the text box. A button would otherwise
// blur it, and on phones that drops the keyboard and reflows the dock mid-tap. iOS decides
// that at the touch level, so the tap is handled on touchend with its default prevented
// (which also cancels the synthesized click). A touch that moved is a scroll (of the chip
// row or the transcript) and a long press is text selection, so neither counts as a tap.
// click covers mouse and keyboard activation, unless the button submits the form, whose
// submit handler covers those instead. selectable keeps text selectable with the mouse.
export function useTap(handler, { click = true, selectable = false } = {}) {
  const start = useRef(null);
  const latest = useRef(handler);
  latest.current = handler;
  return {
    onMouseDown: selectable ? undefined : (event) => event.preventDefault(),
    onTouchStart: (event) => {
      const t = event.touches[0];
      start.current = { x: t.clientX, y: t.clientY, at: Date.now() };
    },
    onTouchEnd: (event) => {
      const t = event.changedTouches[0];
      const s = start.current;
      const tap = s && Math.hypot(t.clientX - s.x, t.clientY - s.y) <= 10 && Date.now() - s.at < 500;
      start.current = null;
      if (!tap) return;
      event.preventDefault();
      latest.current();
    },
    onClick: click ? () => latest.current() : undefined,
  };
}

// A button that acts on a tap as above.
export function TapButton({ onTap, click, selectable, children, type = "button", ...rest }) {
  const handlers = useTap(onTap, { click, selectable });
  return <button type={type} {...rest} {...handlers}>{children}</button>;
}
