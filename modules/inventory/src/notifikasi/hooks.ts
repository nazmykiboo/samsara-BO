import { notifyEvent, pool } from "@samsara/core";
import { getCurrentStock } from "../domain/stok.js";

/**
 * Titik pemicu `notifyEvent` dari modul Inventory -- SELALU dipanggil
 * SETELAH transaksi penulis (withTransaction) commit sukses, pakai koneksi
 * BARU (bukan client transaksi yang sudah dilepas), dan SELALU
 * fire-and-forget (tidak di-`await` oleh caller router) supaya kegagalan
 * kirim notifikasi (atau lambatnya panggilan Telegram) TIDAK PERNAH membuat
 * response API jadi gagal/lambat. Error di sini cuma di-`console.error`.
 *
 * Alasan pakai koneksi baru (bukan client transaksi lama): `notifyEvent`
 * memanggil Telegram lewat `fetch` (jaringan luar) -- menahan transaksi DB
 * terbuka selama menunggu network call eksternal berisiko timeout/deadlock.
 */

const ALASAN_PRESET_TOLAK_PERMINTAAN = ["Stok tidak cukup", "Item tidak diproduksi hari ini", "Permintaan ganda/salah"];
const ALASAN_PRESET_TOLAK_OPNAME = ["Selisih tidak wajar, cek ulang", "Draft salah lokasi/tanggal"];

export async function kirimNotifikasiPermintaanBaru(
  baris: Array<{ headerId: number; kode: string; itemKode: string }>,
  locationAsalId: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    for (const b of baris) {
      const { rows } = await client.query<{ qty_diminta: string; item_id: number; name: string }>(
        `SELECT p.qty_diminta, p.item_id, i.name
         FROM inventory_permintaan_transfer p JOIN inventory_items i ON i.id = p.item_id
         WHERE p.id = $1`,
        [b.headerId],
      );
      const row = rows[0];
      if (!row) continue;
      const qtyDiminta = Number(row.qty_diminta);
      const stokSaatIni = await getCurrentStock(client, row.item_id, locationAsalId);
      const statusStok = stokSaatIni <= 0 ? "HABIS" : stokSaatIni < qtyDiminta ? "KURANG" : "cukup";

      await notifyEvent(client, {
        kejadian: "permintaan_baru_ck",
        judul: `Permintaan baru: ${row.name}`,
        pesan: `Kode: ${b.kode}\nQty diminta: ${qtyDiminta}\nStok CK saat ini: ${stokSaatIni} (${statusStok})`,
        lokasiId: locationAsalId,
        referensiTipe: "permintaan_transfer",
        referensiId: b.headerId,
        dedupKeyBase: `permintaan_baru_ck:${b.headerId}`,
        aksi: { alasanPresetTolak: ALASAN_PRESET_TOLAK_PERMINTAAN, deepLinkPath: "/permintaan-ke-ck" },
      });
    }
  } finally {
    client.release();
  }
}

export async function kirimNotifikasiJawabanCk(permintaanId: number): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      kode: string;
      status: string;
      item_name: string;
      location_tujuan_id: number;
      diminta_oleh: number | null;
      alasan_tolak: string | null;
    }>(
      `SELECT p.kode, p.status, i.name AS item_name, p.location_tujuan_id, p.diminta_oleh, p.alasan_tolak
       FROM inventory_permintaan_transfer p JOIN inventory_items i ON i.id = p.item_id
       WHERE p.id = $1`,
      [permintaanId],
    );
    const row = rows[0];
    if (!row) return;

    const labelStatus: Record<string, string> = {
      dipenuhi: "dipenuhi penuh",
      dipenuhi_sebagian: "dipenuhi sebagian",
      ditolak: `ditolak (alasan: ${row.alasan_tolak ?? "-"})`,
    };

    await notifyEvent(client, {
      kejadian: "jawaban_ck",
      judul: `CK menjawab permintaan ${row.kode}`,
      pesan: `Item: ${row.item_name}\nStatus: ${labelStatus[row.status] ?? row.status}`,
      lokasiId: row.location_tujuan_id,
      referensiTipe: "permintaan_transfer",
      referensiId: permintaanId,
      dedupKeyBase: `jawaban_ck:${permintaanId}:${row.status}`,
    });
  } finally {
    client.release();
  }
}

export async function kirimNotifikasiOpnameMenunggu(opnameId: number, locationId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await notifyEvent(client, {
      kejadian: "opname_menunggu_persetujuan",
      judul: `Opname id ${opnameId} menunggu persetujuan`,
      pesan: `Lokasi id ${locationId} mengajukan opname yang perlu disetujui/ditolak.`,
      lokasiId: locationId,
      referensiTipe: "opname",
      referensiId: opnameId,
      dedupKeyBase: `opname_menunggu_persetujuan:${opnameId}`,
      aksi: { alasanPresetTolak: ALASAN_PRESET_TOLAK_OPNAME, deepLinkPath: "/opname" },
    });
  } finally {
    client.release();
  }
}
