import type { HTMLAttributes, ReactNode } from "react";

export default function Card({ children, className = "", ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section className={`surface-card${className ? ` ${className}` : ""}`} {...props}>{children}</section>;
}
