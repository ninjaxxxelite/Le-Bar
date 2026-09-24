// =====================================================================
// LE BAR — Edge Function "revalue-all" (réévaluation mensuelle)
// Parcourt TOUTES les bouteilles et met à jour "current_value" via l'IA.
// Déclenchée par une tâche planifiée (pg_cron) — voir cron_revalue.sql.
//
// Déploiement : Dashboard > Edge Functions > "Deploy a new function" > Via Editor
//   Nom : revalue-all ; coller ce code ; Deploy ; décocher "Verify JWT".
// Secrets : GEMINI_API_KEY, CRON_SECRET (un mot de passe que vous choisissez).
//   (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement.)
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function estimate(model: string, key: string, prompt: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  };
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
    if (res.status === 429 || res.status >= 500) {
      await sleep(800 * (i + 1));
      continue;
    }
    throw new Error(`Gemini ${res.status}`);
  }
  throw new Error("Gemini indisponible");
}

function buildPrompt(b: Record<string, unknown>) {
  const desc = [
    b.name && `nom: ${b.name}`,
    b.producer && `producteur: ${b.producer}`,
    b.vintage && `millésime: ${b.vintage}`,
    b.region && `région: ${b.region}`,
    b.type && `type: ${b.type}`,
    b.grape && `cépage/matière: ${b.grape}`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    "Tu es sommelier. Donne une ESTIMATION indicative de la valeur marchande actuelle, en euros, " +
    `d'UNE bouteille de 75cl — ${desc}. Réponds UNIQUEMENT en JSON : ` +
    '{"value": nombre en euros ou null}.'
  );
}

Deno.serve(async (req) => {
  // Sécurité : seule une requête portant le bon secret peut déclencher le job
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Interdit" }), { status: 401 });
  }

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return new Response(JSON.stringify({ error: "GEMINI_API_KEY manquant" }), { status: 500 });
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // On limite le lot pour rester dans les temps d'exécution
  const { data: rows, error } = await admin
    .from("bottles")
    .select("id,name,producer,vintage,region,type,grape")
    .order("valued_at", { ascending: true, nullsFirst: true })
    .limit(200);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let updated = 0;
  let failed = 0;
  for (const b of rows ?? []) {
    try {
      const data = await estimate(model, key, buildPrompt(b));
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .map((p: { text?: string }) => p.text ?? "")
        .join("")
        .trim()
        .replace(/```json|```/g, "")
        .trim();
      const out = JSON.parse(text);
      const v = Number(out.value);
      if (!isNaN(v) && v > 0) {
        await admin
          .from("bottles")
          .update({ current_value: v, valued_at: new Date().toISOString() })
          .eq("id", b.id);
        updated++;
      } else {
        // On marque quand même la date pour ne pas boucler dessus
        await admin.from("bottles").update({ valued_at: new Date().toISOString() }).eq("id", b.id);
        failed++;
      }
      await sleep(300); // petite pause pour ménager le quota
    } catch (_e) {
      failed++;
    }
  }
  return new Response(JSON.stringify({ updated, failed, total: rows?.length ?? 0 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
