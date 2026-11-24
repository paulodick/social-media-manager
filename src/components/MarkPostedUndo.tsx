"use client";

import { useEffect, useState } from "react";
import { undoMarkPosted } from "@/lib/actions";

export default function MarkPostedUndo({ id, antes }: { id: string; antes: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      if (typeof window !== "undefined" && window.location.search.includes("feito=")) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [id, antes]);

  if (!visible) return null;

  return (
    <div className="alert ok row between" role="status" style={{ alignItems: "center", gap: 12 }}>
      <span>Marcado como postado.</span>
      <form action={undoMarkPosted}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="antes" value={antes} />
        <input type="hidden" name="volta" value="/postar-hoje" />
        <button type="submit" className="btn small">Desfazer</button>
      </form>
    </div>
  );
}
