import { registerAksiNotifikasi } from "@samsara/core";
import { akuiPermintaan, tolakPermintaan } from "../domain/permintaan-transfer.js";
import { decideOpname } from "../domain/stok.js";

/**
 * Pendaftaran handler aksi notifikasi (modul inventory) -- dipanggil SEKALI
 * saat boot lewat side-effect import di `../index.ts`. Lihat
 * `@samsara/core`'s `aksi-registry.ts` untuk alasan pola ini (core tidak
 * boleh import modul bisnis, jadi modul bisnis yang mendaftar ke core) dan
 * untuk kenapa "terima" (2026-11-18) sekarang juga bisa lewat sini --
 * SELALU role-gated owner-only di level webhook (`core/src/notifikasi/router.ts`),
 * TIDAK PERNAH untuk role lain.
 */
registerAksiNotifikasi("permintaan_transfer", "tolak", async ({ client, referensiId, alasanPreset, userId }) => {
  const hasil = await tolakPermintaan(client, {
    id: referensiId,
    alasanTolak: alasanPreset ?? "Ditolak via Telegram",
    userId,
  });
  return { ringkasan: `Permintaan ${hasil.kode} ditolak` };
});

// "Terima" untuk permintaan_transfer SENGAJA TIDAK mengubah status/stok --
// cuma menandai "diakui" (diakui_pada/diakui_oleh, migrasi 0035). Qty
// pengiriman tetap wajib lewat Transfer Kirim sungguhan di app, karena
// Telegram tidak pernah mengirim angka qty apa pun.
registerAksiNotifikasi("permintaan_transfer", "terima", async ({ client, referensiId, userId }) => {
  const hasil = await akuiPermintaan(client, { id: referensiId, userId });
  return { ringkasan: `Permintaan ${hasil.kode} diakui -- SIAPKAN & kirim lewat app (qty belum ditentukan dari Telegram)` };
});

registerAksiNotifikasi("opname", "tolak", async ({ client, referensiId, userId }) => {
  // decideOpname TIDAK menggerakkan stok untuk decision 'tolak' (hanya
  // 'setuju' yang posting ledger) -- aman dijalankan lewat Telegram siapa pun.
  const hasil = await decideOpname(client, { opnameId: referensiId, decision: "tolak", decidedByUserId: userId });
  return { ringkasan: `Opname id ${hasil.headerId} ditolak` };
});

// "Terima" untuk opname = approval SUNGGUHAN (decision 'setuju', MENGGERAKKAN
// stok lewat posting ledger) -- beda dari permintaan_transfer di atas, karena
// opname TIDAK butuh angka baru dari Telegram (qty fisik/sistem sudah
// direkam lengkap saat draft dibuat di app, "setuju" cuma mengunci angka
// yang SUDAH ADA). Owner-only (role-gated di webhook core).
registerAksiNotifikasi("opname", "terima", async ({ client, referensiId, userId }) => {
  const hasil = await decideOpname(client, { opnameId: referensiId, decision: "setuju", decidedByUserId: userId });
  return { ringkasan: `Opname id ${hasil.headerId} disetujui` };
});
