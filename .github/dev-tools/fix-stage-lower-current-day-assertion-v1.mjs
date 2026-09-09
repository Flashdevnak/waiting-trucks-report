import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const target = new URL(".github/dev-tools/stage-dev-runtime.test.mjs", root);
let source = await readFile(target, "utf8");

const oldAssertion = `  assert.match(first, /bangkokDateValue\\(row\\.unloadingCompletedAt\\) === bangkokDateValue\\(now\\)/);`;
const newAssertion = `  assert.match(first, /return rowBusinessDay\\(row\\) === bangkokDateValue\\(now\\);/);`;

if (source.includes(oldAssertion)) {
  if (source.indexOf(oldAssertion) !== source.lastIndexOf(oldAssertion))
    throw new Error("old staged lower current-day assertion is not unique");
  source = source.replace(oldAssertion, newAssertion);
} else if (!source.includes(newAssertion)) {
  throw new Error("staged lower current-day assertion target missing");
}

await writeFile(target, source);
console.log("STAGE_LOWER_CURRENT_DAY_ASSERTION_V1=PATCHED");
