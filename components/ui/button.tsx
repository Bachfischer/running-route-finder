import type { ComponentProps } from "react";
export function Button({
  className = "",
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  variant?: "default" | "ghost" | "outline";
  size?: "default" | "icon";
}) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      className={`button ${className}`}
      {...props}
    />
  );
}
