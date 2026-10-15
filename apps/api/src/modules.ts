import inventory from "@samsara/inventory";
import hr from "@samsara/hr";
import salesSync from "@samsara/sales-sync";
import type { LoadedModule } from "@samsara/core";

/**
 * Satu-satunya tempat yang tahu modul apa saja yang dirakit ke aplikasi ini.
 * Menambah modul baru = tambah satu baris di sini, tidak menyentuh `core`.
 */
export const modules: LoadedModule[] = [inventory, hr, salesSync];
