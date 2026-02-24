import { apiPost, apiGet } from "./auth.js";

function $(id){ return document.getElementById(id); }

async function tryMe(){
  const r = await apiGet("/api/me");
  if (r && r.ok) {
    location.href = "/app.html";
    return true;
  }
  return false;
}

window.addEventListener("load", async () => {
  // если уже залогинен — сразу в список
  await tryMe();

  const form = $("loginForm");
  const err = $("loginError");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";

    const username = $("username").value.trim();
    const password = $("password").value;

    if (!username || !password){
      err.textContent = "Введите логин и пароль";
      return;
    }

    const res = await apiPost("/api/login", { username, password });

    if (!res || !res.ok){
      err.textContent = "Неверный логин или пароль";
      return;
    }

    // важно: после логина проверяем /api/me (значит cookie сохранилась)
    const ok = await tryMe();
    if (!ok){
      err.textContent = "Вход выполнен, но сессия не сохранилась (cookie).";
    }
  });
});