# Codex Telegram Gateway

Tek Telegram botundan birden fazla yerel Codex projesini seçip soru sormak veya görev vermek için bağımsız gateway.

## İlk kurulum

1. Telegram'da `@BotFather` açın ve `/newbot` ile bot oluşturun.
2. `.env.example` dosyasını `.env` adıyla kopyalayın.
3. BotFather tokenını `TELEGRAM_BOT_TOKEN` alanına yazın.
4. İlk çalıştırmada bota `/whoami` yazın.
5. Dönen sayısal ID'yi `TELEGRAM_ALLOWED_USER_IDS` alanına yazın ve gateway'i yeniden başlatın.

```powershell
npm install
npm run check
npm run dev
```

Windows'ta `CODEX_BIN=codex` bırakıldığında Gateway, Codex masaüstü uygulamasının resmi ve sürümlü kurulum klasörlerini tarar. Masaüstü uygulamasının sürüm klasörü değişse bile en güncel `codex.exe` otomatik seçilir. Böylece `spawn codex ENOENT` hatasını çözmek için `.env` içine sürüme bağlı mutlak bir yol yazmak gerekmez.

## Komutlar

- `/projects`: Kayıtlı yerel projeleri listeler.
- `/ping`: Botun çalıştığını ve komut alabildiğini doğrular.
- `/sync`: İzin verilen ana klasörlerde yeni projeleri tarar.
- `/current`: Aktif projeyi gösterir.
- `/threads`: Aktif projedeki mevcut Codex görevlerinden birini seçip ona bağlanır.
- `/latest`: Aktif projedeki en son Codex görevine bağlanır.
- `/new`: Aktif projede yeni Codex görevi başlatır.
- `/ask <soru>`: Salt okunur sandbox ile soru sorar.
- `/do <talimat>`: Yalnızca aktif proje klasöründe yazma izniyle görev çalıştırır.
- `/status`: Aktif görevin isteğini, çalışma süresini ve son Telegram görevinin durumunu gösterir.
- `/stop`: Aktif görevi durdurur.

## Güvenlik

- `.env` ve oturum verileri Git'e alınmaz.
- Yalnızca `TELEGRAM_ALLOWED_USER_IDS` içindeki kullanıcılar komut çalıştırabilir.
- Proje yolları `config/projects.json` allowlist dosyasından gelir.
- Başlangıçta ve her `/projects` çağrısında otomatik keşif çalışır.
- Otomatik keşif yalnızca `PROJECT_ROOTS` altındaki klasörleri tarar.
- `/ask` salt okunurdur.
- `/do` sadece seçili proje klasörüne yazabilir; tam erişim kullanılmaz.
- App Server dış ağa port açmadan yerel `stdio` üzerinden çalışır.

## İki yönlü çalışma

Proje seçildiğinde gateway o projenin en son Codex görevine bağlanır. `/threads` ile başka bir mevcut görevi seçebilir, `/latest` ile yeniden en son göreve dönebilirsiniz. Telegram komutları bu görev geçmişine eklenir ve Codex uygulamasında görünür.

Codex masaüstünde açık bir görev aynı anda başka bir süreç tarafından doğrudan yazılamaz. Böyle bir görev seçildiğinde gateway otomatik olarak `thread/fork` kullanır: geçmişi kopyalayan, aynı proje klasöründe görünen yeni bir Telegram dalı açar ve komutu orada çalıştırır.

Gateway, kayıtlı yerel projelerdeki masaüstü Codex görevlerini salt okunur `thread/read` çağrılarıyla izler. Yeni bir turun tamamlandığını gördüğünde proje adını, isteği ve son Codex mesajını Telegram'a gönderir. Gateway'in kendi başlattığı tur kimlikleri kalıcı olarak kaydedilir ve ikinci kez masaüstü bildirimi gibi gönderilmez. İzleme aralığı varsayılan olarak 5 saniyedir ve `DESKTOP_MONITOR_INTERVAL_MS` ile değiştirilebilir.

Bot, zaman alan komutları alır almaz bir bekleme mesajı gönderir. Telegram'da gönderilmiş bir komut sonradan düzenlenirse özellikle yazma işlemlerinin iki kez çalışmasını önlemek için otomatik olarak yeniden yürütülmez; bot komutun yeni mesaj olarak gönderilmesini ister.

## Not

Bu sürüm yerel klasörü bulunan Codex projelerini destekler. ChatGPT bulut projeleri yerel `cwd` sunmadığı için bu kayıt listesine dahil değildir.

## Otomatik proje keşfi

Varsayılan tarama kökleri:

```text
C:\Users\ercan\Desktop
C:\Users\ercan\Documents\ChatGPT
```

Gateway; `.git`, `.codex`, `AGENTS.md`, `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `.sln` ve benzeri proje işaretlerini arar. `node_modules`, build/çıktı klasörleri ve gateway'in kendi klasörü atlanır. Yeni bulunan klasörler `config/projects.json` dosyasına eklenir. Tarama kökleri `.env` içindeki `PROJECT_ROOTS`, derinlik ise `PROJECT_SCAN_MAX_DEPTH` ile değiştirilebilir.

Güvenlik ve gereksiz alt paketleri önlemek için yeni projeler varsayılan olarak tarama kökünün yalnızca doğrudan altında (`PROJECT_AUTO_ADD_DEPTH=1`) otomatik eklenir. Kayıtlı fakat taşınmış bir proje, daha derin taramada adı tek bir klasörle eşleşirse otomatik olarak yeni konumuna bağlanır. Yeni projeleri bir alt klasör grubu altında tutuyorsanız o grup klasörünü `PROJECT_ROOTS` listesine eklemek en güvenli yöntemdir.
