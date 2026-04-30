// Placeholder Database type. Supabase-js v2 expects a strict GenericSchema
// shape — plain `any` doesn't satisfy it. This loose schema keeps the
// client compiling: every row/insert/update is `Record<string, any>`.
//
// Replace with output of:
//   supabase gen types typescript --project-id mkgkrfcfhtrlecfuzroz > web/lib/database.types.ts
// once we install the Supabase CLI.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Database = {
  public: {
    Tables: {
      [tableName: string]: {
        Row: Record<string, any>;
        Insert: Record<string, any>;
        Update: Record<string, any>;
        Relationships: [];
      };
    };
    Views: {
      [viewName: string]: {
        Row: Record<string, any>;
        Relationships: [];
      };
    };
    Functions: {
      [fnName: string]: {
        Args: Record<string, any>;
        Returns: any;
      };
    };
    Enums: { [enumName: string]: string };
    CompositeTypes: { [typeName: string]: Record<string, any> };
  };
};
