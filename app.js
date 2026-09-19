// ==========================================================================
// CONSTANTES, RÉGLAGES & PROFILS
// ==========================================================================
const SETTINGS_KEY = "le-bar-settings";
const DEFAULT_MODEL = "claude-sonnet-5";
let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");

/* ===== État (rempli après connexion Supabase) ===== */
let ME = null; // utilisateur connecté : { id, email, role, name }
let bottles = []; // cave de l'utilisateur, chargée depuis la base
let activeFilter = "Toutes";
let editingId = null;
let editingPhotoPath = ""; // chemin Storage de la photo en cours d'édition
let photoData = ""; // aperçu : "" | URL existante | data:... (nouvelle image)
const isAdmin = () => !!(ME && ME.role === "admin");

// ==========================================================================
// UTILITAIRES
// ==========================================================================
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const euro = (n) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

function save() {} // persistance gérée par Supabase (DB.saveBottle / DB.deleteBottle)
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
function escapeHtml(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[m],
  );
}

// ==========================================================================
// RENDU DES BOUTEILLES (CARTES)
// ==========================================================================
function categoryIcon(type) {
  if (type === "Vin rouge") return "🍷";
  if (type === "Vin blanc") return "🥂";
  if (type === "Vin rosé") return "🌸";
  if (type === "Vin effervescent") return "🍾";
  if (type === "Liqueur") return "🍸";
  return "🥃";
}
function card(b) {
  const img = b.photo ? `<img src="${b.photo}" alt="">` : categoryIcon(b.type);
  return `<article class="bottle-card" data-id="${b.id}">
    <div class="bottle-image">${img}</div>
    <button class="favorite ${b.favorite ? "on" : ""}" title="Favori">${b.favorite ? "★" : "☆"}</button>
    <div class="bottle-info">
      <span class="tag">${escapeHtml(b.type)}</span>
      <h3>${escapeHtml(b.name)}</h3>
      <div class="producer">${escapeHtml(b.producer || "")}</div>
      <div class="meta">${b.vintage ? b.vintage + " • " : ""}${escapeHtml(b.region || "")}</div>
      <div class="card-bottom"><span class="price">${euro(b.currentValue)}</span><span class="qty">× ${b.quantity}</span></div>
    </div>
  </article>`;
}
function bindCards(container) {
  container.querySelectorAll(".bottle-card").forEach((c) => {
    c.addEventListener("click", (e) => {
      if (e.target.closest(".favorite")) return;
      openModal(c.dataset.id);
    });
    c.querySelector(".favorite").addEventListener("click", async (e) => {
      e.stopPropagation();
      const b = bottles.find((x) => x.id === c.dataset.id);
      b.favorite = !b.favorite;
      render();
      try {
        await DB.saveBottle(b);
        toast(b.favorite ? "Ajouté aux favoris" : "Retiré des favoris");
      } catch (err) {
        b.favorite = !b.favorite;
        render();
        toast("Erreur : " + (err.message || err));
      }
    });
  });
}
// ==========================================================================
// STATISTIQUES & RENDU GLOBAL
// ==========================================================================
function renderStats() {
  const count = bottles.reduce((a, b) => a + Number(b.quantity || 0), 0);
  const value = bottles.reduce(
    (a, b) => a + Number(b.quantity || 0) * Number(b.currentValue || 0),
    0,
  );
  const purchase = bottles.reduce(
    (a, b) => a + Number(b.quantity || 0) * Number(b.purchasePrice || 0),
    0,
  );
  const fav = bottles.filter((b) => b.favorite).length;
  $("#stats").innerHTML = [
    ["BOUTEILLES", count, "unités en cave"],
    ["VALEUR", euro(value), "estimation actuelle"],
    ["INVESTI", euro(purchase), "prix d'achat total"],
    ["FAVORIS", fav, "sélections personnelles"],
  ]
    .map(
      (x) =>
        `<div class="stat"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="sub">${x[2]}</div></div>`,
    )
    .join("");
}
// ==========================================================================
// FILTRES, RECHERCHE & TRI
// ==========================================================================
function renderFilters() {
  const filters = [
    "Toutes",
    "Vin rouge",
    "Vin blanc",
    "Vin rosé",
    "Vin effervescent",
    "Pinot",
    "Liqueur",
    "Spiritueux",
  ];
  $("#filters").innerHTML = filters
    .map(
      (f) =>
        `<button class="filter ${activeFilter === f ? "active" : ""}" data-filter="${f}">${f}</button>`,
    )
    .join("");
  $$("#filters .filter").forEach(
    (btn) =>
      (btn.onclick = () => {
        activeFilter = btn.dataset.filter;
        renderCellar();
      }),
  );
}
function filtered() {
  const q = ($("#searchInput")?.value || "").toLowerCase().trim();
  let arr = bottles.filter((b) => {
    const text = [b.name, b.producer, b.region, b.grape, b.type, b.vintage, b.location]
      .join(" ")
      .toLowerCase();
    const matchesSearch = !q || text.includes(q);
    let matchesFilter =
      activeFilter === "Toutes" ||
      b.type === activeFilter ||
      (activeFilter === "Pinot" && /pinot/i.test(b.grape || ""));
    return matchesSearch && matchesFilter;
  });
  const sort = $("#sortSelect")?.value || "recent";
  if (sort === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "priceDesc") arr.sort((a, b) => b.currentValue - a.currentValue);
  if (sort === "vintage") arr.sort((a, b) => (b.vintage || 0) - (a.vintage || 0));
  if (sort === "recent")
    arr.sort((a, b) => new Date(b.purchaseDate || 0) - new Date(a.purchaseDate || 0));
  return arr;
}
function renderCellar() {
  renderFilters();
  const arr = filtered();
  $("#cellarGrid").innerHTML = arr.length
    ? arr.map(card).join("")
    : `<div class="empty">Aucune bouteille ne correspond à votre recherche.</div>`;
  bindCards($("#cellarGrid"));
}
function render() {
  renderStats();
  const recent = [...bottles]
    .sort((a, b) => new Date(b.purchaseDate || 0) - new Date(a.purchaseDate || 0))
    .slice(0, 4);
  $("#recentGrid").innerHTML = recent.length
    ? recent.map(card).join("")
    : `<div class="empty">Votre cave est vide.</div>`;
  bindCards($("#recentGrid"));
  renderCellar();
  const fav = bottles.filter((b) => b.favorite);
  $("#favoritesGrid").innerHTML = fav.length
    ? fav.map(card).join("")
    : `<div class="empty">Aucun favori pour le moment.<br>Ajoutez une étoile à vos bouteilles préférées.</div>`;
  bindCards($("#favoritesGrid"));
}

// ==========================================================================
// NAVIGATION ENTRE LES VUES
// ==========================================================================
function showView(view) {
  if (view === "admin" && !isAdmin()) view = "dashboard";
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#${view}View`).classList.remove("hidden");
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  const titles = {
    dashboard: "Tableau de bord",
    cellar: "Ma cave",
    favorites: "Mes favoris",
    settings: "Paramètres",
    admin: "Administration",
  };
  $("#pageTitle").textContent = titles[view] || "";
  if (view === "admin" && typeof renderAdminView === "function") renderAdminView();
}
$$(".nav-item").forEach((n) => (n.onclick = () => showView(n.dataset.view)));
$$("[data-view-target]").forEach((n) => (n.onclick = () => showView(n.dataset.viewTarget)));

// ==========================================================================
// FORMULAIRE AJOUT / ÉDITION (MODALE)
// ==========================================================================
function openModal(id = null) {
  editingId = id;
  photoData = "";
  editingPhotoPath = "";
  const form = $("#bottleForm");
  form.reset();
  $("#photoPreview").innerHTML = "🍷";
  const _ss = document.querySelector("#scanStatus");
  if (_ss) {
    _ss.textContent = "";
    _ss.className = "scan-status";
  }
  $("#deleteBtn").classList.toggle("hidden", !id);
  $("#modalTitle").textContent = id ? "Modifier la bouteille" : "Ajouter à ma cave";
  if (id) {
    const b = bottles.find((x) => x.id === id);
    Object.entries(b).forEach(([k, v]) => {
      const el = form.elements[k];
      if (el) el.value = v ?? "";
    });
    photoData = b.photo || "";
    editingPhotoPath = b.photoPath || "";
    if (photoData) $("#photoPreview").innerHTML = `<img src="${photoData}" alt="">`;
  }
  $("#modal").classList.remove("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
}
$("#addBtn").onclick = () => openModal();
$("#closeModal").onclick = closeModal;
$("#cancelBtn").onclick = closeModal;
$("#modal .modal-backdrop").onclick = closeModal;

$("#photoInput").onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  compressImage(file, 1100, (d) => {
    photoData = d;
    $("#photoPreview").innerHTML = `<img src="${d}" alt="">`;
  });
};

$("#bottleForm").onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  ["vintage", "quantity", "purchasePrice", "currentValue", "rating"].forEach(
    (k) => (data[k] = Number(data[k] || 0)),
  );
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    // Photo : nouvelle image (data:) -> upload Storage ; sinon on conserve l'URL
    if (photoData && photoData.indexOf("data:") === 0) {
      const blob = await (await fetch(photoData)).blob();
      const up = await DB.uploadPhoto(blob);
      if (editingPhotoPath) {
        try {
          await DB.deletePhoto(editingPhotoPath);
        } catch (e2) {}
      }
      data.photo = up.url;
      data.photoPath = up.path;
    } else {
      data.photo = photoData || "";
      data.photoPath = editingPhotoPath || "";
    }
    if (editingId) {
      const cur = bottles.find((b) => b.id === editingId) || {};
      data.id = editingId;
      data.favorite = cur.favorite || false;
    } else {
      data.favorite = false;
    }
    const saved = await DB.saveBottle(data);
    if (editingId) {
      const i = bottles.findIndex((b) => b.id === editingId);
      if (i > -1) bottles[i] = saved;
      else bottles.unshift(saved);
      toast("Bouteille modifiée");
    } else {
      bottles.unshift(saved);
      toast("Bouteille ajoutée à la cave");
    }
    closeModal();
    render();
  } catch (err) {
    toast("Erreur : " + (err.message || err));
  } finally {
    if (btn) btn.disabled = false;
  }
};

$("#deleteBtn").onclick = async () => {
  if (!editingId) return;
  if (!confirm("Supprimer cette bouteille de la cave ?")) return;
  try {
    const b = bottles.find((x) => x.id === editingId);
    await DB.deleteBottle(editingId);
    if (b && b.photoPath) {
      try {
        await DB.deletePhoto(b.photoPath);
      } catch (e2) {}
    }
    bottles = bottles.filter((x) => x.id !== editingId);
    closeModal();
    render();
    toast("Bouteille supprimée");
  } catch (err) {
    toast("Erreur : " + (err.message || err));
  }
};
$("#searchInput").oninput = renderCellar;
$("#sortSelect").onchange = renderCellar;

// ==========================================================================
// SAUVEGARDE & RESTAURATION
// ==========================================================================
function exportCave() {
  const who = (ME && ME.name) || "cave";
  const payload = {
    app: "Le Bar",
    version: 2,
    profile: who,
    exportedAt: new Date().toISOString(),
    bottles,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const slug =
    who
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "cave";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `le-bar-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Sauvegarde exportée");
}
function importCave(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      const list = Array.isArray(data) ? data : data.bottles;
      if (!Array.isArray(list)) throw new Error("format");
      toast("Import en cours…");
      for (const b of list) {
        const copy = Object.assign({}, b);
        delete copy.id; // insertion comme nouvel enregistrement
        await DB.saveBottle(copy);
      }
      bottles = await DB.listBottles();
      render();
      toast("Cave importée (" + list.length + ")");
    } catch (err) {
      alert("Import impossible : " + (err.message || err));
    }
    input.value = "";
  };
  reader.readAsText(file);
}
$("#exportBtn").onclick = exportCave;
$("#exportBtn2").onclick = exportCave;
$("#importFile").onchange = (e) => importCave(e.target);
$("#importFile2").onchange = (e) => importCave(e.target);

/* ================= Remplissage automatique (lecture d'étiquette) ================= */
function compressImage(file, max, cb) {
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      let w = img.width,
        h = img.height;
      if (w > h && w > max) {
        h = Math.round((h * max) / w);
        w = max;
      } else if (h >= w && h > max) {
        w = Math.round((w * max) / h);
        h = max;
      }
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      cb(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => toast("Image illisible");
    img.src = r.result;
  };
  r.readAsDataURL(file);
}

const _scanInput = document.querySelector("#scanInput");
if (_scanInput)
  _scanInput.onchange = (e) => {
    const f = e.target.files[0];
    if (f) scanLabel(f);
    e.target.value = "";
  };

async function scanLabel(file) {
  const status = document.querySelector("#scanStatus");
  compressImage(file, 1100, async (dataUrl) => {
    photoData = dataUrl;
    document.querySelector("#photoPreview").innerHTML = `<img src="${dataUrl}" alt="">`;
    if (!settings.apiKey) {
      status.className = "scan-status error";
      status.innerHTML =
        "Clé API manquante. Ajoutez-la dans <b>Paramètres &rsaquo; Remplissage automatique</b>.";
      return;
    }
    status.className = "scan-status";
    status.innerHTML = '<span class="spin"></span>Lecture de l\'étiquette…';
    try {
      const b64 = dataUrl.split(",")[1];
      const media = dataUrl.substring(5, dataUrl.indexOf(";"));
      const prompt =
        'Analyse cette étiquette de bouteille (vin, spiritueux ou liqueur). Réponds UNIQUEMENT par un objet JSON, sans texte ni balises autour, avec les clés: name, producer, type (une valeur EXACTE parmi "Vin rouge","Vin blanc","Vin rosé","Vin effervescent","Liqueur","Spiritueux"), grape (cépage ou matière première, ex "Pinot Noir","Rhum"; "" si inconnu), vintage (année en nombre, ou null), region (région ou pays; "" si inconnu). N\'invente pas de prix.';
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: settings.model || DEFAULT_MODEL,
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: media, data: b64 } },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error("API " + res.status + " — " + t.slice(0, 140));
      }
      const data = await res.json();
      let text = (data.content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim()
        .replace(/```json|```/g, "")
        .trim();
      const info = JSON.parse(text);
      const form = document.querySelector("#bottleForm");
      const put = (k, v) => {
        if (v !== undefined && v !== null && v !== "" && form.elements[k])
          form.elements[k].value = v;
      };
      put("name", info.name);
      put("producer", info.producer);
      if (info.type && form.elements["type"]) form.elements["type"].value = info.type;
      put("grape", info.grape);
      if (info.vintage) put("vintage", info.vintage);
      put("region", info.region);
      status.className = "scan-status ok";
      status.textContent = "Champs remplis — vérifiez et complétez si besoin.";
    } catch (err) {
      status.className = "scan-status error";
      status.textContent =
        "Lecture impossible (" + (err.message || err) + "). Saisie manuelle possible.";
    }
  });
}

/* ================= Réglages IA ================= */
function loadSettingsUI() {
  const k = document.querySelector("#apiKeyInput"),
    m = document.querySelector("#apiModelInput");
  if (k) k.value = settings.apiKey || "";
  if (m) m.value = settings.model || DEFAULT_MODEL;
}
if (document.querySelector("#saveKeyBtn"))
  document.querySelector("#saveKeyBtn").onclick = () => {
    settings.apiKey = (document.querySelector("#apiKeyInput").value || "").trim();
    settings.model = (document.querySelector("#apiModelInput").value || "").trim() || DEFAULT_MODEL;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    toast("Réglages enregistrés");
  };
if (document.querySelector("#clearKeyBtn"))
  document.querySelector("#clearKeyBtn").onclick = () => {
    settings.apiKey = "";
    const k = document.querySelector("#apiKeyInput");
    if (k) k.value = "";
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    toast("Clé effacée");
  };
loadSettingsUI();

/* ================= Gestion des profils ================= */
function renderProfileChip() {
  const av = document.querySelector("#profileAvatar"),
    nm = document.querySelector("#profileName"),
    rl = document.querySelector("#profileRole");
  const name = (ME && ME.name) || "—";
  if (av) av.textContent = (name.trim().charAt(0) || "?").toUpperCase();
  if (nm) nm.textContent = name;
  if (rl) rl.textContent = ME ? (ME.role === "admin" ? "Administrateur" : "Utilisateur") : "";
  const navAdmin = document.querySelector("#navAdmin");
  if (navAdmin) navAdmin.style.display = isAdmin() ? "" : "none";
}
function openProfileModal() {
  const box = document.querySelector("#profileList");
  if (box) {
    const initial = (((ME && ME.name) || "?").trim().charAt(0) || "?").toUpperCase();
    box.innerHTML =
      '<div class="profile-row active"><span class="avatar">' +
      escapeHtml(initial) +
      '</span><span class="profile-row-meta"><strong>' +
      escapeHtml((ME && ME.name) || "") +
      "</strong><span>" +
      escapeHtml((ME && ME.email) || "") +
      '</span></span><span class="role-badge ' +
      (isAdmin() ? "admin" : "user") +
      '">' +
      (isAdmin() ? "Admin" : "User") +
      "</span></div>";
  }
  const goto = document.querySelector("#gotoAdminBtn");
  if (goto) goto.style.display = isAdmin() ? "" : "none";
  document.querySelector("#profileModal").classList.remove("hidden");
}
function closeProfileModal() {
  document.querySelector("#profileModal").classList.add("hidden");
}
async function logout() {
  try {
    await DB.signOut();
  } catch (e) {}
  ME = null;
  bottles = [];
  closeProfileModal();
  boot();
}
if (document.querySelector("#profileChip"))
  document.querySelector("#profileChip").onclick = () => {
    openProfileModal();
    if (window.matchMedia("(max-width:850px)").matches) {
      const sb = document.querySelector(".sidebar"),
        sc = document.querySelector("#sidebarScrim");
      if (sb) sb.classList.remove("open");
      if (sc) sc.classList.remove("show");
    }
  };
if (document.querySelector("#closeProfileModal"))
  document.querySelector("#closeProfileModal").onclick = closeProfileModal;
if (document.querySelector("#profileModal .modal-backdrop"))
  document.querySelector("#profileModal .modal-backdrop").onclick = closeProfileModal;
if (document.querySelector("#logoutBtn")) document.querySelector("#logoutBtn").onclick = logout;
/* ---- Administration des comptes (rôles réels, via Supabase) ---- */
function icon(name) {
  const P = {
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    up: '<path d="M18 15l-6-6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock:
      '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-1.6"/>',
    trash:
      '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>',
  };
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    (P[name] || "") +
    "</svg>"
  );
}
async function renderAdminView() {
  if (!isAdmin()) return;
  const wrap = document.querySelector("#adminTable");
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty">Chargement…</div>';
  let list;
  try {
    list = await DB.listProfiles();
  } catch (err) {
    wrap.innerHTML = '<div class="empty">Erreur : ' + escapeHtml(err.message || "" + err) + "</div>";
    return;
  }
  const adminCount = list.filter((p) => p.role === "admin").length;
  wrap.innerHTML = list
    .map((p) => {
      const me = ME && p.id === ME.id;
      const label = p.name || p.email || "—";
      const initial = (label.trim().charAt(0) || "?").toUpperCase();
      const lastAdmin = p.role === "admin" && adminCount <= 1;
      return `<div class="admin-acc ${me ? "me" : ""}" data-id="${p.id}">
      <span class="avatar">${escapeHtml(initial)}</span>
      <span class="admin-acc-meta">
        <span class="nm">${escapeHtml(label)}${me ? ' <span class="role-badge admin" style="background:#1b170e">vous</span>' : ""}<span class="role-badge ${p.role}">${p.role === "admin" ? "Admin" : "User"}</span></span>
        <span class="sb">${escapeHtml(p.email || "")}</span>
      </span>
      <span class="admin-acc-actions">
        <button class="mini" data-a="rename" title="Renommer">${icon("edit")}</button>
        <button class="mini" data-a="role" title="${p.role === "admin" ? "Rétrograder en utilisateur" : "Promouvoir administrateur"}" ${lastAdmin ? "disabled" : ""}>${icon(p.role === "admin" ? "down" : "up")}</button>
      </span>
    </div>`;
    })
    .join("");
  wrap.querySelectorAll(".admin-acc").forEach((row) => {
    const id = row.dataset.id;
    row
      .querySelectorAll("[data-a]")
      .forEach((b) => b.addEventListener("click", () => adminAction(b.dataset.a, id, list)));
  });
}
async function adminAction(a, id, list) {
  const p = (list || []).find((x) => x.id === id);
  if (!p) return;
  try {
    if (a === "rename") {
      const n = prompt("Nom du compte :", p.name || "");
      if (n && n.trim()) {
        await DB.renameProfile(id, n.trim());
        if (ME && id === ME.id) {
          ME.name = n.trim();
          renderProfileChip();
        }
        renderAdminView();
      }
    } else if (a === "role") {
      const newRole = p.role === "admin" ? "user" : "admin";
      if (
        ME &&
        id === ME.id &&
        newRole === "user" &&
        !confirm("Vous allez retirer VOTRE rôle administrateur. Continuer ?")
      )
        return;
      await DB.setRole(id, newRole);
      if (ME && id === ME.id) {
        ME.role = newRole;
        renderProfileChip();
      }
      toast((p.name || p.email) + " : " + (newRole === "admin" ? "administrateur" : "utilisateur"));
      renderAdminView();
    }
  } catch (err) {
    toast("Erreur : " + (err.message || err));
  }
}
if (document.querySelector("#gotoAdminBtn"))
  document.querySelector("#gotoAdminBtn").onclick = () => {
    closeProfileModal();
    showView("admin");
  };
renderProfileChip();

/* ================= Menu latéral rétractable (mobile) ================= */
(function () {
  const sidebar = document.querySelector(".sidebar");
  const scrim = document.querySelector("#sidebarScrim");
  const toggle = document.querySelector("#menuToggle");
  if (!sidebar || !scrim || !toggle) return;
  const isMobile = () => window.matchMedia("(max-width:850px)").matches;
  function open() {
    sidebar.classList.add("open");
    scrim.classList.add("show");
    toggle.setAttribute("aria-label", "Fermer le menu");
  }
  function close() {
    sidebar.classList.remove("open");
    scrim.classList.remove("show");
    toggle.setAttribute("aria-label", "Ouvrir le menu");
  }
  toggle.onclick = () => {
    sidebar.classList.contains("open") ? close() : open();
  };
  scrim.onclick = close;
  // Fermer le tiroir après un choix de rubrique sur mobile
  document.querySelectorAll(".nav-item,[data-view-target]").forEach((n) => {
    n.addEventListener("click", () => {
      if (isMobile()) close();
    });
  });
  // Repasser en desktop : s'assurer que le tiroir est refermé/neutralisé
  window.addEventListener("resize", () => {
    if (!isMobile()) close();
  });
})();

// ==========================================================================
// CONNEXION (Supabase e-mail + mot de passe)
// ==========================================================================
let authMode = "signin"; // "signin" | "signup"
function showAuth(show) {
  const gate = document.querySelector("#authGate");
  if (gate) gate.style.display = show ? "flex" : "none";
}
function authError(msg) {
  const e = document.querySelector("#authError");
  if (e) {
    e.textContent = msg || "";
    e.style.display = msg ? "block" : "none";
  }
}
function bindAuthToggle() {
  const a = document.querySelector("#authToggle");
  if (a)
    a.onclick = (e) => {
      e.preventDefault();
      setAuthMode(authMode === "signup" ? "signin" : "signup");
    };
}
function setAuthMode(mode) {
  authMode = mode;
  const t = document.querySelector("#authTitle");
  const sub = document.querySelector("#authSubmit");
  const sw = document.querySelector("#authSwitch");
  if (t) t.textContent = mode === "signup" ? "Créer un compte" : "Connexion";
  if (sub) sub.textContent = mode === "signup" ? "Créer mon compte" : "Se connecter";
  if (sw)
    sw.innerHTML =
      mode === "signup"
        ? 'Déjà un compte ? <a href="#" id="authToggle">Se connecter</a>'
        : 'Pas de compte ? <a href="#" id="authToggle">Créer un compte</a>';
  bindAuthToggle();
  authError("");
}
async function submitAuth() {
  const email = (document.querySelector("#authEmail").value || "").trim();
  const pass = document.querySelector("#authPassword").value || "";
  if (!email || !pass) {
    authError("Renseignez e-mail et mot de passe.");
    return;
  }
  const btn = document.querySelector("#authSubmit");
  if (btn) btn.disabled = true;
  authError("");
  try {
    if (authMode === "signup") {
      const r = await DB.signUp(email, pass);
      if (r.error) throw r.error;
      const cu = await DB.currentUser();
      if (!cu) {
        setAuthMode("signin");
        authError("Compte créé. Vérifiez votre e-mail, puis connectez-vous.");
        return;
      }
    } else {
      const r = await DB.signIn(email, pass);
      if (r.error) throw r.error;
    }
    await boot();
  } catch (err) {
    authError(err.message || "" + err);
  } finally {
    if (btn) btn.disabled = false;
  }
}
(function initAuthUI() {
  const f = document.querySelector("#authForm");
  if (f) f.onsubmit = (e) => {
    e.preventDefault();
    submitAuth();
  };
  setAuthMode("signin");
})();

// ==========================================================================
// DÉMARRAGE : connexion requise, puis chargement de la cave depuis Supabase
// ==========================================================================
async function boot() {
  let user = null;
  try {
    user = await DB.currentUser();
  } catch (e) {}
  ME = user;
  if (!ME) {
    showAuth(true);
    return;
  }
  showAuth(false);
  renderProfileChip();
  showView("dashboard");
  try {
    bottles = await DB.listBottles();
  } catch (err) {
    bottles = [];
    toast("Erreur de chargement : " + (err.message || err));
  }
  render();
}
if (window.DB) {
  boot();
} else {
  console.error("[Le Bar] db.js non chargé — vérifiez les balises <script>.");
}

// ==========================================================================
// PWA : enregistrement du service worker (cache hors-ligne, si servi en http/https)
// ==========================================================================
if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}

