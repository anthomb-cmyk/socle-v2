import Link from "next/link";
import SignOutButton from "./sign-out-button";

export default function AppNav({ email, role }: { email: string; role: "admin" | "caller" }) {
  const isAdmin = role === "admin";

  return (
    <nav className="bg-white border-b border-zinc-200 px-4 py-0 flex items-stretch text-sm">
      {/* Brand */}
      <Link
        href={(isAdmin ? "/" : "/calls/queue") as never}
        className="font-semibold tracking-tight flex items-center pr-5 border-r border-zinc-100 mr-2"
      >
        Socle
      </Link>

      {/* Primary links */}
      <div className="flex items-stretch gap-0">
        {isAdmin ? (
          <>
            <NavLink href="/">Dashboard</NavLink>
            <NavLink href="/leads">Leads</NavLink>
            <NavLink href="/review">Review inbox</NavLink>
            <NavLink href="/phone-review">Phone review</NavLink>
            <NavLink href="/follow-ups">Follow-ups</NavLink>
            <NavLink href="/import">Import</NavLink>
            <NavLink href="/calls/queue">Call queue</NavLink>

            {/* Admin dropdown — CSS-only hover */}
            <div className="relative group flex items-center">
              <button className="h-full px-3 text-zinc-500 hover:text-zinc-900 flex items-center gap-1 cursor-default">
                Admin
                <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12">
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <div className="absolute top-full left-0 hidden group-hover:block bg-white border border-zinc-200 rounded-xl shadow-lg py-1 z-50 min-w-[160px]">
                <DropLink href="/admin/users">Users</DropLink>
                <DropLink href="/admin/enrichment">Enrichment</DropLink>
                <DropLink href="/admin/events">Events log</DropLink>
                <DropLink href="/data-health">Data health</DropLink>
                <DropLink href="/properties">Properties</DropLink>
                <DropLink href="/contacts">Contacts</DropLink>
                <DropLink href="/calendar">Calendar</DropLink>
                <div className="my-1 border-t border-zinc-100" />
                <DropLink href="/admin/test" muted>Test panel</DropLink>
                <DropLink href="/admin/seed" muted>Seed data</DropLink>
              </div>
            </div>
          </>
        ) : (
          <>
            <NavLink href="/calls/queue">My queue</NavLink>
            <NavLink href="/follow-ups">Follow-ups</NavLink>
            <NavLink href="/calendar">Calendar</NavLink>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* Right side */}
      <div className="flex items-center gap-2 pl-4">
        <span className="text-xs text-zinc-400 hidden lg:inline truncate max-w-[160px]">{email}</span>
        <span className="text-xs uppercase tracking-wide rounded px-1.5 py-0.5 bg-zinc-100 text-zinc-500">
          {role}
        </span>
        <SignOutButton />
      </div>
    </nav>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href as never}
      className="flex items-center px-3 h-10 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 transition-colors"
    >
      {children}
    </Link>
  );
}

function DropLink({ href, children, muted }: { href: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <Link
      href={href as never}
      className={`block px-4 py-2 hover:bg-zinc-50 transition-colors ${muted ? "text-zinc-400" : "text-zinc-700"}`}
    >
      {children}
    </Link>
  );
}
