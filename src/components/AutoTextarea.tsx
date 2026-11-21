"use client";

import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

/** Caixa de texto que cresce com o conteúdo (até 60% da altura da tela; depois rola por dentro). */
export default function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.6))}px`;
  };
  useEffect(fit, []);
  return <textarea {...props} ref={ref} className="auto-grow" onInput={(e) => { fit(); props.onInput?.(e); }} />;
}
