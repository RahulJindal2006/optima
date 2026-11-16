// Small figures on the landing page are driven by one number, q, from 0 to 1:
// time when the page opens, scroll position inside the pinned scene.
// Elements opt in with data-paint and read their own targets from data attributes.
import { SEND_AT } from './score'

const clamp = (n) => Math.min(1, Math.max(0, n))

function digits(text) {
  return [...text].map((ch) => (/\d/.test(ch) ? `<span class="d">${ch}</span>` : `<span>${ch}</span>`)).join('')
}

export function paint(root, q) {
  if (!root) return
  root.querySelectorAll('[data-paint]').forEach((el) => {
    const data = el.dataset
    const delay = Number(data.d || 0)
    const local = delay ? clamp((q - delay) / 0.7) : q
    const from = Number(data.from || 0)
    const to = Number(data.to || 0)
    const now = from + (to - from) * local
    switch (data.paint) {
      case 'count':
        el.textContent = String(Math.round(now))
        break
      case 'line':
        el.style.setProperty('--v', now.toFixed(2))
        el.classList.toggle('fits', now >= SEND_AT)
        break
      case 'grow':
        el.style.setProperty('--v', now.toFixed(2))
        break
      case 'show':
        el.classList.toggle('on', local >= Number(data.at || 0))
        break
      case 'type': {
        const text = data.text || ''
        el.textContent = text.slice(0, Math.round(text.length * local))
        break
      }
      case 'words': {
        const text = (data.text || '').slice(0, Math.round((data.text || '').length * local)).trim()
        el.textContent = String(text ? text.split(/\s+/).length : 0)
        break
      }
      case 'timer': {
        const s = Math.round(now)
        const text = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
        if (el.dataset.shown !== text) {
          el.dataset.shown = text
          el.innerHTML = digits(text)
        }
        break
      }
      default:
    }
  })
}

// Runs q from 0 to 1 over `ms`, easing out. Returns a function that cancels it.
export function play(root, ms = 1200, done) {
  let frame = 0
  let start = 0
  const ease = (t) => 1 - Math.pow(1 - t, 4)
  const tick = (now) => {
    if (!start) start = now
    const t = clamp((now - start) / ms)
    paint(root, ease(t))
    if (t < 1) frame = requestAnimationFrame(tick)
    else if (done) done()
  }
  paint(root, 0)
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}
