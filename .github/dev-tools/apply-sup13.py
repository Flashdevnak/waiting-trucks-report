from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_present(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count < 1:
        raise RuntimeError(f"{path}: expected cache assertion anchor: {old!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")


# supervisor.html: Thai-first language controls, cache-busted SUP-13 assets.
replace_once(
    "supervisor.html",
    '  <link rel="stylesheet" href="supervisor.css?v=20260914-sup05">',
    '  <link rel="stylesheet" href="supervisor.css?v=20260915-sup13">',
)
replace_once(
    "supervisor.html",
    '        <a class="button button-quiet" href="admin.html">เข้าสู่ระบบ Admin</a>\n',
    '        <a class="button button-quiet" href="admin.html">เข้าสู่ระบบ Admin</a>\n        <button class="button button-quiet language-toggle" type="button" data-language-toggle aria-label="Switch to English">EN</button>\n',
)
replace_once(
    "supervisor.html",
    '      <div class="topbar-actions">\n        <span class="environment-pill"><i></i> DEV</span>',
    '      <div class="topbar-actions">\n        <button class="button button-quiet language-toggle" type="button" data-language-toggle aria-label="Switch to English">EN</button>\n        <span class="environment-pill"><i></i> DEV</span>',
)
replace_once(
    "supervisor.html",
    '  <script type="module" src="supervisor.js?v=20260915-sup12"></script>',
    '  <script type="module" src="supervisor.js?v=20260915-sup13"></script>',
)

# supervisor.css: only presentation for the language control.
p = Path("supervisor.css")
css = p.read_text(encoding="utf-8")
marker = "SUPERVISOR_I18N_V1"
if marker not in css:
    css += '\n/* SUPERVISOR_I18N_V1: Thai-first / English toggle; presentation only. */\n.language-toggle{min-width:44px;min-height:34px;padding:6px 10px;border-radius:999px;font-size:11px;line-height:1;font-weight:850}\n@media(max-width:420px){.language-toggle{min-width:40px;padding:6px 8px}}\n'
    p.write_text(css, encoding="utf-8")

# supervisor.js: import pure language layer and re-apply it after bounded UI renders.
replace_once(
    "supervisor.js",
    '// SUPERVISOR_QUOTA_PROTECTION_V1\n',
    '// SUPERVISOR_QUOTA_PROTECTION_V1\n// SUPERVISOR_I18N_V1\n',
)
replace_once(
    "supervisor.js",
    'import { deriveHubView, deriveOverview } from "./supervisor-view.js?v=20260914-sup07";\n',
    'import { deriveHubView, deriveOverview } from "./supervisor-view.js?v=20260914-sup07";\nimport { applySupervisorLanguage, nextSupervisorLanguage, readSupervisorLanguage, syncSupervisorLanguageControls, writeSupervisorLanguage } from "./supervisor-i18n.js?v=20260915-sup13";\n',
)
replace_once(
    "supervisor.js",
    'const terminalState = { availability: "UNAVAILABLE", events: [], filter: "ALL", cleared: false, limit: 120 };\n\nconst sectionCopy = {',
    '''const terminalState = { availability: "UNAVAILABLE", events: [], filter: "ALL", cleared: false, limit: 120 };\nlet supervisorLanguage = readSupervisorLanguage();\n\nfunction applyCurrentLanguage() {\n  applySupervisorLanguage(document, supervisorLanguage);\n  syncSupervisorLanguageControls(document, supervisorLanguage);\n}\n\nfunction bindLanguageControls() {\n  document.querySelectorAll("[data-language-toggle]").forEach((button) => {\n    button.addEventListener("click", () => {\n      supervisorLanguage = nextSupervisorLanguage(supervisorLanguage);\n      writeSupervisorLanguage(localStorage, supervisorLanguage);\n      applyCurrentLanguage();\n    });\n  });\n}\n\nconst sectionCopy = {''',
)
replace_once(
    "supervisor.js",
    '  document.getElementById("supervisor-app").hidden = true;\n}',
    '  document.getElementById("supervisor-app").hidden = true;\n  applyCurrentLanguage();\n}',
)
replace_once(
    "supervisor.js",
    '  document.getElementById("section-subtitle").textContent = copy[1];\n}',
    '  document.getElementById("section-subtitle").textContent = copy[1];\n  applyCurrentLanguage();\n}',
)
replace_once(
    "supervisor.js",
    '    clearButton.textContent = terminalState.cleared ? "Restore view" : "Clear view";\n  }\n}',
    '    clearButton.textContent = terminalState.cleared ? "Restore view" : "Clear view";\n  }\n  applyCurrentLanguage();\n}',
)
replace_once(
    "supervisor.js",
    '      } catch {\n        copyButton.textContent = "Copy blocked";\n      }\n',
    '      } catch {\n        copyButton.textContent = "Copy blocked";\n      }\n      applyCurrentLanguage();\n',
)
replace_once(
    "supervisor.js",
    '  sourceSummary.append(sourceState, sourceDetail);\n  renderTerminalConsole(snapshot);\n}',
    '  sourceSummary.append(sourceState, sourceDetail);\n  renderTerminalConsole(snapshot);\n  applyCurrentLanguage();\n}',
)
replace_once(
    "supervisor.js",
    'document.addEventListener("DOMContentLoaded", () => {\n  const auth = readLocalAdminClaim();',
    'document.addEventListener("DOMContentLoaded", () => {\n  supervisorLanguage = readSupervisorLanguage();\n  bindLanguageControls();\n  applyCurrentLanguage();\n  const auth = readLocalAdminClaim();',
)

# worker/package.json: syntax + focused contract in the normal full check.
replace_once(
    "worker/package.json",
    'node --check ../supervisor.js && node --check ../supervisor-modules.js',
    'node --check ../supervisor.js && node --check ../supervisor-i18n.js && node --check ../supervisor-modules.js',
)
replace_once(
    "worker/package.json",
    'tests/supervisor-shared-quota-center.test.mjs tests/supervisor-quota-protection.test.mjs tests/bus-enrichment.test.mjs',
    'tests/supervisor-shared-quota-center.test.mjs tests/supervisor-quota-protection.test.mjs tests/supervisor-language-contract.test.mjs tests/bus-enrichment.test.mjs',
)

# DEV deploy: trigger, copy and syntax-check the new static language asset.
replace_once(
    ".github/workflows/deploy-worker-dev.yml",
    '      - supervisor.js\n      - supervisor-modules.js',
    '      - supervisor.js\n      - supervisor-i18n.js\n      - supervisor-modules.js',
)
replace_once(
    ".github/workflows/deploy-worker-dev.yml",
    'cp ../waiting.html ../admin.html ../admin.js ../admin.css ../supervisor.html ../supervisor.js ../supervisor-modules.js ../supervisor-view.js ../supervisor.css',
    'cp ../waiting.html ../admin.html ../admin.js ../admin.css ../supervisor.html ../supervisor.js ../supervisor-i18n.js ../supervisor-modules.js ../supervisor-view.js ../supervisor.css',
)
replace_once(
    ".github/workflows/deploy-worker-dev.yml",
    '          node --check .dev-assets/supervisor.js\n          node --check .dev-assets/supervisor-modules.js',
    '          node --check .dev-assets/supervisor.js\n          node --check .dev-assets/supervisor-i18n.js\n          node --check .dev-assets/supervisor-modules.js',
)

# Existing checkpoint tests intentionally pin asset cache keys. Align only those
# presentation assertions with the accepted SUP-13 cache key; no runtime predicate changes.
replace_present(
    "worker/tests/supervisor-core-shell.test.mjs",
    "supervisor\\.css\\?v=20260914-sup05",
    "supervisor\\.css\\?v=20260915-sup13",
)
for path in [
    "worker/tests/supervisor-event-console.test.mjs",
    "worker/tests/supervisor-incident-action-center.test.mjs",
    "worker/tests/supervisor-quota-protection.test.mjs",
    "worker/tests/supervisor-shared-quota-center.test.mjs",
]:
    replace_present(
        path,
        "supervisor.js?v=20260915-sup12",
        "supervisor.js?v=20260915-sup13",
    )

print("SUP13_APPLY=PASS")
