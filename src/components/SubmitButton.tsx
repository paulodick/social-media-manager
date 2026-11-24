"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Botão de envio com proteção contra duplo clique via `useFormStatus`.
 * Enquanto o formulário está enviando, desabilita todos os botões de envio do mesmo formulário
 * e exibe `pendingLabel`. Respeita a regra do React: nunca passa `name`/`value` junto com `formAction`.
 */
export default function SubmitButton({
  children,
  pendingLabel = "Salvando…",
  className,
  disabled,
  title,
  name,
  value,
  formAction,
  formNoValidate,
  onClick,
  tabIndex,
  "aria-hidden": ariaHidden,
  "data-save": dataSave,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  name?: string;
  value?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  formNoValidate?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  tabIndex?: number;
  "aria-hidden"?: boolean;
  "data-save"?: boolean;
}) {
  const { pending } = useFormStatus();
  const isDisabled = !!disabled || pending;
  return (
    <button
      type="submit"
      className={className}
      disabled={isDisabled}
      title={title}
      name={formAction ? undefined : name}
      value={formAction ? undefined : value}
      formAction={formAction}
      formNoValidate={formNoValidate}
      onClick={onClick}
      tabIndex={tabIndex}
      aria-hidden={ariaHidden}
      data-save={dataSave ? "" : undefined}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
