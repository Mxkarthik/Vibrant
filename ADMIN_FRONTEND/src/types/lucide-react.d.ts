declare module "lucide-react" {
  import type { SVGProps } from "react";
  type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };
  export const ArrowUpRight: (props: IconProps) => JSX.Element;
  export const Check: (props: IconProps) => JSX.Element;
  export const LockKeyhole: (props: IconProps) => JSX.Element;
  export const ShieldAlert: (props: IconProps) => JSX.Element;
  export const ShieldCheck: (props: IconProps) => JSX.Element;
}
