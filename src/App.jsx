import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  Check,
  ChevronDown,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'

const SUPABASE_URL = 'https://grsiborhqvvxssjrxrsk.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_dEMmlwfgL0JE99kOVIgelg_0y0ZWtzW'
const ALLOWED_USERS = new Set(['neverlordd', 'puk_privet'])

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const COUNTRIES = [
  { id: 'vietnam', name: 'Вьетнам', emoji: '🇻🇳' },
  { id: 'thailand', name: 'Таиланд', emoji: '🇹🇭' },
]
const CATEGORIES = ['Заведения', 'Хайки', 'Города', 'Досуг']
const EMPTY_FORM = {
  title: '',
  description: '',
  category: CATEGORIES[0],
  latitude: '',
  longitude: '',
  photo: null,
}

function getTelegramUser() {
  const webApp = window.Telegram?.WebApp
  webApp?.ready()
  webApp?.expand()
  if (webApp) {
    webApp.setHeaderColor?.('#F9FAFB')
    webApp.setBackgroundColor?.('#F9FAFB')
  }

  const user = webApp?.initDataUnsafe?.user
  if (user?.username) return user

  // Только локальная разработка. В production обход отсутствует.
  if (import.meta.env.DEV) return { username: 'neverlordd', first_name: 'Dev' }
  return null
}

function haptic(type = 'light') {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(type)
}

function normalizeNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(String(value).replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

function storageFileName(file) {
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  return `${crypto.randomUUID()}.${extension}`
}

export default function App() {
  const [telegramUser] = useState(getTelegramUser)
  const username = telegramUser?.username?.toLowerCase() || ''
  const hasAccess = ALLOWED_USERS.has(username)
  const [country, setCountry] = useState('vietnam')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [createCategory, setCreateCategory] = useState(CATEGORIES[0])

  const loadItems = useCallback(async (showLoader = false) => {
    if (!hasAccess) return
    if (showLoader) setLoading(true)

    const { data, error: queryError } = await supabase
      .from('checklist_items')
      .select('*')
      .order('created_at', { ascending: true })

    if (queryError) setError(`Не удалось загрузить список: ${queryError.message}`)
    else {
      setItems(data || [])
      setError('')
    }
    setLoading(false)
  }, [hasAccess])

  useEffect(() => {
    if (!hasAccess) return undefined
    loadItems(true)

    const channel = supabase
      .channel('travel-checklist-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checklist_items' },
        () => loadItems(false),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') setError('Realtime временно недоступен. Обновите приложение.')
      })

    return () => { supabase.removeChannel(channel) }
  }, [hasAccess, loadItems])

  const countryItems = useMemo(
    () => items.filter((item) => item.country === country),
    [items, country],
  )
  const completed = countryItems.filter((item) => item.is_completed).length
  const progress = countryItems.length ? Math.round((completed / countryItems.length) * 100) : 0
  const selectedCountry = COUNTRIES.find((item) => item.id === country)

  async function toggleItem(item) {
    haptic()
    const nextValue = !item.is_completed
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, is_completed: nextValue } : row))

    const { error: updateError } = await supabase
      .from('checklist_items')
      .update({ is_completed: nextValue })
      .eq('id', item.id)

    if (updateError) {
      setItems((current) => current.map((row) => row.id === item.id ? item : row))
      setError(`Не удалось обновить пункт: ${updateError.message}`)
    }
  }

  async function deleteItem(item) {
    if (!window.confirm(`Удалить «${item.title}»?`)) return
    haptic('medium')

    const { error: deleteError } = await supabase.from('checklist_items').delete().eq('id', item.id)
    if (deleteError) {
      setError(`Не удалось удалить пункт: ${deleteError.message}`)
      return
    }

    if (item.photo_path) await supabase.storage.from('photos').remove([item.photo_path])
    setItems((current) => current.filter((row) => row.id !== item.id))
  }

  function openCreate(category = CATEGORIES[0]) {
    setEditingItem(null)
    setCreateCategory(category)
    setModalOpen(true)
    window.setTimeout(() => document.getElementById('item-title')?.focus(), 100)
  }

  function openEdit(item) {
    setEditingItem(item)
    setModalOpen(true)
  }

  if (!hasAccess) return <AccessDenied username={username} />

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-6">
      <header className="mb-7">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-mint-700">Наш маршрут</p>
            <h1 className="text-3xl font-bold tracking-tight text-ink">{selectedCountry.emoji} {selectedCountry.name}</h1>
          </div>
          <label className="relative">
            <span className="sr-only">Выбрать страну</span>
            <select
              value={country}
              onChange={(event) => { setCountry(event.target.value); haptic() }}
              className="appearance-none rounded-2xl border border-mint-100 bg-white py-3 pl-4 pr-10 text-sm font-semibold text-ink shadow-sm outline-none focus:border-mint-400 focus:ring-4 focus:ring-mint-100"
            >
              {COUNTRIES.map((item) => <option key={item.id} value={item.id}>{item.emoji} {item.name}</option>)}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          </label>
        </div>

        <div className="rounded-3xl border border-white bg-white/90 p-4 shadow-soft backdrop-blur">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-muted">Готово {completed} из {countryItems.length}</span>
            <span className="font-bold text-mint-700">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-mint-50">
            <div className="h-full rounded-full bg-mint-500 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Закрыть"><X size={17} /></button>
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-24 text-mint-600"><LoaderCircle className="animate-spin" /></div>
      ) : (
        <main className="space-y-8">
          {CATEGORIES.map((category) => {
            const categoryItems = countryItems.filter((item) => item.category === category)
            return (
              <section key={category}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-bold underline decoration-mint-200 decoration-4 underline-offset-4">{category}</h2>
                  <span className="rounded-full bg-mint-50 px-2.5 py-1 text-xs font-semibold text-mint-700">{categoryItems.length}</span>
                </div>
                {categoryItems.length ? (
                  <div className="space-y-3">
                    {categoryItems.map((item) => (
                      <ChecklistCard key={item.id} item={item} onToggle={toggleItem} onEdit={openEdit} onDelete={deleteItem} />
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => openCreate(category)}
                    className="w-full rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-5 text-sm text-muted transition hover:border-mint-300 hover:text-mint-700"
                  >
                    + Добавить первый пункт
                  </button>
                )}
              </section>
            )
          })}
        </main>
      )}

      <button
        onClick={() => openCreate()}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-ink px-5 py-3.5 text-sm font-semibold text-white shadow-xl transition hover:bg-mint-700 active:scale-95"
      >
        <Plus size={19} /> Добавить место
      </button>

      {modalOpen && (
        <ItemModal
          country={country}
          username={username}
          item={editingItem}
          initialCategory={createCategory}
          onClose={() => setModalOpen(false)}
          onSaved={(saved) => {
            setItems((current) => editingItem
              ? current.map((row) => row.id === saved.id ? saved : row)
              : [...current, saved])
            setModalOpen(false)
            haptic('medium')
          }}
          onError={setError}
        />
      )}
    </div>
  )
}

function ChecklistCard({ item, onToggle, onEdit, onDelete }) {
  const mapsUrl = item.latitude !== null && item.longitude !== null
    ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`
    : null

  return (
    <article className={`overflow-hidden rounded-3xl border bg-white shadow-sm transition ${item.is_completed ? 'border-mint-100' : 'border-slate-100'}`}>
      {item.photo_url && (
        <img src={item.photo_url} alt="" className={`h-44 w-full object-cover transition ${item.is_completed ? 'opacity-75' : ''}`} loading="lazy" />
      )}
      <div className="flex gap-3 p-4">
        <button
          onClick={() => onToggle(item)}
          aria-label={item.is_completed ? 'Отметить невыполненным' : 'Отметить выполненным'}
          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl border-2 transition active:scale-90 ${item.is_completed ? 'border-mint-500 bg-mint-500 text-white' : 'border-slate-300 bg-white text-transparent'}`}
        >
          <Check size={17} strokeWidth={3} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className={`break-words font-semibold leading-snug ${item.is_completed ? 'text-muted line-through decoration-mint-400' : 'text-ink'}`}>{item.title}</h3>
          {item.description && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">{item.description}</p>}
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-mint-50 px-3 py-2 text-xs font-semibold text-mint-700 transition hover:bg-mint-100">
              <MapPin size={15} /> Открыть на карте
            </a>
          )}
        </div>
        <div className="flex shrink-0 flex-col">
          <button className="icon-button" onClick={() => onEdit(item)} aria-label="Редактировать"><Pencil size={17} /></button>
          <button className="icon-button hover:bg-red-50 hover:text-red-600" onClick={() => onDelete(item)} aria-label="Удалить"><Trash2 size={17} /></button>
        </div>
      </div>
    </article>
  )
}

function ItemModal({ country, username, item, initialCategory, onClose, onSaved, onError }) {
  const [form, setForm] = useState(() => item ? {
    title: item.title,
    description: item.description || '',
    category: item.category,
    latitude: item.latitude ?? '',
    longitude: item.longitude ?? '',
    photo: null,
  } : { ...EMPTY_FORM, category: initialCategory })
  const [preview, setPreview] = useState(item?.photo_url || '')
  const [removePhoto, setRemovePhoto] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
      if (preview.startsWith('blob:')) URL.revokeObjectURL(preview)
    }
  }, [onClose, preview, saving])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  function choosePhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return onError('Можно загружать только изображения.')
    if (file.size > 10 * 1024 * 1024) return onError('Фото должно быть меньше 10 МБ.')
    if (preview.startsWith('blob:')) URL.revokeObjectURL(preview)
    setForm((current) => ({ ...current, photo: file }))
    setPreview(URL.createObjectURL(file))
    setRemovePhoto(false)
  }

  async function submit(event) {
    event.preventDefault()
    const title = form.title.trim()
    const latitude = normalizeNumber(form.latitude)
    const longitude = normalizeNumber(form.longitude)
    const hasOneCoordinate = (form.latitude !== '' && form.longitude === '') || (form.latitude === '' && form.longitude !== '')

    if (!title) return onError('Введите название.')
    if (hasOneCoordinate || (form.latitude !== '' && latitude === null) || (form.longitude !== '' && longitude === null)) {
      return onError('Укажите корректные широту и долготу — либо оставьте оба поля пустыми.')
    }
    if (latitude !== null && (latitude < -90 || latitude > 90)) return onError('Широта должна быть от −90 до 90.')
    if (longitude !== null && (longitude < -180 || longitude > 180)) return onError('Долгота должна быть от −180 до 180.')

    setSaving(true)
    let uploadedPath = null
    let photoUrl = removePhoto ? null : item?.photo_url || null
    let photoPath = removePhoto ? null : item?.photo_path || null

    if (form.photo) {
      uploadedPath = `${country}/${storageFileName(form.photo)}`
      const { error: uploadError } = await supabase.storage.from('photos').upload(uploadedPath, form.photo, {
        cacheControl: '3600',
        contentType: form.photo.type,
        upsert: false,
      })
      if (uploadError) {
        setSaving(false)
        return onError(`Не удалось загрузить фото: ${uploadError.message}`)
      }
      photoPath = uploadedPath
      photoUrl = supabase.storage.from('photos').getPublicUrl(uploadedPath).data.publicUrl
    }

    const values = {
      country,
      category: form.category,
      title,
      description: form.description.trim(),
      latitude,
      longitude,
      photo_url: photoUrl,
      photo_path: photoPath,
      created_by: item?.created_by || username,
    }

    const query = item
      ? supabase.from('checklist_items').update(values).eq('id', item.id).select().single()
      : supabase.from('checklist_items').insert(values).select().single()
    const { data, error: saveError } = await query

    if (saveError) {
      if (uploadedPath) await supabase.storage.from('photos').remove([uploadedPath])
      setSaving(false)
      return onError(`Не удалось сохранить пункт: ${saveError.message}`)
    }

    const oldPhotoWasReplaced = item?.photo_path && (uploadedPath || removePhoto)
    if (oldPhotoWasReplaced) await supabase.storage.from('photos').remove([item.photo_path])
    onSaved(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title" className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-canvas p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="modal-title" className="text-xl font-bold">{item ? 'Редактировать' : 'Новое место'}</h2>
          <button className="icon-button" onClick={onClose} disabled={saving} aria-label="Закрыть"><X size={21} /></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Название *</span>
            <input id="item-title" name="title" value={form.title} onChange={updateField} className="field" maxLength={160} placeholder="Например, водопад Бахо" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Категория</span>
            <select name="category" value={form.category} onChange={updateField} className="field">
              {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Описание</span>
            <textarea name="description" value={form.description} onChange={updateField} className="field min-h-24 resize-y" placeholder="Что важно знать об этом месте" />
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-semibold">Фото</span>
            {preview && !removePhoto ? (
              <div className="relative overflow-hidden rounded-2xl bg-slate-100">
                <img src={preview} alt="Предпросмотр" className="h-48 w-full object-cover" />
                <button type="button" onClick={() => { setRemovePhoto(true); setForm((current) => ({ ...current, photo: null })) }} className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-xl bg-white/90 text-red-600 shadow-sm" aria-label="Удалить фото"><Trash2 size={17} /></button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm font-medium text-muted transition hover:border-mint-400 hover:text-mint-700">
                <ImagePlus size={20} /> Выбрать фото
                <input type="file" accept="image/*" onChange={choosePhoto} className="sr-only" />
              </label>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-semibold">Координаты Google Maps</span>
            <div className="grid grid-cols-2 gap-3">
              <input name="latitude" inputMode="decimal" value={form.latitude} onChange={updateField} className="field" placeholder="Широта" />
              <input name="longitude" inputMode="decimal" value={form.longitude} onChange={updateField} className="field" placeholder="Долгота" />
            </div>
          </div>

          <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mint-600 px-5 py-3.5 font-semibold text-white shadow-sm transition hover:bg-mint-700 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? <><LoaderCircle size={19} className="animate-spin" /> Сохраняю…</> : <><Check size={19} /> Сохранить</>}
          </button>
        </form>
      </div>
    </div>
  )
}

function AccessDenied({ username }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-white text-mint-700 shadow-soft"><LockKeyhole size={28} /></div>
        <h1 className="text-2xl font-bold tracking-tight">Доступ закрыт</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {username ? `Аккаунт @${username} не добавлен в белый список.` : 'Откройте приложение внутри Telegram из меню бота.'}
        </p>
      </div>
    </main>
  )
}
