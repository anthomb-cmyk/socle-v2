import Link from "next/link";
import SignOutButton from "./sign-out-button";

export default function AppNav({ email, role }: { email: string; role: "admin" | "caller" }) {
  const isAdmin = role === "admin";

  return (
    <nav className="crm-nav" style={{ display: "flex", alignItems: "stretch", padding: "0 16px", gap: 0 }}>
      {/* Brand */}
      <Link
        href={(isAdmin ? "/" : "/calls/queue") as never}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingRight: 16,
          marginRight: 6,
          borderRight: "1px solid var(--crm-card-border)",
          textDecoration: "none",
          flexShrink: 0,
        }}
      >
        <span style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: "var(--crm-gold)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: 0.5,
          flexShrink: 0,
        }}>S</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--crm-text)", letterSpacing: 0.3 }}>Socle</span>
      </Link>

      {/* Primary links */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
        {isAdmin ? (
          <>
            <NavLink href="/">Dashboard</NavLink>
            <NavLink href="/leads">Leads</NavLink>
            <NavLink href="/review">Revue</NavLink>
            <NavLink href="/phone-review">Tél. revue</NavLink>
            <NavLink href="/follow-ups">Suivis</NavLink>
            <NavLink href="/import">Import</NavLink>
            <NavLink href="/calls/queue">File d&rsquo;appels</NavLink>

            {/* Admin dropdown */}
            <div style={{ position: "relative", display: "flex", alignItems: "stretch" }} className="group">
              <button style={{
                height: "100%",
                padding: "0 12px",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--crm-text2)",
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}>
                Admin
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.5 }}>
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <div style={{
                position: "absolute",
                top: "100%",
                left: 0,
                minWidth: 160,
                background: "#fff",
                border: "1px solid var(--crm-card-border)",
                borderRadius: 12,
                boxShadow: "0 8px 28px rgba(0,0,0,.10)",
                padding: "4px 0",
                zIndex: 50,
              }} className="hidden group-hover:block">
                <DropLink href="/admin/users">Utilisateurs</DropLink>
                <DropLink href="/admin/enrichment">Enrichissement</DropLink>
                <DropLink href="/admin/events">Journal événements</DropLink>
                <DropLink href="/data-health">Santé données</DropLink>
                <DropLink href="/properties">Propriétés</DropLink>
                <DropLink href="/contacts">Contacts</DropLink>
                <DropLink href="/calendar">Calendrier</DropLink>
                <div style={{ margin: "4px 0", borderTop: "1px solid var(--crm-card-border)" }} />
                <DropLink href="/admin/test" muted>Panel test</DropLink>
                <DropLink href="/admin/seed" muted>Données seed</DropLink>
              </div>
            </div>
          </>
        ) : (
          <>
            <NavLink href="/calls/queue">Ma file</NavLink>
            <NavLink href="/follow-ups">Suivis</NavLink>
            <NavLink href="/calendar">Calendrier</NavLink>
          </>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Right side */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 12 }}>
        <span style={{ fontSize: 11, color: "var(--crm-text3)" }} className="hidden lg:inline truncate max-w-[140px]">{email}</span>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.6px",
          textTransform: "uppercase",
          background: isAdmin ? "var(--crm-gold-light)" : "#F3F4F6",
          color: isAdmin ? "var(--crm-gold)" : "var(--crm-text3)",
          borderRadius: 6,
          padding: "3px 7px",
        }}>{role}</span>
        <SignOutButton />
      </div>
    </nav>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href as never}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        height: 44,
        fontSize: 13,
        fontWeight: 600,
        color: "var(--crm-text2)",
        textDecoration: "none",
        borderBottom: "2px solid transparent",
        whiteSpace: "nowrap",
        transition: "color 0.15s",
      }}
      className="hover:text-[var(--crm-text)] hover:bg-[var(--crm-bg)]"
    >
      {children}
    </Link>
  );
}

function DropLink({ href, children, muted }: { href: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <Link
      href={href as never}
      style={{
        display: "block",
        padding: "9px 16px",
        fontSize: 13,
        color: muted ? "var(--crm-text3)" : "var(--crm-text2)",
        textDecoration: "none",
        fontWeight: 600,
      }}
      className="hover:bg-[var(--crm-bg)]"
    >
      {children}
    </Link>
  );
}
