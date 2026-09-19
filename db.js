// =====================================================================
// LE BAR — Couche de données (Supabase)
// Prérequis dans index.html, AVANT ce fichier :
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="config.js"></script>
//   <script src="db.js"></script>
//
// Expose window.DB : authentification, cave (bouteilles), photos, admin.
// L'objet "bouteille" côté application garde ses noms actuels (camelCase) ;
// la conversion vers/depuis les colonnes SQL est faite ici.
// =====================================================================
(function () {
  "use strict";

  var cfg = window.LEBAR_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.error("[Le Bar] config.js manquant ou incomplet.");
  }
  var sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // ---- Conversion application <-> base -------------------------------
  function toRow(b) {
    var row = {
      name: b.name, producer: b.producer, type: b.type, grape: b.grape,
      vintage: b.vintage || null, region: b.region, quantity: b.quantity || 1,
      purchase_price: b.purchasePrice || null, current_value: b.currentValue || null,
      location: b.location, rating: b.rating || null,
      purchase_date: b.purchaseDate || null, notes: b.notes,
      favorite: !!b.favorite, photo_url: b.photo || null, photo_path: b.photoPath || null
    };
    if (b.id) row.id = b.id;
    return row;
  }
  function fromRow(r) {
    return {
      id: r.id, name: r.name, producer: r.producer, type: r.type, grape: r.grape,
      vintage: r.vintage || 0, region: r.region, quantity: r.quantity || 1,
      purchasePrice: r.purchase_price || 0, currentValue: r.current_value || 0,
      location: r.location, rating: r.rating || 0, purchaseDate: r.purchase_date || "",
      notes: r.notes || "", favorite: !!r.favorite,
      photo: r.photo_url || "", photoPath: r.photo_path || ""
    };
  }

  var DB = {
    client: sb,

    // ---- Authentification -------------------------------------------
    signUp: function (email, password) { return sb.auth.signUp({ email: email, password: password }); },
    signIn: function (email, password) { return sb.auth.signInWithPassword({ email: email, password: password }); },
    signOut: function () { return sb.auth.signOut(); },
    onAuthChange: function (cb) { return sb.auth.onAuthStateChange(function (_e, session) { cb(session); }); },

    // Utilisateur courant + son rôle (null si déconnecté)
    currentUser: async function () {
      var res = await sb.auth.getUser();
      var user = res.data && res.data.user;
      if (!user) return null;
      var prof = await sb.from("profiles").select("*").eq("id", user.id).single();
      return {
        id: user.id, email: user.email,
        role: (prof.data && prof.data.role) || "user",
        name: (prof.data && prof.data.name) || (user.email || "").split("@")[0]
      };
    },

    // ---- Cave (bouteilles de l'utilisateur connecté) ----------------
    listBottles: async function () {
      var r = await sb.from("bottles").select("*").order("created_at", { ascending: false });
      if (r.error) throw r.error;
      return r.data.map(fromRow);
    },
    saveBottle: async function (b) {
      var row = toRow(b);
      var r;
      if (row.id) r = await sb.from("bottles").update(row).eq("id", row.id).select().single();
      else        r = await sb.from("bottles").insert(row).select().single();
      if (r.error) throw r.error;
      return fromRow(r.data);
    },
    deleteBottle: async function (id) {
      var r = await sb.from("bottles").delete().eq("id", id);
      if (r.error) throw r.error;
    },

    // ---- Photos (Storage) -------------------------------------------
    // file : un Blob ou File (image). Retourne { url, path }.
    uploadPhoto: async function (file) {
      var u = await sb.auth.getUser();
      var uid = u.data.user.id;
      var ext = (file.type && file.type.indexOf("png") > -1) ? "png" : "jpg";
      var path = uid + "/" + (crypto.randomUUID ? crypto.randomUUID() : Date.now()) + "." + ext;
      var up = await sb.storage.from("photos").upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (up.error) throw up.error;
      var pub = sb.storage.from("photos").getPublicUrl(path);
      return { url: pub.data.publicUrl, path: path };
    },
    deletePhoto: async function (path) {
      if (path) await sb.storage.from("photos").remove([path]);
    },

    // ---- Administration (réservé admin, garanti par RLS) ------------
    listProfiles: async function () {
      var r = await sb.from("profiles").select("*").order("created_at");
      if (r.error) throw r.error;
      return r.data;
    },
    setRole: async function (userId, role) {
      var r = await sb.from("profiles").update({ role: role }).eq("id", userId);
      if (r.error) throw r.error;
    },
    renameProfile: async function (userId, name) {
      var r = await sb.from("profiles").update({ name: name }).eq("id", userId);
      if (r.error) throw r.error;
    }
  };

  window.DB = DB;
})();
