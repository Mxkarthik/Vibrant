import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet"; icon?: ReactNode };

export default function Button({ variant = "secondary", icon, className = "", children, ...props }: ButtonProps) {
  return <button className={`ui-button button-${variant}${className ? ` ${className}` : ""}`} {...props}>{icon}{children}</button>;
}
