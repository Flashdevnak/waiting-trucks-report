import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const devTools = path.join(repoRoot, ".github/dev-tools");
const stageFile = path.join(devTools, "stage-dev-runtime.mjs");
const INSTALL_MARKER = "BUS_TIME_HOT_LANE_V14_STAGE";
const files = [
  "patch-bus-time-hot-lane-v14.mjs",
  "bus-time-hot-lane-v14-runtime.mjs",
  "bus-time-hot-lane-v14.test.mjs",
];

function replaceUnique(input, from, to, label) {
  const first = input.indexOf(from);
  const last = input.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${INSTALL_MARKER}: ${label} anchor missing or non-unique`);
  return input.slice(0, first) + to + input.slice(first + from.length);
}

for (const name of files)
  fs.copyFileSync(path.join(here, name), path.join(devTools, name));

let stage = fs.readFileSync(stageFile, "utf8");
if (!stage.includes(INSTALL_MARKER)) {
  const constAnchor = `const repoRoot = fileURLToPath(new URL("../../", import.meta.url));`;
  const constReplacement = `// ${INSTALL_MARKER}: normal DEV staging always applies the BusTime hot lane.
const devBusTimeHotLaneV14Patch = fileURLToPath(
  new URL("./patch-bus-time-hot-lane-v14.mjs", import.meta.url),
);
${constAnchor}`;
  stage = replaceUnique(stage, constAnchor, constReplacement, "patch path");

  const execAnchor = `  execFileSync(process.execPath, [devTbrSplitV2Patch, workerTarget], {
    stdio: "inherit",
  });`;
  const execReplacement = `${execAnchor}
  execFileSync(process.execPath, [devBusTimeHotLaneV14Patch, workerTarget], {
    stdio: "inherit",
  });
  const busTimeHotLaneWorker = await readFile(workerTarget, "utf8");
  if (!busTimeHotLaneWorker.includes("BUS_TIME_HOT_LANE_V14"))
    throw new Error("DEV BusTime hot-lane marker missing after staging");
  if (busTimeHotLaneWorker.includes("BUS_TIME_SOURCE_TTL_MS = 60 * 1000"))
    throw new Error("DEV BusTime reverted to fake 60-second source TTL");`;
  stage = replaceUnique(stage, execAnchor, execReplacement, "staging execution");

  const logAnchor =
    '  console.log("Staged DEV TBR Shadow runtime: SHADOW_READONLY_SPLIT_V2");';
  const logReplacement = `${logAnchor}
  console.log("Staged DEV BusTime runtime: BUS_TIME_HOT_LANE_V14");`;
  stage = replaceUnique(stage, logAnchor, logReplacement, "staging log");
}

fs.writeFileSync(stageFile, stage);
console.log(`${INSTALL_MARKER}=PASS`);
for (const name of files) console.log(`INSTALLED=${path.join(".github/dev-tools", name)}`);
