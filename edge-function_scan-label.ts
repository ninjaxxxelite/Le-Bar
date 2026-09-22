// =====================================================================
// LE BAR — Edge Function "scan-label" (version anti-503)
// Garde la clé Gemini SECRÈTE côté serveur. Réessais automatiques sur
// 429/503 + bascule sur un modèle de secours si le principal est saturé.
//
// Déploiement : Dashboard > Edge Functions > scan-label > coller > Deploy.
// Secrets : GEMINI_API_KEY (obligatoire), GEMINI_MODEL (facultatif),
//           GEMINI_MODEL_FALLBACK (facultatif).
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

const PROMPT =
  'Analyse cette étiquette de bouteille (vin, spiritueux ou liqueur). ' +
  "Réponds UNIQUEMENT par un objet JSON, sans texte ni balises autour, avec les clés: " +
  'name, producer, type (une valeur EXACTE parmi "Vin rouge","Vin blanc","Vin rosé","Vin effervescent","Liqueur","Spiritueux"), ' +
  'grape (cépage ou matière première, ex "Pinot Noir","Rhum"; "" si inconnu), ' +
  "vintage (année en nombre, ou null), region (région ou pays; \"\" si inconnu). N'invente pas de prix.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Appelle un modèle Gemini avec réessais sur erreurs transitoires (429/5xx)
async function generate(model: string, key: string, image: string, mimeType: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = {
    contents: [{ parts: [{ inlineData: { mimeType, data: image } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };
  const MAX = 3;
  let lastErr = "";
  for (let i = 0; i < MAX; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
    lastErr = `Gemini ${res.status} — ${(await res.text()).slice(0, 200)}`;
    // 429 (quota) ou 5xx (surcharge) => transitoire : on réessaie après une pause
    if (res.status === 429 || res.status >= 500) {
      await sleep(700 * (i + 1));
      continue;
    }
    // Erreur non transitoire (clé invalide, requête malformée…) : inutile d'insister
    throw new Error(lastErr);
  }
  throw new Error(lastErr);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    // 1) Utilisateur connecté requis
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

    // 2) Image
    const { image, mimeType } = await req.json();
    if (!image) return json({ error: "Image manquante" }, 400);

    // 3) Clé + modèles (principal puis secours)
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "Secret GEMINI_API_KEY non configuré" }, 500);
    const primary = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
    const fallback = Deno.env.get("GEMINI_MODEL_FALLBACK") ?? "gemini-3.5-flash-lite";
    const models = [...new Set([primary, fallback])];

    // 4) On tente chaque modèle (avec réessais) jusqu'à en obtenir un qui répond
    let gData: any = null;
    let lastError = "";
    for (const model of models) {
      try {
        gData = await generate(model, key, image, mimeType ?? "image/jpeg");
        break;
      } catch (e) {
        lastError = String(e);
      }
    }
    if (!gData) {
      return json(
        { error: lastError || "Service momentanément indisponible, réessayez." },
        503,
      );
    }

    // 5) Extraction du JSON
    const parts = gData?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((p: { text?: string }) => p.text ?? "")
      .join("")
      .trim()
      .replace(/```json|```/g, "")
      .trim();
    let info: unknown = {};
    try {
      info = JSON.parse(text);
    } catch {
      info = {};
    }
    return json({ info });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
