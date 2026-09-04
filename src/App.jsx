import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  Check, ChevronDown, ExternalLink, Heart, ImagePlus, Link2, LoaderCircle,
  LockKeyhole, Map, MapPin, Pencil, Plus, Settings, Trash2, X,
} from 'lucide-react'

const SUPABASE_URL = 'https://grsiborhqvvxssjrxrsk.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_dEMmlwfgL0JE99kOVIgelg_0y0ZWtzW'
const ALLOWED_USERS = new Set(['neverlordd', 'puk_privet'])
const CATEGORIES = ['Все', 'Заведения', 'Хайки', 'Города', 'Досуг']
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
})

function getTelegramUser() {
  const app = window.Telegram?.WebApp
  app?.ready()
  app?.expand()
  if (app?.isVersionAtLeast?.('6.1')) {
    app.setHeaderColor?.('#F7F8FA')
    app.setBackgroundColor?.('#F7F8FA')
  }
  const user = app?.initDataUnsafe?.user
  if (user?.username) return user
  if (import.meta.env.DEV) return { username: 'neverlordd', first_name: 'Dev' }
  return null
}

function haptic(type = 'light') {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(type)
}

function notify(type = 'success') {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(type)
}

function confirmAction(text) {
  const confirm = window.Telegram?.WebApp?.showConfirm
  return confirm ? new Promise((resolve) => confirm(text, resolve)) : Promise.resolve(window.confirm(text))
}

function normalizeUrl(value) {
  if (!value?.trim()) return null
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
  try {
    const url = new URL(candidate)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch { return null }
}

function extractCoordinates(url) {
  if (!url) return { latitude: null, longitude: null }
  const decoded = decodeURIComponent(url)
  const match = decoded.match(/(?:@|query=|q=|place\/)(-?\d{1,2}(?:\.\d+)?)[,%2C\s]+(-?\d{1,3}(?:\.\d+)?)/i)
    || decoded.match(/(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/)
  if (!match) return { latitude: null, longitude: null }
  const latitude = Number(match[1]); const longitude = Number(match[2])
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    ? { latitude, longitude } : { latitude: null, longitude: null }
}

function storageFileName(file) {
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  return `${crypto.randomUUID()}.${ext}`
}

async function optimizePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1_200_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84))
    return blob ? new File([blob], 'place.jpg', { type: 'image/jpeg' }) : file
  } catch { return file }
}

function titleFromMapsUrl(url) {
  try {
    const match = new URL(url).pathname.match(/\/place\/([^/@]+)/i)
    return match?.[1] ? decodeURIComponent(match[1].replace(/\+/g, ' ')).trim() : ''
  } catch { return '' }
}

async function getLinkPreview(url) {
  const normalized = normalizeUrl(url)
  if (!normalized) return null
  if (/\.(avif|gif|jpe?g|png|webp)(?:\?.*)?$/i.test(normalized)) return { image_url: normalized, final_url: normalized }
  try {
    const endpoint = new URL('https://api.microlink.io')
    endpoint.searchParams.set('url', normalized)
    endpoint.searchParams.set('audio', 'false')
    endpoint.searchParams.set('video', 'false')
    endpoint.searchParams.set('iframe', 'false')
    const response = await fetch(endpoint, { signal: AbortSignal.timeout?.(15000) })
    const payload = await response.json()
    if (!response.ok || payload.status !== 'success') throw new Error('Metadata unavailable')
    const data = payload.data || {}
    const finalUrl = normalizeUrl(data.url) || normalized
    const host = new URL(finalUrl).hostname.toLowerCase()
    const isMaps = host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'google.com' || host.includes('google.')
    const mapsTitle = isMaps ? titleFromMapsUrl(finalUrl) || titleFromMapsUrl(normalized) : ''
    const rawTitle = isMaps && /^google maps$/i.test(data.title || '') ? mapsTitle : data.title || mapsTitle
    const titleParts = isMaps ? rawTitle.split(/\s+·\s+/).filter(Boolean) : [rawTitle]
    const title = titleParts[0] || ''
    const rawDescription = isMaps && /find local businesses|view maps|get driving directions/i.test(data.description || '') ? '' : data.description || ''
    const description = isMaps ? [rawDescription, ...titleParts.slice(1)].filter(Boolean).join(' · ') : rawDescription
    return { title, description, image_url: data.image?.url || null, final_url: finalUrl }
  } catch {
    try {
      const response = await fetch(normalized, { signal: AbortSignal.timeout?.(8000) })
      const html = await response.text()
      const documentNode = new DOMParser().parseFromString(html, 'text/html')
      const title = documentNode.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.content || documentNode.title
      const description = documentNode.querySelector('meta[property="og:description"], meta[name="description"]')?.content || ''
      const image = documentNode.querySelector('meta[property="og:image"], meta[name="twitter:image"]')?.content
      return { title, description, image_url: image ? new URL(image, response.url).href : null, final_url: response.url }
    } catch { return null }
  }
}

function upsert(list, value) {
  return list.some((item) => item.id === value.id)
    ? list.map((item) => item.id === value.id ? value : item)
    : [...list, value]
}

function useTelegramBack(open, onClose) {
  useEffect(() => {
    const app = window.Telegram?.WebApp
    if (!open || !app?.isVersionAtLeast?.('6.1')) return undefined
    app.BackButton?.show?.(); app.onEvent?.('backButtonClicked', onClose)
    return () => { app.offEvent?.('backButtonClicked', onClose); app.BackButton?.hide?.() }
  }, [onClose, open])
}

export default function App() {
  const [telegramUser] = useState(getTelegramUser)
  const username = telegramUser?.username?.toLowerCase() || ''
  const allowed = ALLOWED_USERS.has(username)
  const [countries, setCountries] = useState([])
  const [items, setItems] = useState([])
  const [countryId, setCountryId] = useState(() => localStorage.getItem('travel-country') || '')
  const [section, setSection] = useState('places')
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('Все')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [itemModal, setItemModal] = useState(null)
  const [countryModal, setCountryModal] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const deleteTimer = useRef(null)

  const loadAll = useCallback(async (initial = false) => {
    if (!allowed) return
    if (initial) setLoading(true)
    const [countryResult, itemResult] = await Promise.all([
      supabase.from('countries').select('*').order('sort_order').order('created_at'),
      supabase.from('checklist_items').select('*').order('created_at', { ascending: false }),
    ])
    if (countryResult.error || itemResult.error) setError(countryResult.error?.message || itemResult.error?.message)
    else {
      setCountries(countryResult.data || []); setItems(itemResult.data || []); setError('')
      const ids = new Set((countryResult.data || []).map((country) => country.id))
      setCountryId((current) => ids.has(current) ? current : countryResult.data?.[0]?.id || '')
    }
    setLoading(false)
  }, [allowed])

  useEffect(() => {
    if (!allowed) return undefined
    void loadAll(true)
    const itemChannel = supabase.channel('items-live-v3')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_items' }, (payload) => {
        setItems((current) => payload.eventType === 'DELETE'
          ? current.filter((item) => item.id !== payload.old.id) : upsert(current, payload.new))
      }).subscribe()
    const countryChannel = supabase.channel('countries-live-v1')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'countries' }, () => void loadAll())
      .subscribe()
    const refresh = () => document.visibilityState === 'visible' && void loadAll()
    document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh)
      supabase.removeChannel(itemChannel); supabase.removeChannel(countryChannel)
    }
  }, [allowed, loadAll])

  useEffect(() => { if (countryId) localStorage.setItem('travel-country', countryId) }, [countryId])
  useEffect(() => () => deleteTimer.current && clearTimeout(deleteTimer.current), [])

  const visibleItems = useMemo(() => {
    let result = section === 'favorites'
      ? items.filter((item) => item.is_favorite)
      : items.filter((item) => item.country === countryId)
    if (section !== 'favorites' && status === 'done') result = result.filter((item) => item.is_completed)
    if (category !== 'Все') result = result.filter((item) => item.category === category)
    return result.sort((a, b) => Number(a.is_completed) - Number(b.is_completed)
      || String(b.updated_at).localeCompare(String(a.updated_at)))
  }, [category, countryId, items, section, status])

  async function patchItem(item, values) {
    setItems((current) => upsert(current, { ...item, ...values }))
    const { data, error: updateError } = await supabase.from('checklist_items').update(values).eq('id', item.id).select().single()
    if (updateError) { setItems((current) => upsert(current, item)); setError(updateError.message); notify('error') }
    else { setItems((current) => upsert(current, data)); notify() }
  }

  async function deleteItemNow(item) {
    const { error: deleteError } = await supabase.from('checklist_items').delete().eq('id', item.id)
    if (deleteError) { setItems((current) => upsert(current, item)); setError(deleteError.message); return }
    if (item.photo_path) await supabase.storage.from('photos').remove([item.photo_path])
  }

  async function deleteItem(item) {
    if (!await confirmAction(`Удалить «${item.title}»?`)) return
    if (pendingDelete) { clearTimeout(deleteTimer.current); void deleteItemNow(pendingDelete) }
    setItems((current) => current.filter((value) => value.id !== item.id)); setPendingDelete(item); haptic('medium')
    deleteTimer.current = setTimeout(() => { void deleteItemNow(item); setPendingDelete(null) }, 5500)
  }

  function undoDelete() {
    clearTimeout(deleteTimer.current); setItems((current) => upsert(current, pendingDelete)); setPendingDelete(null); haptic()
  }

  if (!allowed) return <AccessDenied username={username} />
  if (loading) return <Loading />

  return <div className="mx-auto min-h-dvh w-full max-w-2xl px-3 pb-[calc(6.75rem+env(safe-area-inset-bottom))] pt-[calc(40px+env(safe-area-inset-top))] sm:px-6 sm:pt-[calc(2rem+env(safe-area-inset-top))]">
    {section === 'settings' ? <SettingsScreen countries={countries} username={username} onAdd={() => setCountryModal({})} onEdit={(country) => setCountryModal(country)} onDelete={async (country) => {
      if (countries.length === 1) return setError('Нельзя удалить единственную страну.')
      const count = items.filter((item) => item.country === country.id).length
      if (count) return setError(`Сначала удалите места из «${country.name}» (${count}). Так данные не потеряются случайно.`)
      if (!await confirmAction(`Удалить «${country.name}»?`)) return
      const { error: deleteError } = await supabase.from('countries').delete().eq('id', country.id)
      if (deleteError) setError(deleteError.message); else notify()
    }} /> : <>
      <header className="mb-3 grid gap-3 sm:mb-5 sm:flex sm:items-center sm:justify-between">
        {section === 'favorites' ? <h1 className="text-[27px] font-extrabold tracking-tight text-ink sm:text-[28px]">Избранное</h1> : <label className="relative block min-w-0 max-w-full">
          <select value={countryId} onChange={(event) => setCountryId(event.target.value)} className="w-full max-w-full appearance-none truncate bg-transparent py-1 pr-8 text-[27px] font-extrabold tracking-tight text-ink outline-none sm:w-auto sm:text-[28px]">
            {countries.map((country) => <option key={country.id} value={country.id}>{country.emoji} {country.name}</option>)}
          </select><ChevronDown size={19} className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-muted" />
        </label>}
        {section === 'places' && <div className="grid w-full grid-cols-2 rounded-2xl bg-white p-1 shadow-sm sm:flex sm:w-auto sm:rounded-xl"><button onClick={() => setStatus('all')} className={`min-h-10 rounded-xl px-3 py-2 text-xs font-bold ${status === 'all' ? 'bg-ink text-white' : 'text-muted'}`}>Все</button><button onClick={() => setStatus('done')} className={`min-h-10 rounded-xl px-3 py-2 text-xs font-bold ${status === 'done' ? 'bg-ink text-white' : 'text-muted'}`}>Выполненные</button></div>}
      </header>

      <CategoryTabs value={category} onChange={setCategory} />
      {error && <ErrorBanner text={error} close={() => setError('')} />}
      {visibleItems.length ? <main className="space-y-2.5">{visibleItems.map((item) => <PlaceCard key={item.id} item={item} country={countries.find((value) => value.id === item.country)} showCountry={section === 'favorites'} onToggle={() => patchItem(item, { is_completed: !item.is_completed })} onFavorite={() => patchItem(item, { is_favorite: !item.is_favorite })} onEdit={() => setItemModal(item)} onDelete={() => deleteItem(item)} />)}</main> : <EmptyState favorites={section === 'favorites'} onAdd={() => setItemModal({})} />}
    </>}

    {section !== 'settings' && countries.length > 0 && <button onClick={() => setItemModal({})} className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-4 z-20 grid h-14 w-14 place-items-center rounded-2xl bg-ink text-white shadow-xl transition active:scale-95 sm:right-6" aria-label="Добавить место"><Plus size={25} /></button>}
    <BottomNav value={section} onChange={(value) => { setSection(value); setCategory('Все'); haptic() }} />
    {pendingDelete && <div className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-3 z-40 flex max-w-[calc(100%-5.5rem)] items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-xl sm:left-6"><span className="truncate">Место удалено</span><button onClick={undoDelete} className="min-h-8 font-extrabold text-mint-200">Вернуть</button></div>}
    {itemModal && <ItemSheet item={itemModal.id ? itemModal : null} countryId={countryId} username={username} onClose={() => setItemModal(null)} onSave={(saved) => { setItems((current) => upsert(current, saved)); setItemModal(null); notify() }} onError={setError} />}
    {countryModal && <CountrySheet country={countryModal.id ? countryModal : null} order={countries.length} onClose={() => setCountryModal(null)} onSave={(saved) => { setCountries((current) => upsert(current, saved).sort((a, b) => a.sort_order - b.sort_order)); setCountryId(saved.id); setCountryModal(null); notify() }} onError={setError} />}
  </div>
}

function CategoryTabs({ value, onChange }) {
  return <nav className="sticky top-[env(safe-area-inset-top)] z-10 -mx-3 mb-3 overflow-x-auto overscroll-x-contain bg-canvas/95 px-3 py-2.5 backdrop-blur [scrollbar-width:none] sm:-mx-6 sm:mb-4 sm:px-6 [&::-webkit-scrollbar]:hidden"><div className="flex w-max gap-2">{CATEGORIES.map((item) => <button key={item} onClick={() => { onChange(item); haptic() }} className={`min-h-11 rounded-full px-4 py-2.5 text-sm font-bold transition active:scale-[0.98] ${value === item ? 'bg-mint-600 text-white shadow-sm' : 'bg-white text-muted shadow-sm'}`}>{item}</button>)}</div></nav>
}

function PlaceCard({ item, country, showCountry, onToggle, onFavorite, onEdit, onDelete }) {
  const mapUrl = item.maps_url || (item.latitude != null && item.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}` : null)
  return <article className={`flex min-h-[104px] gap-2.5 rounded-2xl border bg-white p-2 shadow-sm sm:gap-3 sm:p-2.5 ${item.is_completed ? 'border-mint-100 opacity-75' : 'border-slate-100'}`}>
    {item.photo_url ? <img src={item.photo_url} alt="" className="h-[88px] w-[82px] shrink-0 rounded-xl object-cover sm:h-[84px] sm:w-[92px]" loading="lazy" /> : <div className="grid h-[88px] w-[82px] shrink-0 place-items-center rounded-xl bg-mint-50 text-mint-600 sm:h-[84px] sm:w-[92px]"><MapPin size={24} /></div>}
    <div className="min-w-0 flex-1 py-0.5"><div className="flex items-start gap-1"><button onClick={onToggle} className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 ${item.is_completed ? 'border-mint-500 bg-mint-500 text-white' : 'border-slate-300 text-transparent'}`} aria-label="Выполнено"><Check size={15} strokeWidth={3} /></button><h2 className={`line-clamp-2 flex-1 pt-0.5 text-[13px] font-extrabold leading-[1.35] sm:text-sm ${item.is_completed ? 'line-through text-muted' : 'text-ink'}`}>{item.title}</h2><button onClick={onFavorite} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" aria-label="Избранное"><Heart size={19} className={item.is_favorite ? 'fill-rose-500 text-rose-500' : 'text-slate-300'} /></button></div>
      {item.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{item.description}</p>}
      <div className="mt-1.5 flex min-w-0 items-center gap-1"><span className="max-w-[4.5rem] truncate rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] font-bold text-muted min-[380px]:max-w-[6.5rem]">{showCountry ? `${country?.emoji || '✈️'} ${country?.name || ''}` : item.category}</span>{mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg bg-mint-50 px-2 text-[10px] font-extrabold text-mint-700"><MapPin size={12} /> Карта</a>}<span className="flex-1" /><button onClick={onEdit} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted active:bg-slate-100" aria-label="Редактировать"><Pencil size={15} /></button><button onClick={onDelete} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 active:bg-red-50 active:text-red-500" aria-label="Удалить"><Trash2 size={15} /></button></div>
    </div>
  </article>
}

function BottomNav({ value, onChange }) {
  const links = [{ id: 'places', label: 'Места', icon: <Map size={21} /> }, { id: 'favorites', label: 'Избранное', icon: <Heart size={21} /> }, { id: 'settings', label: 'Настройки', icon: <Settings size={21} /> }]
  return <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-100 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur"><div className="mx-auto grid h-[68px] max-w-2xl grid-cols-3 gap-1">{links.map(({ id, label, icon }) => <button key={id} onClick={() => onChange(id)} className={`my-1 flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-bold transition active:scale-[0.98] ${value === id ? 'bg-mint-50 text-mint-700' : 'text-slate-400'}`}>{icon}{label}</button>)}</div></nav>
}

function SettingsScreen({ countries, username, onAdd, onEdit, onDelete }) {
  return <main><header className="mb-5 sm:mb-6"><h1 className="text-[27px] font-extrabold tracking-tight sm:text-[28px]">Настройки</h1><p className="mt-1 text-sm text-muted">@{username}</p></header><section className="rounded-3xl bg-white p-3 shadow-sm sm:p-4"><div className="mb-3 flex items-center justify-between gap-3"><div className="min-w-0"><h2 className="font-extrabold">Страны</h2><p className="text-xs text-muted">Добавляйте направления поездок</p></div><button onClick={onAdd} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-mint-50 text-mint-700 active:scale-95" aria-label="Добавить страну"><Plus size={20} /></button></div><div className="space-y-2">{countries.map((country) => <div key={country.id} className="flex min-h-14 items-center gap-2 rounded-2xl bg-canvas px-3 py-2"><span className="text-2xl">{country.emoji}</span><span className="min-w-0 flex-1 truncate font-bold">{country.name}</span><button onClick={() => onEdit(country)} className="icon-button shrink-0" aria-label={`Редактировать ${country.name}`}><Pencil size={17} /></button><button onClick={() => onDelete(country)} className="icon-button shrink-0 text-red-500" aria-label={`Удалить ${country.name}`}><Trash2 size={17} /></button></div>)}</div></section></main>
}

function ItemSheet({ item, countryId, username, onClose, onSave, onError }) {
  const [form, setForm] = useState({ title: item?.title || '', description: item?.description || '', category: item?.category || 'Заведения', maps_url: item?.maps_url || '', external_url: item?.external_url || '' })
  const [photoFile, setPhotoFile] = useState(null)
  const [photoUrl, setPhotoUrl] = useState(item?.photo_url || '')
  const [photoPath, setPhotoPath] = useState(item?.photo_path || null)
  const [previewing, setPreviewing] = useState(false)
  const [previewMessage, setPreviewMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const importedUrl = useRef('')
  const close = useCallback(() => { if (!saving) onClose() }, [onClose, saving])
  useTelegramBack(true, close)

  async function importLink(url, field) {
    const normalized = normalizeUrl(url)
    if (!normalized || importedUrl.current === normalized) return
    importedUrl.current = normalized
    setPreviewing(true)
    setPreviewMessage('')
    const preview = await getLinkPreview(normalized)
    if (preview) {
      setForm((current) => ({
        ...current,
        [field]: preview.final_url || normalized,
        title: current.title.trim() || preview.title?.trim() || '',
        description: current.description.trim() || preview.description?.trim() || '',
      }))
      if (preview.image_url && !photoFile) { setPhotoUrl(preview.image_url); setPhotoPath(null) }
      setPreviewMessage('Данные заполнены')
      notify()
    } else {
      importedUrl.current = ''
      setPreviewMessage('Не удалось прочитать ссылку')
    }
    setPreviewing(false)
  }

  function importPastedLink(event, field) {
    const url = event.clipboardData.getData('text')
    if (normalizeUrl(url)) window.setTimeout(() => void importLink(url, field), 0)
  }

  function choosePhoto(event) {
    const file = event.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    setPhotoFile(file); setPhotoUrl(URL.createObjectURL(file)); setPhotoPath(null)
  }

  async function submit(event) {
    event.preventDefault()
    const title = form.title.trim(); const mapsUrl = normalizeUrl(form.maps_url); const externalUrl = normalizeUrl(form.external_url)
    if (!title) return onError('Введите название места.')
    if (form.maps_url && !mapsUrl) return onError('Проверьте ссылку Google Maps.')
    if (form.external_url && !externalUrl) return onError('Проверьте ссылку на сайт.')
    setSaving(true)
    let finalPhotoUrl = photoUrl || null; let finalPhotoPath = photoPath
    if (photoFile) {
      const optimized = await optimizePhoto(photoFile); finalPhotoPath = `${countryId}/${storageFileName(optimized)}`
      const { error } = await supabase.storage.from('photos').upload(finalPhotoPath, optimized, { contentType: optimized.type })
      if (error) { setSaving(false); return onError(error.message) }
      finalPhotoUrl = supabase.storage.from('photos').getPublicUrl(finalPhotoPath).data.publicUrl
    }
    const coordinates = extractCoordinates(mapsUrl)
    const values = { country: countryId, title, description: form.description.trim(), category: form.category, maps_url: mapsUrl, external_url: externalUrl, photo_url: finalPhotoUrl, photo_path: finalPhotoPath, ...coordinates, created_by: item?.created_by || username }
    const request = item ? supabase.from('checklist_items').update(values).eq('id', item.id).select().single() : supabase.from('checklist_items').insert(values).select().single()
    const { data, error } = await request
    if (error) { setSaving(false); return onError(error.message) }
    if (item?.photo_path && finalPhotoPath !== item.photo_path) await supabase.storage.from('photos').remove([item.photo_path])
    onSave(data)
  }

  return <Sheet title={item ? 'Редактировать место' : 'Новое место'} onClose={close}>
    <form onSubmit={submit} className="space-y-4 sm:space-y-5">
      <label className="block"><span className="label">Название</span><input autoFocus className="field" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Куда хотите сходить?" /></label>
      <div><span className="label">Категория</span><div className="grid grid-cols-2 gap-2">{CATEGORIES.slice(1).map((value) => <button type="button" key={value} onClick={() => { setForm({ ...form, category: value }); haptic() }} className={`min-h-12 rounded-xl px-3 py-3 text-sm font-bold active:scale-[0.98] ${form.category === value ? 'bg-mint-600 text-white' : 'bg-white text-muted shadow-sm'}`}>{value}</button>)}</div></div>
      <label className="block"><span className="label">Описание</span><textarea className="field min-h-20 resize-none" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Коротко о месте" /></label>
      <label className="block"><span className="label">Google Maps</span><span className="relative block"><MapPin size={17} className="field-icon" /><input className="field pl-10" value={form.maps_url} onChange={(event) => { setForm({ ...form, maps_url: event.target.value }); setPreviewMessage('') }} onPaste={(event) => importPastedLink(event, 'maps_url')} onBlur={(event) => void importLink(event.currentTarget.value, 'maps_url')} placeholder="Вставьте ссылку — данные заполнятся" /></span></label>
      <label className="block"><span className="label">Сайт или карточка места</span><span className="relative block"><Link2 size={17} className="field-icon" /><input className="field pl-10" value={form.external_url} onChange={(event) => { setForm({ ...form, external_url: event.target.value }); setPreviewMessage('') }} onPaste={(event) => importPastedLink(event, 'external_url')} onBlur={(event) => void importLink(event.currentTarget.value, 'external_url')} placeholder="Вставьте ссылку — данные заполнятся" /></span></label>
      {(previewing || previewMessage) && <div className={`-mt-2 flex items-center gap-2 text-xs font-bold ${previewMessage.startsWith('Не') ? 'text-amber-600' : 'text-mint-700'}`}>{previewing ? <><LoaderCircle size={15} className="animate-spin" /> Загружаю название, описание и фото…</> : <><Check size={15} /> {previewMessage}</>}</div>}
      <div><span className="label">Фото</span>{photoUrl ? <div className="relative overflow-hidden rounded-2xl"><img src={photoUrl} alt="Предпросмотр" className="h-40 w-full object-cover" /><button type="button" onClick={() => { setPhotoUrl(''); setPhotoFile(null); setPhotoPath(null) }} className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-xl bg-white/90 text-red-500"><Trash2 size={17} /></button></div> : <label className="flex h-28 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white text-sm font-bold text-muted">{previewing ? <><LoaderCircle size={19} className="animate-spin" /> Загружаю данные…</> : <><ImagePlus size={20} /> Добавить фото</>}<input className="sr-only" type="file" accept="image/*" onChange={choosePhoto} /></label>}{!photoUrl && !previewing && (form.maps_url || form.external_url) && <button type="button" onClick={() => { importedUrl.current = ''; void importLink(form.external_url || form.maps_url, form.external_url ? 'external_url' : 'maps_url') }} className="mt-2 text-xs font-bold text-mint-700">Повторить загрузку по ссылке</button>}</div>
      <button disabled={saving} className="sticky bottom-0 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-4 font-extrabold text-white shadow-xl disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={20} /> : <Check size={20} />} Сохранить</button>
    </form>
  </Sheet>
}

function CountrySheet({ country, order, onClose, onSave, onError }) {
  const [name, setName] = useState(country?.name || '')
  const [emoji, setEmoji] = useState(country?.emoji || '✈️')
  const [saving, setSaving] = useState(false)
  const close = useCallback(() => { if (!saving) onClose() }, [onClose, saving])
  useTelegramBack(true, close)
  async function submit(event) {
    event.preventDefault(); if (!name.trim()) return onError('Введите название страны.')
    setSaving(true)
    const values = { name: name.trim(), emoji: emoji.trim() || '✈️', sort_order: country?.sort_order ?? order }
    const request = country ? supabase.from('countries').update(values).eq('id', country.id).select().single() : supabase.from('countries').insert({ id: crypto.randomUUID(), ...values }).select().single()
    const { data, error } = await request
    if (error) { setSaving(false); return onError(error.message) }
    onSave(data)
  }
  return <Sheet title={country ? 'Редактировать страну' : 'Новая страна'} onClose={close}><form onSubmit={submit} className="space-y-4"><div className="grid grid-cols-[90px_1fr] gap-3"><label><span className="label">Флаг</span><input className="field text-center text-2xl" value={emoji} onChange={(event) => setEmoji(event.target.value)} maxLength={8} /></label><label><span className="label">Название</span><input autoFocus className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Индонезия" maxLength={80} /></label></div><button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-4 font-extrabold text-white">{saving && <LoaderCircle size={19} className="animate-spin" />} Сохранить</button></form></Sheet>
}

function Sheet({ title, onClose, children }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/35 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="max-h-[calc(100dvh-env(safe-area-inset-top)-8px)] w-full max-w-lg overscroll-contain overflow-y-auto rounded-t-[26px] bg-canvas px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:max-h-[94dvh] sm:rounded-[28px] sm:p-5"><header className="sticky top-0 z-10 -mx-1 mb-4 flex items-center justify-between bg-canvas/95 px-1 py-1 backdrop-blur sm:mb-5"><h1 className="text-lg font-extrabold sm:text-xl">{title}</h1><button onClick={onClose} className="icon-button" aria-label="Закрыть"><X size={21} /></button></header>{children}</section></div>
}

function EmptyState({ favorites, onAdd }) {
  return <div className="rounded-3xl bg-white px-6 py-14 text-center shadow-sm"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-mint-50 text-mint-700">{favorites ? <Heart size={22} /> : <MapPin size={22} />}</div><h2 className="font-extrabold">{favorites ? 'Здесь появится любимое' : 'Пока ничего нет'}</h2><p className="mt-1 text-sm text-muted">{favorites ? 'Нажмите на сердце у нужного места.' : 'Добавьте первое место в эту категорию.'}</p>{!favorites && <button onClick={onAdd} className="mt-4 rounded-xl bg-mint-50 px-4 py-2 text-sm font-bold text-mint-700">Добавить место</button>}</div>
}

function ErrorBanner({ text, close }) {
  return <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700"><span>{text}</span><button onClick={close}><X size={17} /></button></div>
}

function Loading() { return <div className="grid min-h-dvh place-items-center text-mint-600"><LoaderCircle className="animate-spin" /></div> }

function AccessDenied({ username }) {
  return <main className="grid min-h-dvh place-items-center px-6 text-center"><div><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-white text-mint-700 shadow-soft"><LockKeyhole size={28} /></div><h1 className="text-2xl font-extrabold">Доступ закрыт</h1><p className="mt-2 text-sm text-muted">{username ? `Аккаунт @${username} не добавлен.` : 'Откройте приложение внутри Telegram.'}</p></div></main>
}
