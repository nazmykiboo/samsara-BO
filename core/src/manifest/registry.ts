import type { LoadedModule } from "./types.js";

export class ManifestError extends Error {}

/**
 * Validasi kontrak antar modul, lalu kembalikan modul terurut sesuai
 * dependency (topological order) — urutan ini dipakai untuk load router
 * maupun menjalankan migrasi.
 */
export function buildRegistry(modules: LoadedModule[]): LoadedModule[] {
  const byName = new Map<string, LoadedModule>();
  for (const mod of modules) {
    if (byName.has(mod.manifest.name)) {
      throw new ManifestError(`Nama modul duplikat: "${mod.manifest.name}"`);
    }
    byName.set(mod.manifest.name, mod);
  }

  const prefixOwner = new Map<string, string>();
  for (const mod of modules) {
    const prefix = mod.manifest.tablePrefix;
    const owner = prefixOwner.get(prefix);
    if (owner) {
      throw new ManifestError(
        `tablePrefix "${prefix}" dipakai dua modul: "${owner}" dan "${mod.manifest.name}"`,
      );
    }
    prefixOwner.set(prefix, mod.manifest.name);
  }

  for (const mod of modules) {
    for (const dep of mod.manifest.dependsOn) {
      if (!byName.has(dep)) {
        throw new ManifestError(
          `Modul "${mod.manifest.name}" depends on "${dep}" yang tidak terdaftar`,
        );
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: LoadedModule[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new ManifestError(`Dependency melingkar terdeteksi pada modul "${name}"`);
    }
    visiting.add(name);
    const mod = byName.get(name)!;
    for (const dep of mod.manifest.dependsOn) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(mod);
  }

  for (const mod of modules) {
    visit(mod.manifest.name);
  }

  return ordered;
}
