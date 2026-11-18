-- Tahap 2 notifikasi (2026-11-18): "Terima" di Telegram, KHUSUS role owner,
-- sekarang benar-benar memberi efek yang TERLIHAT di app -- bukan cuma
-- acknowledgment yang hilang begitu saja (keluhan owner: "status permintaan
-- item masih menunggu dipenuhi" walau sudah tekan Terima).
--
-- SENGAJA BUKAN kolom status baru (mis. 'diterima' di antara 'diminta' dan
-- 'dipenuhi') -- itu akan membuat baris ini HILANG dari Layar CK (yang
-- memfilter status = 'diminta'), padahal stok BELUM benar-benar dikirim
-- (qty pengiriman belum diketahui, cuma bisa diisi lewat Transfer Kirim
-- sungguhan di app). Dua kolom terpisah ini murni PENANDA "sudah
-- dilihat/diakui", TIDAK mengubah status/alur fulfillment sama sekali --
-- permintaan TETAP muncul di Layar CK sampai benar-benar dipenuhi/ditolak.
ALTER TABLE inventory_permintaan_transfer
  ADD COLUMN IF NOT EXISTS diakui_pada TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS diakui_oleh BIGINT REFERENCES core_users (id);

COMMENT ON COLUMN inventory_permintaan_transfer.diakui_pada IS
  'Kapan permintaan ini diakui/dilihat (bukan dipenuhi) -- saat ini cuma diisi lewat tombol "Terima" di Telegram oleh role owner (lihat core/src/notifikasi/router.ts + modules/inventory/src/notifikasi/register.ts). TIDAK mengubah status, TIDAK menggerakkan stok -- murni penanda visibilitas supaya owner tahu tekanannya di Telegram benar-benar tercatat.';
COMMENT ON COLUMN inventory_permintaan_transfer.diakui_oleh IS
  'User yang mengakui (lihat diakui_pada). NULL kalau belum pernah diakui.';
