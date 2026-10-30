import { pool } from "@samsara/core";

/**
 * Baca riwayat (bukan hitung live) untuk dashboard halaman Sinkronisasi:
 * jalan otomatis TERAKHIR dan impor TERAKHIR per jenis. Dua tabel sumbernya
 * (`salessync_otomatis_log`, `salessync_import_log`, migrasi 0003)
 * APPEND-ONLY -- lihat `pratinjau.ts` untuk state "tertahan/perlu ditinjau"
 * SAAT INI yang dihitung live, BUKAN dari sini.
 */

export interface OtomatisLogTerakhir {
  dipicuOleh: string;
  transaksiDibuat: number;
  barisDiproses: number;
  tertahan: number;
  perluDitinjau: number;
  gagal: number;
  pesanErrorTerakhir: string | null;
  dijalankanPada: string;
}

export async function getOtomatisLogTerakhir(): Promise<OtomatisLogTerakhir | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      dipicu_oleh: string;
      transaksi_dibuat: number;
      baris_diproses: number;
      tertahan: number;
      perlu_ditinjau: number;
      gagal: number;
      pesan_error_terakhir: string | null;
      dijalankan_pada: string;
    }>(
      `SELECT dipicu_oleh, transaksi_dibuat, baris_diproses, tertahan, perlu_ditinjau, gagal,
              pesan_error_terakhir, dijalankan_pada
       FROM salessync_otomatis_log
       ORDER BY dijalankan_pada DESC
       LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      dipicuOleh: row.dipicu_oleh,
      transaksiDibuat: row.transaksi_dibuat,
      barisDiproses: row.baris_diproses,
      tertahan: row.tertahan,
      perluDitinjau: row.perlu_ditinjau,
      gagal: row.gagal,
      pesanErrorTerakhir: row.pesan_error_terakhir,
      dijalankanPada: row.dijalankan_pada,
    };
  } finally {
    client.release();
  }
}

export interface ImporLogTerakhir {
  jenisImpor: string;
  dibuat: number;
  diperbarui: number;
  dilewati: number;
  jumlahError: number;
  contohPesanError: string | null;
  dijalankanPada: string;
}

/** Satu baris TERBARU per `jenis_impor` (4 kemungkinan: log-penjualan/transaksi/raw-majoo/biaya-platform) -- jenis yang belum pernah dipanggil sama sekali TIDAK muncul di hasil (bukan baris kosong). */
export async function getImporLogTerakhirPerJenis(): Promise<ImporLogTerakhir[]> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      jenis_impor: string;
      dibuat: number;
      diperbarui: number;
      dilewati: number;
      jumlah_error: number;
      contoh_pesan_error: string | null;
      dijalankan_pada: string;
    }>(
      `SELECT DISTINCT ON (jenis_impor) jenis_impor, dibuat, diperbarui, dilewati, jumlah_error,
              contoh_pesan_error, dijalankan_pada
       FROM salessync_import_log
       ORDER BY jenis_impor, dijalankan_pada DESC`,
    );
    return rows.map((row) => ({
      jenisImpor: row.jenis_impor,
      dibuat: row.dibuat,
      diperbarui: row.diperbarui,
      dilewati: row.dilewati,
      jumlahError: row.jumlah_error,
      contohPesanError: row.contoh_pesan_error,
      dijalankanPada: row.dijalankan_pada,
    }));
  } finally {
    client.release();
  }
}
