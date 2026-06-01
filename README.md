# 🎮 V-Manager
> **vuenxx** tarafından geliştirilen, oyun kütüphanenizi yönetmenizi, performans artırıcı grafik modlarını kurmanızı ve oyunlarınızı sıkıştırarak disk alanından tasarruf etmenizi sağlayan hepsi bir arada Windows masaüstü yardımcısı.

<p align="center">
  <img src="program_logo.png" alt="V-Manager Logo" width="128" height="128" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows-blue?style=for-the-badge&logo=windows" alt="Platform: Windows" />
  <img src="https://img.shields.io/badge/Framework-Electron-activegreen?style=for-the-badge&logo=electron" alt="Framework: Electron" />
  <img src="https://img.shields.io/badge/License-ISC-orange?style=for-the-badge" alt="License: ISC" />
  <img src="https://img.shields.io/badge/Version-0.0.1-red?style=for-the-badge" alt="Version: 0.x.x" />
</p>

---

## 🌟 Öne Çıkan Özellikler

V-Manager, modern oyuncuların ihtiyaç duyduğu mod yönetimi, disk alanı tasarrufu ve oyun keşfi gibi birçok güçlü aracı tek bir çatı altında birleştirir:

*   🔍 **Gelişmiş Oyun Tarama:** **Steam**, **Epic Games**, **GOG Galaxy**, **Xbox**, **EA App** ve **Ubisoft Connect** platformlarındaki oyunları otomatik olarak algılar. Ayrıca Windows Kayıt Defteri (Registry) ve manuel tanımlanan klasörleri de tarayabilir.
*   🖼️ **Otomatik Kapak Görseli:** Bulunan oyunlar için **SteamGrid DB API** kullanarak otomatik olarak kapak görsellerini indirir ve şık bir oyun kütüphanesi oluşturur.
*   ⚡ **Tek Tıkla Grafik Modu Kurulumu:** Oyunlarınıza DLSS Enabler, OptiScaler ve Streamline gibi performans artıran ve kare oluşturma (Frame Generation) sağlayan modları güvenli bir şekilde kurar ve yönetir.
*   💾 **Akıllı Oyun Sıkıştırma:** Windows'un yerleşik sıkıştırma algoritmalarını (**XPRESS 4K/8K/16K ve LZX**) kullanarak oyun klasörlerinizi sıkıştırır. Oyunlar oynanabilir kalırken diskte devasa alan açılır!
*   📺 **YouTube Entegrasyonu:** Grafik modlarının kurulum rehberlerini ve en yeni oyun videolarını doğrudan uygulama içerisindeki "Videolar" sekmesinden izlemenizi sağlar.
*   🎨 **Premium Arayüz & Karanlık Tema:** Kullanıcı dostu, modern animasyonlara sahip, `Plus Jakarta Sans` yazı tipiyle tasarlanmış göz yormayan karanlık tema.

---

## 🛠️ Desteklenen Grafik Modları

V-Manager, günümüzün en popüler upscaler ve kare oluşturma modlarının yönetimini basitleştirir:

| Mod Adı | Açıklama | V-Manager Entegrasyonu |
| :--- | :--- | :--- |
| **DLSS Enabler** | NVIDIA RTX olmayan ekran kartlarında dahi Multi Frame Generation (Kare Oluşturma) özelliğini aktif hale getirir. | Yerel sürümleri listeleme, otomatik ve manuel kurulum, güvenli kaldırma ve enjeksiyon kontrolü. |
| **OptiScaler** | DLSS/FSR/XeSS arasında köprü kuran açık kaynaklı ölçeklendirme aracı. | GitHub Releases API üzerinden en güncel sürümleri çekme, otomatik `.7z` indirme, ayıklama ve kurma. |
| **Streamline** | NVIDIA'nın Streamline SDK kütüphanelerini yönetir. | Derinlemesine arama (BFS) ile `sl.*.dll` konumunu bulma, güncellemelere karşı yedekleme ve hash doğrulamalı geri yükleme. |
| **OptiPatcher** | OptiScaler için ek uyumluluk ve stabilite yamaları sağlar. | GitHub üzerinden otomatik sürüm kontrolü ve kurulum desteği. |
| **FSR4 Dosyaları** | FSR4 mod kütüphaneleri için gerekli dosyaları barındırır. | Harici indirme sunucusundan son sürüm dosyalarını çekebilme imkanı. |

---

## 🗜️ Disk Alanından Tasarruf: Akıllı Sıkıştırma

Uygulamanın **Sıkıştır** sekmesi altında, Windows'un Compact OS teknolojisini kullanarak klasörleri sıkıştırabilirsiniz:

*   **XPRESS 4K:** Hızlı sıkıştırma, düşük işlemci kullanımı (Ortalama %21 sıkıştırma oranı).
*   **XPRESS 8K / 16K:** Dengeli ve yüksek sıkıştırma oranları.
*   **LZX:** Maksimum sıkıştırma oranı (Yüksek işlemci gücü gerektirir, arşiv veya büyük oyunlar için idealdir).
*   **Topluluk Veritabanı (Compression DB):** Hangi oyunun hangi yöntemle ne kadar sıkıştığına dair topluluk verilerini inceleyerek en doğru kararı verin.
---

## 🚀 Geliştiriciler İçin Kurulum

Projeyi yerel bilgisayarınızda çalıştırmak veya geliştirmek için aşağıdaki adımları takip edebilirsiniz:

### Gereksinimler
*   [Node.js](https://nodejs.org/) (v18 veya daha yeni bir sürüm önerilir)
*   Windows İşletim Sistemi (Modların ve sıkıştırma araçlarının çalışabilmesi için gereklidir)

### Adımlar
1.  **Projeyi Klonlayın:**
    ```bash
    git clone https://github.com/vuenxx/v-manager.git
    cd v-manager
    ```

2.  **Bağımlılıkları Yükleyin:**
    ```bash
    npm install
    ```

3.  **Uygulamayı Geliştirici Modunda Başlatın:**
    ```bash
    npm start
    ```

4.  **Uygulamayı Derleyin (Production Release):**
    ```bash
    npm run build
    ```
    *Bu komut, Windows (`x64`) için kurulabilir bir `.exe` yükleyicisi (NSIS) oluşturur ve `dist/` klasörüne kaydeder.*

---

## 📂 Proje Yapısı

Uygulamanın temel modülleri ve görevleri şu şekildedir:

```text
├── main.js                 # Electron ana süreci (bootstrap)
├── preload.js              # Güvenli IPC köprüsü (Main ↔ Renderer)
├── index.html              # Kullanıcı arayüzü HTML yapısı
├── styles.css              # Premium modern CSS tasarımı
├── src/                    # Uygulama kaynak kodları
│   └── main/
│       ├── config.js       # Yapılandırma, oyun listesi ve yollar
│       ├── ipc.js          # IPC iletişim kanalları (Main handlers)
│       ├── scanner.js      # Çoklu platform oyun tarayıcısı
│       ├── utils.js        # Dosya hash, sürüm okuma ve API araçları
│       └── window.js       # BrowserWindow yönetim modülü
├── mods/                   # Mod yükleme ve kaldırma mantıkları
│       ├── dlssEnabler.js  # DLSS Enabler yönetimi
│       ├── optiScaler.js   # OptiScaler otomatik indirici & kurucu
│       ├── streamline.js   # Streamline yedekleme ve güncelleme sistemi
│       ├── uninstaller.js  # Güvenli mod kaldırma modülü
│       └── compressor.js   # Sıkıştırma motoru
└── package.json            # Proje bağımlılıkları ve scriptler
```

---

## 🔑 Lisans ve Katkıda Bulunma

Bu proje **ISC Lisansı** altında lisanslanmıştır. Katkıda bulunmak için lütfen bir Pull Request (PR) açın veya karşılaştığınız hataları Issues sekmesinden bildirin.

---
<p align="center">Made with ❤️ by <a href="https://github.com/vuenxx">vuenxx</a></p>
