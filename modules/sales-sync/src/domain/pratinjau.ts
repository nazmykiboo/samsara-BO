import { pool } from "@samsara/core";
import { bacaDataProses, kunciPemetaan, type IdentitasGrup } from "./proses.js";

/**
 * Pratinjau KATEGORISASI arsip log penjualan TANPA memanggil Inventory atau
 * menulis apa pun -- murni baca + hitung, pola sama persis dengan loop
 * kategorisasi di `prosesSinkronisasi` (SENGAJA diduplikasi, bukan
 * dipanggil, karena `prosesSinkronisasi` bercampur dengan efek samping HTTP
 * + tulis `processed_at` yang tidak relevan di sini -- lihat juga
 * `jalankanOtomatisJikaAktif` di `otomatis.ts` yang memang memanggil
 * `prosesSinkronisasi` sungguhan).
 *
 * Dipakai oleh GET /otomatis/pratinjau (tombol "Lihat Pratinjau" di UI,
 * tanpa efek samping) dan GET /otomatis/status (angka "tertahan" di
 * dashboard Sinkronisasi) -- state dihitung LIVE tiap panggilan, TIDAK
 * disimpan di mana pun (konsisten dengan pola `listItemMapping` yang sudah
 * ada di `item-mapping.ts`).
 */
export interface HasilPratinjau {
  siapDiproses: IdentitasGrup[];
  dilewatiSebelumTanggalMulai: IdentitasGrup[];
  dilewatiBelumTerpetakan: IdentitasGrup[];
  perluDitinjau: IdentitasGrup[];
  channelTidakDikenal: IdentitasGrup[];
}

export async function pratinjauProses(tanggalMulai: string | undefined): Promise<HasilPratinjau> {
  if (!tanggalMulai || !/^\d{4}-\d{2}-\d{2}$/.test(tanggalMulai)) {
    throw new Error("Isi tanggal mulai untuk melihat pratinjau.");
  }

  const client = await pool.connect();
  let data;
  try {
    data = await bacaDataProses(client);
  } finally {
    client.release();
  }

  const hasil: HasilPratinjau = {
    siapDiproses: [],
    dilewatiSebelumTanggalMulai: [],
    dilewatiBelumTerpetakan: [],
    perluDitinjau: [],
    channelTidakDikenal: [],
  };

  for (const grup of data.grup) {
    const identitas: IdentitasGrup = { platform: grup.platform, orderId: grup.orderId, tanggal: grup.tanggal };

    if (grup.tanggal < tanggalMulai) {
      hasil.dilewatiSebelumTanggalMulai.push(identitas);
      continue;
    }

    if (grup.baris.some((row) => row.itemType === "refund")) {
      hasil.perluDitinjau.push(identitas);
      continue;
    }

    const adaYangBelumTerpetakan = grup.baris.some(
      (row) => !row.menuId || !data.pemetaan.get(kunciPemetaan(row.platform, row.menuId)),
    );
    if (adaYangBelumTerpetakan) {
      hasil.dilewatiBelumTerpetakan.push(identitas);
      continue;
    }

    if (!data.channel.get(grup.platform)) {
      hasil.channelTidakDikenal.push(identitas);
      continue;
    }

    hasil.siapDiproses.push(identitas);
  }

  return hasil;
}
