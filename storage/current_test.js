const cases = [
  { name: "ТЕСТ 1", input: [6, 14, 10, 0], expected: 0 },
  { name: "ТЕСТ 2", input: [16, 0], expected: 16 },
  { name: "ТЕСТ 3", input: [56, 86, 96, 0], expected: 152 },
  { name: "ТЕСТ 4", input: [106, 216, 0], expected: 216 },
];

function lastIntNum(str) {
  const nums = String(str ?? "").match(/-?\d+/g) || [];
  if (!nums.length) return null;
  const v = Number(nums[nums.length - 1]);
  return Number.isFinite(v) ? v : null;
}

tester.clearComments();

const hasWhile = tester.isMatchCode(/\bwhile\b/);
tester.print("Есть while", hasWhile);

let allOk = true;

for (const tc of cases) {
  const stu = await tester.run(tc.input);

  const okNoErr = !stu.error;
  const got = lastIntNum(stu.result);

  const okEq = okNoErr && got !== null && got === tc.expected;

  tester.print(`${tc.name}: без ошибок`, okNoErr);

  allOk = allOk && okEq;
}

tester.print("Итог: все тесты пройдены", allOk);
return;
