import type { SupabaseClient } from "@supabase/supabase-js";

export type CopilotMemory = {
  id: string;
  body: string;
  kind: "preference" | "fact" | "workflow" | "constraint";
  updated_at: string;
};

const MAX_MEMORIES_PER_USER = 20;

export async function loadCopilotMemory(sb: SupabaseClient, userId: string): Promise<CopilotMemory[]> {
  const { data, error } = await sb
    .from("copilot_memory")
    .select("id,body,kind,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(MAX_MEMORIES_PER_USER);
  if (error) return [];
  return (data ?? []) as unknown as CopilotMemory[];
}

export async function saveCopilotMemory(
  sb: SupabaseClient,
  userId: string,
  body: string,
  kind: CopilotMemory["kind"] = "preference",
) {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false as const, error: "Empty memory body." };
  if (trimmed.length > 400) return { ok: false as const, error: "Memory too long (max 400 chars)." };

  // Cheap dedup: don't insert if an existing memory body matches verbatim.
  const { data: existing } = await sb
    .from("copilot_memory")
    .select("id,body")
    .eq("user_id", userId)
    .eq("body", trimmed)
    .maybeSingle();
  if (existing) {
    await sb.from("copilot_memory").update({ updated_at: new Date().toISOString() }).eq("id", (existing as { id: string }).id);
    return { ok: true as const, id: (existing as { id: string }).id, deduped: true };
  }

  const { data, error } = await sb
    .from("copilot_memory")
    .insert({ user_id: userId, body: trimmed, kind })
    .select("id")
    .single();
  if (error) return { ok: false as const, error: error.message };

  // Trim oldest beyond cap.
  const { data: rows } = await sb
    .from("copilot_memory")
    .select("id,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  const overflow = ((rows ?? []) as Array<{ id: string }>).slice(MAX_MEMORIES_PER_USER);
  if (overflow.length > 0) {
    await sb.from("copilot_memory").delete().in("id", overflow.map((r) => r.id));
  }

  return { ok: true as const, id: (data as { id: string }).id };
}

export async function deleteCopilotMemory(sb: SupabaseClient, userId: string, memoryId: string) {
  const { error } = await sb
    .from("copilot_memory")
    .delete()
    .eq("user_id", userId)
    .eq("id", memoryId);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, deleted: memoryId };
}
