import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";

/* ── Button ──────────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-teal-600 text-white shadow-sm shadow-teal-600/20 hover:bg-teal-700 focus-visible:ring-teal-500",
  secondary:
    "bg-white text-slate-700 border border-slate-300 shadow-sm hover:bg-slate-50 focus-visible:ring-slate-400",
  outline:
    "bg-transparent text-teal-700 border border-teal-600 hover:bg-teal-50 focus-visible:ring-teal-500",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400",
  danger:
    "bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-500",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ── Form controls ───────────────────────────────────────────────────────── */

const fieldBase =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldBase} ${className}`} {...props} />;
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldBase} resize-y ${className}`} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${fieldBase} pr-8 ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Label({
  className = "",
  htmlFor,
  children,
}: {
  className?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={`mb-1.5 block text-sm font-medium text-slate-700 ${className}`}
    >
      {children}
    </label>
  );
}

/* ── Card ────────────────────────────────────────────────────────────────── */

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
      {...props}
    />
  );
}

export function CardHeader({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`px-5 pt-5 pb-0 ${className}`} {...props} />;
}

export function CardTitle({ className = "", ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`text-base font-semibold text-slate-900 ${className}`} {...props} />
  );
}

export function CardDescription({
  className = "",
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={`mt-1 text-sm text-slate-500 ${className}`} {...props} />;
}

export function CardContent({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-5 ${className}`} {...props} />;
}

export function CardFooter({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`px-5 py-4 ${className}`} {...props} />;
}

/* ── Badge ───────────────────────────────────────────────────────────────── */

export type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "neutral";

const badgeVariants: Record<BadgeVariant, string> = {
  default: "bg-teal-50 text-teal-700 ring-teal-600/20",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
  error: "bg-red-50 text-red-700 ring-red-600/20",
  info: "bg-sky-50 text-sky-700 ring-sky-600/20",
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export function Badge({
  label,
  variant = "neutral",
  className = "",
}: {
  label: string;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeVariants[variant]} ${className}`}
    >
      {label}
    </span>
  );
}

/** Map a consultation status to a badge variant + friendly label. */
export function consultationStatusBadge(status: string): {
  label: string;
  variant: BadgeVariant;
} {
  const map: Record<string, { label: string; variant: BadgeVariant }> = {
    draft: { label: "Draft", variant: "neutral" },
    recording: { label: "Recording", variant: "info" },
    uploading: { label: "Uploading", variant: "info" },
    processing: { label: "Processing", variant: "warning" },
    draft_ready: { label: "Draft ready", variant: "warning" },
    approved: { label: "Approved", variant: "success" },
    rejected: { label: "Rejected", variant: "error" },
    failed: { label: "Failed", variant: "error" },
  };
  return map[status] ?? { label: status.replace(/_/g, " "), variant: "neutral" };
}

/* ── Avatar ──────────────────────────────────────────────────────────────── */

const avatarPalette = [
  "bg-teal-100 text-teal-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
];

function initials(name: string): string {
  return (name ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function colorFor(name: string): string {
  const key = name ?? "";
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return avatarPalette[hash % avatarPalette.length];
}

export function Avatar({
  name,
  className = "",
}: {
  name?: string | null;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold ${colorFor(
        name ?? ""
      )} ${className}`}
      aria-hidden="true"
    >
      {initials(name ?? "")}
    </span>
  );
}

/* ── Skeleton ────────────────────────────────────────────────────────────── */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/80 ${className}`} />;
}
