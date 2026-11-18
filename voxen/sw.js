// Voxen service worker (v0.24.0, D85/D86). Yalnız web'de ve üretim derlemesinde kaydedilir (src/pwa.js).
//
// Önbellek: YALNIZ uygulama kabuğu (index, giriş js/css, simgeler, manifest). Supabase'e, başka kökene ve API yollarına
// hiç dokunulmaz. Önbellek adı her derlemede değişir (npm run build yer tutucuları doldurur: scripts/pwa-lib.mjs);
// yeni sürüm etkinleşince "voxen-kabuk-" önekli eski önbellekler silinir.
// DeepFilterNet (v0.29.2): /dfn/ altındaki ≈19 MB'lık dosyalar sürümden bağımsız "voxen-dfn-v3c" önbelleğinde durur
// (her yayında yeniden inmesin). Önceden indirilmez: yalnız uygulama ilk kez istediğinde (bilgisayarda Güçlü) dolar.
// Push: gelen bildirimi gösterir; tıklanınca açık Voxen penceresine hedefi yollar ya da yeni pencere açar.
/* eslint-env serviceworker */
const SURUM = "0.29.7-563118d329"
const KABUK = ["/","/apple-touch-icon.png","/assets/index-BCUTpvlt.js","/assets/index-DHj3RqhU.css","/favicon-okunmamis.svg","/favicon.svg","/index.html","/manifest.webmanifest","/simge-192.png","/simge-512.png"]
const ONEK = 'voxen-kabuk-'
const ONBELLEK = ONEK + SURUM
const DFN_ONEK = 'voxen-dfn-'
// DFN_SURUM hem dosya klasörü (dfn/v3c/) hem önbellek adıdır; src/voice/dfn.js DFN_SURUM ile aynı olmalı (testli).
// Derleme değişince ikisi birlikte değişir: tarayıcının HTTP önbelleğindeki eski wasm yeni yapıştırıcıyla karışmaz.
// v3b (v0.29.3): wasm kendi derlememiz. v3c (v0.29.3 son tur): aynı wasm, name/producers bölümleri atıldı.
// Eski 'voxen-dfn-v3' ve 'voxen-dfn-v3b' etkinleşmede silinir.
const DFN_SURUM = 'v3c'
const DFN_ONBELLEK = DFN_ONEK + DFN_SURUM
// Taban yol: kökte '/' (pages.dev), yedek adreste '/voxen/' (GitHub Pages). Kabuk listesi köke göre yazılır,
// burada tabana taşınır.
const TABAN = (() => { try { return new URL(self.registration.scope).pathname } catch { return '/' } })()
const yol = (p) => TABAN + String(p).replace(/^\//, '')
const KABUK_YOL = KABUK.map(yol)
const SIMGE = yol('simge-192.png')
// Aynı kökende olsa da asla önbelleğe alınmayan yollar (ileride bir vekil eklenirse diye)
const API_YOLU = /^\/(rest|auth|realtime|storage|functions|graphql)\//

self.addEventListener('install', (olay) => {
  olay.waitUntil(
    caches.open(ONBELLEK)
      .then((c) => c.addAll(KABUK.filter((x) => x !== '__VOXEN_KABUK__').map(yol)))
      .catch(() => {}), // kabuk alınamazsa da kurulsun (ağdan çalışır)
    // v0.29.4: yeni sürüm kendiliğinden devralmaz, "waiting"de bekler; sayfa "Yeni sürüm hazır" bildirimini gösterir,
    // kullanıcı "Yenile"ye basınca aşağıdaki iletiyle devralır (src/pwa.js swGuncellemeyiIzle). İlk kurulumda
    // bekleyecek eski sürüm olmadığı için hemen etkinleşir.
  )
})

// Sayfadan "şimdi devral" (yalnız bu ileti; başka hiçbir şey kabul edilmez)
self.addEventListener('message', (olay) => {
  if (olay.data && olay.data.tur === 'voxen-skip-waiting') self.skipWaiting()
})

self.addEventListener('activate', (olay) => {
  olay.waitUntil(
    caches.keys()
      .then((adlar) => Promise.all(adlar.filter((a) => (a.startsWith(ONEK) && a !== ONBELLEK) || (a.startsWith(DFN_ONEK) && a !== DFN_ONBELLEK))
        .map((a) => caches.delete(a))))
      .then(() => self.clients.claim()),
  )
})

// İstek bu service worker'ın işi mi? Yalnız aynı kökenden GET ve API olmayan yol.
function bizimMi(istek) {
  if (istek.method !== 'GET') return false
  let url
  try { url = new URL(istek.url) } catch { return false }
  if (url.origin !== self.location.origin) return false // Supabase, GIPHY, depolama: hiç dokunulmaz
  if (API_YOLU.test(url.pathname)) return false
  return true
}

self.addEventListener('fetch', (olay) => {
  const istek = olay.request
  if (!bizimMi(istek)) return
  const url = new URL(istek.url)
  if (istek.mode === 'navigate') {
    // Sayfa: önce ağ (yeni sürüm hemen gelsin), ağ yoksa önbellekteki kabuk
    olay.respondWith(fetch(istek).catch(() => caches.match(yol('index.html')).then((y) => y || Response.error())))
    return
  }
  if (url.pathname.startsWith(yol('dfn/'))) {
    // DeepFilterNet dosyaları: önce ayrı önbellek; yoksa ağdan alınıp yazılır (HTML ya da hatalı cevap yazılmaz)
    olay.respondWith(caches.open(DFN_ONBELLEK).then((c) => c.match(istek).then((y) => y || fetch(istek).then((cevap) => {
      const tur = cevap.headers && cevap.headers.get ? cevap.headers.get('content-type') || '' : ''
      // 15 MB'lık yazma bitene kadar SW yaşasın; kota dolarsa yutulur (bir dahaki sefer ağdan gelir)
      if (cevap.ok && !tur.includes('text/html')) olay.waitUntil(c.put(istek, cevap.clone()).catch(() => {}))
      return cevap
    }))))
    return
  }
  if (url.pathname.startsWith(yol('assets/')) || KABUK_YOL.includes(url.pathname)) {
    // Değişmeyen dosyalar (adında özet var) ve simgeler: önce önbellek
    olay.respondWith(caches.open(ONBELLEK).then((c) => c.match(istek).then((y) => y || fetch(istek).then((cevap) => {
      // Silinmiş eski dosya _redirects yüzünden index.html (200) dönebilir: HTML önbelleğe yazılmaz
      const tur = cevap.headers && cevap.headers.get ? cevap.headers.get('content-type') || '' : ''
      if (cevap.ok && url.pathname.startsWith(yol('assets/')) && !tur.includes('text/html')) olay.waitUntil(c.put(istek, cevap.clone()).catch(() => {}))
      return cevap
    }))))
  }
})

// ---- Push ----
function veriOku(olay) {
  try { return olay.data ? olay.data.json() : null } catch { return null }
}

self.addEventListener('push', (olay) => {
  const v = veriOku(olay) || {}
  const baslik = typeof v.baslik === 'string' && v.baslik ? v.baslik : 'Voxen'
  olay.waitUntil(self.registration.showNotification(baslik, {
    body: typeof v.govde === 'string' ? v.govde : '',
    tag: typeof v.etiket === 'string' ? v.etiket : undefined, // sayfa bildirimiyle aynı etiket: tek bildirim
    renotify: typeof v.etiket === 'string',
    icon: SIMGE,
    data: { ac: v.ac || null },
  }))
})

self.addEventListener('notificationclick', (olay) => {
  olay.notification.close()
  const ac = olay.notification.data && olay.notification.data.ac
  olay.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((pencereler) => {
    const acik = pencereler.find((p) => new URL(p.url).origin === self.location.origin)
    if (acik) {
      if (ac) acik.postMessage({ tur: 'voxen-bildirim', ac })
      return acik.focus()
    }
    return self.clients.openWindow(ac ? TABAN + '#/bildirim/' + encodeURIComponent(JSON.stringify(ac)) : TABAN)
  }))
})
