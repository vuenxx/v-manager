# V-Manager — Progress Memories Agent

> Bu dosya projenin mevcut durumunu, mimarisini, tamamlanan işleri ve açık görevleri takip eder.
> Her oturumun başında bu dosyayı oku; her önemli değişiklikte güncelle.

---

## 📌 Proje Özeti

**V-Manager** — Electron tabanlı bir Windows masaüstü uygulaması.  
Steam, Epic Games ve manuel olarak eklenen oyunları tarayıp üç farklı grafik modunu (DLSS Enabler, OptiScaler, Streamline) oyunlara otomatik yükleyen / kaldıran bir mod yöneticisi.

- **Platform:** Windows (Electron)  
- **Dil:** JavaScript (Node.js / Electron main process)  
- **Entry point:** `index.js` → `config.js` + `ipc.js` + `window.js`  
- **Proje kökü:** `src/main/` içinde; `config.js`'deki `projectRoot` hesaplaması buna göre yapılıyor.

---

## 🗂️ Dosya / Modül Haritası

```
index.js                 — App bootstrap; config.loadExistingGames(), ipc.registerIpcHandlers(), createWindow()
config.js                — Global state (games, blacklist, favorites), dosya yolları, okuma/yazma fonksiyonları
ipc.js                   — Tüm ipcMain handler'ları (renderer ↔ main köprüsü)
scanner.js               — Steam / Epic / Registry / Manuel oyun tarama + detectUpscalers()
utils.js                 — Dosya hash, versiyon okuma, resim indirme, oyun çalışıyor mu kontrolü
window.js                — BrowserWindow oluşturma

mods/
  dlssEnabler.js         — DLSS Enabler sürümleri listeleme, seçme, yükleme (otomatik + manuel)
  optiScaler.js          — GitHub Releases'den OptiScaler indirme/yükleme (7z, node-7z)
  streamline.js          — Streamline DLL dosyalarını kopyalama, yedekleme, geri yükleme
  uninstaller.js         — Üç modun kaldırma mantığı (dosya silme, state güncelleme)
  analyser.js            — Oyun klasörü analizi
  compressor.js          — Klasör sıkıştırma / açma
  compressionDb.js       — Sıkıştırma veritabanı
  compressionWatcher.js  — Sıkıştırma izleyici (watch/unwatch)
  steamScanner.js        — Steam appId ↔ klasör eşleştirme
```

---

## 🔑 Kritik Veri Yapıları

### Oyun Nesnesi (`games.json` elemanı)
```js
{
  name: String,
  exePath: String,
  source: 'steam' | 'epic' | 'registry' | 'manual',
  cover: String | null,          // kapak görseli yolu (userData/covers/)
  isFavorite: Boolean,
  hasDlssEnabler: Boolean,
  dlssEnablerVersion: String | null,
  hasOptiscaler: Boolean,
  optiscalerVersion: String | null,
  optiscalerInjection: String | null,
  hasStreamline: Boolean,
  streamlineVersion: String | null,
  streamlinePath: String | null,
  upscalers: {
    dlss: Boolean,
    xess: Boolean,
    fsr: Boolean,
    dlssEnabler: Boolean,
    optiscaler: Boolean,
    streamline: Boolean
  }
}
```

### Kalıcı Dosya Yolları (`config.js`)
| Değişken | Yol |
|---|---|
| `GAMES_FILE` | `userData/games.json` |
| `BLACKLIST_FILE` | `userData/blacklist.json` |
| `COVERS_DIR` | `userData/covers/` |
| `modsPath` | `projectRoot/mods/` |
| `registeredGamesPath` | `projectRoot/list-of-registered-games.txt` |
| `uninstallListPath` | `projectRoot/uninstall-list.txt` |
| `streamlineModsPath` | `projectRoot/mods/streamline/` |

---

## ✅ Tamamlanan Özellikler

### Tarama & Keşif
- [x] Steam oyun tarama (`steamapps/common` okuma)
- [x] Epic Games tarama
- [x] Windows Registry tarama
- [x] Manuel kayıtlı oyun tarama (`list-of-registered-games.txt`)
- [x] `detectUpscalers()` — DLSS / XeSS / FSR / DLSS Enabler / OptiScaler / Streamline tespiti
- [x] Sembolik link (reparse point) atlama
- [x] Klasör öncelik / yoksay listesi sistemi (sınırsız derinlik, akıllı atlama)
- [x] `deduplicateState()` — mod bilgilerini birleştirerek tekrarlı oyunları temizleme

### Oyun Yönetimi
- [x] `games.json` okuma/yazma
- [x] Manuel oyun ekleme (dialog → `.exe` seçimi)
- [x] Kara liste (blacklist) ekle/çıkar
- [x] Favori toggle (kalıcı `favoriteNames` listesi)
- [x] Cover görseli SteamGrid API üzerinden indirme
- [x] Force refresh tarama (manuel oyunları koruyarak yeniden tara)

### Mod: DLSS Enabler
- [x] `mods/dlssenabler/` klasöründen sürüm listesi okuma
- [x] `.exe` seçimi (launcher uyarısı mantığı mevcut)
- [x] Manuel kurulum (`executeDlssInstall`)
- [x] Otomatik kurulum (`autoInstallDlss`)
- [x] Kaldırma: benzersiz dosyalar + enjeksiyon DLL'leri (description tabanlı)

### Mod: OptiScaler
- [x] GitHub Releases API'dan son 5 sürümü listeleme
- [x] `.7z` indirme (`node-7z` + `7zip-bin`)
- [x] Yükleme (`installOptiScaler`)
- [x] "Zaten indirildi" kontrolü
- [x] Kaldırma: benzersiz dosyalar + klasörler + enjeksiyon DLL'leri (isOptiScalerFile)

### Mod: Streamline
- [x] `findStreamlineDir()` — BFS ile sl.*.dll konumu bulma
- [x] Yedekleme + kurulum (`installStreamline`)
- [x] Geri yükleme (`restoreStreamline`) — .backup kontrolü, UAC/kilit try-catch koruması (EPERM), güvenli mod-only silme (games.json & sürüm paketi doğrulamalı) ve oyun güncellemelerini algılayan katı hash eşleştirme sistemi eklendi
- [x] Eksik yolda yeniden tespit mekanizması
- [x] Kurulum hedefi otomatik arama (findStreamlineDir) ve kullanıcı klasör seçici uyarısı / fallback sistemi (Manuel Kur arayüzden kaldırılarak entegre edildi), akıllı yedek atlama (dosya varsa yedekleme es geçilir, yoksa yedeklenir) ve onay ekranı baypası eklendi.

### Sıkıştırma
- [x] Klasör sıkıştırma / açma (`compressor.js`)
- [x] Sıkıştırma veritabanı (`compressionDb.js`)
- [x] İzleyici sistemi (`compressionWatcher.js`)
- [x] Steam appId ↔ klasör eşleştirme (`steamScanner.js`)

### IPC Katmanı
- [x] Tüm handler'lar `ipc.js`'de kayıtlı
- [x] `isScanning` flag ile çoklu tarama engeli
- [x] Progress tracker (`{ total, current }`) tarama sırasında renderer'a iletiliyor

---

## 🔧 Bilinen Sorunlar / Açık Görevler

### Yüksek Öncelik
- [ ] **`scan-complete` event eksikliği riski**: Tarama sırasında hata fırlarsa `finally` bloğu çalışıyor ama renderer'a hata mesajı iletilmiyor — hata durumu UI'a yansıtılmalı.
- [ ] **`registerIpcHandlers` tekrar çağrısı**: Pencere yeniden oluşturulursa (`activate` eventi) handler'lar ikinci kez kaydedilebilir. IPC handler'lar için deregistration veya tek-seferlik guard eklenmeli.
- [ ] **OptiScaler indirme ilerlemesi**: `downloadOptiScalerRelease` fonksiyonu `event` parametresi alıyor ama indirme yüzdesi renderer'a aktarılıyor mu kontrol edilmeli.

### Orta Öncelik
- [ ] **`deduplicateState()` performansı**: Her `saveGamesState()` çağrısında tekrar çalışıyor; büyük kütüphanelerde yavaşlayabilir — dirty flag ile optimize edilebilir.
- [ ] **`list-of-registered-games.txt` format dayanıklılığı**: `parseRegisteredGames` basit INI parser; değer içinde `=` işareti olduğunda düzgün çalışıyor (`split('=').slice(1).join('=')`) — edge case testleri yazılmalı.
- [ ] **Kapak görseli eksikliği**: Manuel eklenen oyunlarda `coverUrl: null` — SteamGrid'de isim araması yapılabilir.
- [ ] **`analyser.js` dokümantasyonu eksik**: `analyze()` fonksiyonunun ne döndürdüğü belirsiz, IPC tarafında `analyze-folder` handler var ama kullanım senaryosu tanımlanmamış.

### Düşük Öncelik
- [ ] **Windows dışı platform**: `isGameRunning` için `tasklist` kullanılıyor — macOS/Linux uyumluluğu yok (kasıtlı olabilir).
- [ ] **`STEAMGRID_API_KEY` config.js içinde hardcoded** — environment variable veya ayrı secrets dosyasına taşınmalı.
- [ ] **Test coverage sıfır** — En azından `deduplicateState`, `parseRegisteredGames`, `detectUpscalers` için unit testler yazılmalı.

---

## 🔍 Önemli Tasarım Kararları

| Karar | Neden |
|---|---|
| Sembolik linkler atlanıyor | Sonsuz döngü ve kullanıcı isteği |
| OptiScaler tespiti "description" bazlı | DLL adı standart (`dxgi.dll` vb.) ama içerik OptiScaler'a özgü |
| `deduplicateState` her kayıtta çalışır | Farklı kaynaklardan aynı oyunun tek kayıt olarak tutulması için |
| `favoriteNames` ayrı liste olarak tutulur | Taramada oyun silinse bile favori bilgisi korunur |
| `projectRoot` paketten farklı | `app.isPackaged` ile production/development ayrımı |
| Streamline için backup mekanizması | Oyun güncellemeleri DLL'leri sıfırlayabilir |

---

## 📡 Dış API & Bağımlılıklar

| Servis / Paket | Kullanım |
|---|---|
| `SteamGrid API` | Oyun kapak görseli indirme (key: `config.STEAMGRID_API_KEY`) |
| `GitHub API` | OptiScaler releases (`/repos/optiscaler/OptiScaler/releases`) |
| `7zip-bin` + `node-7z` | OptiScaler `.7z` arşivi açma |
| `electron` | BrowserWindow, ipcMain, dialog, app |

---

## 🚀 Geliştirme Akışı

```
# Kurulum
npm install

# Geliştirme
npm start            # Electron'u development modunda başlat

# Paket
npm run build        # app.isPackaged = true, projectRoot = execPath dizini
```

---

## 📝 Bir Sonraki Oturum İçin Notlar

_Bu bölüme oturum sonunda "bir sonraki seferde devam et" notları ekle._

- [ ] ...

---

*Son güncelleme: İlk oluşturma — tüm dosyalar `main.zip` içindeki güncel halinden analiz edildi.*
