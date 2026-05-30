import type { ReactNode } from "react";

export type IcoName =
  | "create"
  | "match"
  | "manage"
  | "wheel"
  | "overlay"
  | "obs"
  | "copy"
  | "eye"
  | "lock"
  | "trash";

const ICON_PATHS: Record<IcoName, ReactNode> = {
  create: <path d="M12 5v14M5 12h14" />,
  match: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M3 10h18M9 5v14" />
    </>
  ),
  manage: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  wheel: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
    </>
  ),
  overlay: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M3 16l4 4h10l4-4" />
    </>
  ),
  obs: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="1" />
      <path d="M8 21h8M12 18v3M7 9l3 3-3 3M13 15h4" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="1" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  trash: (
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" />
  ),
};

export type IcoProps = {
  name: IcoName;
  className?: string;
};

export function Ico({ name, className = "gg-icon" }: IcoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
