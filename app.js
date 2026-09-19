// ==========================================================================
// CONSTANTES, RÉGLAGES & PROFILS
// ==========================================================================
const SETTINGS_KEY = "le-bar-settings";
const DEFAULT_MODEL = "claude-sonnet-5";
let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");

/* ===== Profils (comptes locaux) ===== */
const PROFILES_KEY = "le-bar:profiles";
const ACTIVE_KEY = "le-bar:active";
const bottlesKeyFor = (id) => "le-bar:bottles:" + id;
const newId = () =>
  window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function loadProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function persistProfiles() {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}
let profiles = loadProfiles();
function legacyBottles() {
  let l = localStorage.getItem("le-bar-v1") || localStorage.getItem("ma-cave-v1");
  if (l) {
    try {
      const a = JSON.parse(l);
      if (Array.isArray(a)) return a;
    } catch (e) {}
  }
  return null;
}
if (profiles.length === 0) {
  const id = newId();
  profiles = [{ id, name: "Moi", pin: "", role: "admin", createdAt: Date.now() }];
  persistProfiles();
  localStorage.setItem(ACTIVE_KEY, id);
  // Reprise des anciennes données mono-cave si présentes, sinon cave vide
  localStorage.setItem(bottlesKeyFor(id), JSON.stringify(legacyBottles() || []));
}
let activeId = localStorage.getItem(ACTIVE_KEY) || profiles[0].id;
if (!profiles.some((p) => p.id === activeId)) {
  activeId = profiles[0].id;
  localStorage.setItem(ACTIVE_KEY, activeId);
}
// Réparation : profil actif sans cave enregistrée -> reprise des données héritées si disponibles
if (localStorage.getItem(bottlesKeyFor(activeId)) === null) {
  localStorage.setItem(bottlesKeyFor(activeId), JSON.stringify(legacyBottles() || []));
}
const activeProfile = () => profiles.find((p) => p.id === activeId) || profiles[0];
// Migration des rôles (installations antérieures sans rôle)
let _roleMig = false;
profiles.forEach((p) => {
  if (!p.role) {
    p.role = "user";
    _roleMig = true;
  }
});
if (!profiles.some((p) => p.role === "admin")) {
  (profiles.find((p) => p.id === activeId) || profiles[0]).role = "admin";
  _roleMig = true;
}
if (_roleMig) persistProfiles();
const isAdmin = () => activeProfile().role === "admin";

let bottles = JSON.parse(localStorage.getItem(bottlesKeyFor(activeId)) || "null") || [];
let activeFilter = "Toutes";
let editingId = null;
let photoData = "";

// ==========================================================================
// UTILITAIRES
// ==========================================================================
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const euro = (n) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

function save() {
  localStorage.setItem(bottlesKeyFor(activeId), JSON.stringify(bottles));
}
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
    c.querySelector(".favorite").addEventListener("click", (e) => {
      e.stopPropagation();
      const b = bottles.find((x) => x.id === c.dataset.id);
      b.favorite = !b.favorite;
      save();
      render();
      toast(b.favorite ? "Ajouté aux favoris" : "Retiré des favoris");
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
  if (view === "admin" && !(activeProfile().role === "admin")) view = "dashboard";
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

$("#bottleForm").onsubmit = (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  ["vintage", "quantity", "purchasePrice", "currentValue", "rating"].forEach(
    (k) => (data[k] = Number(data[k] || 0)),
  );
  data.photo = photoData;
  if (editingId) {
    const i = bottles.findIndex((b) => b.id === editingId);
    data.id = editingId;
    data.favorite = bottles[i].favorite;
    bottles[i] = data;
    toast("Bouteille modifiée");
  } else {
    data.id = crypto.randomUUID();
    data.favorite = false;
    bottles.unshift(data);
    toast("Bouteille ajoutée à la cave");
  }
  save();
  closeModal();
  render();
};

$("#deleteBtn").onclick = () => {
  if (!editingId) return;
  if (confirm("Supprimer cette bouteille de la cave ?")) {
    bottles = bottles.filter((b) => b.id !== editingId);
    save();
    closeModal();
    render();
    toast("Bouteille supprimée");
  }
};
$("#searchInput").oninput = renderCellar;
$("#sortSelect").onchange = renderCellar;

// ==========================================================================
// SAUVEGARDE & RESTAURATION
// ==========================================================================
function exportCave() {
  const p = activeProfile();
  const payload = {
    app: "Le Bar",
    version: 1,
    profile: p.name,
    exportedAt: new Date().toISOString(),
    bottles,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const slug =
    (p.name || "cave")
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
  toast("Sauvegarde exportée : " + p.name);
}
function importCave(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.bottles)) throw new Error();
      bottles = data.bottles;
      save();
      render();
      toast("Cave restaurée avec succès");
    } catch {
      alert("Fichier de sauvegarde invalide.");
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
  const p = activeProfile();
  const av = document.querySelector("#profileAvatar"),
    nm = document.querySelector("#profileName"),
    rl = document.querySelector("#profileRole");
  const initial = ((p.name || "?").trim().charAt(0) || "?").toUpperCase();
  if (av) av.textContent = initial;
  if (nm) nm.textContent = p.name || "Profil";
  if (rl) rl.textContent = p.role === "admin" ? "Administrateur" : "Utilisateur";
  const navAdmin = document.querySelector("#navAdmin");
  if (navAdmin) navAdmin.style.display = isAdmin() ? "" : "none";
  const gotoAdmin = document.querySelector("#gotoAdminBtn");
  if (gotoAdmin) gotoAdmin.style.display = isAdmin() ? "" : "none";
}
function renderProfileList() {
  const list = document.querySelector("#profileList");
  if (!list) return;
  list.innerHTML = profiles
    .map((p) => {
      const active = p.id === activeId;
      const initial = ((p.name || "?").trim().charAt(0) || "?").toUpperCase();
      const sub = active ? "Profil actif" : p.pin ? "🔒 Code requis" : "Toucher pour ouvrir";
      return `<div class="profile-row ${active ? "active" : ""}" data-id="${p.id}">
      <span class="avatar">${escapeHtml(initial)}</span>
      <span class="profile-row-meta"><strong>${escapeHtml(p.name)}</strong><span>${sub}</span></span>
      <span class="role-badge ${p.role || "user"}">${p.role === "admin" ? "Admin" : "User"}</span>
    </div>`;
    })
    .join("");
  list.querySelectorAll(".profile-row").forEach((row) => {
    row.addEventListener("click", () => switchProfile(row.dataset.id));
  });
}
function switchProfile(id) {
  if (id === activeId) {
    closeProfileModal();
    return;
  }
  const p = profiles.find((x) => x.id === id);
  if (!p) return;
  if (p.pin) {
    const code = prompt("Code d'accès pour « " + p.name + " » :");
    if (code === null) return;
    if (code.trim() !== p.pin) {
      toast("Code incorrect");
      return;
    }
  }
  activeId = id;
  localStorage.setItem(ACTIVE_KEY, activeId);
  bottles = JSON.parse(localStorage.getItem(bottlesKeyFor(activeId)) || "null") || [];
  activeFilter = "Toutes";
  renderProfileChip();
  render();
  closeProfileModal();
  showView("dashboard");
  toast("Profil : " + p.name);
}
function openProfileModal() {
  renderProfileList();
  document.querySelector("#profileModal").classList.remove("hidden");
}
function closeProfileModal() {
  document.querySelector("#profileModal").classList.add("hidden");
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
/* ---- Administration des comptes ---- */
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
function countFor(id) {
  try {
    return (JSON.parse(localStorage.getItem(bottlesKeyFor(id)) || "[]") || []).length;
  } catch (e) {
    return 0;
  }
}
function renderAdminView() {
  if (!isAdmin()) return;
  const wrap = document.querySelector("#adminTable");
  if (!wrap) return;
  const adminCount = profiles.filter((p) => p.role === "admin").length;
  wrap.innerHTML = profiles
    .map((p) => {
      const me = p.id === activeId;
      const initial = ((p.name || "?").trim().charAt(0) || "?").toUpperCase();
      const lastAdmin = p.role === "admin" && adminCount <= 1;
      return `<div class="admin-acc ${me ? "me" : ""}" data-id="${p.id}">
      <span class="avatar">${escapeHtml(initial)}</span>
      <span class="admin-acc-meta">
        <span class="nm">${escapeHtml(p.name)}${me ? ' <span class="role-badge admin" style="background:#1b170e">vous</span>' : ""}<span class="role-badge ${p.role}">${p.role === "admin" ? "Admin" : "User"}</span></span>
        <span class="sb">${p.pin ? "🔒 code actif" : "🔓 sans code"} · ${countFor(p.id)} bouteille(s)</span>
      </span>
      <span class="admin-acc-actions">
        <button class="mini" data-a="rename" title="Renommer">${icon("edit")}</button>
        <button class="mini" data-a="role" title="${p.role === "admin" ? "Rétrograder en utilisateur" : "Promouvoir administrateur"}" ${lastAdmin ? "disabled" : ""}>${icon(p.role === "admin" ? "down" : "up")}</button>
        <button class="mini" data-a="pin" title="${p.pin ? "Modifier ou retirer le code" : "Ajouter un code"}">${icon(p.pin ? "lock" : "unlock")}</button>
        <button class="mini danger-mini" data-a="delete" title="Supprimer le compte" ${profiles.length <= 1 || lastAdmin ? "disabled" : ""}>${icon("trash")}</button>
      </span>
    </div>`;
    })
    .join("");
  wrap.querySelectorAll(".admin-acc").forEach((row) => {
    const id = row.dataset.id;
    row
      .querySelectorAll("[data-a]")
      .forEach((b) => b.addEventListener("click", () => adminAction(b.dataset.a, id)));
  });
}
function adminAction(a, id) {
  const p = profiles.find((x) => x.id === id);
  if (!p) return;
  const adminCount = profiles.filter((x) => x.role === "admin").length;
  if (a === "rename") {
    const n = prompt("Nom du compte :", p.name);
    if (n && n.trim()) {
      p.name = n.trim();
      persistProfiles();
      renderAdminView();
      renderProfileChip();
    }
  } else if (a === "role") {
    if (p.role === "admin" && adminCount <= 1) {
      toast("Au moins un administrateur est requis");
      return;
    }
    p.role = p.role === "admin" ? "user" : "admin";
    persistProfiles();
    renderAdminView();
    renderProfileChip();
    toast(p.name + " : " + (p.role === "admin" ? "administrateur" : "utilisateur"));
  } else if (a === "pin") {
    const code = prompt("Code d'accès pour « " + p.name + " » (laisser vide = aucun) :", "");
    if (code === null) return;
    p.pin = code.trim();
    persistProfiles();
    renderAdminView();
    toast(p.pin ? "Code défini" : "Code retiré");
  } else if (a === "delete") {
    if (profiles.length <= 1) {
      toast("Impossible : dernier compte");
      return;
    }
    if (p.role === "admin" && adminCount <= 1) {
      toast("Impossible : dernier administrateur");
      return;
    }
    if (!confirm("Supprimer le compte « " + p.name + " » et sa cave ? Action définitive.")) return;
    localStorage.removeItem(bottlesKeyFor(id));
    profiles = profiles.filter((x) => x.id !== id);
    persistProfiles();
    if (activeId === id) {
      activeId = profiles[0].id;
      localStorage.setItem(ACTIVE_KEY, activeId);
      bottles = JSON.parse(localStorage.getItem(bottlesKeyFor(activeId)) || "null") || [];
      renderProfileChip();
      render();
    }
    renderAdminView();
    toast("Compte supprimé");
  }
}
function adminAddAccount() {
  if (!isAdmin()) return;
  const inp = document.querySelector("#adminNewName");
  const name = (inp.value || "").trim();
  const role = (document.querySelector("#adminNewRole") || {}).value || "user";
  if (!name) {
    toast("Donnez un nom au compte");
    return;
  }
  const id = newId();
  profiles.push({ id, name, pin: "", role, createdAt: Date.now() });
  persistProfiles();
  localStorage.setItem(bottlesKeyFor(id), JSON.stringify([]));
  inp.value = "";
  renderAdminView();
  toast("Compte « " + name + " » créé");
}
if (document.querySelector("#adminAddBtn"))
  document.querySelector("#adminAddBtn").onclick = adminAddAccount;
if (document.querySelector("#adminNewName"))
  document.querySelector("#adminNewName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") adminAddAccount();
  });
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

render();

// ==========================================================================
// PWA : enregistrement du service worker (cache hors-ligne, si servi en http/https)
// ==========================================================================
if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}

