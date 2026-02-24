import { requireAuthOrRedirect, apiGet, apiPost, logout } from "./auth.js";

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}

function renderList(list) {
  const root = $("list");
  const empty = $("empty");
  root.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  for (const t of list) {
    const row = document.createElement("div");
    row.className = "listRow";
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.style.padding = "10px 12px";
    row.style.border = "1px solid rgba(0,0,0,.08)";
    row.style.borderRadius = "12px";
    row.style.marginBottom = "8px";
    row.style.cursor = "pointer";

    const left = document.createElement("div");
    left.innerHTML = `<div style="font-weight:900;">${escapeHtml(t.title || "Тренажёр")}</div>
                      <div class="muted" style="font-size:12px;">${escapeHtml(t.id)}</div>`;

    const right = document.createElement("div");
    right.innerHTML = `<span class="btnSoft">Открыть →</span>`;

    row.appendChild(left);
    row.appendChild(right);

    row.addEventListener("click", () => {
      location.href = `/trainer.html?id=${encodeURIComponent(t.id)}`;
    });

    root.appendChild(row);
  }
}

async function load() {
  const r = await apiGet("/api/trainers");
  if (!r || !r.ok) {
    $("list").innerHTML = `<div class="muted">Не удалось загрузить список</div>`;
    $("empty").style.display = "none";
    return;
  }
  renderList(r.list);
}

async function createTrainer() {
  const title = $("titleInput").value.trim();
  if (!title) {
    alert("Введите название тренажёра");
    return;
  }

  const r = await apiPost("/api/trainers", { title });
  if (!r || !r.ok) {
    alert("Не удалось создать тренажёр");
    return;
  }

  location.href = `/trainer.html?id=${encodeURIComponent(r.id)}`;
}

async function init() {
  const user = await requireAuthOrRedirect();
  if (!user) return;

  $("userLabel").textContent = `Аккаунт: ${user.username}`;

  $("logoutBtn").addEventListener("click", async () => {
    await logout();
    location.href = "/login.html";
  });

  $("reloadBtn").addEventListener("click", load);
  $("createBtn").addEventListener("click", createTrainer);

  $("titleInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") createTrainer();
  });

  await load();
}

init();