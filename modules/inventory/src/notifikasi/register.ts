import { registerAksiNotifikasi } from "@samsara/core";
import { tolakPermintaan } from "../domain/permintaan-transfer.js";
import { decideOpname } from "../domain/stok.js";

/**
 * Pendaftaran handler aksi "tolak" notifikasi (modul inventory) -- dipanggil
 * SEKALI saat boot lewat side-effect import di `../index.ts`. Lihat
 * `@samsara/core`'s `aksi-registry.ts` untuk alasan pola ini (core tidak
 * boleh import modul bisnis, jadi modul bisnis yang mendaftar ke core).
 *
 * HANYA utk "tolak" -- "terima" SENGAJA generik di webhook core, tidak
 * pernah lewat sini (lihat aksi-registry.ts).
 */
registerAksiNotifikasi("permintaan_transfer", async ({ client, referensiId, alasanPreset, userId }) => {
  const hasil = await tolakPermintaan(client, {
    id: referensiId,
    alasanTolak: alasanPreset ?? "Ditolak via Telegram",
    userId,
  });
  return { ringkasan: `Permintaan ${hasil.kode} ditolak` };
});

registerAksiNotifikasi("opname", async ({ client, referensiId, userId }) => {
  // decideOpname TIDAK menggerakkan stok untuk decision 'tolak' (hanya
  // 'setuju' yang posting ledger) -- aman dijalankan lewat Telegram,
  // konsisten dengan "Terima tidak menggerakkan stok" (approval sungguhan
  // TETAP harus lewat app, lihat tombol "Buka di app").
  const hasil = await decideOpname(client, { opnameId: referensiId, decision: "tolak", decidedByUserId: userId });
  return { ringkasan: `Opname id ${hasil.headerId} ditolak` };
});
