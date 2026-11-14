import { pool, notifyEvent } from "@samsara/core";
import { listPermintaanTransfer, listStokMinus, listTransferBelumDiterima } from "@samsara/inventory";
import { getKesegaranSumber } from "@samsara/sales-sync";

/**
 * Scheduler notifikasi (2026-11-14) -- cek berkala 4 kejadian yang BUKAN
 * event-driven (permintaan_belum_dijawab, transfer_belum_diterima,
 * sumber_data_tidak_masuk, stok_minus). Kunci advisory SENDIRI (beda dari
 * `sales_sync_otomatis`, lihat `modules/sales-sync/src/domain/otomatis.ts`)
 * supaya scheduler ini TIDAK saling kunci dengan pemrosesan otomatis
 * sales-sync -- keduanya independen.
 *
 * Interval 15 menit: cukup rapat untuk ambang_jam escalation terasa "berkala"
 * tanpa membebani Telegram API/DB terus-menerus -- asumsi default, bisa
 * diubah tanpa migrasi (bukan setting tersimpan, cuma konstanta kode).
 */
const KUNCI_ADVISORY = "notifikasi_scheduler";
const INTERVAL_MS = 15 * 60 * 1000;

export function mulaiSchedulerNotifikasi(): void {
  setInterval(() => {
    jalankanSekaliTick().catch((err) => console.error("[scheduler notifikasi] gagal:", err));
  }, INTERVAL_MS);
}

async function jalankanSekaliTick(): Promise<void> {
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query<{ terkunci: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS terkunci`,
      [KUNCI_ADVISORY],
    );
    if (!rows[0]?.terkunci) return; // tick sebelumnya masih jalan -- lewati, bukan error

    try {
      const client = await pool.connect();
      try {
        await cekPermintaanBelumDijawab(client);
        await cekTransferBelumDiterima(client);
        await cekSumberDataTidakMasuk(client);
        await cekStokMinus(client);
      } finally {
        client.release();
      }
    } finally {
      await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [KUNCI_ADVISORY]);
    }
  } finally {
    lockClient.release();
  }
}

async function cekPermintaanBelumDijawab(client: import("pg").PoolClient): Promise<void> {
  const diminta = await listPermintaanTransfer(client, { status: "diminta" });
  for (const p of diminta) {
    const jamSejak = (Date.now() - new Date(p.createdAt).getTime()) / 3600000;
    await notifyEvent(client, {
      kejadian: "permintaan_belum_dijawab",
      judul: `Permintaan ${p.kode} belum dijawab`,
      pesan: `Item: ${p.itemNama}\nDiajukan ${jamSejak.toFixed(1)} jam lalu oleh ${p.dimintaOlehUsername ?? "-"} (${p.locationTujuanNama}).`,
      lokasiId: p.locationAsalId,
      referensiTipe: "permintaan_transfer",
      referensiId: p.id,
      dedupKeyBase: `permintaan_belum_dijawab:${p.id}`,
      jamSejak,
    });
  }
}

async function cekTransferBelumDiterima(client: import("pg").PoolClient): Promise<void> {
  const dalamPerjalanan = await listTransferBelumDiterima(client);
  for (const t of dalamPerjalanan) {
    const jamSejak = (Date.now() - new Date(t.dikirimPada).getTime()) / 3600000;
    await notifyEvent(client, {
      kejadian: "transfer_belum_diterima",
      judul: `Transfer id ${t.transferId} belum diterima`,
      pesan: `Dikirim ${jamSejak.toFixed(1)} jam lalu, belum dikonfirmasi diterima di lokasi tujuan.`,
      lokasiId: t.locationTujuanId,
      referensiTipe: "transfer",
      referensiId: t.transferId,
      dedupKeyBase: `transfer_belum_diterima:${t.transferId}`,
      jamSejak,
    });
  }
}

async function cekSumberDataTidakMasuk(client: import("pg").PoolClient): Promise<void> {
  const sumber = await getKesegaranSumber(client);
  const hariIni = new Date().toISOString().slice(0, 10);
  for (const s of sumber.filter((x) => x.merah)) {
    await notifyEvent(client, {
      kejadian: "sumber_data_tidak_masuk",
      judul: `Sumber data tidak masuk: ${s.label}`,
      pesan:
        s.terakhirMasuk === null
          ? "Belum pernah ada data masuk sama sekali."
          : `Terakhir masuk ${s.jamSejakTerakhir?.toFixed(1)} jam lalu (ambang: ${s.ambangJam?.toFixed(1)} jam).`,
      dedupKeyBase: `sumber_data_tidak_masuk:${s.key}:${hariIni}`,
    });
  }
}

async function cekStokMinus(client: import("pg").PoolClient): Promise<void> {
  const items = await listStokMinus(client);
  const hariIni = new Date().toISOString().slice(0, 10);
  for (const item of items) {
    await notifyEvent(client, {
      kejadian: "stok_minus",
      judul: `Stok minus: ${item.itemName}`,
      pesan: `Lokasi: ${item.locationName}\nQty saat ini: ${item.qty}`,
      lokasiId: item.locationId,
      referensiTipe: "item",
      referensiId: item.itemId,
      dedupKeyBase: `stok_minus:${item.itemId}:${item.locationId}:${hariIni}`,
    });
  }
}
