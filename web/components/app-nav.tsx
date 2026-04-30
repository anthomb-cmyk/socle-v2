import Link from "next/link";
import SignOutButton from "./sign-out-button";

export default function AppNav({ email, role }: { email: string; role: "admin" | "caller" }) {
  return (
    <nav className="bg-white border-b border-zinc-200 px-4 py-2 flex items-center gap-4 text-sm">
      <Link href={(role === "admin" ? "/" : "/calls/queue") as never} className="font-semibold tracking-tight">
        Socle CRM
      </Link>
      <div className="flex items-center gap-3 text-zinc-600">
        {role === "admin" && (
          <>
            <Link href="/" className="hover:text-zinc-900">Dashboard</Link>
            <Link href="/leads" className="hover:text-zinc-900">Leads</Link>
            <Link href={"/properties" as never} className="hover:text-zinc-900">Properties</Link>
            <Link href={"/contacts" as never} className="hover:text-zinc-900">Contacts</Link>
            <Link href="/import" className="hover:text-zinc-900">Import</Link>
            <Link href={"/follow-ups" as never} className="hover:text-zinc-900">Follow-ups</Link>
            <Link href={"/calendar" as never} className="hover:text-zinc-900">Calendar</Link>
            <Link href={"/review" as never} className="hover:text-zinc-900">Review</Link>
            <Link href={"/data-health" as never} className="hover:text-zinc-900">Health</Link>
            <Link href={"/admin/enrichment" as never} className="hover:text-zinc-900">Enrichment</Link>
            <Link href={"/admin/users" as never} className="hover:text-zinc-900">Users</Link>
            <Link href={"/admin/events" as never} className="hover:text-zinc-900">Events</Link>
            <Link href={"/admin/test" as never} className="hover:text-zinc-900 text-zinc-400">Test</Link>
            <Link href={"/admin/seed" as never} className="hover:text-zinc-900 text-zinc-400">Seed</Link>
          </>
        )}
        {role === "caller" && (
          <>
            <Link href={"/calls/queue" as never} className="hover:text-zinc-900">Queue</Link>
            <Link href={"/follow-ups" as never} className="hover:text-zinc-900">Follow-ups</Link>
            <Link href={"/calendar" as never} className="hover:text-zinc-900">Calendar</Link>
          </>
        )}
      </div>
      <div className="flex-1" />
      <span className="text-xs text-zinc-500 hidden sm:inline">{email}</span>
      <span className="text-xs uppercase tracking-wide rounded px-1.5 py-0.5 bg-zinc-100">{role}</span>
      <SignOutButton />
    </nav>
  );
}
