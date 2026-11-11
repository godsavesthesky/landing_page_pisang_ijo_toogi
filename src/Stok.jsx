import { useState } from 'react'
import SalesDashboard from './SalesDashboard.jsx'
import PersediaanBahan from './PersediaanBahan.jsx'
import StokProduk from './StokProduk.jsx'

export default function Stok({ me, say }) {
  const [section, setSection] = useState('produk')

  return (
    <div className="stock-page">
      <SalesDashboard me={me} say={say} dailyOnly />
      <nav className="stock-sections" aria-label="Jenis stok">
        <button className={'btn' + (section === 'produk' ? ' on' : '')} onClick={() => setSection('produk')}>Stok produk</button>
        <button className={'btn' + (section === 'bahan' ? ' on' : '')} onClick={() => setSection('bahan')}>Persediaan bahan baku</button>
      </nav>
      {section === 'bahan'
        ? <PersediaanBahan me={me} say={say} />
        : <StokProduk me={me} say={say} />}
    </div>
  )
}
