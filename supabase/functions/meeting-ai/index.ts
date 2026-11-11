import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createMeetingAiHandler } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL")!,
  options = { auth: { persistSession: false } };
Deno.serve(
  createMeetingAiHandler({
    admin: createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      options,
    ),
    userClient: (jwt) =>
      createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        ...options,
        global: { headers: { Authorization: "Bearer " + jwt } },
      }),
    apiKey: Deno.env.get("MEETING_AI_API_KEY"),
    model: Deno.env.get("MEETING_AI_MODEL"),
    origin: "https://timativ-blip.github.io",
  }),
);
