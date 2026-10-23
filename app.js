/* ===== Config ===== */
const firebaseConfig = {
  apiKey: "AIzaSyBUOjJnRPDbbRZzqJ-yZhkgewl1szSDqwk",
  authDomain: "drag-and-drop-file-uploa-7c156.firebaseapp.com",
  projectId: "drag-and-drop-file-uploa-7c156",
  storageBucket: "drag-and-drop-file-uploa-7c156.firebasestorage.app",
  messagingSenderId: "594344208552",
  appId: "1:594344208552:web:1559915926c2201e857a9d",
  measurementId: "G-BHR5PT3HE3"
};
const ALLOWED = ["image/jpeg", "image/png", "image/gif"];
const MAX_SIZE = 2 * 1024 * 1024;       // 2 MB
const KEY = "dropzone_images_v2";
const LS_LIMIT = 5_000_000;             // ~5M characters in localStorage

const $ = s => document.querySelector(s);
const dropArea = $("#dropArea"), fileInput = $("#fileInput"), errorBox = $("#error"),
      queue = $("#queue"), gallery = $("#gallery"), lightbox = $("#lightbox");

/* ===== Firebase (loaded dynamically so the app still works offline / if blocked) ===== */
let fb = null;
(async () => {
  try {
    const base = "https://www.gstatic.com/firebasejs/13.1.0/";
    const [{ initializeApp }, st] = await Promise.all([
      import(base + "firebase-app.js"), import(base + "firebase-storage.js")]);
    fb = { ...st, storage: st.getStorage(initializeApp(firebaseConfig)) };
    setStatus(true);
  } catch (e) { console.warn("Firebase unavailable:", e); setStatus(false); }
})();
function setStatus(ok) {
  const p = $("#fbStatus");
  p.textContent = ok ? "● Firebase connected" : "● Firebase offline";
  p.className = "pill " + (ok ? "on" : "off");
}
async function sendToFirebase(file) {
  if (!fb) return null;
  try {
    const r = fb.ref(fb.storage, `images/${Date.now()}_${file.name.replace(/[^\w.-]/g, "_")}`);
    const task = (async () => { await fb.uploadBytes(r, file); return fb.getDownloadURL(r); })();
    return await Promise.race([task, new Promise((_, rej) => setTimeout(() => rej("timeout"), 15000))]);
  } catch (e) { console.warn("Firebase upload failed:", e); return null; }
}

/* ===== Helpers ===== */
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtSize = b => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(2) + " MB";
function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type; t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, 3000);
}
function showError(msg) {
  errorBox.textContent = "⚠️ " + msg;
  errorBox.classList.remove("show"); void errorBox.offsetWidth; errorBox.classList.add("show");
  clearTimeout(showError.t); showError.t = setTimeout(() => errorBox.classList.remove("show"), 5000);
}

/* ===== Theme ===== */
const themeBtn = $("#themeBtn");
function applyTheme(t) { document.documentElement.dataset.theme = t; themeBtn.textContent = t === "dark" ? "☀️" : "🌙"; localStorage.setItem("dz_theme", t); }
applyTheme(localStorage.getItem("dz_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
themeBtn.onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

/* ===== Drag & drop + file input + paste ===== */
dropArea.addEventListener("click", () => fileInput.click());
dropArea.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", () => { handleFiles(fileInput.files); fileInput.value = ""; });

let depth = 0; // counts nested dragenter/dragleave so highlight doesn't flicker
dropArea.addEventListener("dragenter", e => { e.preventDefault(); depth++; dropArea.classList.add("dragover"); });
dropArea.addEventListener("dragover", e => { e.preventDefault(); dropArea.classList.add("dragover"); });
dropArea.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; dropArea.classList.remove("dragover"); } });
dropArea.addEventListener("drop", e => {
  e.preventDefault(); depth = 0; dropArea.classList.remove("dragover");
  handleFiles(e.dataTransfer.files);
});
// stop the browser from opening images dropped outside the drop area
["dragover", "drop"].forEach(ev => window.addEventListener(ev, e => e.preventDefault()));
document.addEventListener("paste", e => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) handleFiles(files);
});

/* ===== Validation ===== */
function handleFiles(list) {
  const files = [...list];
  if (!files.length) return;
  let bad = 0;
  files.forEach(file => {
    if (!ALLOWED.includes(file.type)) { bad++; return showError(`Sirf images allowed hain (JPG, PNG, GIF). "${file.name}" allowed nahi hai.`); }
    if (file.size > MAX_SIZE) { bad++; return showError(`"${file.name}" ka size ${fmtSize(file.size)} hai — maximum 2 MB allowed hai.`); }
    startUpload(file);
  });
  if (bad) toast(`${bad} file(s) rejected`, "err");
}

/* ===== Upload card (preview + progress) ===== */
function startUpload(file) {
  const card = document.createElement("div");
  card.className = "q-item";
  card.innerHTML = `<img alt=""><div class="q-info"><div class="q-top"><b>${esc(file.name)}</b><span class="pct">0%</span></div>
    <div class="q-meta">${fmtSize(file.size)} · reading…</div><div class="progress"><div class="bar"></div></div></div>`;
  queue.prepend(card);
  const img = card.querySelector("img"), bar = card.querySelector(".bar"),
        pct = card.querySelector(".pct"), meta = card.querySelector(".q-meta");

  const reader = new FileReader();
  reader.onerror = () => { meta.textContent = "Could not read file"; showError(`Could not read "${file.name}".`); };
  reader.onload = async () => {
    const dataUrl = reader.result;
    img.onload = () => meta.textContent = `${fmtSize(file.size)} · ${img.naturalWidth}×${img.naturalHeight} · uploading…`;
    img.src = dataUrl;

    const cloud = sendToFirebase(file);          // real upload runs in parallel
    let p = 0;                                   // simulated progress with setTimeout
    await new Promise(done => (function tick() {
      p = Math.min(100, p + Math.random() * 14 + 6);
      bar.style.width = p + "%"; pct.textContent = Math.round(p) + "%";
      p < 100 ? setTimeout(tick, 160) : done();
    })());

    meta.textContent = "Finalizing…";
    const url = await cloud;
    const src = await compress(dataUrl, file.type);
    const ok = addImage({ id: Date.now() + Math.random(), name: file.name, size: file.size, src, url });
    card.classList.add("done");
    meta.textContent = ok ? (url ? "✅ Uploaded to Firebase & saved" : "✅ Saved locally (cloud upload failed)") : "❌ Storage full";
    if (ok) toast(url ? "Uploaded to Firebase ☁️" : "Saved locally", url ? "ok" : "");
    setTimeout(() => { card.classList.add("out"); setTimeout(() => card.remove(), 500); }, 2500);
  };
  reader.readAsDataURL(file);
}

/* Shrink PNG/JPG before storing so localStorage doesn't fill up (GIFs kept to preserve animation) */
function compress(dataUrl, type) {
  return new Promise(res => {
    if (type === "image/gif") return res(dataUrl);
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, 1000 / Math.max(im.width, im.height));
      const c = document.createElement("canvas");
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      res(c.toDataURL(type === "image/png" ? "image/webp" : "image/jpeg", .82));
    };
    im.onerror = () => res(dataUrl);
    im.src = dataUrl;
  });
}

/* ===== localStorage persistence ===== */
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
function persist(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } }
function addImage(item) {
  const list = load(); list.unshift(item);
  if (!persist(list)) { showError("localStorage is full. Delete some images to save more."); return false; }
  renderGallery(); return true;
}

/* ===== Gallery ===== */
function renderGallery() {
  const list = load();
  $("#count").textContent = list.length;
  const used = (localStorage.getItem(KEY) || "").length, pctUsed = Math.min(100, used / LS_LIMIT * 100);
  $("#meterBar").style.width = pctUsed + "%";
  $("#meterTxt").textContent = `Local storage: ${pctUsed.toFixed(1)}% used`;
  $("#clearBtn").style.display = list.length ? "" : "none";
  gallery.innerHTML = list.length ? "" : '<div class="empty">🖼️ No images yet — drop one above!</div>';
  list.forEach(img => {
    const d = document.createElement("div");
    d.className = "thumb";
    d.innerHTML = `${img.url ? '<span class="cloud">☁️ cloud</span>' : ""}<img src="${img.src}" alt="${esc(img.name)}">
      <div class="ov"><p>${esc(img.name)} · ${fmtSize(img.size)}</p>
      <div><button data-a="view" title="View">👁</button><button data-a="copy" title="Copy link">🔗</button>
      <button data-a="dl" title="Download">⬇</button><button data-a="del" class="del" title="Delete">🗑</button></div></div>`;
    d.querySelector("img").onclick = () => openLightbox(img);
    d.querySelector(".ov").onclick = e => {
      const a = e.target.closest("button")?.dataset.a; if (!a) return;
      if (a === "view") openLightbox(img);
      if (a === "dl") { const l = document.createElement("a"); l.href = img.src; l.download = img.name; l.click(); }
      if (a === "copy") copyLink(img);
      if (a === "del") { persist(load().filter(i => i.id !== img.id)); renderGallery(); toast("Image deleted"); }
    };
    gallery.appendChild(d);
  });
}
async function copyLink(img) {
  try { await navigator.clipboard.writeText(img.url || img.name); toast(img.url ? "Cloud link copied 🔗" : "No cloud link — name copied", img.url ? "ok" : ""); }
  catch { toast("Copy not supported here", "err"); }
}
$("#clearBtn").onclick = () => { if (confirm("Delete all saved images?")) { localStorage.removeItem(KEY); renderGallery(); toast("All images cleared"); } };

/* ===== Lightbox ===== */
function openLightbox(img) { $("#lbImg").src = img.src; $("#lbCap").textContent = `${img.name} · ${fmtSize(img.size)}`; lightbox.classList.add("show"); }
lightbox.onclick = () => lightbox.classList.remove("show");
document.addEventListener("keydown", e => { if (e.key === "Escape") lightbox.classList.remove("show"); });

renderGallery(); // restore images after refresh