// Ses kapısı AudioWorklet'i (v0.15.0, düzeltme turu 1).
// Sesle algılama (VAD) kararı ses iş parçacığında verilir: ana iş parçacığı arka planda yavaşlasa da
// (sekme arkada, oyun öndeyken zamanlayıcı kısılması) kapı gecikmeden açılıp kapanır.
//
// Girişler: 0 = ölçüm (HAM mikrofon sesi), 1 = gönderilecek ses (ön tampondan geçmiş). Çıkış: kapıdan geçen ses.
// Port iletileri (ana iş parçacığından): { izin, vad, esik, kapanmaSn, onTamponSn } (hepsi isteğe bağlı)
//   izin: susturulmamış / sağır değil (bas-konuşta ayrıca tuş basılı). false ise kapı her durumda kapalı.
//   vad : sesle algılama açık mı. Açıksa kapı = izin VE (seviye eşiği geçti ya da kapanma süresi dolmadı).
// Port iletisi (ana iş parçacığına): { tip: 'vad', acik } yalnız VAD durumu değişince.
// Bu dosya bağımsızdır (import yok): build'de olduğu gibi kopyalanır ve addModule ile yüklenir.

export const KAPI_ISLEMCI_ADI = 'voxen-kapi'
const PENCERE_BLOK = 8 // 8 x 128 = 1024 örnek (≈21 ms) üzerinden RMS: eski AnalyserNode ölçümüyle aynı pencere
const GECIS_SN = 0.005 // kazanç geçişi (çıt sesi olmasın)

// Saf mantık (testler doğrudan kullanır). blok(olcum, ses, cikis, zamanSn) her render quantum'unda çağrılır.
// Düzeltme turu 2:
//   - Gönderilen ses ön tampon (onTamponSn) kadar geriden gelir. Kapı kararı ise gecikmesiz sesle verilir. Bu yüzden
//     kapanma koşulu "kapanma süresi + ön tampon"dur; yoksa kelime sonu ön tampon kadar kısalırdı.
//   - İzin false -> true olunca (susturma/sağırlık kalktı) kapı, ön tampon süresi dolana kadar kapalı kalır.
//     Gecikme hattında susturulmuşken söylenen ses vardır; o gitmemeli. Ön tampon değişince de aynı şekilde
//     (eski ve yeni sürenin büyüğü kadar) beklenir: gecikmenin ani değişimi çıt ya da yineleme olarak duyulmasın.
//   - Kapı kapalı (izin = false) başlar; açmak için açıkça izin verilmelidir.
export class KapiMantigi {
  constructor({ ornekHizi = 48000, bildir = () => {} } = {}) {
    this.ornekHizi = ornekHizi
    this.bildir = bildir
    this.izin = false
    this.vad = false
    this.esik = 0.02
    this.kapanmaSn = 0.7
    this.onTamponSn = 0
    this.acik = false // VAD durumu
    this.sonYuksek = -Infinity
    this.simdi = 0 // son işlenen bloğun zamanı
    this.tutmaBitis = -Infinity // bu zamana kadar kapı zorla kapalı (Ö2)
    this.kazanc = 0
    this.enerjiler = new Float64Array(PENCERE_BLOK)
    this.sira = 0
    this.adim = 1 - Math.exp(-1 / (GECIS_SN * ornekHizi))
  }

  ayarla(a = {}) {
    if (typeof a.onTamponSn === 'number' && Number.isFinite(a.onTamponSn)) {
      const yeni = Math.max(0, a.onTamponSn)
      if (yeni !== this.onTamponSn) {
        this.tutmaBitis = Math.max(this.tutmaBitis, this.simdi + Math.max(yeni, this.onTamponSn))
        this.onTamponSn = yeni
      }
    }
    if (typeof a.izin === 'boolean') {
      if (a.izin && !this.izin) this.tutmaBitis = Math.max(this.tutmaBitis, this.simdi + this.onTamponSn)
      this.izin = a.izin
    }
    if (typeof a.esik === 'number' && Number.isFinite(a.esik)) this.esik = a.esik
    if (typeof a.kapanmaSn === 'number' && Number.isFinite(a.kapanmaSn)) this.kapanmaSn = Math.max(0, a.kapanmaSn)
    if (typeof a.vad === 'boolean' && a.vad !== this.vad) {
      this.vad = a.vad
      if (!this.vad && this.acik) { this.acik = false; this.bildir(false) }
    }
  }

  // Son ~21 ms'nin RMS seviyesi
  seviye() {
    let t = 0
    for (const e of this.enerjiler) t += e
    return Math.sqrt(t / PENCERE_BLOK)
  }

  hedef() {
    if (!this.izin || this.simdi < this.tutmaBitis) return 0
    return !this.vad || this.acik ? 1 : 0
  }

  blok(olcum, ses, cikis, zamanSn) {
    this.simdi = zamanSn
    let e = 0
    const n = olcum?.length ?? 0
    for (let i = 0; i < n; i++) e += olcum[i] * olcum[i]
    this.enerjiler[this.sira] = n ? e / n : 0
    this.sira = (this.sira + 1) % PENCERE_BLOK
    if (this.vad) {
      if (this.seviye() >= this.esik) {
        this.sonYuksek = zamanSn
        if (!this.acik) { this.acik = true; this.bildir(true) }
      } else if (this.acik && zamanSn - this.sonYuksek >= this.kapanmaSn + this.onTamponSn) {
        this.acik = false
        this.bildir(false)
      }
    }
    if (!cikis) return
    const hedef = this.hedef()
    for (let i = 0; i < cikis.length; i++) {
      this.kazanc += (hedef - this.kazanc) * this.adim
      cikis[i] = (ses ? ses[i] ?? 0 : 0) * this.kazanc
    }
  }
}

/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentTime */
if (typeof AudioWorkletProcessor !== 'undefined' && typeof registerProcessor === 'function') {
  class KapiIslemci extends AudioWorkletProcessor {
    constructor() {
      super()
      this.mantik = new KapiMantigi({ ornekHizi: sampleRate, bildir: (acik) => this.port.postMessage({ tip: 'vad', acik }) })
      this.port.onmessage = (e) => this.mantik.ayarla(e.data)
    }

    process(inputs, outputs) {
      this.mantik.blok(inputs[0]?.[0], inputs[1]?.[0], outputs[0]?.[0], currentTime)
      return true
    }
  }
  registerProcessor(KAPI_ISLEMCI_ADI, KapiIslemci)
}
