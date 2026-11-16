import { useCallback, useState } from 'react'
import Cropper from 'react-easy-crop'
import { Notice } from './Bits'
import Modal from './Modal'

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.addEventListener('load', () => resolve(img))
    img.addEventListener('error', () => reject(new Error('That file could not be read as an image.')))
    img.src = url
  })
}

// Cuts the chosen square out of the picture and hands it back as a JPEG.
async function croppedBlob(imageSrc, area) {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = area.width
  canvas.height = area.height
  const ctx = canvas.getContext('2d')
  // A JPEG has no transparency: put white behind logos that do.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be saved.'))), 'image/jpeg', 0.92)
  })
}

// Pick the square part of a picture to keep. `onCropDone` receives the file and may throw.
export default function ImageCropModal({ imageSrc, onClose, onCropDone, shape = 'round', title = 'Adjust your photo' }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState(null)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')

  const onCropComplete = useCallback((_, pixels) => setArea(pixels), [])

  const save = async () => {
    if (!area) return
    setSaving(true)
    setProblem('')
    try {
      const blob = await croppedBlob(imageSrc, area)
      await onCropDone(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
    } catch (err) {
      setProblem(err.message || 'The picture could not be saved.')
      setSaving(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving || !area}>
            {saving && <span className="spinner" aria-hidden="true" />}
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="crop-area">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape={shape}
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <div className="slider">
          <label htmlFor="crop-zoom">
            <span>Zoom</span>
            <output htmlFor="crop-zoom">{Math.round(zoom * 100)}%</output>
          </label>
          <input
            id="crop-zoom"
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            style={{ '--v': ((zoom - 1) / 2) * 100 }}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </div>
        <p className="hint">Drag the picture to move it.</p>
        {problem && <Notice tone="stop">{problem}</Notice>}
      </div>
    </Modal>
  )
}
