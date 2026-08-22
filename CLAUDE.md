## Ağ mimarisi kuralları

- Sunucu otoritedir. İstemci hiçbir zaman kendi durumunu sunucuya dayatmaz.
- Simülasyon sabit tick ile çalışır (`shared/constants.js`'teki `TICK_RATE`/`FIXED_DT`); render frame rate'inden bağımsızdır.
- Girdi ve durum paketleri unreliable/unordered gönderilir; sadece bağlantı, eşleşme ve skor gibi olaylar reliable kanaldan gider.
- Her ağ değişikliği 150ms RTT + 30ms jitter + %2 paket kaybı altında (bkz. `client/net/netSim.js`'in "tipikMobil"/"kotu" profilleri) test edilmeden birleştirilmez.
- `update()` içinde nesne allocation yok — GC duraklaması jitter olarak görünür.
