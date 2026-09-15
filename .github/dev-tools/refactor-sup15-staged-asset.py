from pathlib import Path

modules = Path('supervisor-modules.js')
context = Path('supervisor-context.js')
app = Path('supervisor.js')
package = Path('worker/package.json')
system_test = Path('worker/tests/supervisor-system-context.test.mjs')
guide_test = Path('worker/tests/supervisor-guide-contract.test.mjs')

module_text = modules.read_text()
context_text = context.read_text()
if 'SUPERVISOR_SYSTEM_CONTEXT_V1' in module_text:
    raise SystemExit('context helpers already present in supervisor-modules.js')
modules.write_text(module_text.rstrip() + '\n\n' + context_text + '\n')

app_text = app.read_text()
old_import = 'import { createSupervisorRegistry, waitingTrucksModule } from "./supervisor-modules.js?v=20260914-sup03";'
new_import = 'import { createSupervisorRegistry, deriveRedactedSystemContext, serializeRedactedSystemContext, waitingTrucksModule } from "./supervisor-modules.js?v=20260915-sup15";'
if old_import not in app_text:
    raise SystemExit('supervisor-modules import anchor missing')
app_text = app_text.replace(old_import, new_import, 1)
context_import = 'import { deriveRedactedSystemContext, serializeRedactedSystemContext } from "./supervisor-context.js?v=20260915-sup15";\n'
if context_import not in app_text:
    raise SystemExit('supervisor-context import anchor missing')
app.write_text(app_text.replace(context_import, '', 1))

pkg = package.read_text()
needle = ' && node --check ../supervisor-context.js'
if needle not in pkg:
    raise SystemExit('package context syntax-check anchor missing')
package.write_text(pkg.replace(needle, '', 1))

test_text = system_test.read_text()
if '../../supervisor-context.js' not in test_text:
    raise SystemExit('system context test import anchor missing')
test_text = test_text.replace('../../supervisor-context.js', '../../supervisor-modules.js')
if 'const contextModule = await read("supervisor-context.js");' not in test_text:
    raise SystemExit('system context source anchor missing')
test_text = test_text.replace('const contextModule = await read("supervisor-context.js");', 'const contextModule = await read("supervisor-modules.js");')
old_deploy = '''test("SUP-15 DEV deployment stages and syntax-checks the context asset", async () => {
  const workflow = await read(".github/workflows/deploy-worker-dev.yml");
  const pkg = await read("worker/package.json");
  assert.ok(workflow.includes("- supervisor-context.js"));
  assert.ok(workflow.includes("../supervisor-context.js"));
  assert.ok(workflow.includes("node --check .dev-assets/supervisor-context.js"));
  assert.ok(pkg.includes("node --check ../supervisor-context.js"));
  assert.ok(pkg.includes("tests/supervisor-system-context.test.mjs"));
});'''
new_deploy = '''test("SUP-15 reuses the already-staged pure Supervisor module asset", async () => {
  const workflow = await read(".github/workflows/deploy-worker-dev.yml");
  const pkg = await read("worker/package.json");
  const app = await read("supervisor.js");
  assert.ok(workflow.includes("- supervisor-modules.js"));
  assert.ok(workflow.includes("../supervisor-modules.js"));
  assert.ok(workflow.includes("node --check .dev-assets/supervisor-modules.js"));
  assert.ok(pkg.includes("node --check ../supervisor-modules.js"));
  assert.ok(pkg.includes("tests/supervisor-system-context.test.mjs"));
  assert.ok(app.includes("./supervisor-modules.js?v=20260915-sup15"));
  assert.equal(app.includes("supervisor-context.js"), false);
});'''
if old_deploy not in test_text:
    raise SystemExit('SUP-15 deploy test anchor missing')
system_test.write_text(test_text.replace(old_deploy, new_deploy, 1))

guide = guide_test.read_text()
old = 'assert.ok(app.includes("./supervisor-context.js?v=20260915-sup15"));'
new = 'assert.ok(app.includes("./supervisor-modules.js?v=20260915-sup15"));'
if old not in guide:
    raise SystemExit('guide context asset expectation missing')
guide_test.write_text(guide.replace(old, new, 1))

context.unlink()
print('SUP15_EXISTING_STAGED_ASSET_REFACTOR=PASS')
print('DEPLOY_WORKFLOW_CHANGE_REQUIRED=NO')
print('PRODUCTION_TOUCHED=NO')
