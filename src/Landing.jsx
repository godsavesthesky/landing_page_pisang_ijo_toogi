import { useEffect, useRef, useState } from 'react'
import { sb } from './lib.js'

const BUCKET = 'kedai-gallery'
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/webm']
const SOCIALS = [
  { name: 'Instagram', url: 'https://www.instagram.com/kedai.toogi/?hl=nb', label: '@kedai.toogi' },
  { name: 'TikTok', url: 'https://www.tiktok.com/@kedai.toogi', label: '@kedai.toogi' },
]
const PRODUCTS = [
  { name: 'Es Pisang Ijo To’ogi’', image: 'pisang-ijo.webp' },
  { name: 'Es Pisang Ijo Ice Cream Durian', image: 'pisang-ijo-durian.webp' },
  { name: 'Ice Cream Durian', image: 'ice-cream.webp' },
  { name: 'Jalangkote’', image: 'jalangkote.webp' },
  { name: 'Jalangkote’ Frozen Isi 3', image: 'frozen3.webp' },
  { name: 'Jalangkote’ Frozen Isi 5', image: 'frozen5.webp' },
  { name: 'Air Mineral', image: 'air.webp' },
  { name: 'Totebag Cooler', image: 'totebag.webp' },
]

const formatPrice = (price) => price == null ? 'Harga belum tersedia' : 'Rp' + Number(price).toLocaleString('id-ID')
const productTokens = (name) => name.toLocaleLowerCase('id-ID')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/)
  .filter((token) => token && !['es', 'toogi'].includes(token))

export default function Landing({ onOpenKasir }) {
  const [quantities, setQuantities] = useState(() => PRODUCTS.map(() => 0))
  const [photos, setPhotos] = useState([])
  const [branches, setBranches] = useState([])
  const [branchState, setBranchState] = useState('loading')
  const [pickupBranchId, setPickupBranchId] = useState('')
  const [branchPrices, setBranchPrices] = useState({})
  const [priceState, setPriceState] = useState('loading')
  const [galleryState, setGalleryState] = useState('loading')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [method, setMethod] = useState('Pickup')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [orderError, setOrderError] = useState('')
  const logoClicks = useRef(0)
  const logoTimer = useRef(null)
  const count = quantities.reduce((total, quantity) => total + quantity, 0)
  const priceFor = (index) => branchPrices[index] ?? null
  const total = quantities.reduce((sum, quantity, index) => sum + quantity * (priceFor(index) || 0), 0)
  const whatsapp = (import.meta.env.VITE_WHATSAPP_NUMBER || '').replace(/\D/g, '')
  const orderLines = PRODUCTS
    .map((product, index) => {
      const quantity = quantities[index]
      if (!quantity) return ''
      const price = priceFor(index)
      return `${product.name} — ${quantity} x ${formatPrice(price)} = ${formatPrice(quantity * (price || 0))}`
    })
    .filter(Boolean)
    .map((line, index) => `${index + 1}. ${line}`)
    .join('\n')
  const pickupBranch = branches.find((branch) => branch.id === pickupBranchId) || branches[0]
  const pickupMaps = (branch) => branch.lat != null && branch.lng != null
    ? `https://www.google.com/maps?q=${branch.lat},${branch.lng}`
    : null
  const pickupAddress = pickupBranch
    ? `${pickupBranch.nama}${pickupMaps(pickupBranch) ? ` — ${pickupMaps(pickupBranch)}` : ''}`
    : 'Lokasi pickup belum tersedia'
  const selectPickupBranch = (branchId) => {
    setBranchPrices({})
    setPriceState('loading')
    setPickupBranchId(branchId)
  }

  useEffect(() => {
    if (!checkoutOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setCheckoutOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [checkoutOpen])

  useEffect(() => {
    let active = true
    sb.rpc('cabang_publik').then(({ data, error }) => {
      if (!active) return
      if (error) {
        console.error('Daftar cabang publik gagal dimuat:', error.message)
        setBranchState('error')
        return
      }
      const rows = data || []
      setBranches(rows)
      setPickupBranchId(rows[0]?.id || '')
      setBranchState(rows.length ? 'ready' : 'empty')
    })
    sb.storage.from(BUCKET).list('', {
      limit: 24,
      sortBy: { column: 'name', order: 'desc' },
    }).then(({ data, error }) => {
      if (!active) return
      if (error) {
        console.error('Galeri kedai gagal dimuat:', error.message)
        setGalleryState('error')
        return
      }
      const images = (data || [])
        .filter((photo) => photo.id && [...IMAGE_TYPES, ...VIDEO_TYPES].includes(photo.metadata?.mimetype))
        .map((photo) => ({
          name: photo.name,
          type: photo.metadata?.mimetype,
          url: sb.storage.from(BUCKET).getPublicUrl(photo.name).data.publicUrl,
        }))
      setPhotos(images)
      setGalleryState(images.length ? 'ready' : 'empty')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    if (!pickupBranchId) {
      setBranchPrices({})
      setPriceState(branchState === 'loading' ? 'loading' : 'error')
      return () => { active = false }
    }
    setPriceState('loading')
    setBranchPrices({})
    sb.rpc('harga_menu_publik', { p_cabang_id: pickupBranchId }).then(({ data, error }) => {
      if (!active) return
      if (error) {
        console.error('Harga cabang gagal dimuat:', error.message)
        setBranchPrices({})
        setPriceState('error')
        return
      }
      const catalog = (data || []).sort((a, b) => a.urut - b.urut)
      const normalize = (value) => productTokens(value).join(' ')
      const matchedPrices = {}
      const matchedProductIds = new Set()
      for (const [index, product] of PRODUCTS.entries()) {
        const availableCatalog = catalog.filter((row) => !matchedProductIds.has(row.produk_id))
        const exact = availableCatalog.find((row) => normalize(row.nama) === normalize(product.name))
        const productWords = new Set(productTokens(product.name))
        const candidates = availableCatalog.map((row) => {
          const words = new Set(productTokens(row.nama))
          const overlap = [...productWords].filter((word) => words.has(word)).length
          const score = overlap / Math.max(productWords.size, words.size, 1)
          return { row, score, distance: Math.abs(words.size - productWords.size) }
        }).filter((candidate) => candidate.score >= 0.65)
          .sort((a, b) => b.score - a.score || a.distance - b.distance)
        const match = exact || (candidates[0]?.score > (candidates[1]?.score || 0) ? candidates[0].row : null)
        if (match) {
          matchedProductIds.add(match.produk_id)
          matchedPrices[index] = Number(match.harga_outlet)
        }
      }
      setBranchPrices(matchedPrices)
      setPriceState('ready')
    })
    return () => { active = false }
  }, [branchState, pickupBranchId])

  const changeQuantity = (index, amount) => {
    if (priceFor(index) == null && amount > 0) return
    setQuantities((current) => current.map((quantity, i) => (
      i === index ? Math.max(0, quantity + amount) : quantity
    )))
  }

  const handleLogoClick = () => {
    logoClicks.current += 1
    window.clearTimeout(logoTimer.current)
    if (logoClicks.current >= 5) {
      logoClicks.current = 0
      onOpenKasir()
      return
    }
    logoTimer.current = window.setTimeout(() => { logoClicks.current = 0 }, 1500)
  }

  const submitOrder = (event) => {
    event.preventDefault()
    if (!count) {
      setOrderError('Pilih minimal satu menu sebelum melanjutkan.')
      return
    }
    if (!whatsapp) {
      setOrderError('Nomor WhatsApp kedai belum dikonfigurasi.')
      return
    }
    if (method === 'Pickup' && !pickupBranch) {
      setOrderError('Cabang pickup belum tersedia. Silakan pilih delivery atau hubungi kedai.')
      return
    }
    if (quantities.some((quantity, index) => quantity > 0 && priceFor(index) == null)) {
      setOrderError('Harga menu untuk cabang yang dipilih belum tersedia. Silakan pilih cabang lain atau hubungi kedai.')
      return
    }
    const address = method === 'Pickup' ? pickupAddress : deliveryAddress.trim()
    const message = [
      'Halo Kedai To’ogi’! Saya mau pesan ya 😊',
      '',
      'DATA PEMESAN',
      `Nama: ${customerName.trim()}`,
      `No. WA: ${customerPhone.trim()}`,
      `Metode: ${method}`,
      `Alamat: ${address}`,
      '',
      'RINCIAN PESANAN',
      orderLines,
      '',
      `TOTAL: ${formatPrice(total)}`,
      '',
      'Mohon konfirmasi pesanan saya. Terima kasih!',
    ].join('\n')
    const url = `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (!opened) window.location.assign(url)
    setCheckoutOpen(false)
  }

  return (
    <div className="landing">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Kedai To’ogi’, beranda">
          <img src="./assets/logo.png" alt="Kedai To’ogi’" />
        </a>
        <a className="pill" href="#menu">Lihat menu <span aria-hidden="true">↓</span></a>
      </header>

      <main>
        <div className="hero-wrap" id="top">
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow"><span aria-hidden="true">✦</span> Jajanan enak, mood baik</span>
              <h1>Seger.<br />Manis.<br /><span>Bikin nagih.</span></h1>
              <p>Teman paling pas buat nemenin harimu. Pilih favoritmu, kami siapin yang terbaik!</p>
              <div className="hero-actions">
                <a className="pill pill-yellow" href="#menu">Pilih menu <span aria-hidden="true">→</span></a>
                <a className="hero-link" href="#tentang">Kenalan dengan To’ogi’</a>
              </div>
              <div className="hero-note"><span aria-hidden="true">♡</span> Dibuat fresh, dinikmati sampai habis.</div>
            </div>
            <div className="hero-art">
              <div className="hero-sun" aria-hidden="true" />
              <img className="hero-food" src="./assets/pisang-ijo-durian.webp" alt="Es pisang ijo dengan ice cream durian" />
              <div className="hero-sticker"><span>Favorit<br />semua orang</span><b>{priceFor(1) == null ? 'Harga cabang' : formatPrice(priceFor(1))}</b></div>
              <span className="hero-sparkle sparkle-one" aria-hidden="true">✳</span>
              <span className="hero-sparkle sparkle-two" aria-hidden="true">✦</span>
            </div>
          </section>
          <div className="ticker" aria-label="Menu favorit Kedai To’ogi’">
            <div>{Array.from({ length: 2 }, (_, repeat) => (
              <span key={repeat}>ES PISANG IJO <i>✦</i> JALANGKOTE’ <i>✦</i> ICE CREAM DURIAN <i>✦</i> DIBUAT DENGAN HATI <i>✦</i> </span>
            ))}</div>
          </div>
        </div>

        <section className="menu-section" id="menu">
          <div className="section-heading">
            <div>
              <span className="eyebrow eyebrow-dark">Yang bikin hari jadi seru</span>
              <h2>Pilih favoritmu<span>.</span></h2>
            </div>
            <div className="menu-branch-picker">
              <label htmlFor="menu-branch">Harga untuk cabang</label>
              <select id="menu-branch" value={pickupBranchId} onChange={(event) => selectPickupBranch(event.target.value)} disabled={branchState !== 'ready'}>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nama}</option>)}
              </select>
              <small>{priceState === 'loading' ? 'Memuat harga…' : priceState === 'error' ? 'Harga cabang gagal dimuat.' : 'Harga mengikuti cabang yang dipilih.'}</small>
            </div>
          </div>
          <div className="product-grid">
            {PRODUCTS.map((product, index) => (
              <article className="product-card" key={product.image}>
                <div className="product-image">
                  <img src={`./assets/${product.image}`} alt={product.name} loading="lazy" />
                  {index === 1 && <span className="product-badge">Best seller</span>}
                </div>
                <div className="product-info">
                  <h3>{product.name}</h3>
                  <div className="product-bottom">
                    <span className="price">{priceState === 'loading' ? 'Memuat harga…' : formatPrice(priceFor(index))}</span>
                    <div className="quantity-control" aria-label={`Jumlah ${product.name}`}>
                      <button type="button" onClick={() => changeQuantity(index, -1)} disabled={!quantities[index]} aria-label={`Kurangi ${product.name}`}>−</button>
                      <output aria-live="polite">{quantities[index]}</output>
                      <button type="button" onClick={() => changeQuantity(index, 1)} disabled={priceFor(index) == null} aria-label={`Tambah ${product.name}`}>+</button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="gallery-section" id="suasana">
          <div className="section-heading">
            <div>
              <span className="eyebrow eyebrow-dark">Mampir, yuk!</span>
              <h2>Suasana kedai<span>.</span></h2>
            </div>
            <p>Lihat keseruan dan suasana di Kedai To’ogi’.</p>
          </div>
          {galleryState === 'ready'
            ? <div className="venue-gallery">
              {photos.map((photo) => (
                VIDEO_TYPES.includes(photo.type)
                  ? <video key={photo.name} src={photo.url} controls playsInline preload="metadata" aria-label="Video suasana Kedai To’ogi’" />
                  : <img key={photo.name} src={photo.url} alt="Suasana Kedai To’ogi’" loading="lazy" />
              ))}
            </div>
            : <div className="gallery-empty">
              <span aria-hidden="true">✦</span>
              <p>{galleryState === 'error' ? 'Galeri kedai belum dapat dimuat. Silakan coba lagi nanti.' : 'Foto suasana kedai segera hadir.'}</p>
            </div>}
        </section>

        <section className="locations-section" id="lokasi">
          <div className="section-heading">
            <div>
              <span className="eyebrow eyebrow-dark">Dekat dan mudah ditemukan</span>
              <h2>Mampir ke cabang<span>.</span></h2>
            </div>
            <p>Pilih cabang terdekat untuk melihat lokasi, harga, dan opsi pickup.</p>
          </div>
          <div className="branch-grid">
            {branches.map((branch) => (
              <article className="branch-card" key={branch.id}>
                <span className="branch-pin" aria-hidden="true">⌖</span>
                <div>
                  <span className="branch-label">KEDAI TO’OGI’</span>
                  <h3>{branch.nama}</h3>
                  <p>{branch.alamat || 'Alamat cabang belum diisi.'}</p>
                  {pickupMaps(branch) && <a className="text-link" href={pickupMaps(branch)} target="_blank" rel="noreferrer">Buka Google Maps <span aria-hidden="true">↗</span></a>}
                </div>
              </article>
            ))}
            {branchState === 'loading' && <p className="muted">Memuat daftar cabang…</p>}
            {branchState === 'empty' && <p className="muted">Informasi cabang belum tersedia.</p>}
            {branchState === 'error' && <p className="err">Informasi cabang gagal dimuat. Coba muat ulang halaman.</p>}
          </div>
        </section>

        <section className="about-section" id="tentang">
          <div className="about-mark"><img src="./assets/logo.png" alt="" loading="lazy" /></div>
          <div>
            <span className="eyebrow eyebrow-dark">Kenalan yuk!</span>
            <h2>Jajanan lokal,<br />rasa spesial<span>.</span></h2>
            <p>Kedai To’ogi’ hadir dengan es pisang ijo yang segar, jalangkote’ gurih, dan camilan favorit untuk berbagi. Terima kasih sudah mampir dan mendukung usaha lokal!</p>
            <a className="text-link" href="#menu">Cari camilanmu <span aria-hidden="true">→</span></a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <button className="footer-logo" type="button" onClick={handleLogoClick} aria-label="Kedai To’ogi’">
          <img src="./assets/logo.png" alt="Kedai To’ogi’" />
        </button>
        <p>Yang enak-enak, dari To’ogi’ untuk kamu. <span aria-hidden="true">♡</span></p>
        <nav className="social-links" aria-label="Media sosial Kedai To’ogi’">
          {SOCIALS.map((social) => (
            <a key={social.name} href={social.url} target="_blank" rel="noreferrer">{social.name} <span>{social.label}</span> ↗</a>
          ))}
        </nav>
        <small>© {new Date().getFullYear()} Kedai To’ogi’</small>
      </footer>

      <div className={`order-bar${count ? ' order-bar-visible' : ''}`} aria-live="polite">
        <div><strong>{formatPrice(total)}</strong><small>{count} item{count === 1 ? '' : ''}</small></div>
        <button className="pill pill-yellow" type="button" onClick={() => { setOrderError(''); setCheckoutOpen(true) }}>Pesan via WhatsApp <span aria-hidden="true">↗</span></button>
      </div>

      {checkoutOpen && (
        <div className="checkout-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCheckoutOpen(false)
        }}>
          <form className="checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title" onSubmit={submitOrder}>
            <button className="checkout-close" type="button" onClick={() => setCheckoutOpen(false)} aria-label="Tutup form pesanan">×</button>
            <span className="eyebrow eyebrow-dark">Satu langkah lagi</span>
            <h2 id="checkout-title">Lengkapi pesanan<span>.</span></h2>
            <p className="checkout-intro">Detail ini akan dimasukkan ke pesan WhatsApp untuk kedai.</p>
            <label htmlFor="order-name">Nama</label>
            <input id="order-name" autoComplete="name" required value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
            <label htmlFor="order-phone">No. WA</label>
            <input id="order-phone" type="tel" inputMode="tel" autoComplete="tel" required value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Contoh: 08xxxxxxxxxx" />
            <label htmlFor="order-method">Metode</label>
            <select id="order-method" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="Pickup">Pickup</option>
              <option value="Delivery">Delivery</option>
            </select>
            <label htmlFor="order-address">Alamat</label>
            {method === 'Delivery'
              ? <textarea id="order-address" required value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="Alamat lengkap dan link shareloc/Google Maps" rows="3" />
              : <div className="pickup-address" id="order-address">
                <label htmlFor="pickup-branch">Pilih cabang pickup</label>
                <select id="pickup-branch" required value={pickupBranchId} onChange={(event) => selectPickupBranch(event.target.value)} disabled={branchState !== 'ready'}>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nama}</option>)}
                </select>
                {pickupBranch && <><b>{pickupBranch.nama}</b>{pickupMaps(pickupBranch) && <a href={pickupMaps(pickupBranch)} target="_blank" rel="noreferrer">Lihat lokasi di Google Maps ↗</a>}</>}
                {branchState === 'error' && <span className="err">Daftar cabang gagal dimuat. Coba muat ulang.</span>}
              </div>}
            <div className="checkout-summary">
              <span>{count} item pesanan</span><strong>{formatPrice(total)}</strong>
            </div>
            {orderError && <p className="err" role="alert">{orderError}</p>}
            <button className="pill pill-yellow checkout-submit" type="submit">Lanjut ke WhatsApp <span aria-hidden="true">↗</span></button>
          </form>
        </div>
      )}
    </div>
  )
}
