require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const { spawn } = require("child_process");

// OpenAI SDK (npm i openai)
let OpenAI;
try {
  const pkg = require("openai");
  OpenAI = pkg.default ?? pkg;
} catch (e) {
  OpenAI = null;
}

const app = express();
const PORT = 8010;

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "static")));

/* ================= STORAGE ================= */

const STORAGE = path.join(__dirname, "storage");
const USERS_FILE = path.join(STORAGE, "users.json");
const SESSIONS_FILE = path.join(STORAGE, "sessions.json");
const DATA_DIR = path.join(STORAGE, "data");

function ensureFile(file, def) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(def, null, 2));
  }
}

ensureFile(USERS_FILE, { users: [] });
ensureFile(SESSIONS_FILE, { sessions: {} });

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/* ================= AUTH ================= */

function authMiddleware(req, res, next) {
  const sid = req.cookies.sid;
  if (!sid) return res.status(401).json({ ok: false });

  const sessions = readJSON(SESSIONS_FILE).sessions;
  const username = sessions[sid];
  if (!username) return res.status(401).json({ ok: false });

  req.user = username;
  next();
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const users = readJSON(USERS_FILE).users;

  const u = users.find((x) => x.username === username);
  if (!u || u.passwordHash !== sha256(password)) {
    return res.json({ ok: false });
  }

  const sid = crypto.randomBytes(16).toString("hex");
  const data = readJSON(SESSIONS_FILE);
  data.sessions[sid] = username;
  writeJSON(SESSIONS_FILE, data);

  res.cookie("sid", sid, { httpOnly: true });
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  const sid = req.cookies.sid;
  if (sid) {
    const data = readJSON(SESSIONS_FILE);
    delete data.sessions[sid];
    writeJSON(SESSIONS_FILE, data);
  }
  res.clearCookie("sid");
  res.json({ ok: true });
});

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ ok: true, username: req.user });
});

/* ================= TRAINERS ================= */

function userDir(username) {
  return path.join(DATA_DIR, username, "trainers");
}

app.get("/api/trainers", authMiddleware, (req, res) => {
  const dir = userDir(req.user);
  fs.mkdirSync(dir, { recursive: true });

  const list = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const id = f.replace(".json", "");
      const data = readJSON(path.join(dir, f));
      return { id, title: data.title || "Тренажёр" };
    });

  res.json({ ok: true, list });
});

/**
 * ✅ FIX: берём название из ввода (title или name).
 * Если пусто — "Новый тренажёр".
 */
app.post("/api/trainers", authMiddleware, (req, res) => {
  const dir = userDir(req.user);
  fs.mkdirSync(dir, { recursive: true });

  const rawTitle =
    (typeof req.body?.title === "string" ? req.body.title : "") ||
    (typeof req.body?.name === "string" ? req.body.name : "");

  const title = String(rawTitle).trim() || "Новый тренажёр";

  const id = crypto.randomBytes(8).toString("hex");
  const file = path.join(dir, id + ".json");

  const trainer = {
    title,
    taskText: "",
    referenceInput: "",
    testJs: "",
    referencePy: "",
    templates: [],
  };

  writeJSON(file, trainer);
  res.json({ ok: true, id });
});

app.get("/api/trainers/:id", authMiddleware, (req, res) => {
  const file = path.join(userDir(req.user), req.params.id + ".json");
  if (!fs.existsSync(file)) return res.json({ ok: false });
  res.json({ ok: true, trainer: readJSON(file) });
});

app.put("/api/trainers/:id", authMiddleware, (req, res) => {
  const file = path.join(userDir(req.user), req.params.id + ".json");
  if (!fs.existsSync(file)) return res.json({ ok: false });

  writeJSON(file, req.body);
  res.json({ ok: true });
});

/* ================= AI GENERATE ================= */
/**
 * POST /api/ai/generate
 * body: { trainerId, taskText }
 */
app.post("/api/ai/generate", authMiddleware, async (req, res) => {
  try {
    if (!OpenAI) {
      return res.json({
        ok: false,
        message: "OpenAI SDK не установлен. Выполни: npm i openai",
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.json({
        ok: false,
        message: "Нет OPENAI_API_KEY в окружении (создай .env рядом с server.js)",
      });
    }

    const trainerId = String(req.body?.trainerId ?? "").trim();
    const taskText = String(req.body?.taskText ?? "").trim();

    if (!trainerId) return res.json({ ok: false, message: "Нет trainerId" });
    if (!taskText) return res.json({ ok: false, message: "Пустое задание" });

    const file = path.join(userDir(req.user), trainerId + ".json");
    if (!fs.existsSync(file)) return res.json({ ok: false, message: "Тренажёр не найден" });

    const trainer = readJSON(file);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const instructions = `
Ты генератор контента для тренажёра по Python.
Верни СТРОГО JSON (без текста вокруг).

Формат:
{
  "referencePy": "эталонное решение на Python",
  "testJs": "JS unit tests для среды tester (await tester.run(), tester.print(msg, pass, score))",
  "referenceInput": "пример ввода (каждая строка отдельное значение) или пусто",
  "templates": [{"name":"...", "code":"..."}]
}

Требования к testJs:
- тесты должны вызывать await tester.run() ИЛИ await tester.run([...])
- если проверяешь вывод, извлекай последнее число из stdout
- используй tester.print("...", pass, score)
- суммарный score = 100

Если невозможно:
{ "cannot": true, "reason": "..." }
`.trim();

    const input = `ЗАДАНИЕ:\n${taskText}`;

    // responses API
    const ai = await client.responses.create({
      model: "gpt-5",
      instructions,
      input,
    });

    const text = String(ai.output_text || "").trim();

    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return res.json({
        ok: false,
        message: "AI вернул не JSON",
        raw: text.slice(0, 2000),
      });
    }

    if (obj?.cannot) {
      return res.json({ ok: false, message: obj.reason || "Не могу сгенерировать" });
    }

    trainer.referencePy = typeof obj.referencePy === "string" ? obj.referencePy : (trainer.referencePy || "");
    trainer.testJs = typeof obj.testJs === "string" ? obj.testJs : (trainer.testJs || "");
    trainer.referenceInput = typeof obj.referenceInput === "string" ? obj.referenceInput : (trainer.referenceInput || "");
    trainer.templates = Array.isArray(obj.templates) ? obj.templates : (trainer.templates || []);

    writeJSON(file, trainer);

    return res.json({
      ok: true,
      referencePy: trainer.referencePy || "",
      testJs: trainer.testJs || "",
      referenceInput: trainer.referenceInput || "",
      templates: trainer.templates || [],
    });
  } catch (e) {
    console.error(e);
    return res.json({ ok: false, message: e?.message || String(e) });
  }
});

/* ================= PYTHON RUN ================= */

function runPython(code, input) {
  return new Promise((resolve) => {
    const py = spawn("python", ["-c", code]);

    let out = "";
    let err = "";

    py.stdout.on("data", (d) => (out += d.toString()));
    py.stderr.on("data", (d) => (err += d.toString()));

    py.on("close", () => {
      resolve({ result: out, error: err });
    });

    py.stdin.write(input || "");
    py.stdin.end();
  });
}

/* ================= CHECK ================= */

app.post("/api/check", authMiddleware, async (req, res) => {
  const { trainerId, code } = req.body || {};
  const file = path.join(userDir(req.user), String(trainerId) + ".json");

  if (!fs.existsSync(file)) return res.json({});

  const trainer = readJSON(file);
  const prints = [];

  const tester = {
    prints,

    // ✅ FIX: run() может быть без аргументов
    async run(inputArr = []) {
      const arr = Array.isArray(inputArr) ? inputArr : [];
      const input = arr.join("\n") + (arr.length ? "\n" : "");
      return await runPython(code, input);
    },

    async runReference(inputArr = []) {
      const arr = Array.isArray(inputArr) ? inputArr : [];
      const input = arr.join("\n") + (arr.length ? "\n" : "");
      return await runPython(trainer.referencePy || "", input);
    },

    // ✅ FIX: поддержка score (третий аргумент)
    print(message, pass, score = 0) {
      prints.push({ message, pass, score });
    },

    isMatchCode(regex) {
      return regex.test(code);
    },

    clearComments() {},
  };

  try {
    const wrapped = `(async()=>{ ${trainer.testJs || ""} })()`;
    await eval(wrapped);
  } catch (e) {
    return res.json({ message: e.message });
  }

  res.json({ prints });
});

app.get("/api/ip", async (req, res) => {
  const r = await fetch("https://api.ipify.org?format=json");
  const j = await r.json();
  res.json(j);
});


/* ================= ROUTES ================= */

app.get("/", (req, res) => res.redirect("/login.html"));
app.get("/login", (req, res) => res.redirect("/login.html"));
app.get("/app", (req, res) => res.redirect("/app.html"));
app.get("/trainer", (req, res) => res.redirect("/trainer.html"));

/* ================= START ================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 code-checker1 запущен");
  console.log("http://127.0.0.1:" + PORT);
  console.log("OPENAI_API_KEY exists?", !!process.env.OPENAI_API_KEY);
});