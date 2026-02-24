import { requireAuthOrRedirect, logout, apiGet, apiPut, apiPost } from "./auth.js";

let trainerId = null;
let trainer = null;
let selectedTplIndex = -1;

let saveTimer = null;
let saveInFlight = false;
let pendingSave = false;

function q(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function setBadge(kind, text){
  const el = document.getElementById("saveBadge");
  el.classList.remove("ok","work","err");
  el.classList.add(kind === "work" ? "work" : kind === "err" ? "err" : "ok");
  el.textContent = text;
}
function setTplBadge(kind, text){
  const el = document.getElementById("tplSaveBadge");
  el.classList.remove("ok","work","err");
  el.classList.add(kind === "work" ? "work" : kind === "err" ? "err" : "ok");
  el.textContent = text;
}

function switchMode(mode){
  document.getElementById("pill-unit").classList.toggle("active", mode === "unit");
  document.getElementById("pill-templates").classList.toggle("active", mode === "templates");

  if (mode === "templates"){
    document.body.classList.add("templatesMode");
    document.getElementById("unitView").style.display = "none";
    document.getElementById("templatesView").style.display = "block";
  } else {
    document.body.classList.remove("templatesMode");
    document.getElementById("unitView").style.display = "block";
    document.getElementById("templatesView").style.display = "none";
  }
}

function ensureTrainerFields(){
  if (trainer.title === undefined) trainer.title = "Тренажёр";
  if (trainer.taskText === undefined) trainer.taskText = "";
  if (trainer.referenceInput === undefined) trainer.referenceInput = "";
  if (trainer.testJs === undefined) trainer.testJs = "";
  if (trainer.referencePy === undefined) trainer.referencePy = "";
  if (!Array.isArray(trainer.templates)) trainer.templates = [];
}

function fillUI(user){
  document.getElementById("who").textContent = user.username;
  document.getElementById("subInfo").textContent = "id: " + trainerId;

  document.getElementById("titleH").textContent = trainer.title || "Тренажёр";
  document.getElementById("taskText").value = trainer.taskText || "";
  document.getElementById("referenceInput").value = trainer.referenceInput || "";
  document.getElementById("testJs").value = trainer.testJs || "";

  // settings modal field
  document.getElementById("referencePy").value = trainer.referencePy || "";

  selectedTplIndex = -1;
  document.getElementById("tplCode").value = "";
  document.getElementById("tplHeader").textContent = "Решение —";
  renderTemplates();

  setBadge("ok","сохранено");
  setTplBadge("ok","сохранено");
}

function collectFromUI(){
  trainer.taskText = document.getElementById("taskText").value;
  trainer.referenceInput = document.getElementById("referenceInput").value;
  trainer.testJs = document.getElementById("testJs").value;

  // referencePy from modal
  trainer.referencePy = document.getElementById("referencePy").value;

  return trainer;
}

function scheduleSave(){
  pendingSave = true;
  setBadge("work","сохраняю…");
  setTplBadge("work","сохраняю…");
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(), 450);
}

async function saveNow(){
  if (!trainerId || !trainer) return;
  if (saveInFlight) { pendingSave = true; return; }

  const payload = collectFromUI();
  saveInFlight = true;
  pendingSave = false;

  try{
    const r = await apiPut("/api/trainers/" + encodeURIComponent(trainerId), payload);
    if (r.ok){
      setBadge("ok","сохранено");
      setTplBadge("ok","сохранено");
    } else {
      setBadge("err","ошибка");
      setTplBadge("err","ошибка");
    }
  } catch {
    setBadge("err","ошибка");
    setTplBadge("err","ошибка");
  } finally {
    saveInFlight = false;
    if (pendingSave) scheduleSave();
  }
}

async function forceSave(){
  if (saveTimer) clearTimeout(saveTimer);
  await saveNow();
}

async function loadTrainer(){
  trainerId = q("id");
  if (!trainerId) { location.href = "/app.html"; return; }

  const r = await apiGet("/api/trainers/" + encodeURIComponent(trainerId));
  if (!r.ok) {
    alert("Не удалось открыть тренажёр");
    location.href = "/app.html";
    return;
  }
  trainer = r.trainer;
  ensureTrainerFields();
}

/* ---------------- Templates ---------------- */
function renderTemplates(){
  const list = document.getElementById("tplList");
  list.innerHTML = "";

  if (!trainer.templates.length){
    list.innerHTML = `<div class="muted" style="padding:10px;">Пока нет шаблонов. Нажми “+ Добавить”.</div>`;
    return;
  }

  trainer.templates.forEach((t, idx) => {
    const item = document.createElement("div");
    item.className = "tplItem" + (idx === selectedTplIndex ? " active" : "");

    const left = document.createElement("div");
    left.className = "tplItemLeft";

    const dot = document.createElement("div");
    dot.className = "dot" + (idx === selectedTplIndex ? " active" : "");
    dot.textContent = (idx === selectedTplIndex) ? "✓" : "";

    const name = document.createElement("div");
    name.className = "tplName";
    name.textContent = t.name || ("Решение " + (idx+1));

    left.appendChild(dot);
    left.appendChild(name);

    const actions = document.createElement("div");
    actions.className = "tplActions";

    const editBtn = document.createElement("button");
    editBtn.className = "miniIconBtn";
    editBtn.title = "Переименовать";
    editBtn.textContent = "✎";
    editBtn.onclick = (ev) => {
      ev.stopPropagation();
      const newName = prompt("Название решения:", name.textContent);
      if (newName !== null){
        trainer.templates[idx].name = newName.trim() || name.textContent;
        renderTemplates();
        scheduleSave();
      }
    };

    const delBtn = document.createElement("button");
    delBtn.className = "miniIconBtn danger";
    delBtn.title = "Удалить";
    delBtn.textContent = "🗑";
    delBtn.onclick = (ev) => {
      ev.stopPropagation();
      if (!confirm("Удалить решение?")) return;
      trainer.templates.splice(idx,1);

      if (selectedTplIndex === idx){
        selectedTplIndex = -1;
        document.getElementById("tplCode").value = "";
        document.getElementById("tplHeader").textContent = "Решение —";
      } else if (selectedTplIndex > idx){
        selectedTplIndex -= 1;
      }

      renderTemplates();
      scheduleSave();
    };

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    item.appendChild(left);
    item.appendChild(actions);
    item.onclick = () => selectTemplate(idx);

    list.appendChild(item);
  });
}

function selectTemplate(idx){
  selectedTplIndex = idx;
  document.getElementById("tplCode").value = trainer.templates[idx].code || "";
  document.getElementById("tplHeader").textContent = trainer.templates[idx].name || ("Решение " + (idx+1));
  renderTemplates();
}

function addTemplate(){
  if (trainer.templates.length >= 50) { alert("Лимит 50"); return; }
  trainer.templates.push({ name: "Решение " + (trainer.templates.length + 1), code: "" });
  selectTemplate(trainer.templates.length - 1);
  scheduleSave();
}

function copyTemplateToStudent(){
  if (selectedTplIndex < 0) return alert("Выбери решение слева");
  document.getElementById("studentCode").value = trainer.templates[selectedTplIndex].code || "";
}

/* ---------------- Check (unit tests) ---------------- */
async function runCheck(){
  const code = document.getElementById("studentCode").value;

  const r = await fetch("/api/check", {
    method:"POST",
    headers: {"Content-Type":"application/json"},
    credentials: "same-origin",
    body: JSON.stringify({ trainerId, code })
  });

  const data = await r.json();

  const prints = Array.isArray(data.prints) ? data.prints : [];
  const hasChecks = prints.length > 0;

  const ul = document.getElementById("checks");
  ul.innerHTML = "";

  prints.forEach(p => {
    const li = document.createElement("li");
    li.className = p.pass ? "ok" : "bad";
    li.textContent = (p.pass ? "✅ " : "❌ ") + p.message;
    ul.appendChild(li);
  });

  const statusText = document.getElementById("statusText");
  if (!hasChecks) statusText.textContent = "unit-test не подключён или упал";
  else statusText.textContent = `${prints.filter(p=>p.pass).length} из ${prints.length} тестов пройдено`;

  document.getElementById("stdout").textContent = (data.result || "").trim() || "—";
  document.getElementById("stderr").textContent = (data.message || "").trim() || "—";
}

/* ---------------- AI Generate ---------------- */
async function generateByTask(){
  const task = (document.getElementById("taskText").value || "").trim();
  if (!task) return alert("Поле 'Задание' пустое");

  const btn = document.getElementById("genBtn");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Генерирую…";

  try{
    // на всякий случай сохраним текущие поля
    await forceSave();

    const r = await apiPost("/api/ai/generate", { trainerId, taskText: task });

    if (!r || !r.ok){
      alert(r?.message || "Не получилось сгенерировать");
      return;
    }

    // применяем в тренажёр + UI
    trainer.testJs = r.testJs || "";
    trainer.referencePy = r.referencePy || "";
    trainer.referenceInput = r.referenceInput || "";
    trainer.templates = Array.isArray(r.templates) ? r.templates : [];

    document.getElementById("testJs").value = trainer.testJs;
    document.getElementById("referencePy").value = trainer.referencePy;
    document.getElementById("referenceInput").value = trainer.referenceInput;

    // если появились шаблоны — обновим список
    renderTemplates();

    await forceSave();
    alert("Сгенерировано ✅");
  } catch(e){
    console.error(e);
    alert("Ошибка генерации: " + (e?.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

/* ---------------- Export ---------------- */
function exportTrainer(){
  if (!trainer) return;
  const payload = collectFromUI();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (payload.title || "trainer") + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------- Settings modal ---------------- */
function openSettings(){
  document.getElementById("settingsModal").style.display = "grid";
}
function closeSettings(){
  document.getElementById("settingsModal").style.display = "none";
}

/* ---------------- Init ---------------- */
async function init(){
  const user = await requireAuthOrRedirect();
  if (!user) return;

  await loadTrainer();
  fillUI(user);

  // tabs
  document.getElementById("pill-unit").onclick = () => switchMode("unit");
  document.getElementById("pill-templates").onclick = () => switchMode("templates");

  // top buttons
  document.getElementById("logoutBtn").onclick = async () => {
    await logout();
    location.href = "/login.html";
  };
  document.getElementById("exportBtn").onclick = exportTrainer;

  // main
  document.getElementById("checkBtn").onclick = runCheck;

  // ВОТ ГЛАВНОЕ: вместо saveBtn теперь genBtn
  document.getElementById("genBtn").onclick = generateByTask;

  // templates
  document.getElementById("addTplBtn").onclick = addTemplate;
  document.getElementById("copyTplBtn").onclick = copyTemplateToStudent;
  document.getElementById("historyBtn").onclick = () => alert("Позже добавим историю изменений");

  // settings modal
  document.getElementById("settingsBtn").onclick = openSettings;

  const close1 = document.getElementById("closeSettingsBtn");
  const close2 = document.getElementById("closeSettingsBtn2");
  close1.onclick = closeSettings;
  close2.onclick = closeSettings;

  // click overlay to close
  document.getElementById("settingsModal").addEventListener("click", (e) => {
    if (e.target.id === "settingsModal") closeSettings();
  });

  document.getElementById("saveSettingsBtn").onclick = async () => {
    await forceSave();
    closeSettings();
  };

  // autosave on inputs
  document.addEventListener("input", (e) => {
    if (!trainer) return;
    const id = e.target?.id;

    if (id === "taskText" || id === "referenceInput" || id === "testJs" || id === "referencePy"){
      scheduleSave();
    }

    if (id === "tplCode"){
      if (selectedTplIndex >= 0){
        trainer.templates[selectedTplIndex].code = document.getElementById("tplCode").value;
        scheduleSave();
      }
    }
  });

  // back: save and exit
  document.getElementById("backLink").addEventListener("click", async (e) => {
    e.preventDefault();
    await forceSave();
    location.href = "/app.html";
  });

  switchMode("unit");
  closeSettings();
}

init();