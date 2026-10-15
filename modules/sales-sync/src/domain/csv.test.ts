import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "./csv.js";

/**
 * Unit test MURNI untuk `parseCsv` -- fungsi ini pure (string -> string[][]),
 * tidak menyentuh database sama sekali, jadi TIDAK pakai `withRollback` dan
 * tidak membuka pool koneksi (karena itu file ini juga tidak perlu
 * `after(() => pool.end())` seperti test domain lain di modul ini).
 *
 * Kasus yang diuji di sini adalah kasus NYATA dari keempat CSV sumber modul
 * sales-sync, bukan kasus karangan: kolom `raw_payload` di `transaksi.csv`
 * berisi JSON lengkap (koma + kutip ganda ter-escape) dalam SATU field
 * berkutip, dan kolom angka di file yang sama memakai pemisah ribuan koma
 * (`"29,600"`).
 */

test("parseCsv: header + beberapa baris data biasa tanpa kutip", () => {
  const rows = parseCsv("platform,order_id,quantity\nShopee,ORD-1,2\nGoFood,ORD-2,1\nGrabFood,ORD-3,5");

  assert.equal(rows.length, 4, "1 header + 3 baris data");
  assert.deepEqual(rows[0], ["platform", "order_id", "quantity"]);
  assert.deepEqual(rows[1], ["Shopee", "ORD-1", "2"]);
  assert.deepEqual(rows[2], ["GoFood", "ORD-2", "1"]);
  assert.deepEqual(rows[3], ["GrabFood", "ORD-3", "5"]);
  for (const row of rows) assert.equal(row.length, 3, "jumlah kolom tiap baris harus sama dengan header");
});

test("parseCsv: field kosong di tengah dan di ujung baris tetap dihitung sebagai kolom", () => {
  const rows = parseCsv("a,b,c\n1,,3\n,,\n4,5,");

  // Baris `,,` BUKAN baris kosong -- isinya 3 field kosong, jadi tidak dibuang
  // oleh filter baris kosong (yang hanya membuang baris berisi satu field "").
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1], ["1", "", "3"]);
  assert.deepEqual(rows[2], ["", "", ""]);
  assert.deepEqual(rows[3], ["4", "5", ""]);
});

test("parseCsv: field berkutip berisi koma (kasus nyata kolom raw_payload berisi JSON)", () => {
  const payload = '{"order_id": "ORD-1", "fees": [1000, 2500], "note": "iklan, komisi"}';
  const text =
    "platform,platform_order_number,gross_amount,raw_payload\n" +
    `Shopee,ORD-1,"29,600","${payload.replace(/"/g, '""')}"\n`;

  const rows = parseCsv(text);

  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, 4, "koma DI DALAM field berkutip tidak boleh memecah kolom");
  assert.equal(rows[1][2], "29,600", "pemisah ribuan ikut terbaca apa adanya (dibuang nanti di import-csv.ts)");
  assert.equal(rows[1][3], payload, "JSON kembali utuh, kutip ganda ter-escape dibuka jadi satu kutip");
  // Pembuktian paling relevan untuk importTransaksi: hasil parse-nya memang JSON valid.
  assert.deepEqual(JSON.parse(rows[1][3]), {
    order_id: "ORD-1",
    fees: [1000, 2500],
    note: "iklan, komisi",
  });
});

test('parseCsv: kutip ganda escape ("" di dalam field berkutip) jadi SATU kutip literal', () => {
  const rows = parseCsv('a,b\n"dia bilang ""halo"" lalu pergi","akhir ""kutip"""\n');

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ['dia bilang "halo" lalu pergi', 'akhir "kutip"']);
});

test("parseCsv: newline DI DALAM field berkutip tidak memecah baris", () => {
  const rows = parseCsv('a,b\n"baris satu\nbaris dua",nilai\n');

  assert.equal(rows.length, 2, "newline di dalam kutip tetap satu baris data");
  assert.deepEqual(rows[1], ["baris satu\nbaris dua", "nilai"]);
});

test("parseCsv: newline di akhir file dan baris kosong di tengah dibuang", () => {
  // Trailing newline (artefak export) + satu baris benar-benar kosong di tengah.
  const rows = parseCsv("a,b,c\n1,2,3\n\n4,5,6\n");

  assert.equal(rows.length, 3, "baris kosong tidak ikut jadi baris data");
  assert.deepEqual(rows[0], ["a", "b", "c"]);
  assert.deepEqual(rows[1], ["1", "2", "3"]);
  assert.deepEqual(rows[2], ["4", "5", "6"]);
});

test("parseCsv: CRLF (export Windows/spreadsheet) diperlakukan sama dengan LF", () => {
  const rows = parseCsv("a,b\r\n1,2\r\n3,4\r\n");

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ["1", "2"]);
  assert.deepEqual(rows[2], ["3", "4"]);
  assert.equal(rows[2][1], "4", "tidak ada sisa \\r yang nempel di field terakhir");
});

test("parseCsv: baris terakhir tanpa newline penutup tetap terbaca lengkap", () => {
  const rows = parseCsv("a,b\n1,2");

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ["1", "2"]);
});

test("parseCsv: string kosong menghasilkan nol baris (pemanggil yang melaporkan 'CSV kosong')", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\n"), []);
});
