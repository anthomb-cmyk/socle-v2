"use client";
import { useEffect, useState } from "react";

const ROLES = ["admin", "manager", "cold_caller", "caller", "research_assistant", "viewer"] as const;
type Role = typeof ROLES[number];

type UserRow = {
  user_id: string;
  display_name: string | null;
  role: Role | string;
  is_active: boolean;
  telegram_user_id: string | null;
  email: string | null;
  twilio_forward_to: string | null;
  last_sign_in_at?: string | null;
  _orphan?: boolean;
};

export default function UsersTable() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<UserRow>>({});

  async function refresh() {
    setLoading(true);
    const r = await fetch("/api/users");
    const j = await r.json();
    setLoading(false);
    if (!j.ok) { setError(j.error); return; }
    setUsers(j.data);
  }
  useEffect(() => { refresh(); }, []);

  async function patch(id: string, body: Partial<UserRow>) {
    setBusyId(id); setError(null);
    const r = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    setBusyId(null);
    if (!j.ok) { setError(j.error); return false; }
    refresh();
    return true;
  }

  async function quickRoleChange(id: string, role: Role) {
    await patch(id, { role });
  }
  async function toggleActive(u: UserRow) {
    await patch(u.user_id, { is_active: !u.is_active });
  }

  async function saveEdit(id: string) {
    const ok = await patch(id, {
      display_name: draft.display_name ?? null,
      telegram_user_id: draft.telegram_user_id ?? null,
      twilio_forward_to: draft.twilio_forward_to ?? null,
      email: draft.email ?? null,
    });
    if (ok) { setEditing(null); setDraft({}); }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-sm text-zinc-500">{users.length} users{users.some(u => u._orphan) && <> · <span className="text-amber-700">{users.filter(u => u._orphan).length} need users_meta</span></>}</div>

      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="text-left p-2">User</th>
              <th className="text-left p-2">Role</th>
              <th className="text-left p-2">Active</th>
              <th className="text-left p-2">Telegram</th>
              <th className="text-left p-2">Twilio fwd</th>
              <th className="text-left p-2">Last sign-in</th>
              <th className="text-left p-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-4 text-center text-zinc-400">Loading…</td></tr>}
            {!loading && users.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-zinc-400">No users yet.</td></tr>}
            {users.map(u => {
              const isEditing = editing === u.user_id;
              return (
                <tr key={u.user_id} className={`border-t border-zinc-100 align-top ${u._orphan ? "bg-amber-50" : ""}`}>
                  <td className="p-2">
                    {isEditing ? (
                      <div className="space-y-1">
                        <input value={draft.display_name ?? ""} onChange={e => setDraft({ ...draft, display_name: e.target.value })}
                          placeholder="Display name"
                          className="w-full border border-zinc-300 rounded px-2 py-1 text-sm" />
                        <input value={draft.email ?? ""} onChange={e => setDraft({ ...draft, email: e.target.value })}
                          placeholder="email@example.com"
                          className="w-full border border-zinc-300 rounded px-2 py-1 text-sm" />
                      </div>
                    ) : (
                      <>
                        <div className="font-medium">{u.display_name ?? <span className="text-zinc-400 italic">(no name)</span>}</div>
                        <div className="text-xs text-zinc-500">{u.email ?? <span className="text-zinc-400">no email</span>}</div>
                        {u._orphan && <div className="text-xs text-amber-700 mt-1">No users_meta row — Edit to create.</div>}
                      </>
                    )}
                  </td>
                  <td className="p-2">
                    <select value={u.role} onChange={e => quickRoleChange(u.user_id, e.target.value as Role)}
                      disabled={busyId === u.user_id || u._orphan}
                      className="border border-zinc-300 rounded px-2 py-1 text-sm">
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <button onClick={() => toggleActive(u)} disabled={busyId === u.user_id || u._orphan}
                      className={`text-xs uppercase tracking-wide rounded px-2 py-1 ${u.is_active ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"}`}>
                      {u.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="p-2 text-xs">
                    {isEditing ? (
                      <input value={draft.telegram_user_id ?? ""} onChange={e => setDraft({ ...draft, telegram_user_id: e.target.value || null })}
                        placeholder="Telegram chat ID"
                        className="border border-zinc-300 rounded px-2 py-1 text-xs font-mono w-full" />
                    ) : u.telegram_user_id ? (
                      <span className="font-mono">{u.telegram_user_id}</span>
                    ) : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="p-2 text-xs">
                    {isEditing ? (
                      <input value={draft.twilio_forward_to ?? ""} onChange={e => setDraft({ ...draft, twilio_forward_to: e.target.value || null })}
                        placeholder="+15145551234"
                        className="border border-zinc-300 rounded px-2 py-1 text-xs font-mono w-full" />
                    ) : u.twilio_forward_to ? (
                      <span className="font-mono">{u.twilio_forward_to}</span>
                    ) : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="p-2 text-xs text-zinc-500">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : <span className="text-zinc-400">never</span>}
                  </td>
                  <td className="p-2">
                    {isEditing ? (
                      <div className="flex flex-col gap-1">
                        <button onClick={() => saveEdit(u.user_id)} disabled={busyId === u.user_id}
                          className="bg-zinc-900 text-white text-xs rounded px-2 py-1">Save</button>
                        <button onClick={() => { setEditing(null); setDraft({}); }}
                          className="border border-zinc-300 text-xs rounded px-2 py-1">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditing(u.user_id); setDraft({ display_name: u.display_name, email: u.email, telegram_user_id: u.telegram_user_id, twilio_forward_to: u.twilio_forward_to }); }}
                        className="text-xs text-zinc-600 hover:underline">Edit</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
