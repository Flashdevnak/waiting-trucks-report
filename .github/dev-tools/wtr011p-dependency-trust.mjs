import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const INSTALL_UID = 65533;
const MARKER = "trusted-install.json";
const PRIVATE_PARENT = "/var/lib";
const PREFIX = PRIVATE_PARENT + "/wtr011p-locked-npm-";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = reason => { throw Error("WTR011P_DEPENDENCY_" + reason); };
const stable = (a, b) => ["dev", "ino", "mode", "size", "nlink", "uid", "gid", "mtimeNs", "ctimeNs"]
  .every(key => a[key] === b[key]);

function fileBytes(file, named, allowInternalLinks = false) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, {bigint:true});
    if (!before.isFile() || (!allowInternalLinks && before.nlink !== 1n) || !stable(before, named)) fail("CHANGED_OR_HARDLINK:" + file);
    const bytes = fs.readFileSync(fd);
    if (BigInt(bytes.length) !== before.size || !stable(before, fs.fstatSync(fd, {bigint:true})) ||
        !stable(before, fs.lstatSync(file, {bigint:true}))) fail("CONCURRENT_MUTATION:" + file);
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function dependencyDigest(root, {installed = false} = {}) {
  return scanDependencies(root, installed);
}

function scanDependencies(root, installed, destination) {
  const digest = crypto.createHash("sha256");
  const inodes = new Map();
  function walk(current, rel) {
    const st = fs.lstatSync(current, {bigint:true});
    const target = destination && path.join(destination, rel);
    if (st.isDirectory()) {
      if (target) fs.mkdirSync(target, {mode:0o700});
      digest.update(JSON.stringify([rel, "directory"]));
      for (const child of fs.readdirSync(current).sort()) {
        walk(path.join(current, child), path.posix.join(rel, child));
      }
    } else {
      let file = current;
      let stat = st;
      if (st.isSymbolicLink()) {
        if (!installed || path.basename(path.dirname(current)) !== ".bin") fail("UNEXPECTED_SYMLINK:" + rel);
        file = fs.realpathSync(current);
        if (!file.startsWith(root + path.sep)) fail("SYMLINK_ESCAPE:" + rel);
        stat = fs.lstatSync(file, {bigint:true});
      }
      if (!stat.isFile() || (!installed && stat.nlink !== 1n)) fail("NONREGULAR_OR_HARDLINK:" + rel);
      if (installed && !st.isSymbolicLink() && stat.nlink > 1n) {
        const key = stat.dev + ":" + stat.ino;
        const group = inodes.get(key) || {expected:stat.nlink, seen:0n, first:rel};
        if (group.expected !== stat.nlink) fail("CONCURRENT_LINK_CHANGE:" + rel);
        group.seen++;
        inodes.set(key, group);
      }
      const bytes = fileBytes(file, stat, installed);
      const executable = Number(stat.mode & 0o111n);
      if (target) {
        fs.writeFileSync(target, bytes, {flag:"wx", mode:0o400});
        fs.chmodSync(target, 0o444 | executable);
      }
      digest.update(JSON.stringify([rel, "file", executable, bytes.length, sha(bytes)]));
    }
    if (!stable(st, fs.lstatSync(current, {bigint:true}))) fail("CONCURRENT_MUTATION:" + rel);
  }
  if (!fs.lstatSync(root).isDirectory() || fs.realpathSync(root) !== root) fail("BAD_TREE_ROOT");
  walk(root, "");
  for (const {seen,expected,first} of inodes.values()) {
    // Native postinstall tooling may hardlink inside node_modules. The source
    // inode may not have any aliases outside the protected install inventory.
    if (seen !== expected) fail("HARDLINK_OUTSIDE:" + first);
  }
  return digest.digest("hex");
}

function rootPrivateDirectory(dir) {
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.uid !== 0 || (st.mode & 0o777) !== 0o700 ||
      fs.realpathSync(dir) !== dir) fail("UNTRUSTED_INSTALL_ROOT");
}

export function privateSealParent() {
  for (let dir = PRIVATE_PARENT;; dir = path.dirname(dir)) {
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.uid !== 0 || (st.mode & 0o022) ||
        fs.lstatSync(path.join(dir, "node_modules"), {throwIfNoEntry:false})) fail("UNTRUSTED_ANCESTOR");
    if (dir === "/") break;
  }
  return PRIVATE_PARENT;
}

function npmConfigState(file) {
  const st = fs.lstatSync(file, {bigint:true});
  if (!path.isAbsolute(file) || !st.isFile() || st.uid !== 0n || st.nlink !== 1n ||
      (st.mode & 0o7777n) !== 0o444n || st.size !== 0n || fs.realpathSync(file) !== file ||
      fileBytes(file, st).length !== 0) fail("UNTRUSTED_NPM_CONFIG:" + file);
  return st;
}

export function prepareTrustedDependencies(inputs, binding) {
  privateSealParent();
  const dir = fs.mkdtempSync(PREFIX);
  rootPrivateDirectory(dir);
  const install = path.join(dir, "install");
  try {
    fs.mkdirSync(install, {mode:0o700});
    fs.chownSync(install, INSTALL_UID, INSTALL_UID);
    for (const [name, bytes] of inputs) {
      fs.writeFileSync(path.join(install, name), bytes, {flag:"wx", mode:0o444});
    }
    // The installer can read these siblings but cannot replace them through its writable cwd.
    const npmConfigs = {
      npm_config_userconfig: path.join(dir, "npm-user.npmrc"),
      npm_config_globalconfig: path.join(dir, "npm-global.npmrc"),
    };
    const configStates = Object.values(npmConfigs).map(file => {
      fs.writeFileSync(file, "", {flag:"wx", mode:0o444});
      fs.chmodSync(file, 0o444);
      return [file, npmConfigState(file)];
    });
    const node = fs.realpathSync(process.execPath);
    const npm = fs.realpathSync(path.join(path.dirname(node), "npm"));
    fs.chmodSync(dir, 0o711);
    let run;
    try {
      // The dedicated unprivileged UID cannot alter the private parent. The PID
      // namespace stops install descendants from surviving the npm ci process.
      run = spawnSync("/usr/bin/unshare", ["--pid", "--fork", "--kill-child",
        "/usr/bin/setpriv", "--reuid=" + INSTALL_UID, "--regid=" + INSTALL_UID,
        "--clear-groups", "--no-new-privs", "--", node, npm, "ci",
        "--include=dev", "--no-audit", "--no-fund"], {
        cwd:install,
        env:{PATH:path.dirname(node) + ":/usr/bin:/bin", HOME:install,
          npm_config_cache:path.join(install, ".npm-cache"),
          ...npmConfigs,
          npm_config_registry:"https://registry.npmjs.org/"},
        encoding:"utf8", timeout:180_000, killSignal:"SIGKILL", maxBuffer:4*1024*1024,
      });
    } finally {
      fs.chmodSync(dir, 0o700);
    }
    for (const [file, before] of configStates) {
      if (!stable(before, npmConfigState(file))) fail("NPM_CONFIG_CHANGED:" + file);
      fs.unlinkSync(file);
    }
    if (run.error || run.status !== 0) {
      process.stderr.write(run.stderr || String(run.error || run.status));
      fail("NPM_CI");
    }
    for (const [name, bytes] of inputs) {
      const file = path.join(install, name);
      const st = fs.lstatSync(file, {bigint:true});
      if (!fileBytes(file, st).equals(bytes)) fail("INSTALL_INPUT_CHANGED:" + name);
    }
    const modules = path.join(dir, "node_modules");
    fs.renameSync(path.join(install, "node_modules"), modules);
    const installedDigest = dependencyDigest(modules, {installed:true});
    fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({binding, installedDigest}),
      {flag:"wx", mode:0o400});
    fs.rmSync(install, {recursive:true, force:true});
    return dir;
  } catch (error) {
    fs.rmSync(dir, {recursive:true, force:true});
    throw error;
  }
}

export function copyVerifiedDependencies(source, destination, expected) {
  if (dependencyDigest(source, {installed:true}) !== expected) fail("INSTALL_HASH");
  const copied = scanDependencies(source, true, destination);
  if (copied !== expected || dependencyDigest(source, {installed:true}) !== expected ||
      dependencyDigest(destination) !== expected) {
    fail("COPY_HASH_OR_CONCURRENT_MUTATION");
  }
}

export function populatePublisherDependencies(dir, destination, binding) {
  if (!/^\/var\/lib\/wtr011p-locked-npm-[A-Za-z0-9]{6}$/.test(dir || "")) fail("TRUSTED_INSTALL_REQUIRED");
  privateSealParent();
  rootPrivateDirectory(dir);
  const marker = path.join(dir, MARKER);
  const st = fs.lstatSync(marker, {bigint:true});
  if (st.uid !== 0n || (st.mode & 0o777n) !== 0o400n || !st.isFile()) fail("UNTRUSTED_INSTALL_RECEIPT");
  const receipt = JSON.parse(fileBytes(marker, st));
  if (receipt.binding !== binding || !/^[a-f0-9]{64}$/.test(receipt.installedDigest || "")) fail("INSTALL_RECEIPT_BINDING");
  copyVerifiedDependencies(path.join(dir, "node_modules"), destination, receipt.installedDigest);
  return receipt.installedDigest;
}
