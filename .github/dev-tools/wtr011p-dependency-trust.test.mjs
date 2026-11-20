import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { copyVerifiedDependencies, dependencyDigest, populatePublisherDependencies } from "./wtr011p-dependency-trust.mjs";

function fixtures(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wtr011p-dependency-test-"));
  t.after(() => fs.rmSync(base, {recursive:true, force:true}));
  const source = path.join(base, "node_modules");
  const destination = path.join(base, "sealed");
  const executable = path.join(source, "sample", "cli.js");
  fs.mkdirSync(path.dirname(executable), {recursive:true});
  fs.mkdirSync(path.join(source, ".bin"));
  fs.writeFileSync(executable, "console.log('installation byte fixture');\n", {mode:0o755});
  fs.symlinkSync("../sample/cli.js", path.join(source, ".bin", "sample"));
  const pin = dependencyDigest(source, {installed:true});
  return {base, source, destination, executable, pin};
}

test("internal npm bin is detached with the same bytes and execution mode", t => {
  const {source, destination, executable, pin} = fixtures(t);
  copyVerifiedDependencies(source, destination, pin);
  const bin = path.join(destination, ".bin", "sample");
  assert.equal(dependencyDigest(destination), pin);
  assert.deepEqual(fs.readFileSync(bin), fs.readFileSync(executable));
  assert.equal(fs.lstatSync(bin).isFile(), true);
  assert.equal(fs.statSync(bin).nlink, 1);
  assert.equal(fs.statSync(bin).mode & 0o111, fs.statSync(executable).mode & 0o111);
});

test("byte mutation after trusted installation fails the receipt digest", t => {
  const {source, destination, executable, pin} = fixtures(t);
  fs.appendFileSync(executable, "\n");
  assert.throws(() => copyVerifiedDependencies(source, destination, pin), /INSTALL_HASH/);
  assert.equal(fs.existsSync(destination), false);
});

test("wrong dependency digest fails before any snapshot bytes are copied", t => {
  const {source, destination} = fixtures(t);
  assert.throws(() => copyVerifiedDependencies(source, destination, "0".repeat(64)), /INSTALL_HASH/);
  assert.equal(fs.existsSync(destination), false);
});

test("hash also binds path set and executable mode", t => {
  const {source, destination, executable, pin} = fixtures(t);
  fs.chmodSync(executable, 0o644);
  assert.throws(() => copyVerifiedDependencies(source, destination, pin), /INSTALL_HASH/);
});

test("only internal npm bin links are admitted", t => {
  const {base, source, destination, executable, pin} = fixtures(t);
  const file = path.join(base, "outside");
  fs.copyFileSync(executable, file);
  fs.symlinkSync("../../outside", path.join(source, ".bin", "escape"));
  assert.throws(() => copyVerifiedDependencies(source, destination, pin), /SYMLINK_ESCAPE/);
  fs.unlinkSync(path.join(source, ".bin", "escape"));
  fs.symlinkSync(executable, path.join(source, "unexpected"));
  assert.throws(() => copyVerifiedDependencies(source, destination, pin), /UNEXPECTED_SYMLINK/);
});

test("source hardlinks cannot preserve an external mutable alias", t => {
  const {base, source, destination, executable, pin} = fixtures(t);
  fs.linkSync(executable, path.join(base, "alias"));
  assert.throws(() => copyVerifiedDependencies(source, destination, pin), /HARDLINK_OUTSIDE/);
});

test("internal npm hardlinks are materialized as independent read-only bytes", t => {
  const {source, destination, executable} = fixtures(t);
  fs.linkSync(executable, path.join(source, "sample", "native-hardlink"));
  const pin = dependencyDigest(source, {installed:true});
  copyVerifiedDependencies(source, destination, pin);
  const original = fs.statSync(path.join(destination, "sample", "cli.js"));
  const detached = fs.statSync(path.join(destination, "sample", "native-hardlink"));
  assert.notEqual(original.ino, detached.ino);
  assert.equal(original.nlink, 1);
  assert.equal(detached.nlink, 1);
  assert.equal(dependencyDigest(destination), pin);
});

test("mutation during copy is detected even if destination bytes were already copied", t => {
  const {source, destination, executable, pin} = fixtures(t);
  const write = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", (...args) => {
    write(...args);
    if (args[0] === path.join(destination, "sample", "cli.js")) {
      fs.appendFileSync(executable, "concurrent modification fixture");
    }
  });
  assert.throws(() => copyVerifiedDependencies(source, destination, pin), /CONCURRENT_MUTATION/);
});

test("missing or workspace install is refused before dependency use", t => {
  const {source, destination} = fixtures(t);
  assert.throws(() => populatePublisherDependencies(undefined, destination, "bound"), /TRUSTED_INSTALL_REQUIRED/);
  assert.throws(() => populatePublisherDependencies(source, destination, "bound"), /TRUSTED_INSTALL_REQUIRED/);
});
