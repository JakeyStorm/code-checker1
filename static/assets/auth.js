export async function apiGet(url){
  const r = await fetch(url, { credentials: "same-origin" });
  return await r.json();
}

export async function apiPost(url, data){
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    credentials: "same-origin",
    body: JSON.stringify(data ?? {})
  });
  return await r.json();
}

export async function apiPut(url, data){
  const r = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type":"application/json" },
    credentials: "same-origin",
    body: JSON.stringify(data ?? {})
  });
  return await r.json();
}

export async function requireAuthOrRedirect(){
  const me = await apiGet("/api/me");
  if (!me || !me.ok){
    location.href = "/login.html";
    return null;
  }
  return { username: me.username };
}

export async function logout(){
  try { await apiPost("/api/logout", {}); } catch {}
}