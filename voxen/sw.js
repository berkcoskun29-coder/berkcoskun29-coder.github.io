// Voxen service worker (v0.24.0, D85/D86). Yalnız web'de ve üretim derlemesinde kaydedilir (src/pwa.js).
//
// Önbellek: YALNIZ uygulama kabuğu (index, giriş js/css, simgeler, manifest). Supabase'e, başka kökene ve API yollarına
// hiç dokunulmaz. Önbellek adı her derlemede değişir (npm run build yer tutucuları doldurur: scripts/pwa-lib.mjs);
// yeni sürüm etkinleşince "voxen-kabuk-" önekli eski önbellekler silinir.
// Push: gelen bildirimi gösterir; tıklanınca açık Voxen penceresine hedefi yollar ya da yeni pencere açar.
/* eslint-env serviceworker */
const SURUM = "0.29.2-457d41d00e"
const KABUK = ["/","/apple-touch-icon.png","/assets/index-C8Niy18n.js","/assets/index-nLvoYXzS.css","/favicon-okunmamis.svg","/favicon.svg","/index.html","/manifest.webmanifest","/simge-192.png","/simge-512.png"]
const ONEK = 'voxen-kabuk-'
const ONBELLEK = ONEK + SURUM
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
      .catch(() => {}) // kabuk alınamazsa da kurulsun (ağdan çalışır)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (olay) => {
  olay.waitUntil(
    caches.keys()
      .then((adlar) => Promise.all(adlar.filter((a) => a.startsWith(ONEK) && a !== ONBELLEK).map((a) => caches.delete(a))))
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
  if (url.pathname.startsWith(yol('assets/')) || KABUK_YOL.includes(url.pathname)) {
    // Değişmeyen dosyalar (adında özet var) ve simgeler: önce önbellek
    olay.respondWith(caches.open(ONBELLEK).then((c) => c.match(istek).then((y) => y || fetch(istek).then((cevap) => {
      // Silinmiş eski dosya _redirects yüzünden index.html (200) dönebilir: HTML önbelleğe yazılmaz
      const tur = cevap.headers && cevap.headers.get ? cevap.headers.get('content-type') || '' : ''
      if (cevap.ok && url.pathname.startsWith(yol('assets/')) && !tur.includes('text/html')) c.put(istek, cevap.clone())
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
