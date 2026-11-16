import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getMyProfile, updateMyProfile, uploadAvatar } from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Avatar, Field, Loading, Notice } from '../components/Bits'
import ImageCropModal from '../components/ImageCropModal'
import SaveBar from '../components/SaveBar'
import TagInput from '../components/TagInput'
import useDirty from '../lib/useDirty'
import '../styles/pages.css'

const toForm = (p) => ({
  company_description: p.company_description || '',
  company_locations: p.company_locations || [],
})

export default function CompanyProfile() {
  const { user, updateUser } = useAuth()
  const [account, setAccount] = useState(null)
  const [saved, setSaved] = useState(null)
  const [form, setForm] = useState(null)
  const [loadProblem, setLoadProblem] = useState('')
  const [problem, setProblem] = useState('')
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [cropSrc, setCropSrc] = useState(null)
  const logoInput = useRef(null)
  const dirty = useDirty(form, saved)

  useEffect(() => {
    let live = true
    getMyProfile()
      .then((p) => {
        if (!live) return
        setAccount(p)
        setSaved(toForm(p))
        setForm(toForm(p))
      })
      .catch((err) => live && setLoadProblem(err.message))
    return () => {
      live = false
    }
  }, [])

  const set = (key) => (value) => {
    setJustSaved(false)
    setForm((f) => ({ ...f, [key]: value?.target ? value.target.value : value }))
  }

  const save = async () => {
    setProblem('')
    setSaving(true)
    try {
      const updated = await updateMyProfile({
        company_description: form.company_description,
        company_locations: form.company_locations,
      })
      setSaved(toForm(updated))
      setForm(toForm(updated))
      setJustSaved(true)
    } catch (err) {
      setProblem(err.message)
    } finally {
      setSaving(false)
    }
  }

  const pickLogo = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setCropSrc(reader.result)
    reader.readAsDataURL(file)
  }

  const saveLogo = async (file) => {
    const updated = await uploadAvatar(file)
    const url = updated.profile_picture_url ? `${updated.profile_picture_url}?t=${Date.now()}` : null
    setAccount((a) => ({ ...a, profile_picture_url: url }))
    updateUser({ profile_picture_url: url })
    setCropSrc(null)
  }

  if (loadProblem) {
    return (
      <AppShell narrow>
        <PageHead title="Company" />
        <Notice tone="stop" title="Your company details could not load.">
          {loadProblem}
        </Notice>
      </AppShell>
    )
  }
  if (!form) {
    return (
      <AppShell narrow>
        <Loading>Loading your company details</Loading>
      </AppShell>
    )
  }

  return (
    <AppShell narrow>
      <PageHead title="Company">Your logo, a few lines about the work, and where you are.</PageHead>

      <div className="identity">
        <Avatar name={user.name} src={account.profile_picture_url} size="lg" square />
        <div>
          <strong>{user.name}</strong>
          <span>{account.email}</span>
        </div>
        <button type="button" className="btn secondary sm" onClick={() => logoInput.current?.click()}>
          {account.profile_picture_url ? 'Change logo' : 'Add a logo'}
        </button>
        <input ref={logoInput} type="file" accept="image/*" hidden onChange={pickLogo} />
      </div>

      <div className="stack">
        <Field label="About the company" htmlFor="company_description">
          <textarea
            id="company_description"
            className="textarea"
            maxLength={20000}
            rows={7}
            value={form.company_description}
            onChange={set('company_description')}
            placeholder="What the company does, who works there, and what the work is like."
          />
        </Field>

        <Field
          label="Locations"
          htmlFor="company_locations"
          hint="Cities or regions where you have people. Press Enter after each one."
        >
          <TagInput
            id="company_locations"
            tags={form.company_locations}
            onChange={set('company_locations')}
            placeholder="Toronto, Remote"
          />
        </Field>

        {problem && <Notice tone="stop">{problem}</Notice>}
      </div>

      <SaveBar dirty={dirty} saving={saving} saved={justSaved} onSave={save} onDiscard={() => setForm(saved)} />

      {cropSrc && (
        <ImageCropModal
          imageSrc={cropSrc}
          onClose={() => setCropSrc(null)}
          onCropDone={saveLogo}
          shape="rect"
          title="Adjust your logo"
        />
      )}
    </AppShell>
  )
}
