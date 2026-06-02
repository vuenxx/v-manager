# V-Manager — Progress Memories

## Proje Özeti
Electron tabanlı bir Windows masaüstü uygulaması. Steam, Epic, GOG, EA, Ubisoft, Xbox gibi platformlardan oyunları tarar; DLSS Enabler, OptiScaler, Streamline gibi grafik modlarını oyunlara otomatik veya manuel olarak kurar/kaldırır. Oyun kapak fotoğraflarını SteamGridDB üzerinden çeker.

---

## Mimari

```
index.js           → Electron entry point
config.js          → Global state, oyun/yol yönetimi, JSON okuma/yazma
ipc.js             → Tüm IPC handler'ları (renderer ↔ main process köprüsü)
scanner.js         → Oyun tarama motoru + upscaler tespiti
updater.js         → electron-updater ile otomatik güncelleme
utils.js           → Yardımcı fonksiyonlar (hash, indirme, versiyon okuma, vb.)
window.js          → BrowserWindow oluşturma
mods/
  dlssEnabler.js   → DLSS Enabler kurulum/kaldırma/zip yönetimi
  optiScaler.js    → OptiScaler kurulum/kaldırma
  optiPatcher.js   → OptiPatcher (.asi) indirme
  fsr4Files.js     → FSR4 DLL dosyaları indirme
  streamline.js    → NVIDIA Streamline kurulum/yedekleme/geri yükleme
  iniEditor.js     → INI dosyası okuma/yazma (dlss-enabler.ini, OptiScaler.ini)
  analyser.js      → Klasör sıkıştırma analizi (CompactGUI portu, PowerShell)
  compressor.js    → Windows compact.exe ile WOF/NTFS sıkıştırma
  compressionDb.js → CompactGUI community veritabanından sıkıştırma oranları
  steamScanner.js  → Steam kütüphane klasöründen AppID tespiti
  uninstaller.js   → DLSS Enabler, OptiScaler, Streamline kaldırma
```

---

## Çözülen Kritik Sorunlar (Koddan Çıkarılan Fix Etiketleri)

### config.js
- **FIX 5b** — `needsDedup` dirty flag eklendi: `deduplicateState()` her `saveGamesState()` çağrısında değil, yalnızca state gerçekten değiştiğinde çalışır. Performansı artırır.

### scanner.js
- **FIX 5a** — Steam kurulum yolu artık Registry'den (`HKLM\SOFTWARE\WOW6432Node\Valve\Steam`) okunuyor; varsayılan `C:\Program Files (x86)\Steam` sadece fallback olarak kalıyor.

### dlssEnabler.js
- **FIX 2a** — `isSameGame()` fonksiyonundaki name-only ve startsWith subfolder eşleştirmeleri kaldırıldı; yanlış pozitif eşleşmelere yol açıyordu.
- **FIX 2e** — Sürüm değiştirirken eski sürümün yeni sürümde olmayan "artık dosyaları" otomatik temizleniyor.
- **FIX 2f** — DLSS Enabler kaldırılırken, kullanıcı aynı zamanda OptiScaler kuruluysa `OptiScaler.ini` silinmiyor.

### optiScaler.js
- **FIX 4a** — Kurulum sonrası injection DLL'lerinin OptiScaler'a ait olup olmadığı kontrol ediliyor (başka modların üzerine yazılması tespiti).
- **FIX 4b** — `fs.renameSync` farklı sürücüler arasında çalışmıyor (`EXDEV`); fallback olarak copy + delete yapılıyor.
- **FIX 4c** — `event.sender.isDestroyed()` kontrolü eklendi; pencere kapanmışken ilerleme eventi gönderilmiyor.
- **FIX 4d** — "Zaten indirildi" kontrolü için klasörün varlığı değil, kritik dosyaların (`OptiScaler.dll`, `OptiScaler.ini`) varlığı kontrol ediliyor.
- **FIX 4e** — `Licences` klasörü benzersiz dizinler listesinden çıkarıldı; GOG oyunlarının kendi lisans klasörleriyle çakışıyordu.

### streamline.js
- **FIX 3a** — Kopyalama hatası durumunda rollback mekanizması: yedeklenen dosyalar otomatik geri yükleniyor.
- **FIX 3b** — Birden fazla Streamline klasörü bulunduğunda en derin değil en sığ olanı (ana binary klasörü) seçiliyor.
- **FIX 3c** — Oyun güncellemesi tespit edildiğinde yedek silinirken `hasStreamline` ve ilgili state alanları da temizleniyor.
- **FIX 3d** — Streamline versiyon tespiti için sadece `sl.common.dll` değil, birden fazla aday DLL deneniyor (`sl.interposer.dll`, `sl.dlss.dll`, `sl.reflex.dll`).
- **FIX 3e** — `installStreamline()` fonksiyonundaki kullanılmayan `overwriteBackup` ve `skipBackup` parametreleri kaldırıldı.

### uninstaller.js / optiScaler.js kaldırma
- **FIX 4e** — `D3D12_OptiScaler` klasörü silinir ama `Licences` artık silinmiyor (generic isim, oyun klasörleriyle çakışır).

---

## Dual-Layer Oyun Yolu Sistemi

Mod kurucuların her oyun için doğru klasörü bulması için üç katmanlı öncelik sistemi:

1. **user-games.json** — Kullanıcının elle tanımladığı `game_root` + `exe_path` (en yüksek öncelik)
2. **scan + developer-games.json** — Tarayıcıdan gelen yol + geliştirici tarafından tanımlanmış `exe_relative_path` birleşimi
3. **scan only** — Tarayıcının bulduğu ham exePath

`resolveActualGameRoot()` ise Binaries/Win64 gibi alt klasörlerin yanlışlıkla game_root olarak kaydedilmesini önleyen heuristik fonksiyon.

---

## Oyun Tarama Motoru (scanner.js)

### Desteklenen Platformlar
- Steam (`.acf` manifest dosyaları, Registry'den kurulum yolu)
- Epic Games (`.item` manifest dosyaları)
- GOG, EA, Ubisoft, Xbox (Windows Registry `Uninstall` anahtarları)
- Manuel kayıtlı oyunlar (`user-games.json`)
- Custom scan klasörleri (kullanıcı tanımlı)

### Upscaler Tespiti (`detectUpscalers`)
Oyun klasöründe BFS (Breadth-First Search) ile:
- **DLSS** → `nvngx_dlss.dll`, `nvngx_dlssg.dll`, `nvngx_dlssd.dll`
- **XeSS** → `libxess.dll`, `xefx.dll`
- **FSR** → `amd_fidelityfx_*.dll`, `ffx_fsr*.dll`
- **DLSS Enabler** → injection DLL'lerin FileDescription'ına göre (`dlss enabler`)
- **OptiScaler** → injection DLL'lerin FileDescription'ına göre (`optiscaler`)
- **Streamline** → `sl.*.dll` pattern

### Stale Cleanup (KURAL 5)
Tarama tamamlandığında yalnızca taranan kaynak + disk kapsamındaki oyunlar temizlenir. Kapsam dışındaki oyunlara (farklı platform, farklı disk) dokunulmaz. Manuel eklenen oyunlar hiçbir zaman silinmez.

---

## Mod Kurulum Akışları

### DLSS Enabler
- `version.dll` kaynak dosyadan alınır, hedef klasöre `effectiveDllName` (dxgi.dll, winmm.dll vb.) ile kopyalanır
- Conflict check: 3. parti modlarla çakışma tespiti
- Antivirus bypass kontrolü: kopyalamadan 1.5sn sonra dosya hâlâ var mı?
- Başarılı manuel kurulum sonrası otomatik `user-games.json` kaydı
- ZIP'ten kurulum: `adm-zip` ile `version.dll` çıkartılır, sürüm PowerShell ile okunur

### OptiScaler
- GitHub Releases API üzerinden `.zip` veya `.7z` indirilir (`7zip-bin` ile çıkartılır)
- `OptiScaler.dll` → kullanıcının seçtiği injection DLL ismine rename edilir
- İsteğe bağlı: OptiPatcher (`.asi` → `plugins/`) ve FSR4 DLL'leri aynı kurulumda yapılabilir
- `OptiScaler.ini` içinde `LoadAsiPlugins=true` otomatik set edilir (OptiPatcher için)

### Streamline
- NVIDIA Streamline SDK'sından `bin/x64` içindeki whitelist'teki DLL'ler alınır
- Kurulumdan önce orijinal dosyalar `.backup` uzantısıyla yedeklenir, hash'leri kaydedilir
- Oyun güncelleme tespiti: aktif dosya hash'i ≠ backup hash ve ≠ mod hash → oyun güncellendi
- Geri yükleme: `.backup` → orijinal isim, mod tarafından eklenen ve backup'ı olmayan dosyalar silinir

---

## Sıkıştırma Sistemi

- `analyser.js` → PowerShell script ile `GetCompressedFileSize` (Win32) + `WofIsExternalFile` API'leri kullanılarak NTFS/WOF/LXP/XPRESS/LZX sıkıştırma oranı hesaplanır (CompactGUI native port)
- `compressor.js` → `compact.exe /C /S /EXE:XPRESS4K` (veya XPRESS8K/XPRESS16K/LZX) ile WOF sıkıştırma; `compact.exe /U /S /EXE` ile geri alma
- `compressionDb.js` → CompactGUI community veritabanından oyun başına önerilen sıkıştırma oranları, 24 saatlik cache

---

## INI Editörü (iniEditor.js)

- `dlss-enabler.ini` ve `OptiScaler.ini` için okuma/yazma
- Yorum satırları ve boşluklar korunur
- CRLF / LF satır sonu formatı otomatik tespit ve koruma
- Dosyada olmayan yeni key'ler ilgili section'ın sonuna eklenir
- 4 aşamalı dosya bulma: kayıtlı mod yolu → exe yanı → recursive arama → fallback

---

## Otomatik Güncelleme (updater.js)

- `electron-updater` ile GitHub Releases üzerinden güncelleme kontrolü
- `autoDownload: false` — kullanıcı onayı zorunlu
- Uygulama açılıştan 3sn sonra sessizce kontrol eder (sadece packaged build'de)
- Development modunda sahte "güncel" yanıtı döner

---

## Önemli State Dosyaları (userData/)

| Dosya | İçerik |
|-------|--------|
| `games.json` | Taranmış/eklenmiş tüm oyunlar + mod durumları |
| `blacklist.json` | Kütüphaneden gizlenen oyun isimleri |
| `user-games.json` | Kullanıcı tanımlı game_root + exe_path eşlemeleri |
| `developer-games.json` | Geliştirici tanımlı exe_relative_path eşlemeleri (read-only) |
| `custom-folders.json` | Kullanıcının eklediği özel tarama klasörleri |
| `custom-subfolders-state.json` | Özel klasör alt dizinlerinin checkbox durumları |
| `covers/` | İndirilen kapak fotoğrafları (SteamGridDB) |
| `mods/` | İndirilen mod dosyaları (dlssenabler/, optiscaler/, streamline/ vb.) |

---

## Bilinen Özel Davranışlar / Dikkat Edilecekler

- **Sembolik linkler** tarama ve upscaler tespitinde atlanır (sonsuz döngü önlemi)
- **Launcher & redistributable filtreleme** — scanner.js'de kapsamlı isim/exe/path blacklist'i var; `isIgnoredGame()` ile kontrol edilir
- **Deduplication** — Aynı oyunun birden fazla kaynaktan gelmesi durumunda mod durumu merge edilir, en bilgi yüklü kayıt korunur
- **Drive filter** — Tarama belirli disklerle sınırlandırılabilir; manual oyunlar drive filter'dan muaf
- **Cover yenileme** — `coversOnly: true` ile sadece eksik kapaklar SteamGridDB'den çekilir, mevcut kapaklar yeniden indirilmez
- **app.isPackaged** — Updater ve bazı path'ler development/production'da farklı davranır
- **SteamGridDB API key** — `config.js` içinde hardcoded (`b89ed9f1ab39a34c3b8ea71d756403ce`)
- **FSR4 sunucusu** — GitHub değil, özel bir sunucudan (`http://190.92.151.212/fsr4files/`) çekiliyor
- **YouTube RSS** — `UCCeWDMKoZfZSNOn0pRIGBcw` kanal ID'si için RSS feed çekiliyor (muhtemelen uygulama içi haberler)
- **GitHub repo** — `vuenxx/v-manager` üzerinden release listesi çekiliyor
