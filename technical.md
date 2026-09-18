# V-Manager — Teknik Harita (technical.md)

> **Bu dosyanın amacı:** Kod tabanında "ne nerede?" sorusunu dosya dosya aramadan cevaplamak.
> Yeni bir iş isteğinde önce bu dosya okunur, sonra sadece ilgili dosyalar açılır.
>
> Oluşturulma: 2026-09-16 · Sürüm: `package.json` → **0.7.0** · Branch: `main`
> **Güncelleme kuralı:** Yeni IPC kanalı, yeni modül/manifest, yeni sekme veya yeni userData dosyası eklendiğinde ilgili tablo güncellenmeli.

---

## 1. Tek Bakışta Proje

| Konu | Değer |
|---|---|
| Ne yapar | Windows'ta kurulu oyunları tarar, DLSS/FSR/XeSS upscaler & frame-generation modlarını kurar/kaldırır/ayarlar, NTFS sıkıştırma ile disk kazandırır |
| Tip | Electron masaüstü uygulaması (yalnızca Windows / x64) |
| Ana süreç dili | CommonJS (`require`) — `src/main/**` |
| Renderer dili | ES Modules (`import`) — `src/renderer/**` |
| UI | Vanilla JS + tek `index.html` + tek `styles.css` (framework YOK, bundler YOK) |
| Paketleme | `electron-builder` → NSIS installer, GitHub Releases'e publish |
| Dil | TR (varsayılan) + EN, `src/renderer/i18n/` |
| Kod yorumları | Karma TR/EN — yeni kodda çevre dosyanın dilini takip et |

**Çalıştırma:**

```bash
npm start
```

```bash
npm run build:local
```

| Script | Ne yapar |
|---|---|
| `npm start` | `electron .` — geliştirme modu |
| `npm run build:local` | `electron-builder --win --x64 --publish never` → `dist/` |
| `npm run build` | Aynısı + GitHub Releases'e yükler (`GH_TOKEN` gerekir) |
| `npm run compile:win` | `node tools/compile.js` — `src/main/**` → `build-tmp/**/*.jsc` (bytenode) |
| `npm run build:compile` | compile + build (bytecode korumalı sürüm) |

---

## 2. Süreç Mimarisi

```
main.js  (entry, package.json "main")
   └─ src/main/index.js         ← yaşam döngüsü, lisans kapısı, bootApp()
        ├─ src/main/window.js   ← BrowserWindow + kapatma davranışı (tray/exit)
        ├─ src/main/tray.js     ← sistem tepsisi + son oynanan 4 oyun
        ├─ src/main/ipc.js      ← ~95 IPC handler'ın TEK kayıt noktası
        ├─ src/main/config.js   ← tüm state + userData yolları + yol çözümleyici
        ├─ src/main/scanner.js  ← oyun keşfi + mod tespiti
        ├─ src/main/mods/*      ← ESKİ (hardcoded) mod kurucular
        └─ src/main/modules/*   ← YENİ (manifest tabanlı) modül motoru
                 ↕ IPC (contextBridge)
preload.js  ← window.electronAPI köprüsü (tek dosya, güvenlik sınırı)
                 ↕
index.html + styles.css + renderer.js → src/renderer/index.js
```

**Güvenlik ayarları:** `nodeIntegration: false`, `contextIsolation: true`. Renderer'da `require` yok.
Dış link açma yalnızca `open-external-link` IPC kanalıyla (`shell.openExternal` doğrudan expose edilmez — preload'daki `M-28` notu).

---

## 3. Dizin Haritası

### 3.1 Kök dosyalar

| Dosya | Rol |
|---|---|
| `main.js` | Entry. `src/main/index.js` varsa onu, yoksa `build-tmp/.../index.jsc` bytecode'u yükler |
| `preload.js` | **17 KB — `window.electronAPI` yüzeyinin tamamı.** Yeni IPC eklerken BURAYA da satır eklenecek |
| `index.html` | **207 KB — tüm sekmeler + ~38 modal.** Tek dosya |
| `styles.css` | **219 KB / 9117 satır — tüm stil.** Bölüm yorumlarıyla ayrılmış |
| `renderer.js` | Tek satır: `import './src/renderer/index.js'` |
| `activation.html` / `activation_preload.js` / `activation_renderer.js` | Lisans aktivasyon penceresi (ayrı BrowserWindow) |
| `developer-games.json` | Oyun adı → `exe_relative_path` eşlemesi (salt-okunur, extraResource) |
| `dlss_enabler_games.json` | DLSS Enabler destekli oyun listesi (salt-okunur, extraResource) |
| `key-olustur.bat` | HWID'den lisans anahtarı üreten yardımcı bat (→ `tools/generator.js`) |

### 3.2 Dokümantasyon dosyaları

| Dosya | İçerik | Not |
|---|---|---|
| `technical.md` | **Bu dosya** — kod haritası | |
| `README.md` | Kullanıcıya yönelik TR+EN tanıtım | |
| `PROJE_BILGILERI.md` | Dosya envanteri + akış özetleri | Bu dosyayla örtüşür |
| `WALKTHROUGH.md` | Manifest modül sistemi raporu + test sonuçları | |
| `PROGRESS_MEMORIES.md` | Geliştirme günlüğü | |

### 3.3 Aktif olmayan / özel klasörler

| Klasör | Durum |
|---|---|
| `build-tmp/` | `tools/compile.js` çıktısı — `.jsc` bytecode. gitignore'da, build sırasında yeniden üretilir |
| `dist/` | electron-builder çıktısı. gitignore'da, build sırasında yeniden üretilir |
| `tools/` | `compile.js` (bytenode), `generator.js` (Ed25519 lisans CLI), `private.pem`/`public.pem`. **gitignore'da — gizli anahtarlar** |
| `scripts/` | `migrate-ini-schema-to-manifest.js` — `iniSchema.js` şemalarını manifest'lere aktaran tek seferlik migrasyon |
| `test-data/`, `test-data-dlss/` | Sahte oyun klasörleri + örnek userData (E2E testler kullanıyor) |
| `scratch/` | `xbox_scan.ps1` — deneme scripti |
| `icons/` | `program_logo.ico`, `verified_green.png`, `verified_yellow.png` |

---

## 4. Ana Süreç (`src/main/`)

### 4.1 Çekirdek dosyalar

| Dosya | Satır | Sorumluluk | Önemli semboller |
|---|---|---|---|
| `index.js` | 133 | Single-instance lock → lisans kontrolü → `createActivationWindow()` veya `bootApp()` | `bootApp()`, `createActivationWindow()` |
| `config.js` | 708 | **Tüm kalıcı state + yol çözümleme.** En sık dokunulan dosya | `getGamePaths()`, `resolveActualGameRoot()`, `normalizeGameKey()`, `deduplicateState()`, `atomicWriteFile()` |
| `ipc.js` | 1268 | ~95 IPC handler kaydı; iş mantığını `mods/*` ve `modules/*`'a devreder | `registerIpcHandlers()`, `isCompressionRunning()` |
| `scanner.js` | 1109 | Oyun keşfi (Steam/Epic/Xbox/Registry/Manuel) + mod tespiti | `runScan()`, `detectUpscalers()`, `processAndStreamGame()`, `isIgnoredGame()` |
| `utils.js` | 418 | Dosya hash/versiyon/açıklama, sürücü listesi, DX12 kontrolü, exe tarama | `getFileVersion()`, `getFileDescription()`, `checkDx12Support()`, `getSystemDrives()`, `isGameRunning()` |
| `license.js` | 257 | Ed25519 offline HWID lisans + `safeStorage` şifreleme | `checkLicense()`, `activate()`, `getMachineId()` |
| `window.js` | 66 | Ana pencere (min 1280x720), kapatma → tray/exit, sıkıştırma sırasında kapanma engeli | `createWindow()` |
| `tray.js` | 122 | Tepsi menüsü + son 4 oyun hızlı başlatma + sekme navigasyonu | `createTray()`, `updateTrayMenu()` |
| `updater.js` | 146 | `electron-updater` sarmalayıcı; renderer'a event yayını | `initAutoUpdater()`, `checkForUpdates()`, `startDownload()`, `quitAndInstall()` |
| `discord.js` | 170 | Discord Rich Presence + exponential backoff reconnect (`CLIENT_ID` sabit) | `initDiscordRpc()`, `setPresence()` |

### 4.2 `src/main/mods/` — ESKİ nesil (hardcoded) mod kurucular

> Her modun kendi dosyası var; `ipc.js` doğrudan çağırıyor. **Manifest sistemi (§5) bunların yerini almak için yazıldı ama ikisi hâlâ paralel çalışıyor.**

| Dosya | Satır | Ne yapar |
|---|---|---|
| `dlssEnabler.js` | 762 | DLSS Enabler kurulumu, proxy DLL seçimi, zip'ten kurulum, GitHub release listesi |
| `dlssWizard.js` | 593 | DLSS Enabler **otomatik DLL testi sihirbazı** (oyunu başlatır, `dlss-enabler.ini` oluşumunu izler, DLL'leri sırayla dener) |
| `optiScaler.js` | 515 | OptiScaler kurulumu (+ isteğe bağlı OptiPatcher & FSR4 birlikte kurulum) |
| `optiWizard.js` | 536 | OptiScaler sihirbazı |
| `optiBuilder.js` | 413 | OptiBuilder kurulumu (OptiScaler ≥ 0.10 varyantı) |
| `optiBuilderWizard.js` | 440 | OptiBuilder sihirbazı |
| `optiPatcher.js` | 159 | OptiPatcher `.asi` eklentisi indirme |
| `fsr4Files.js` | 225 | FSR4/FSR3.1 DLL paketleri (`.7z`) |
| `streamline.js` | 969 | NVIDIA Streamline `sl.*.dll` dosyaları; `.backup` suffix stratejisi, hash kaydı, dinamik dizin arama |
| `uninstaller.js` | 285 | Eski nesil mod kaldırma |
| `launcher.js` | 245 | Oyun başlatma: Steam (`steam://`), Epic (`com.epicgames.launcher://`), Xbox (`shell:AppsFolder`), doğrudan exe |
| `iniEditor.js` | 393 | INI okuma/yazma + `findIniPath()` recursive arama |
| `releaseCache.js` | ~120 | GitHub release JSON önbelleği — **TTL 1 saat**, `userData/releases-cache/<modId>.json`. Kayıtta `repo` da tutulur: manifest kaynağı değişirse önbellek TTL dolmadan geçersiz olur |
| `compressor.js` | 229 | `compact.exe` sarmalayıcı — `XPRESS4K/8K/16K/LZX` |
| `compressionDb.js` | 108 | `userData/compression-history.json` geçmişi |
| `analyser.js` | 215 | PowerShell ile klasör boyutu / sıkıştırma durumu analizi |
| `steamScanner.js` | 72 | `libraryfolders.vdf` + `.acf` parse → klasör→AppID |

### 4.3 `src/main/modules/` — YENİ nesil manifest tabanlı modül sistemi

| Dosya | Satır | Sorumluluk |
|---|---|---|
| `core/moduleManager.js` | 678 | Manifest keşfi/yükleme, doğrulama, **17 adet `module-*` IPC handler'ı**, custom manifest kaydet/sil |
| `core/moduleEngine.js` | 1171 | **18 adımlı kurulum pipeline'ı** + `uninstall`, `getReleases`, `downloadRelease`, `resolveDestinationDir`, `findDynamicSearchDir` |
| `core/moduleWizardEngine.js` | ~680 | Manifest'ten sürülen evrensel otomatik-test sihirbazı (eski `dlssWizard.js`'in genel hâli). İndirme `moduleEngine.downloadRelease`, kopyalama `copyModFiles`, çakışma kontrolü `manifest.conditions` üzerinden — modülden bağımsız |
| `core/manifestValidator.js` | 387 | Manifest şema doğrulaması (hata + uyarı listesi) |
| `core/backup.js` | 204 | `userData/module-backups/<oyun>/<modId>/<timestamp>/` + `backup-meta.json`, SHA-256 hash, 3 yedek sakla |
| `core/githubFetcher.js` | 140 | GitHub releases çekme, asset glob eşleme, indirme + progress |
| `core/archive.js` | ~60 | `.zip` (extract-zip), `.7z` (7zip-bin) ve `.rar` (rarExtractor) çıkarma |
| `core/exeApiDetector.js` | ~330 | **Oyun exe'sinin grafik API'si + bit genişliği** — PE başlığı (kesin bitlik), import/delay-import tablosu, exe içi string taraması, motor (UE/Unity) ve yol ipuçları. Puanlanmış sıralı liste döner; `apiTargeting` ve kurulum modalı kullanır |
| `core/requirementChecker.js` | ~155 | **Manifest ön koşulları (`requires`)** — "bu mod kurulmadan önce şu modül kurulu olmalı". Önce diskten (`moduleDetector.isModuleInstalledIn`), sonra `games.json` bayrağından kontrol eder. Kurulum modalı ve motorun 5c adımı **aynı** sonucu okur; `failures` şekli `conditionChecker` ile birebir aynıdır |
| `core/conflictChecker.js` | ~270 | **Çakışma denetimi** — (a) manifest'te bildirilen `conflicts` / `incompatible_mods`, (b) dahili *dosya sahipliği* çakışması: hedef dosya zaten var ve başka bir modüle ait, (c) **yabancı dosya çakışması** (`findForeignTargetConflict`): hedef dosya var ama sahibi hiçbir modül değil — yani oyunun kendi dosyası; kurulum durur ve kullanıcıdan başka bir enjeksiyon tipi seçmesi istenir. `requires`'ın aynası; `failures` şekli `conditionChecker`/`requirementChecker` ile birebir aynı. Aynı `detect.exclusiveGroup` içindeki varyantlar (OptiScaler ↔ OptiBuilder) çakışma sayılmaz |
| `core/sourceResolver.js` | ~330 | **Manifest kaynağı çözücü** — `source.type: "github"`, `"github_files"` veya `"url"`. URL kaynağında sürüm keşfi (`html_scrape` / `json_field` / `static`) yapar, githubFetcher ile **aynı şemada** kayıt döndürür, böylece motorun geri kalanı değişmez. `github_files`: release'de asset yokken (yalnızca "Source code (zip)" varken) gereken dosyaları `raw.githubusercontent.com`'dan tek tek indirir (`rawFileUrl`, `downloadFiles`) |
| `core/rarExtractor.js` | ~130 | **RAR4/RAR5 çıkarma** (node-unrar-js/WASM). 7za RAR desteklemediği için yazıldı; asar altında `app.asar.unpacked` yolundan WASM okur, zip-slip koruması var |
| `core/configEditor.js` | 134 | INI/JSON config okuma-yazma, `Section.Key` nokta notasyonu |
| `core/conditionChecker.js` | 181 | `check_conflicts`, `file_exists`, GPU kontrolü (PowerShell `Win32_VideoController`, cache'li) |
| `core/moduleLogger.js` | 40 | Modül başına zaman damgalı log toplayıcı |
| `core/moduleDetector.js` | ~340 | **Manifest tabanlı disk üzerinde mod tespiti** — `detect` bloklarını okur, dosya eşleştirir, sonucu `state` alanlarına yazar. `scanner.js` bunu kullanır. `identifyFileOwner(filePath)` tersini sorar: *bu dosya hangi modüle ait?* (çakışma denetimi) |
| `tools/toolsManager.js` | 326 | **Winget tabanlı araç yöneticisi** (TreeSize Free, Everything, Ü Toolbox) |
| `vlss5/vlss5Manager.js` | ~880 | **VLSS5 kurulum/güncelleme yöneticisi** — `getStatus`, `install`, `checkForUpdatesOnStartup`, `checkForUpdatesManual`, `launch`, `setModelDll`, `findModelDllInDriverStore`, `closeRunningApp`, `isBusy`, `uninstall`. Durum state dosyasından değil diskten okunur |
| `test-module-system.js` | 828 | Birim test paketi |
| `test-e2e-dlssenabler.js` | 196 | Gerçek GitHub indirmeli E2E test |
| `test-e2e-dummy.js` | 146 | dummy-mod E2E test |
| `test-detector.js` | ~165 | moduleDetector birim testleri (sahte FileDescription/FileVersion ile) |
| `test-vlss5.js` | ~200 | VLSS5 + RAR çıkarma testleri (`test-data/vlss5-sample.rar` ile) |

---

## 5. Manifest Tabanlı Modül Sistemi (detay)

### 5.1 Manifest keşif sırası (`moduleManager._getModuleRoots()`)

1. `src/main/modules/official/<id>/manifest.json` — **resmi** (en yüksek öncelik)
2. `src/main/modules/community/<id>/manifest.json` — topluluk (klasör şu an yok)
3. `%APPDATA%/v-manager/modules/<id>/manifest.json` — **custom/kullanıcı** (en son — resmiyi gölgeleyemez)

Aynı `id` iki kez bulunursa ilk yüklenen kazanır (shadowing engeli).

### 5.2 Kayıtlı resmi manifest'ler

| id | Rol | Kaynak repo | destination | Öne çıkan özellik |
|---|---|---|---|---|
| `dlssenabler` | mod | `vuenxx/extra_goldteam34` | `game_exe` | `proxyDetection`, `verifyAntiVirusDelayMs`, `wizard.autoTest`, `uninstall.verifiedDlls`, `unlessState` |
| `optiscaler` | mod | `optiscaler/OptiScaler` | `game_exe` | Zengin `config.schema` + `visibleIf`, `proxyDetection`, **`addons`: optipatcher + fsr4** |
| `optibuilder` | mod | `vuenxx/extra_newrepo` | `game_exe` | OptiScaler ≥0.10 varyantı. `proxyDetection`, asset `["*.7z","*.zip"]`, `injectionField` |
| `optipatcher` | **addon** | `optiscaler/OptiPatcher` | `plugins/` (parent altı) | asset `*.asi` → `OptiPatcher.asi`, `configChanges: LoadAsiPlugins=true` |
| `fsr4` | **addon** | `vuenxx/extra_policebosstr` | `game_exe` | asset `["*.7z","*.zip"]`, yalnızca `*.dll` kopyalanır |
| `optiscaler-dlssnr` | mod | `Dagherbou/OptiScaler_DLSSNR` | `game_exe` | OptiScaler + DLSS5 Neural Rendering forku. `[DlssNr]` config şeması + 4 preset, `proxyDetection`, `files.exclude` (setup script'leri). **`nvngx_dlssnr.dll` kullanıcı tarafından sağlanır** |
| `mfg-unlock` | mod | `mavismmg/MFGAdaUnlock-RenoDx` | `game_exe` | RTX 40'ta DLSS Multi Frame Generation (3x/4x/6x) kilidini açan **ReShade addon'u**. Asset arşiv değil, tek `.addon64` dosyası. `requires: [reshade]` ile ReShade'e bağlı; ayarları `ReShade.ini` → `[RenoDX.MFGUnlock]` |
| `reshade` | **both** | `reshade.me` (url) | `game_exe` | Post-process enjektör. `source.type: url` + sürüm keşfi, SFX exe'den DLL çıkarma, `apiTargeting` (32/64 bit + API'ye göre yeniden adlandırma), `extraSources` (shader paketi), `ReShade.ini` üretimi |
| `dlssg-for-sm86` | mod | `sdli1995/dlssg_for_sm86` | `game_exe` | RTX 20/30'da MFG. Release'de **asset yok** → `source.type: "github_files"` (yalnızca gereken dosyalar raw üzerinden). Her enjeksiyon adı ayrı binary → `proxyDetection.sourceByTarget`. DLL'de FileDescription yok → kaldırma `uninstall.verifiedDlls[].matchModFileHash` ile |
| `streamline` | mod | `NVIDIA-RTX/Streamline` | `dynamic_search` | `in_place_suffix` backup (`.backup`), hash kaydı, `whitelistFiles` |
| `dummy-mod` | mod | `vuenxx/dummy` | `game_exe` | Test manifesti |

> `role: "addon"` olan modüller **mod seçim ekranında listelenmez**; bağlı oldukları modun
> kurulum modalında onay kutusu olarak çıkar. Kendi manifest'leri (repo/asset) tek doğruluk
> kaynağı olarak kalır — `addons` girdileri yalnızca `moduleId` ile referans verir.

### 5.3 Manifest şeması (alan referansı)

```
id, name, description, author, version
source:   { type:"github" | "github_files" | "url",
            // github:       repo, release, asset, maxReleases
            // github_files: repo, release, maxReleases, files:[depo içi yollar]
            //               Release'de asset yokken (yalnızca "Source code (zip)")
            //               dosyalar raw.githubusercontent.com/<repo>/<tag>/<yol>
            //               üzerinden tek tek indirilir ve hedef klasöre DÜZ
            //               (yalnızca dosya adıyla) yazılır. İndirilecek liste =
            //               source.files + seçilen enjeksiyonun sourceByTarget yolu.
            //               `install.extractRoot: "none"` kullanılmalı (arşiv yok).
            // url:    url ("...{version}..."), assetName, version,
            //         versionCheck:{ type:"html_scrape"|"json_field"|"static",
            //                        url, pattern|field, flags }
            type:"github", repo, release:"latest", maxReleases,
            asset: "*.zip" | ["*.7z","*.zip"],    // tek glob veya glob dizisi
            legacyFolders: ["fsr4files"] }        // mods/ altındaki eski klasör adları
install:
  destination:  "game_root" | "game_exe" | "dynamic_search" | {type:"relative", path}
  extractRoot:  "auto" | "bin/x64"
  files:        { exclude:[glob], include:[glob] }
  proxyDetection: { sourceFile, candidates[], descriptionMatch, defaultTarget,
                    sourceByTarget: { "dxgi.dll": "alternatives/dxgi.dll", ... } }
                  // Klasik mod: TEK dosya (`sourceFile`) seçilen hedef adla kopyalanır.
                  // `sourceByTarget`: her hedef adın KENDİ binary'si vardır (yeniden
                  // adlandırma yoktur); anahtar = hedef ad, değer = arşiv/depo içi yol.
                  // Bu alan varsa `descriptionMatch` zorunlu değildir — sürüm kaynağı
                  // taşımayan DLL'lerde mevcut kurulum `state.injectionField`'den okunur.
  apiTargeting: { sourceByArch:{ x64, x86 },        // bit genişliğine göre kaynak dosya
                  renameByApi:{ d3d12:"dxgi.dll", d3d9:"d3d9.dll", ... },
                  defaultApi:"auto", allowUserOverride, backupExisting }
                  // Otomatik tespit exeApiDetector'dan; kullanıcı kurulum modalından değiştirebilir.
                  // Hedefte aynı adlı DLL varsa .bak olarak yedeklenir.
  extraSources: [ { id, url, fileName, extractTo, stripRoot, include[], skipIfExists } ]
                  // Ana arşivden bağımsız ek indirmeler (ör. ReShade shader paketi)
  detection:    { searchBase, strategy:"shallowest_directory", files[], fallback, allowManualPicker }
  whitelistFiles[], cleanStaleVersionFiles, refreshGameOnComplete, verifyAntiVirusDelayMs
config: [ { file, format:"ini"|"json", search[], required, createIfMissing,
            set:{"Section.Key":val}, schema:{...}, presets:{...} } ]
conditions: [ { type:"check_conflicts"|"file_exists"|"file_not_exists"|"gpu", ... } ]
backup:   { enabled, files[], strategy:"in_place_suffix", suffix, recordHashes, rollbackOnFailure }
uninstall:{ files[], verifiedDlls[], restoreBackup, resetState, cleanModOnlyFiles, gameUpdatedCheck,
            // verifiedDlls[]: { candidates[], descriptionMatch }  → açıklama doğrulamalı silme
            //                 { candidates[], matchModFileHash:true } → DLL'de FileDescription
            //                 yoksa: kurulu dosyanın hash'i indirilmiş mod dosyasıyla
            //                 birebir aynıysa silinir, oyunun kendi DLL'ine dokunulmaz
            userRemovable }   // false → Yönet ekranında "Modu Kaldır" butonu gizlenir,
                             // yalnızca sürüm değiştirilebilir (ör. streamline).
                             // Alan yoksa buton görünür (varsayılan true).
state:    { flag:"hasXxx", versionField, pathField, hashesField, modVersionField,
            injectionField,    // seçilen proxy DLL adı buraya yazılır
            upscalerField }    // games.json → upscalers.<alan> = true
wizard:   { type:"auto_test", title, logFolder,   // userData/logs/<logFolder>-wizard/
            autoTest:{ sourceFile, candidates[], watchFile,
            watchLocation, timeoutSeconds, checkProcessRunning, autoTerminateGame } }
detect:   { priority: 60,                  // büyükten küçüğe denenir, ilk eşleşen kazanır
            exclusiveGroup: "optiscaler-family",  // gruptan yalnızca en yüksek öncelikli tespit kalır
            depthStrategy: "shallowest"|"deepest",// deepest → daha derin klasör bulunursa üzerine yazar
            sticky: false,                        // true → tespit edilmezse mevcut state korunur
            enabled: true,
            match: { anyFileName:[...],           // doğrudan dosya adı
                     fileNamePattern: "sl.*.dll", // glob deseni
                     proxyDll:{ candidates[], descriptionMatch },  // proxy DLL + FileDescription
                     requireSiblingFile: "x.dll", // aynı klasörde bulunması gereken işaret
                     versionRange:{ min, max, allowUnknown } } }   // min dahil, max hariç
requires: [ { moduleId,                    // kurulum ÖNCESİ zorunlu olan modülün id'si
              severity: "block" (varsayılan) | "warn",
              message, messageKey,         // eksikse gösterilecek metin
              enabled } ]                  // false → koşul tamamen atlanır
          // Kontrol sırası: DİSK (modülün kendi detect.match'i) → games.json bayrağı.
          // "block": kurulum modalında buton kilitlenir + "Önce X'i Kur" butonu çıkar;
          //          motor da 5c adımında durdurur (indirme hiç başlamaz).
          // "warn":  yalnızca sarı uyarı satırı, kurulum engellenmez.
          // Aynı moduleId hem 'requires' hem 'addons' içinde olamaz (doğrulayıcı reddeder).
conflicts: [ { moduleId,                   // bu modülle AYNI ANDA kurulu olamayacak modül
              severity: "block" (varsayılan) | "warn",
              message, messageKey, enabled } ]
          // 'incompatible_mods' aynı şemanın takma adı; string dizisi de kabul edilir.
          // Kontrol sırası requires ile aynı: DİSK → games.json bayrağı.
          // "block": kurulum modalında buton kilitlenir, motor 5d adımında durur.
          // Alan hiç yoksa hiçbir kural işlemez (geriye dönük uyumlu).
          // Aynı moduleId hem 'requires' hem 'conflicts' içinde olamaz.
          // AYRICA bildirimden bağımsız DAHİLİ çakışma: kopyalama öncesi (adım 12e)
          // hedef dosyanın sahibi başka bir modülse .bak ALINMAZ, kurulum durur (adım 12e).
role:     "mod" (varsayılan) | "addon" | "both"
          // addon: yalnızca başka bir modun kurulum ekranında onay kutusu olarak çıkar
          // both:  hem mod listesinde tek başına kurulabilir hem de addon olarak referans verilebilir
addons:   [ { moduleId,                  // BAŞKA bir modülün id'si (repo tekrarlanmaz)
              label, labelKey, description, default,
              install: { destination:"game_exe"|"<alt klasör>",
                         files:{ include:[glob] }, renameTo },
              configChanges: { "Section.Key": value } } ]
permissions[], metadata:{ homepage, tags[], notes }
```

### 5.4 `moduleEngine.install()` — 18 adım

| # | Adım | % |
|---|---|---|
| 1 | Manifest doğrula | 5 |
| 2 | `conditions` kontrolü (yol-bağımsız) | 10 |
| 3 | Oyun çalışıyor mu? (çalışıyorsa hata) | 15 |
| 4 | `config.getGamePaths()` + `resolveActualGameRoot()` | 20 |
| 5 | `resolveDestinationDir()` | 25 |
| 5b | Yol-bağımlı `conditions` tekrar kontrolü | — |
| 5c | **`requires`** — ön koşul modülleri kurulu mu? (eksikse **indirme başlamadan** durur, hata `failures[]` taşır) | 27 |
| 5d | **`conflicts`** — bildirilmiş çakışan modül kurulu mu? (kuruluysa indirme başlamadan durur) | 27 |
| 5e | **`proxyDetection`** — enjeksiyon (proxy) DLL hedefini belirle. *Eskiden 12a idi*; `github_files` kaynağında indirilecek dosya seçime bağlı olduğu için indirmeden önceye alındı. Öncelik: kullanıcı seçimi > diskte tespit (`descriptionMatch`, yoksa `state.injectionField`) > `defaultTarget` | 27 |
| 5f | **Enjeksiyon çakışması ön-kontrolü** — seçilen proxy adı oyunun kendi dosyasıyla çakışıyorsa **indirme hiç başlamaz** (aynı kontrol 12e'de `apiTargeting` hedefi için tekrarlanır) | 27 |
| 6 | Sürüm belirle + yerel mod klasörü var mı? | 30 |
| 7–8 | GitHub release + asset çöz | 45 |
| 7b | **`github_files`**: asset yok — `source.files` + seçilen enjeksiyonun kaynak yolu raw üzerinden tek tek indirilir, arşiv çıkarma adımı (10) atlanır | 50–65 |
| 9 | İndir (yerel varsa atlanır) → kalıcı cache. `github_files`'ta "yerel var" demek yetmez: seçilen enjeksiyon DLL'i önbellekte yoksa yalnızca o dosya indirilir | 50–60 |
| 10 | Arşiv çıkar (`userData/mods/<modId>/<tag>/`) | 65 |
| 11 | `extractRoot` çöz (`auto` = tek kök klasörü içeri gir) | 70 |
| 12 | Backup pipeline (klasik veya `in_place_suffix`) | 75 |
| 12b | `cleanStaleVersionFiles` — eski sürüm artıkları | — |
| 12e | **Dahili çakışma** — hedef DLL başka bir V-Manager moduna aitse `.bak` alınmaz, kurulum durur. **Sahibi hiçbir modül değilse** (oyunun kendi dosyası) kurulum yine durur: *"Seçtiğiniz enjeksiyon tipi (X) oyunun içerisindeki dosyalarla çakışıyor. Lütfen farklı bir enjeksiyon tipi deneyin."* — `failures[0].type = 'injection_conflict'`. Sahiplik `detect` bloklarından bilinir; `detect` tanımlamayan manifestlerde ve `apiTargeting.backupExisting: true` olan manifestlerde (ör. ReShade) bu kontrol atlanır | — |
| 13 | Dosyaları kopyala | 80 |
| 13a | Enjeksiyon tipi değiştiyse eski proxy DLL'i kaldır (hash'i önbellekteki mod dosyasıyla birebir aynıysa; oyunun kendi DLL'ine dokunulmaz) | — |
| 13b | `verifyAntiVirusDelayMs` — AV silmiş mi kontrolü | 83 |
| 13c | **`addons`** — seçili eklentileri kur (hata ana kurulumu bozmaz) | 84 |
| 14 | `config` değişikliklerini uygula (`set` / preset / addon `configChanges`) | 85 |
| 15 | `games.json` state güncelle (`state.flag`, `versionField`) | 90 |
| 16–17 | Doğrula + temizlik | 95–99 |
| 18 | Bitti | 100 |

**Hata durumunda:** backup varsa otomatik rollback (`restoreBackup`).

**`uninstall()` sırası:** dosya silme (`uninstall.files`) → doğrulamalı DLL silme (`verifiedDlls`: FileDescription eşleşmesi ya da `matchModFileHash` ile indirilmiş dosyanın hash'i) → `.backup` / klasör yedeği geri yükleme → **`.bak` geri yükleme (adım 3b)** → state sıfırlama.
`.bak` dosyaları `apiTargeting` kurulumunda üzerine yazılan orijinal DLL'lerdir; ÖNCE mod dosyası silinir, SONRA `.bak` uzantısı kaldırılarak orijinal adıyla geri konur (ad çakışması olmasın diye).

---

## 6. IPC Kanal Haritası

> Kayıt: `src/main/ipc.js` → `registerIpcHandlers()` · Köprü: `preload.js` · Tüketim: `src/renderer/**`
> **Yeni kanal eklerken 3 yer:** `ipc.js` (handler) + `preload.js` (expose) + renderer çağrısı.

### 6.1 Uygulama & ayarlar
`get-app-version` · `get-settings` · `save-settings` · `get-system-info` · `log-to-main` · `open-external-link` · `get-system-drives`

### 6.2 Oyun kütüphanesi
`get-games` · `start-scan` (→ `game-found`, `scan-progress`, `scan-complete` event'leri) · `refresh-single-game` · `launch-game` · `add-manual-game` · `save-manual-game` · `remove-game` · `toggle-favorite` · `compare-versions`

### 6.3 Blacklist & özel klasörler
`get-blacklist` · `add-to-blacklist` · `remove-from-blacklist` · `get-custom-folders` · `save-custom-folders` · `get-custom-subfolders-list` · `save-custom-subfolders-list`

### 6.4 Çift katmanlı yol sistemi
`get-user-games` · `save-user-game` · `delete-user-game` · `get-developer-games` · `get-dlss-enabler-games` · `resolve-game-paths`

### 6.5 Eski nesil mod kanalları

| Mod | Kanallar |
|---|---|
| DLSS Enabler | `get-dlss-versions`, `execute-dlss-install`, `auto-install-dlss`, `dlss-parse-zip`, `dlss-install-from-zip`, `get-dlss-enabler-releases`, `download-dlss-enabler-release` |
| OptiScaler | `get-optiscaler-releases`, `download-optiscaler-release`, `install-optiscaler` |
| OptiBuilder | `get-optibuilder-releases`, `download-optibuilder-release`, `install-optibuilder`, `run-optibuilder-wizard`, `abort-optibuilder-wizard` |
| OptiPatcher | `get-optipatcher-releases`, `download-optipatcher-release` |
| FSR4 | `get-fsr4-releases`, `download-fsr4-release` |
| Streamline | `get-streamline-versions`, `check-streamline-backup`, `install-streamline`, `restore-streamline`, `get-streamline-releases`, `download-streamline-release` |
| Ortak | `uninstall-mod`, `select-exe`, `scan-folder-for-exes`, `delete-mod-version`, `open-mod-folder`, `read-mod-ini`, `write-mod-ini`, `mod-presets:read`, `mod-presets:write` |

**Sihirbaz kanalları:** `run-dlss-wizard` / `abort-dlss-wizard` · `run-opti-wizard` / `abort-opti-wizard` · `check-dx12-support` · `clear-wizard-logs` · `get-wizard-logs-info` · `open-wizard-logs-dir`

### 6.6 Manifest modül sistemi (`moduleManager.registerIpcHandlers`)
`module-list` · `module-get-info` · `module-get-active-for-game` · `module-install` · `module-uninstall` · `module-get-releases` · `module-download-release` · `module-check-conditions` · `module-list-backups` · `module-read-config` · `module-apply-config-changes` · `module-validate-manifest` · `module-save-manifest` · `module-delete-custom-manifest` · `module-wizard-run` · `module-wizard-abort` · `module-reload` · `module-detect-api` · `module-check-requirements` · `module-check-conflicts`

### 6.7 Sıkıştırma
`select-folder` · `analyze-folder` · `get-folder-game-info` · `run-compression` · `run-uncompression` · `get-compression-history` · `remove-history-entry` · `clear-compression-history`

### 6.8 Araçlar (winget)
`tools:get-status` · `tools:install` · `tools:uninstall` · `tools:upgrade` · `tools:launch`

### 6.8b VLSS5
`vlss5:get-status` · `vlss5:install` · `vlss5:launch` · `vlss5:set-dll` · `vlss5:pick-dll` · `vlss5:find-dll` · `vlss5:open-folder` · `vlss5:uninstall` · `vlss5:check-updates` · `vlss5:is-busy`

Event'ler (main → renderer):
- `vlss5-progress` → `{ phase, percent, text }`, `phase ∈ fetch|download|extract|install|done|error`
- `vlss5-update-event` → `{ type, version?, error?, errorCode? }`, `type ∈ started|repairing|closing-app|finished|failed|close-blocked`

### 6.9 Güncelleme & içerik
`check-for-updates-manual` · `start-update-download` · `quit-and-install` · `fetch-all-releases` · `fetch-youtube-videos` · `fetch-free-games`

### 6.10 Main → Renderer event'leri (tek yön)

| Event | Kaynak |
|---|---|
| `game-found`, `scan-progress`, `scan-complete` | scanner |
| `*-download-progress` (dlss-enabler / optiscaler / optibuilder / optipatcher / fsr4 / streamline / module) | ilgili mod |
| `compression-progress` | compressor |
| `wizard-log`, `opti-wizard-log`, `optibuilder-wizard-log`, `module-progress` | sihirbazlar |
| `update-checking/available/not-available/download-progress/downloaded/error` | updater |
| `show-close-warning`, `navigate-tab` | window / tray |
| `discord-rpc-error` | discord |
| `tools-operation-log` | toolsManager |

---

## 7. Renderer (`src/renderer/`)

### 7.1 Giriş & durum

| Dosya | Rol |
|---|---|
| `index.js` | `DOMContentLoaded` → i18n → tema/navigasyon → tüm `init*Listeners()` çağrıları → `initGames()`. **Yeni UI modülü eklerken buraya `init` satırı eklenecek** |
| `state.js` | Global mutable state: `currentSelectedGame`, `pending*`, `isScanning`, `gameSortMethod`, `gamesViewMode` |

### 7.2 Sekme bileşenleri (`src/renderer/ui/`)

| Dosya | Satır | Bağlı sekme / iş |
|---|---|---|
| `games.js` | 1453 | Oyun kartı + liste görünümü, filtre/sıralama, tekil yenileme, ana sayfa istatistikleri |
| `manifest-builder.js` | ~2490 | **Manifest Oluşturucu** (Modlar → alt sekme). Görsel şema/preset editörü, **Modül Rolü** (mod/addon) ve **Ek Bileşenler** editörü, canlı JSON önizleme, fork/kaydet |
| `compress.js` | 848 | Sıkıştır sekmesi (araçlar + geçmiş alt sekmeleri) |
| `updates-tab.js` | 625 | Güncellemeler sekmesi (GitHub release listesi + uygulama güncellemesi) |
| `mods-tab.js` | ~620 | Modlar sekmesi — **sol modül rayı (arama + tür rozeti + indirilmiş sayacı) + sağ sürüm paneli**, seçili modülün künyesi, indirme kuyruğu, cache rozeti. Ray `#mods-tabs-nav` id'sini koruyor (tıklama delegasyonu) |
| `tools.js` | 470 | Araçlar sekmesi (winget) |
| `settings.js` | 440 | Ayarlar sekmesi — kullanıcı oyunları, özel klasörler |
| `free-games.js` | 343 | Ücretsiz oyunlar (GamerPower API) |
| `blacklist.js` | 158 | Kara liste yönetimi + sayfalama |
| `videos.js` | 112 | YouTube RSS video listesi |
| `system-info.js` | 107 | Ana sayfa sistem bilgisi paneli |
| `navigation.js` | 92 | Sekme geçişi (`switchTab`) |
| `theme.js` | 30 | Dark/light tema (`data-theme` attr) |

### 7.3 Modallar (`src/renderer/ui/modals/`)

| Dosya | Satır | Modal |
|---|---|---|
| `settings.js` | 1446 | **Oyun başına mod ayarları** (INI şema formu, presetler) — `settings-modal` |
| `opti.js` | 680 | `optiscaler-modal` — OptiScaler kurulum (+OptiPatcher/FSR4) |
| `iniSchema.js` | 460 | ⚠️ Eski hardcoded INI şemaları (`DLSS_ENABLER_SCHEMA`, `OPTISCALER_*_KEYS`). Manifest'lere migrate edildi, geriye dönük kalıntı |
| `moduleInstall.js` | ~420 | `module-install-modal` — **manifest tabanlı genel kurulum modali**. Ortak yardımcılar: `resolveExeForGame()`, `getSelectedRelease()`, `getSelectedPreset()` |
| `streamline.js` | 380 | `streamline-modal` |
| `dlss.js` | 362 | `dlss-modal` |
| `optiBuilder.js` | 331 | `optibuilder-modal` |
| `dlssWizard.js` | ~285 | `dlss-wizard-modal` — canlı log terminali. **Tüm modüllerin sihirbazı buradan çalışır**; `moduleCtx` verilirse manifest motoru, verilmezse eski DLSS akışı |
| `exePicker.js` | 197 | `exe-picker-modal` — exe seçme |
| `optiWizard.js` | 183 | `opti-wizard-modal` |
| `base.js` | 180 | `openModal` / `closeModal` / `showNotification` + kapanma guard'ları |
| `dlssVersions.js` | 173 | `dlss-versions-modal` / `dlss-upload-modal` |
| `optiBuilderWizard.js` | 173 | `ob-wizard-modal` |
| `fsr4.js` | 162 | `fsr4-versions-modal` |
| `optiPatcher.js` | 158 | `optipatcher-versions-modal` |
| `info.js` | 155 | `info-modal`, `general-confirm-modal`, launcher uyarısı |
| `modSelection.js` | 150 | `mod-modal` — oyun için mod seçim ızgarası (`moduleList`'ten dinamik) |
| `cacheHelpers.js` | 96 | Release cache yaşı rozeti + `release-cache-warning-modal` |

### 7.4 Sekme ↔ dosya eşlemesi (`index.html`)

| `data-target` / id | Sekme | Renderer dosyası |
|---|---|---|
| `home` | Ana Sayfa | `system-info.js`, `games.js` (istatistik) |
| `games` | Oyunlar | `games.js`, `blacklist.js` |
| `modes` | Modlar (alt: `mods-sub-versions`, `mods-sub-builder`) | `mods-tab.js`, `manifest-builder.js` |
| `compress` | Sıkıştır (alt: `compress-tools`, `compress-history`) | `compress.js` |
| `updates` | Güncellemeler | `updates-tab.js` |
| `videos` | Videolar | `videos.js` |
| `tools` | Araçlar | `tools.js` |
| `free-games` | Ücretsiz Oyunlar | `free-games.js` |
| `settings-tab` | Ayarlar (alt: `settings-app`, `settings-game`, `settings-dev`) | `settings.js` |

### 7.5 i18n

- `src/renderer/i18n/i18n.js` — `t('nav.home')` nokta notasyonu, TR fallback, `localStorage['vmanager-lang']`, ilk açılışta sistem diline göre otomatik
- `tr.js` / `en.js` — **867'şer satır, 30 üst düzey grup**: `nav, header, lang, home, games, mods, updates, compress, settings, videos, scan, modModal, manualAdd, confirmModal, dlss, opti, streamline, update, modSettings, info, freeGames, tools, bugReport, releaseCache, systemInfo, wizard, optiBuilder, exePicker, modsTab, manifestBuilder`
- HTML'de: `data-i18n="key"`, `data-i18n-title="key"` → `applyTranslations()`
- ⚠️ **Yeni metin eklerken İKİ dosyaya da eklenecek**

---

## 8. Veri Dosyaları

### 8.1 `%APPDATA%/v-manager/` (userData)

| Yol | İçerik |
|---|---|
| `games.json` | **Ana oyun state dizisi** (şema aşağıda) |
| `user-games.json` | `{ "<norm-key>": { name, game_root, exe_path } }` — kullanıcı override'ları, EN YÜKSEK öncelik |
| `blacklist.json` | Gizlenen oyun adları dizisi |
| `settings.json` | `{ resolution, discordRpcEnabled, closeBehavior, systemInfo }` |
| `custom-folders.json` | Kullanıcının eklediği tarama klasörleri |
| `custom-subfolders-state.json` | `{ "<klasör yolu>": bool }` — alt klasör seçim durumu |
| `mod-presets.json` | `{ "<mod>": [presets] }` |
| `recent-games.json` | Son 4 oynanan oyun (tray menüsü) |
| `compression-history.json` | Sıkıştırma geçmişi |
| `license.dat` | `safeStorage` ile şifreli lisans |
| `covers/` | İndirilen kapak görselleri |
| `mods/<modId>/<tag>/` | İndirilip çıkarılmış mod dosyaları (kalıcı cache) |
| `modules/<id>/manifest.json` | Kullanıcının custom manifest'leri |
| `module-backups/<oyun>/<modId>/<timestamp>/` | Yedekler + `backup-meta.json` |
| `releases-cache/<modId>.json` | GitHub release cache (TTL 1 saat) |
| `logs/<mod>-wizard/` | Sihirbaz log dosyaları |
| `vlss5/` | **VLSS5 kurulum klasörü** — `VLSS5.exe`, `nvngx.dll_dlssnr.dll` (forwarder) + kullanıcının koyduğu `nvngx_dlssnr.dll` |
| `vlss5-state.json` | `{ installedVersion, installedTag, installedAt, assetName, exePath, dllAddedAt, pendingUpdate? }` — `pendingUpdate` yalnızca işlem sürerken var; zorla kapatma sonrası onarım işareti |
| `vlss5-update/` | Güncelleme staging'i — `<asset>.part` (yarım indirme), doğrulanmış `<asset>`, `extracted/`. Başarılı kurulumdan sonra boşaltılır |

### 8.2 `games.json` oyun nesnesi şeması

```jsonc
{
  "name": "Cyberpunk 2077",
  "exePath": "D:\\...\\Cyberpunk2077.exe",
  "gameRoot": "D:\\...\\Cyberpunk 2077",
  "cover": "file:///.../covers/cyberpunk_2077.jpg",
  "source": "steam|epic|xbox|gog|ea|ubisoft|registry|rockstar|manual",
  "launcherId": "1091500",
  "isFavorite": false,

  "hasDlssEnabler": true,  "dlssEnablerVersion": "...", "dlssEnablerPath": "...",
  "hasOptiscaler":  false, "optiscalerVersion": null,   "optiscalerPath": null, "optiscalerInjection": "dxgi.dll",
  "hasOptiBuilder": false, "optiBuilderVersion": null,  "optiBuilderPath": null, "optiBuilderInjection": null,
  "hasDlssNr":      false, "dlssNrVersion": null,       "dlssNrPath": null,     "dlssNrInjection": null,
  "hasDlssgSm86":   false, "dlssgSm86Version": null,    "dlssgSm86Path": null,  "dlssgSm86Injection": null,
  "hasStreamline":  false, "streamlineVersion": null,   "streamlinePath": null,
  "streamlineHashes": {},  "streamlineModVersion": null,

  "upscalers": { "dlss": true, "xess": false, "fsr": false,
                 "dlssEnabler": true, "optiscaler": false, "optibuilder": false, "streamline": false }
}
```

> `hasXxx` / `xxxVersion` alan adları manifest'teki `state.flag` / `state.versionField` ile eşleşir — yeni mod eklerken bu adlandırmayı koru.

### 8.3 Proje içi salt-okunur veri

| Dosya | Şema |
|---|---|
| `developer-games.json` | `{ "<norm-key>": { "exe_relative_path": "Bin/x64/Game.exe" } }` |
| `dlss_enabler_games.json` | Oyun adı → destek bilgisi |

---

## 9. Kritik Akışlar

### 9.1 Yol çözümleme (her mod kurulumunun temeli)

`config.getGamePaths(gameName, exePath)` öncelik sırası:
1. **`user-games.json`** → `source: 'user'` (kullanıcı manuel ayarladıysa her şeyi ezer)
2. Tarama + **`developer-games.json`** `exe_relative_path` → `source: 'scan+dev'` (fazla kök klasör temizleme heuristiği dahil)
3. Sadece tarama sonucu → `source: 'scan'`
4. `null`

`config.resolveActualGameRoot(gameName, chosenExePath)` — 8 kademeli heuristik: `dbGame.gameRoot` → Steam `steamapps/common/<oyun>` regex → Epic `.item` manifest → developer-games ters eşleme → userGames (şüpheli `Binaries/Win64` değilse) → `Binaries/Win64` gibi alt klasörleri soyma → dizin fallback → `path.dirname()`.
**Amaç:** `game_root` olarak yanlışlıkla `Binaries/Win64` kaydedilmesini engellemek.

### 9.2 Tarama (`scanner.runScan`)

```
coversOnly? → refreshMissingCovers() ve çık
games.json'u temizle
→ Steam (libraryfolders.vdf + .acf)
→ Epic (ProgramData/Epic/.../Manifests/*.item)
→ Xbox (GDK / AppsFolder)
→ Registry (GOG / EA / Ubisoft)
→ Manuel oyunlar (her zaman)
her oyun için: isIgnoredGame() → sürücü filtresi → blacklist →
               detectUpscalers() → kapak indir → upsert → 'game-found' event
→ Akıllı stale cleanup (yalnızca taranan sürücü+kaynak kapsamındakileri sil)
```

**5 kural** kod içinde yorumla işaretli: KURAL 1 coversOnly bypass, KURAL 2 kaynak filtresi, KURAL 3 launcher/redist blacklist, KURAL 4 sürücü filtresi, KURAL 5 akıllı stale cleanup.

`detectUpscalers()`: BFS, `MAX_DEPTH=12`, symlink atlar, `ignoreFolders` (data/shader/audio...) eler, `priorityFolders` (bin/binaries/x64...) önceliklendirir.

**Mod tespiti artık hardcoded değil** — `moduleDetector` üzerinden manifest'lerin `detect` bloğundan sürülür:

```
detectUpscalers() → { dlss, xess, fsr, detections: { <modulId>: { dir, injection, version, depth } } }
                     ↑ sabit dosya listeleri            ↑ moduleDetector.matchFile()
processAndStreamGame() → moduleDetector.applyDetections(game, detections)
                          → manifest.state.flag / versionField / pathField / injectionField / upscalerField
```

- Pahalı `getFileDescription`/`getFileVersion` çağrıları yalnızca `buildMatchPlan()`'ın topladığı dosya adlarında yapılır ve dosya başına cache'lenir.
- Öncelik: `detect.priority` (büyükten küçüğe) → tür (official > community > custom) → id. İlk eşleşen kazanır.
- `exclusiveGroup` (`optiscaler-family`): OptiScaler / OptiBuilder / DLSSNR aynı DLL'i paylaşır, taramanın sonunda gruptan yalnızca en yüksek öncelikli tespit bırakılır.
- Ayrımlar: OptiBuilder `versionRange.min = 0.10`, OptiScaler `versionRange.max = 0.10` (+`allowUnknown`), DLSSNR `requireSiblingFile = nvngx.dll_dlssnr.dll` (fork da FileDescription "OptiScaler" ve sürüm 10.x taşır).
- Streamline `depthStrategy: "deepest"` + `sticky: true` (tespit edilmezse mevcut state korunur).
- ✅ Yeni bir ana mod eklerken `scanner.js`'e dokunmaya gerek YOK — manifest'e `detect` + `state` yazmak yeterli.
- ⚠️ `dlss/xess/fsr` sinyalleri mod değil oyun yeteneğidir; onların dosya listeleri hâlâ `scanner.js` içinde sabittir.

### 9.3 "Mod Kur" akışı (uçtan uca)

```
Oyun kartı → ⚡ Mod Kur            games.js → openModModal()
   ↓
mod-modal (mod seçimi)            modSelection.js — moduleList() ile dinamik
   │  kart: kurulu mu? + 🧙‍♂️ "Oto kurulum" rozeti (manifest.wizard varsa)
   ↓ karta tıkla
module-install-modal              moduleInstall.js
   │  sürüm listesi  ← module-get-releases (+ cache rozeti)
   │  preset seçimi  ← manifest.config[].presets (applyPresetOnInstall izni varsa)
   │  proxy DLL      ← manifest.install.proxyDetection.candidates
   │  ek bileşenler  ← manifest.addons (onay kutuları, ör. OptiPatcher / FSR4)
   │  sihirbaz bölümü ← manifest.wizard varsa görünür
   ├─ "Kurulumu Başlat" → resolveExeForGame() → module-install → 18 adımlı pipeline
   └─ "Sihirbazı Başlat" → resolveExeForGame() → openWizardModal(..., moduleCtx)
                                    ↓
dlss-wizard-modal (canlı terminal)  dlssWizard.js
   manifest.wizard varsa → module-wizard-run  (moduleWizardEngine)
   yoksa                 → run-dlss-wizard     (eski dlssWizard.js)
   her iki motor da 'wizard-log' kanalına yazar → aynı UI
```

**Sihirbaz (auto-test) mantığı:** manifest `wizard.autoTest.candidates` sırasıyla
(varsayılan `version.dll → dxgi.dll → winmm.dll → dbghelp.dll → psapi.dll → winhttp.dll`) →
her denemede `sourceFile`'ı seçilen proxy adıyla kopyala → oyunu başlat →
`watchFile` oluşumunu `timeoutSeconds` (varsayılan 10 sn) izle →
oluştuysa preset uygula + `state.flag`/`versionField`/`pathField` yaz + oyunu sonlandır;
oluşmadıysa temizle, rollback, sonraki DLL'e geç.

`exePath` çözümü her iki yolda da ortak: `resolveGamePaths` → oyun kaydı → exe seçici modal.

### 9.3b VLSS5 otomatik güncelleme

```
Açılış (index.js → did-finish-load + 3 sn)
   └─ vlss5Manager.checkForUpdatesOnStartup()
        ├─ pendingUpdate / bozuk kurulum var mı?  → onar (install)
        │    └─ hiç kurulmamışken yarım kalan İLK kurulum → sadece temizle, kurma
        ├─ getStatus(forceRefresh) → hasUpdate?   → arka planda kur
        └─ yoksa çık

install() dayanıklılık zinciri:
   markPhase('start') → VLSS5.exe açık mı? → açıksa 'closing-app' yayını + taskkill
   → dosya kilidi testi → indir (<asset>.part) → boyut + arşiv imzası doğrula
   → atomik rename → çıkar → kopyala (kullanıcının nvngx_dlssnr.dll'i atlanır)
   → exe hâlâ yerinde mi (AV) → pendingUpdate sil + staging boşalt
```

- Her aşama `vlss5-state.json` → `pendingUpdate.phase` alanına yazılır; zorla kapatma sonrası bir sonraki açılış buradan devam eder.
- Doğrulanmış arşiv staging'de duruyorsa **tekrar indirilmez**; bozuksa atılıp yeniden indirilir.
- Kurulum sürerken pencere kapatılamaz (`window.js` → `vlss5Manager.isBusy()` → `vlss5-update-event { type:'close-blocked' }`). Kilit 5 dakikayla sınırlı — ağ takılırsa uygulama kilitli kalmaz.

### 9.4 Sıkıştırma

`compact.exe` (`cmd /c chcp 65001 >nul && compact.exe ...`) üzerinden `XPRESS4K/8K/16K/LZX`.
Sıkıştırma sürerken pencere kapatılamaz (`window.js` → `ipc.isCompressionRunning()` → `show-close-warning`).

### 9.5 Lisans

`license.js` — Ed25519, gömülü `PUBLIC_KEY_PEM`. Aktivasyon kodu: `base64url(payload).base64(signature)`, payload `{hwid, issuedAt, expiresAt}` (alan sırası `generator.js` ile birebir aynı olmalı).
⚠️ **`LICENSE_BYPASS = true`** (`src/main/license.js:29`) — şu an lisans kontrolü devre dışı, açılışta hep `activated: true` dönüyor.

### 9.6 Güncelleme

`electron-updater` → GitHub provider (`vuenxx/v-manager`). Tag push (`v*`) → `.github/workflows/release.yml` → `npm ci` + `npm run build` → Releases.

---

## 10. Dış Bağımlılıklar & Servisler

### Runtime paketleri

| Paket | Kullanım |
|---|---|
| `electron-updater` | Otomatik güncelleme |
| `electron-log` | Updater logları |
| `adm-zip`, `extract-zip` | Zip işlemleri |
| `7zip-bin` | `.7z` çıkarma |
| `node-unrar-js` | `.rar` (RAR4/RAR5) çıkarma — WASM, `asarUnpack` gerekir |
| `discord-rpc` | Rich Presence |
| `node-machine-id` | HWID |
| `bytenode` | `.jsc` bytecode yükleme |

### Dış servisler

| Servis | Kullanım |
|---|---|
| `api.github.com/repos/<repo>/releases` | Tüm mod sürüm listeleri + uygulama güncellemeleri |
| `www.steamgriddb.com` + `steamcdn-a.akamaihd.net` | Oyun kapakları (`STEAMGRID_API_KEY` `config.js`'de gömülü) |
| `www.youtube.com/feeds/videos.xml` | Videolar sekmesi (RSS) |
| `www.gamerpower.com/api/giveaways` | Ücretsiz oyunlar |
| `winget` (yerel CLI) | Araçlar sekmesi |

### Windows sistem bağımlılıkları

`compact.exe` · `powershell.exe` (GPU/sistem bilgisi, klasör analizi) · `reg` sorguları · `tasklist`/`taskkill` · Steam `libraryfolders.vdf`/`.acf` · Epic `Manifests/*.item` · `shell:AppsFolder` (Xbox)

---

## 11. Sık Yapılan İşler — Nereye Dokunulacak

| İş | Dokunulacak dosyalar |
|---|---|
| **Yeni IPC kanalı** | `src/main/ipc.js` (handler) → `preload.js` (expose) → ilgili renderer dosyası |
| **Yeni mod ekle (önerilen yol)** | Sadece `src/main/modules/official/<id>/manifest.json` — `ipc.js`'e de `scanner.js`'e de dokunmaya gerek yok (tespit için manifest'e `detect` + `state` yaz) |
| **Yeni mod ekle (eski yol)** | `src/main/mods/<mod>.js` + `ipc.js` + `preload.js` + `src/renderer/ui/modals/<mod>.js` + `index.html` modal + `styles.css` + i18n×2 |
| **Yeni UI sekmesi** | `index.html` (`nav-item` + `tab-content`) → `src/renderer/ui/<yeni>.js` → `src/renderer/index.js` (`init` çağrısı) → `styles.css` → `tr.js`+`en.js` |
| **Yeni modal** | `index.html` modal bloğu → `src/renderer/ui/modals/<yeni>.js` → `base.js`'in `openModal()`'ı → `index.js` init |
| **Yeni metin/çeviri** | `src/renderer/i18n/tr.js` **ve** `en.js` (aynı anahtar) |
| **Yeni userData dosyası** | `src/main/config.js` (getter + atomic write + `module.exports`) |
| **Tarama mantığı** | `src/main/scanner.js` (`runScan`, `detectUpscalers`, blacklist dizileri) |
| **Oyun yolu sorunu** | `src/main/config.js` → `getGamePaths()` / `resolveActualGameRoot()` |
| **Kurulum pipeline'ı** | `src/main/modules/core/moduleEngine.js` → `install()` |
| **Manifest alanı ekle** | `manifestValidator.js` (doğrulama) + `moduleEngine.js` (uygulama) + `manifest-builder.js` (UI) |
| **Yeni winget aracı** | `src/main/modules/tools/toolsManager.js` → `TOOLS_CATALOG` + i18n açıklama anahtarları |
| **VLSS5 davranışı** | `src/main/modules/vlss5/vlss5Manager.js` (mantık) + `src/renderer/ui/modals/vlss5.js` (UI durum makinesi) + `index.html` `#vlss5-modal` |
| **Stil** | `styles.css` — 9117 satır, bölüm yorumlarıyla ayrılmış; ilgili bölümü `grep "/\* Bölüm"` ile bul |

---

## 12. Dikkat Edilecek Tuzaklar

1. **İki paralel mod sistemi var** — `src/main/mods/*` (eski, hardcoded) ve `src/main/modules/*` (yeni, manifest). Yeni iş manifest tarafında yapılmalı; eski taraf hâlâ canlı IPC'lerle kullanılıyor, silinmedi.
2. **`iniSchema.js` kalıntı** — şemalar manifest'lere migrate edildi ama dosya duruyor; tek doğruluk kaynağı artık manifest.
3. **`preload.js` unutulmaz** — main'de handler yazıp preload'a eklemezsen renderer göremez.
4. **i18n çift dosya** — sadece `tr.js`'e eklersen EN'de metin eksik kalır (fallback TR'ye döner).
5. **`LICENSE_BYPASS = true`** — lisans akışını test ederken `false` yapman gerekir.
6. **`atomicWriteFile()` kullan** — `config.js`'deki tüm JSON yazımları temp+rename ile yapılıyor (M-16); yeni yazımlar da öyle olmalı.
7. **`games.json` tarama başında tamamen temizlenir** — mod state'leri `processAndStreamGame` içinde yeniden tespit edilerek doldurulur.
8. **Release cache TTL 1 saat** — "yenile" akışında `forceRefresh: true` geçilmeli; UI `cacheHelpers.js` ile yaş rozeti gösteriyor.
9. **Build `files` listesi kısıtlı** (`package.json` → `build.files`) — yeni kök dosya eklersen listeye de eklemelisin, yoksa pakete girmez.
10. **`tools/` gitignore'da** — `private.pem` asla commit edilmemeli.
11. **Mod tespiti manifest'te** — `detect` bloğu olmayan bir modül kurulduktan sonra tekrar taramada tanınmaz (`installedMods` kaydı yaşar ama `hasXxx` bayrağı yeniden yazılmaz). Yeni ana mod eklerken `detect` + `state` birlikte tanımlanmalı.
12. **Manifest Oluşturucu her alanı modellemiyor** — `detect`, `aliases`, `conditions`, `state` gibi bloklar form'da yok; fork/kaydet sırasında kaynaktan aynen taşınır (`buildManifestFromForm` → carry-over listesi). Yeni bir üst düzey alan eklerken bu listeye de bakılmalı.
13. **`node-unrar-js` WASM'ı asar'dan okunamaz** — `package.json` → `build.asarUnpack` içindeki `node_modules/node-unrar-js/**` satırı silinirse paketlenmiş sürümde RAR açma sessizce bozulur (dev'de çalışmaya devam eder). `rarExtractor._loadWasmBinary()` `app.asar.unpacked` yolunu da denediği için ikisi birlikte çalışmalı.
14. **VLSS5 kurulumu kullanıcının `nvngx_dlssnr.dll`'ini ezmez** — güncelleme sırasında hedefte aynı adlı dosya varsa kopyalama atlanır (`vlss5Manager.install` adım 6). Bu davranış bozulursa kullanıcı her güncellemede telifli dosyayı tekrar koymak zorunda kalır.
17. **Arşiv olmayan asset'ler olduğu gibi kopyalanır** — `.addon64`, `.asi` gibi tek dosyalık asset'lerde `archive.supportsFormat()` false döner ve dosya doğrudan mod dizinine kopyalanır (`moduleEngine` 10. adım). `extractRoot` bu dosyaları etkilemez; `install.whitelistFiles` ile hedefe ne kopyalanacağı yine de sınırlandırılmalıdır.
18. **ReShade.ini 0/1 bekler, `toggle` tipi true/false yazar** — ayarlar modalında `type: "toggle"` seçili kutuyu `true`/`false` olarak yazdırır. `[RenoDX.MFGUnlock]` gibi 0/1 bekleyen bölümlerde her boolean ayar `type: "dropdown"` + `val: "0"`/`"1"` olarak tanımlanmalıdır (test-requirements.js bunu doğruluyor).
19. **`conditions[].mod_installed` motora `gameState` geçirilmeden çalışmaz** — bu bağ artık kurulu (adım 2 ve 5b context'lerinde `gameState` var). Yine de modüller arası bağımlılık için tercih edilen yol bildirimsel `requires` alanıdır; `mod_installed` serbest biçimli kaçış kapısı olarak kalır.
15. **`apiTargeting` kullanan modüllerde tüm arşiv kopyalanmaz** — yalnızca seçilen mimarinin dosyası, API'ye uygun adla kopyalanır (`moduleEngine` 12d + 13. adım). Arşivdeki diğer dosyalar bilinçli olarak atlanır.
16. **Grafik API tespiti kesin değil, önceliklidir** — UE gibi motorlar DX11/DX12/OpenGL'i birlikte linkler. `exeApiDetector` puanlanmış liste döner ve kurulum modalı bunu **ön seçim** olarak gösterir; son söz kullanıcınındır. Bit genişliği (PE başlığı) ise kesindir.

---

## 13. Test

```bash
node src/main/modules/test-module-system.js
```

```bash
node src/main/modules/test-detector.js
```

```bash
node src/main/modules/test-vlss5.js
```

```bash
node src/main/modules/test-reshade.js
```

```bash
node src/main/modules/test-requirements.js
```

```bash
node src/main/modules/test-dlssg-sm86.js
```

```bash
node src/main/modules/test-e2e-dummy.js
```

```bash
node src/main/modules/test-e2e-dlssenabler.js
```

- Testler Electron bağlamı dışında çalışır; `electron` modülü mock'lanır.
- `test-data/` ve `test-data-dlss/` sahte oyun klasörlerini kullanırlar.
- Otomatik test runner (jest/vitest) **yok** — testler düz Node script'leri.
