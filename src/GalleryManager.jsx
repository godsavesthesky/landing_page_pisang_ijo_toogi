import { useEffect, useState } from 'react'
import { sb } from './lib.js'

const BUCKET = 'kedai-gallery'
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/webm']
const MEDIA_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES]
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_VIDEO_SIZE = 25 * 1024 * 1024

export default function GalleryManager({ say }) {
  const [media, setMedia] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const loadPhotos = async () => {
    setLoading(true)
    const { data, error } = await sb.storage.from(BUCKET).list('', {
      limit: 50,
      sortBy: { column: 'name', order: 'desc' },
    })
    if (error) {
      say('Galeri belum siap: ' + error.message, true)
      setLoading(false)
      return
    }
    setMedia((data || []).filter((item) => item.id && MEDIA_TYPES.includes(item.metadata?.mimetype)))
    setLoading(false)
  }

  useEffect(() => { loadPhotos() }, [])

  const upload = async (event) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (!MEDIA_TYPES.includes(file.type)) return say('Pilih foto JPG, PNG, WebP, atau video MP4/WebM.', true)
    const isVideo = VIDEO_TYPES.includes(file.type)
    const maxFileSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE
    if (file.size > maxFileSize) return say(`Ukuran ${isVideo ? 'video' : 'foto'} maksimal ${isVideo ? '25' : '5'} MB.`, true)

    setUploading(true)
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
    const fileName = `${Date.now()}-${crypto.randomUUID()}.${extension}`
    const { error } = await sb.storage.from(BUCKET).upload(fileName, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    })
    setUploading(false)
    if (error) return say('Media gagal diunggah: ' + error.message, true)
    say(`${isVideo ? 'Video' : 'Foto'} berhasil ditambahkan.`)
    await loadPhotos()
  }

  const remove = async (photo) => {
    const isVideo = VIDEO_TYPES.includes(photo.metadata?.mimetype)
    if (!window.confirm(`Hapus ${isVideo ? 'video' : 'foto'} ini dari galeri?`)) return
    const { error } = await sb.storage.from(BUCKET).remove([photo.name])
    if (error) return say('Media gagal dihapus: ' + error.message, true)
    say(`${isVideo ? 'Video' : 'Foto'} berhasil dihapus.`)
    await loadPhotos()
  }

  return (
    <section className="gallery-manager box">
      <h2>Kelola foto kedai</h2>
      <p className="muted">Foto JPG, PNG, atau WebP maksimal 5 MB. Video MP4 atau WebM maksimal 25 MB. Media akan tampil di landing page.</p>
      <label className="gallery-upload">
        <span>{uploading ? 'Mengunggah media…' : 'Pilih foto atau video untuk diunggah'}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" disabled={uploading} onChange={upload} />
      </label>
      {loading ? <p className="muted">Memuat galeri…</p> : media.length === 0
        ? <p className="muted">Belum ada foto atau video kedai.</p>
        : <div className="gallery-manager-grid">
          {media.map((item) => {
            const { data } = sb.storage.from(BUCKET).getPublicUrl(item.name)
            const isVideo = VIDEO_TYPES.includes(item.metadata?.mimetype)
            return (
              <figure key={item.id}>
                {isVideo
                  ? <video src={data.publicUrl} controls playsInline preload="metadata">Browser tidak mendukung video.</video>
                  : <img src={data.publicUrl} alt={item.name} />}
                <button className="btn alt" type="button" onClick={() => remove(item)}>Hapus {isVideo ? 'video' : 'foto'}</button>
              </figure>
            )
          })}
        </div>}
    </section>
  )
}
