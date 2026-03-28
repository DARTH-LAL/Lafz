import type { ReactNode } from "react";

import { cx } from "@/lib/utils";

type StatePanelProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
};

export function StatePanel({ eyebrow, title, description, children, className }: StatePanelProps) {
  return (
    <section
      className={cx(
        "rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel)] p-8 shadow-[0_24px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl",
        className
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#ff6ba8]/80">{eyebrow}</p>
      <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">{title}</h2>
      <p className="mt-3 max-w-2xl text-base leading-7 text-white">{description}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}
