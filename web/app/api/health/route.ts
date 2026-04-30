import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("properties").select("id").limit(1);
    return NextResponse.json({
      ok: !error,
      schemaApplied: !error,
      error: error?.message ?? null,
      time: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      schemaApplied: false,
      error: (err as Error).message,
    }, { status: 500 });
  }
}
