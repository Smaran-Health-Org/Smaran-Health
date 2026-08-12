import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const base = "rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-emerald-600 text-white hover:bg-emerald-700",
    secondary: "border border-stone-300 text-stone-700 hover:bg-stone-50",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent ${className}`}
      {...props}
    />
  );
}

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-xl border border-stone-200 bg-white ${className}`} {...props} />
  );
}

export function Badge({
  label,
  variant = "default",
}: {
  label: string;
  variant?: "default" | "success" | "warning" | "error";
}) {
  const variants = {
    default: "bg-stone-100 text-stone-600",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    error: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium ${variants[variant]}`}>
      {label}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-stone-200 ${className}`} />;
}
