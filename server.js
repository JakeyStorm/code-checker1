import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "static")));

const STORAGE_DIR = path.join(__dirname, "storage");
const TEST_FILE = path.join(STORAGE_DIR, "current_test.js");
const REF_FILE = path.join(STORAGE_DIR, "reference_code.py");

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// pages
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "static", "student.html")));
app.get("/teacher", (req, res) => res.sendFile(path.join(__dirname, "static", "teacher.html")));

// init default test
if (!fs.existsSync(TEST_FILE)) {
  fs.writeFileSync(
    TEST_FILE,
`await tester.run();

tester.print("Код запустился без ошибки", !tester.error, 100);
return;
`,
    "utf-8"
  );
}

// init default reference
if (!fs.existsSync(REF_FILE)) {
  fs.writeFileSync(
    REF_FILE,
`# Эталонный код (пример)
n = int(input())
a = [int(input()) for _ in range(n)]
mx = max(a); mn = min(a)
print(mx)
print(a.index(mx)+1)
print(mn)
print(a.index(mn)+1)
`,
    "utf-8"
  );
}

// --- helpers ---
function safeToString(x) {
  try { return String(x); } catch { return ""; }
}

function normalizeText(s) {
  return safeToString(s)
    .replace(/\r/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// args -> stdin like trainer: run([1,2,3]) OR run(1,2,3) OR run("...\n") OR run()
function argsToStdin(args) {
  if (!args || args.length === 0) return "";

  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0].map(v => safeToString(v)).join("\n") + "\n";
  }
  if (args.length === 1 && typeof args[0] === "string") {
    return args[0];
  }
  return args.map(v => safeToString(v)).join("\n") + "\n";
}

function runPython(code, stdinText, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const py = spawn("python", ["-u", "-c", code], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      py.kill("SIGKILL");
    }, timeoutMs);

    py.stdout.on("data", d => stdout += d.toString("utf-8"));
    py.stderr.on("data", d => stderr += d.toString("utf-8"));

    py.on("close", exitCode => {
      clearTimeout(timer);
      resolve({
        exitCode: killed ? 124 : exitCode,
        stdout,
        stderr,
        timeout: killed
      });
    });

    py.stdin.write(stdinText || "");
    py.stdin.end();
  });
}

// --- Tester ---
class Tester {
  constructor(studentCode, referenceCode) {
    this._originalStudentCode = studentCode || "";
    this._studentCode = studentCode || "";
    this._referenceCode = referenceCode || "";
    this._addedCode = "";

    this.result = "";
    this.error = false;
    this.message = "";
    this.log = "";

    this.prints = [];
    this._scoreTotal = 0;
  }

  addCode(code) {
    this._addedCode += "\n" + safeToString(code) + "\n";
  }

  resetCode() {
    this._studentCode = this._originalStudentCode;
    this._addedCode = "";
  }

  clearComments() {
    // very simple python comment stripping
    this._studentCode = this._studentCode.replace(/#.*$/gm, "");
  }

  print(message, value, score = 0) {
    const pass = (typeof value === "undefined") ? !this.error : Boolean(value);
    const s = Number(score || 0);
    if (pass && s > 0) this._scoreTotal += s;
    this.prints.push({ message: safeToString(message), pass, score: s });
  }

  async run(...args) {
    const stdin = argsToStdin(args);
    const fullCode = `${this._studentCode}\n${this._addedCode}`;

    const r = await runPython(fullCode, stdin);

    this.result = r.stdout || "";
    this.error = (r.exitCode !== 0);
    this.message = r.timeout ? "Timeout" : (r.stderr || "");

    this.log += `\n=== RUN ===\nstdin:\n${stdin}\nstdout:\n${this.result}\nstderr:\n${this.message}\nexit:${r.exitCode}\n`;

    return { result: this.result, error: this.error, message: this.message };
  }

  async runReference(...args) {
    const stdin = argsToStdin(args);
    const r = await runPython(this._referenceCode, stdin);

    this.result = r.stdout || "";
    this.error = (r.exitCode !== 0);
    this.message = r.timeout ? "Timeout" : (r.stderr || "");

    this.log += `\n=== RUN_REFERENCE ===\nstdin:\n${stdin}\nstdout:\n${this.result}\nstderr:\n${this.message}\nexit:${r.exitCode}\n`;

    return { result: this.result, error: this.error, message: this.message };
  }

  isEqual(str) {
    if (this.error) return false;
    return normalizeText(this.result) === normalizeText(str);
  }

  isEqualCode(str) {
    return normalizeText(this._studentCode) === normalizeText(str);
  }

  isContains(str) {
    return safeToString(this.result).includes(safeToString(str).trim());
  }

  isMatch(regexp, params = "ui") {
    const re = regexp instanceof RegExp ? regexp : new RegExp(regexp, params);
    return re.test(safeToString(this.result));
  }

  isMatchCode(regexp, params = "ui") {
    const re = regexp instanceof RegExp ? regexp : new RegExp(regexp, params);
    return re.test(safeToString(this._studentCode));
  }

  isKeywords(keywords) {
    const words = safeToString(keywords)
      .split(/[,\s]+/g).map(w => w.trim()).filter(Boolean);
    const code = safeToString(this._studentCode).toLowerCase();
    return words.every(w => code.includes(w.toLowerCase()));
  }

  get score() {
    const anyScored = this.prints.some(p => p.score > 0);
    const allPass = this.prints.every(p => p.pass);
    if (!anyScored) return allPass ? 100 : 0;
    return this._scoreTotal;
  }
}

// --- API: test + reference ---
app.get("/api/test", (req, res) => {
  res.json({ test: fs.readFileSync(TEST_FILE, "utf-8") });
});
app.post("/api/test", (req, res) => {
  fs.writeFileSync(TEST_FILE, safeToString(req.body?.test), "utf-8");
  res.json({ ok: true });
});

app.get("/api/reference", (req, res) => {
  res.json({ reference: fs.readFileSync(REF_FILE, "utf-8") });
});
app.post("/api/reference", (req, res) => {
  fs.writeFileSync(REF_FILE, safeToString(req.body?.reference), "utf-8");
  res.json({ ok: true });
});

// --- check ---
app.post("/api/check", async (req, res) => {
  const studentCode = safeToString(req.body?.code);
  const testJs = fs.readFileSync(TEST_FILE, "utf-8");
  const referenceCode = fs.readFileSync(REF_FILE, "utf-8");

  const tester = new Tester(studentCode, referenceCode);

  const sandbox = {
    tester,
    console: { log: () => {} },
    setTimeout,
    clearTimeout
  };
  const context = vm.createContext(sandbox);

  try {
    const wrapped = `(async () => {\n${testJs}\n})()`;
    const script = new vm.Script(wrapped, { timeout: 2000 });
    await script.runInContext(context);

    res.json({
      ok: tester.prints.every(p => p.pass),
      prints: tester.prints,
      score: tester.score,
      result: tester.result,
      error: tester.error,
      message: tester.message,
      log: tester.log
    });
  } catch (e) {
    tester.print("Ошибка в тесте (JS): " + (e?.message || e), false, 0);
    res.json({
      ok: false,
      prints: tester.prints,
      score: tester.score,
      result: tester.result,
      error: true,
      message: safeToString(e?.message || e),
      log: tester.log
    });
  }
});

// port 8010
const PORT = 8010;
app.listen(PORT, () => {
  console.log("🚀 code-checker1 запущен");
  console.log(`Student: http://127.0.0.1:${PORT}/`);
  console.log(`Teacher: http://127.0.0.1:${PORT}/teacher`);
});
