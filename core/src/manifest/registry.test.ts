import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "express";
import { buildRegistry, ManifestError } from "./registry.js";
import type { LoadedModule, ModuleManifest } from "./types.js";

function fakeManifest(overrides: Partial<ModuleManifest>): ModuleManifest {
  return {
    name: "fake",
    version: "0.0.1",
    description: "",
    enabled: true,
    dependsOn: [],
    tablePrefix: "fake_",
    tables: [],
    api: { basePath: "/api/fake", endpoints: [] },
    migrationsDir: "src/db/migrations",
    ...overrides,
  };
}

function fakeModule(overrides: Partial<ModuleManifest>): LoadedModule {
  return {
    manifest: fakeManifest(overrides),
    createRouter: () => Router(),
    migrationsPath: "/tmp/does-not-matter",
  };
}

test("buildRegistry: modul nonaktif tetap ada di daftar lengkap tapi bisa difilter keluar", () => {
  const a = fakeModule({ name: "a", tablePrefix: "a_", enabled: true });
  const b = fakeModule({ name: "b", tablePrefix: "b_", enabled: false });

  const ordered = buildRegistry([a, b]);
  assert.equal(ordered.length, 2, "modul nonaktif tetap ikut di registry (bukan dihapus)");

  const enabled = ordered.filter((m) => m.manifest.enabled);
  assert.deepEqual(
    enabled.map((m) => m.manifest.name),
    ["a"],
    "cuma modul enabled yang lolos filter untuk di-mount",
  );
});

test("buildRegistry: menonaktifkan satu modul tidak mengubah urutan/keberadaan modul lain", () => {
  const a = fakeModule({ name: "a", tablePrefix: "a_" });
  const b = fakeModule({ name: "b", tablePrefix: "b_", dependsOn: ["a"] });
  const c = fakeModule({ name: "c", tablePrefix: "c_" });

  const withAllEnabled = buildRegistry([a, b, c]).map((m) => m.manifest.name);

  const bDisabled = fakeModule({ name: "b", tablePrefix: "b_", dependsOn: ["a"], enabled: false });
  const withBDisabled = buildRegistry([a, bDisabled, c]).map((m) => m.manifest.name);

  assert.deepEqual(withAllEnabled, withBDisabled, "urutan modul lain tidak berubah walau b dimatikan");

  const enabledOnly = buildRegistry([a, bDisabled, c])
    .filter((m) => m.manifest.enabled)
    .map((m) => m.manifest.name);
  assert.deepEqual(enabledOnly, ["a", "c"], "modul yang dimatikan tidak ikut di-mount, sisanya tetap jalan");
});

test("buildRegistry: menolak nama modul duplikat", () => {
  const a1 = fakeModule({ name: "dup", tablePrefix: "a_" });
  const a2 = fakeModule({ name: "dup", tablePrefix: "b_" });
  assert.throws(() => buildRegistry([a1, a2]), ManifestError);
});

test("buildRegistry: menolak tablePrefix bentrok antar modul", () => {
  const a = fakeModule({ name: "a", tablePrefix: "shared_" });
  const b = fakeModule({ name: "b", tablePrefix: "shared_" });
  assert.throws(() => buildRegistry([a, b]), ManifestError);
});

test("buildRegistry: menolak dependsOn yang tidak terdaftar", () => {
  const a = fakeModule({ name: "a", tablePrefix: "a_", dependsOn: ["ghost"] });
  assert.throws(() => buildRegistry([a]), ManifestError);
});

test("buildRegistry: menolak dependency melingkar", () => {
  const a = fakeModule({ name: "a", tablePrefix: "a_", dependsOn: ["b"] });
  const b = fakeModule({ name: "b", tablePrefix: "b_", dependsOn: ["a"] });
  assert.throws(() => buildRegistry([a, b]), ManifestError);
});

test("buildRegistry: urutan hasil mengikuti dependency (topological order)", () => {
  const a = fakeModule({ name: "a", tablePrefix: "a_" });
  const b = fakeModule({ name: "b", tablePrefix: "b_", dependsOn: ["a"] });
  const ordered = buildRegistry([b, a]).map((m) => m.manifest.name);
  assert.deepEqual(ordered, ["a", "b"], "a (dependency) harus dimuat sebelum b");
});
