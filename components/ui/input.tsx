import type { ComponentProps } from "react";
export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`input ${className}`} {...props} />;
}
