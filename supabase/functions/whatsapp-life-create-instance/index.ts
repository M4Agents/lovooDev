// verify_jwt permanece true. O gateway exige um JWT antes da função.
// A função também valida o usuário e recusa a criação administrativa.
// O service_role só é criado depois do JWT e da autorização por company_users.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeCreateInstance } from "./authorizeCreateInstance.js";
import { handleCreateInstance } from "./handleCreateInstance.js";

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

serve((req) => handleCreateInstance(req, {
  getUser: async (authHeader: string) => {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anon) return { user: null, error: new Error("config") };
    const client = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    return { user: data?.user ?? null, error };
  },
  authorize: async (userId: string, companyId: string) => {
    const svc = serviceClient();
    if (!svc) return { ok: false, status: 503, error: "Não foi possível validar o acesso" };
    return authorizeCreateInstance(svc, userId, companyId);
  },
  admin: () => {
    const svc = serviceClient();
    if (!svc) throw new Error("config");
    return svc;
  },
  fetchImpl: fetch,
  env: {},
}));
