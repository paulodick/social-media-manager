"use client";

import { useState } from "react";

export default function CopyButton({ text, label = "Copiar legenda", className = "btn" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          window.prompt("Copie a legenda:", text);
        }
      }}
    >
      {done ? "Copiado" : label}
    </button>
  );
}
