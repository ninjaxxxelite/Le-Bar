// =====================================================================
// LE BAR — Edge Function "scan-label"
// Garde la clé Gemini SECRÈTE côté serveur. Les utilisateurs connectés
// envoient une image ; la fonction interroge Gemini et renvoie les champs.
//
// Déploiement (sans CLI) :
//   Dashboard Supabase > Edge Functions > "Deploy a new function" > "Via Editor"
//   - Nom de la fonction : scan-label
//   - Collez ce code, puis "Deploy".
// Secret à définir (Dashboard > Edge Functions > Secrets, ou Project Settings) :
//   GEMINI_API_KEY = votre clé Google AI Studio
//   (facultatif) GEMINI_MODEL = gemini-3.8-flash
// SUPABASE_URL et SUPABASE_ANON_KEY sont fournis automatiquement.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    // 1) Vérifier que l'appelant est un utilisateur connecté
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

    // 2) Image reçue
    const { image, mimeType } = await req.json();
    if (!image) return json({ error: "Image manquante" }, 400);

    // 3) Clé Gemini (secret serveur)
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "Secret GEMINI_API_KEY non configuré" }, 500);
    const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";

    // 4) Appel Gemini
    const gRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType: mimeType ?? "image/jpeg", data: image } },
                { text: PROMPT },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      },
    );
    if (!gRes.ok) {
      const t = await gRes.text();
      return json({ error: `Gemini ${gRes.status} — ${t.slice(0, 200)}` }, 502);
    }
    const gData = await gRes.json();
    const parts = gData?.candidates?.[0]?.content?.parts ?? [];
    let text = parts
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
