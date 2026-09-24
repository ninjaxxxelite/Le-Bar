// =====================================================================
// LE BAR — Edge Function "estimate-value"
// Estimation INDICATIVE de la valeur d'une bouteille (75cl) par IA.
// Clé Gemini gardée en secret côté serveur. Réservé aux utilisateurs connectés.
//
// Déploiement : Dashboard > Edge Functions > "Deploy a new function" > Via Editor
//   Nom : estimate-value ; coller ce code ; Deploy.
//   Puis (comme scan-label) : décocher "Verify JWT".
// Secrets : GEMINI_API_KEY (déjà en place), GEMINI_MODEL / GEMINI_MODEL_FALLBACK (optionnels).
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function estimate(model: string, key: string, prompt: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  };
  let lastErr = "";
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
    lastErr = `Gemini ${res.status} — ${(await res.text()).slice(0, 160)}`;
    if (res.status === 429 || res.status >= 500) {
      await sleep(700 * (i + 1));
      continue;
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr);
}

function buildPrompt(b: Record<string, string>) {
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
    "Tu es sommelier et connaisseur du marché du vin et des spiritueux. " +
    "Donne une ESTIMATION indicative de la valeur marchande actuelle, en euros, d'UNE bouteille de 75cl. " +
    "Ce n'est pas un prix de marché en temps réel, base-toi sur ta connaissance générale. " +
    `Bouteille — ${desc}. ` +
    'Réponds UNIQUEMENT en JSON, sans texte autour : {"value": nombre en euros ou null, ' +
    '"low": nombre ou null, "high": nombre ou null, "confidence": "low"|"medium"|"high"}.'
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json({ error: "Non authentifié" }, 401);

    const b = await req.json();
    if (!b || !b.name) return json({ error: "Nom manquant" }, 400);

    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "Secret GEMINI_API_KEY non configuré" }, 500);
    const models = [
      ...new Set([
        Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite",
        Deno.env.get("GEMINI_MODEL_FALLBACK") ?? "gemini-3.8-flash",
      ]),
    ];

    let data: any = null;
    let lastError = "";
    for (const model of models) {
      try {
        data = await estimate(model, key, buildPrompt(b));
        break;
      } catch (e) {
        lastError = String(e);
      }
    }
    if (!data) return json({ error: lastError || "Service indisponible" }, 503);

    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((p: { text?: string }) => p.text ?? "")
      .join("")
      .trim()
      .replace(/```json|```/g, "")
      .trim();
    let out: any = {};
    try {
      out = JSON.parse(text);
    } catch {
      out = {};
    }
    return json({
      value: out.value ?? null,
      low: out.low ?? null,
      high: out.high ?? null,
      confidence: out.confidence ?? "low",
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
