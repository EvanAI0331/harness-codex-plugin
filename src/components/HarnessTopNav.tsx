"use client";

import Link from "next/link";

interface HarnessTopNavProps {
  harnessId?: string;
  active?: "workspace" | "run" | "settings";
}

export default function HarnessTopNav({ harnessId, active = "workspace" }: HarnessTopNavProps) {
  const runHref = harnessId ? `/harness/${harnessId}/run` : "/harness/new";
  const workspaceHref = harnessId ? `/harness/${harnessId}` : "/harness/new";

  return (
    <nav className="sticky top-0 z-20 border-b border-white/8 bg-[rgba(6,10,18,0.76)] backdrop-blur-2xl">
      <div className="mx-auto flex h-[60px] max-w-[1760px] items-center justify-between px-5 sm:px-6">
        <Link href="/harness/new" className="flex items-center gap-3 text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-[16px] bg-gradient-to-br from-sky-300 via-cyan-200 to-emerald-200 text-xs font-black text-slate-950 shadow-[0_16px_30px_rgba(56,189,248,0.18)]">
            H
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">Harness Studio</div>
            <div className="text-[11px] text-slate-400">Workspace · Runs · Runtime Settings</div>
          </div>
        </Link>

        <div className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] p-1 md:flex">
          <NavLink href={workspaceHref} active={active === "workspace"}>
            Workspace
          </NavLink>
          <NavLink href={runHref} active={active === "run"}>
            Runs
          </NavLink>
          <NavLink href="/harness/settings" active={active === "settings"}>
            Runtime Settings
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
      <Link
      href={href}
      className={[
        "rounded-full px-3 py-1.5 text-[13px] font-medium transition",
        active
          ? "bg-white text-slate-950 shadow-[0_12px_24px_rgba(0,0,0,0.24)]"
          : "text-slate-300 hover:bg-white/5 hover:text-white",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}
