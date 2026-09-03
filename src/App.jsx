import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  CalendarDays, Check, ChevronDown, ExternalLink, ImagePlus, Link2, LoaderCircle,
  LockKeyhole, MapPin, Pencil, Plus, RefreshCw, RotateCcw, Search, Share2, Star,
  Trash2, Wifi, WifiOff, X,
} from 'lucide-react'

const SUPABASE_URL = 'https://grsiborhqvvxssjrxrsk.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_dEMmlwfgL0JE99kOVIgelg_0y0ZWtzW'
const ALLOWED_USERS = new Set(['neverlordd', 'puk_privet'])
const CACHE_KEY = 'travel-checklist-cache-v2'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
})

const COUNTRIES = [
  { id: 'vietnam', name: 'Вьетнам', emoji: '🇻🇳' },
  { id: 'thailand', name: 'Таиланд', emoji: '🇹🇭' },
]
const CATEGORIES = ['Заведения', 'Хайки', 'Города', 'Досуг']
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'todo', label: 'В планах' },
  { id: 'done', label: 'Готово' }, { id: 'favorite', label: 'Избранное' },
]
const EMPTY_FORM = {
  title: '', description: '', category: CATEGORIES[0], latitude: '', longitude: '',
  external_url: '', planned_date: '', priority: '1', is_favorite: false, photo: null,
}

function compareItems(a, b, mode = 'smart') {
  if (mode === 'newest') return String(b.created_at).localeCompare(String(a.created_at))
  if (mode === 'date') {
    const aDate = a.planned_date || '9999-12-31'
    const bDate = b.planned_date || '9999-12-31'
    return aDate.localeCompare(bDate) || Number(b.priority) - Number(a.priority)
  }
  if (mode === 'priority') return Number(b.priority) - Number(a.priority) || Number(b.is_favorite) - Number(a.is_favorite)
  return Number(b.is_favorite) - Number(a.is_favorite)
    || Number(a.is_completed) - Number(b.is_completed)
    || Number(b.priority) - Number(a.priority)
    || String(a.planned_date || '9999').localeCompare(String(b.planned_date || '9999'))
    || String(a.created_at).localeCompare(String(b.created_at))
}

function sortItems(items, mode = 'smart') {
  return [...items].sort((a, b) => compareItems(a, b, mode))
}

function upsertItem(items, nextItem) {
  const currentItem = items.find((item) => item.id === nextItem.id)
  if (currentItem?.updated_at && nextItem.updated_at && currentItem.updated_at > nextItem.updated_at) return items
  return currentItem ? items.map((item) => item.id === nextItem.id ? nextItem : item) : [...items, nextItem]
}

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)) } catch { return fallback }
}

function readCountry() {
  try {
    const saved = localStorage.getItem('travel-checklist-country')
    return COUNTRIES.some((country) => country.id === saved) ? saved : 'vietnam'
  } catch { return 'vietnam' }
}

function getTelegramUser() {
  const webApp = window.Telegram?.WebApp
  webApp?.ready()
  webApp?.expand()
  if (webApp?.isVersionAtLeast?.('6.1')) {
    webApp.setHeaderColor?.('#F9FAFB')
    webApp.setBackgroundColor?.('#F9FAFB')
  }
  const user = webApp?.initDataUnsafe?.user
  if (user?.username) return user
  if (import.meta.env.DEV) return { username: 'neverlordd', first_name: 'Dev' }
  return null
}

function haptic(type = 'light') {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(type)
}

function notifyHaptic(type = 'success') {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(type)
}

function confirmAction(message) {
  const showConfirm = window.Telegram?.WebApp?.showConfirm
  if (showConfirm) return new Promise((resolve) => showConfirm(message, resolve))
  return Promise.resolve(window.confirm(message))
}

function normalizeNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(String(value).replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

function normalizeUrl(value) {
  if (!value.trim()) return null
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
  try {
    const url = new URL(candidate)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch { return null }
}

function storageFileName(file) {
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  return `${crypto.randomUUID()}.${extension}`
}

async function optimizePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1_500_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84))
    return blob ? new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' }) : file
  } catch { return file }
}

function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`))
}

export default function App() {
  const [telegramUser] = useState(getTelegramUser)
  const username = telegramUser?.username?.toLowerCase() || ''
  const hasAccess = ALLOWED_USERS.has(username)
  const [country, setCountry] = useState(readCountry)
  const [items, setItems] = useState(() => readJSON(CACHE_KEY, []))
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('connecting')
  const [lastSync, setLastSync] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sortMode, setSortMode] = useState('smart')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [createCategory, setCreateCategory] = useState(CATEGORIES[0])
  const [pendingDelete, setPendingDelete] = useState(null)
  const deleteTimer = useRef(null)

  const loadItems = useCallback(async (showLoader = false) => {
    if (!hasAccess) return
    if (showLoader) setLoading(true); else setRefreshing(true)
    const { data, error: queryError } = await supabase.from('checklist_items').select('*')
    if (queryError) {
      setSyncStatus('offline')
      setError(`Не удалось загрузить список: ${queryError.message}`)
    } else {
      setItems(data || [])
      setSyncStatus('online')
      setLastSync(new Date())
      setError('')
    }
    setLoading(false)
    setRefreshing(false)
  }, [hasAccess])

  useEffect(() => {
    if (!hasAccess) return undefined
    void loadItems(true)
    const channel = supabase.channel('travel-checklist-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_items' }, (payload) => {
        setSyncStatus('online')
        setLastSync(new Date())
        setItems((current) => payload.eventType === 'DELETE'
          ? current.filter((item) => item.id !== payload.old.id)
          : upsertItem(current, payload.new))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { setSyncStatus('online'); void loadItems(false) }
        if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setSyncStatus('offline')
      })
    const refresh = () => { if (document.visibilityState === 'visible' && navigator.onLine) void loadItems(false) }
    const goOffline = () => setSyncStatus('offline')
    window.addEventListener('online', refresh)
    window.addEventListener('offline', goOffline)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const fallbackRefresh = window.setInterval(refresh, 45000)
    return () => {
      window.clearInterval(fallbackRefresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      supabase.removeChannel(channel)
    }
  }, [hasAccess, loadItems])

  useEffect(() => {
    if (!hasAccess) return
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)) } catch { /* optional cache */ }
  }, [hasAccess, items])
  useEffect(() => { try { localStorage.setItem('travel-checklist-country', country) } catch { /* optional */ } }, [country])
  useEffect(() => () => { if (deleteTimer.current) window.clearTimeout(deleteTimer.current) }, [])
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  const countryItems = useMemo(() => items.filter((item) => item.country === country), [items, country])
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru')
    return sortItems(countryItems.filter((item) => {
      const matchesSearch = !needle || [item.title, item.description, item.category]
        .some((value) => String(value || '').toLocaleLowerCase('ru').includes(needle))
      const matchesFilter = filter === 'all' || (filter === 'todo' && !item.is_completed)
        || (filter === 'done' && item.is_completed) || (filter === 'favorite' && item.is_favorite)
      return matchesSearch && matchesFilter
    }), sortMode)
  }, [countryItems, filter, query, sortMode])
  const completed = countryItems.filter((item) => item.is_completed).length
  const progress = countryItems.length ? Math.round((completed / countryItems.length) * 100) : 0
  const selectedCountry = COUNTRIES.find((item) => item.id === country)

  async function updateItem(item, patch) {
    setItems((current) => upsertItem(current, { ...item, ...patch }))
    const { data, error: updateError } = await supabase.from('checklist_items').update(patch).eq('id', item.id).select().single()
    if (updateError) {
      setItems((current) => upsertItem(current, item))
      setError(`Не удалось сохранить изменение: ${updateError.message}`)
      notifyHaptic('error')
      return
    }
    setItems((current) => upsertItem(current, data))
    setLastSync(new Date())
    notifyHaptic('success')
  }

  async function executeDelete(item) {
    const { data, error: deleteError } = await supabase.from('checklist_items').delete().eq('id', item.id).select('id')
    if (deleteError || !data?.length) {
      setItems((current) => upsertItem(current, item))
      setError(`Не удалось удалить пункт: ${deleteError?.message || 'сервер не подтвердил удаление'}`)
      notifyHaptic('error')
      return
    }
    if (item.photo_path) await supabase.storage.from('photos').remove([item.photo_path])
    setLastSync(new Date())
  }

  async function scheduleDelete(item) {
    if (!await confirmAction(`Удалить «${item.title}»?`)) return
    if (deleteTimer.current && pendingDelete) {
      window.clearTimeout(deleteTimer.current)
      void executeDelete(pendingDelete)
    }
    haptic('medium')
    setItems((current) => current.filter((row) => row.id !== item.id))
    setPendingDelete(item)
    deleteTimer.current = window.setTimeout(() => {
      void executeDelete(item)
      setPendingDelete(null)
      deleteTimer.current = null
    }, 6000)
  }

  function undoDelete() {
    if (!pendingDelete) return
    window.clearTimeout(deleteTimer.current)
    deleteTimer.current = null
    setItems((current) => upsertItem(current, pendingDelete))
    setPendingDelete(null)
    haptic()
  }

  function openCreate(category = CATEGORIES[0]) {
    setEditingItem(null); setCreateCategory(category); setModalOpen(true)
  }
  function openEdit(item) { setEditingItem(item); setModalOpen(true) }

  async function shareItem(item) {
    const mapsUrl = item.latitude != null && item.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}` : ''
    const text = [item.title, item.description, mapsUrl || item.external_url].filter(Boolean).join('\n')
    try {
      if (navigator.share) await navigator.share({ title: item.title, text })
      else { await navigator.clipboard.writeText(text); setNotice('Скопировано') }
    } catch (shareError) {
      if (shareError.name !== 'AbortError') setError('Не удалось поделиться пунктом.')
    }
  }

  function toggleCategory(category) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category); else next.add(category)
      return next
    })
  }

  if (!hasAccess) return <AccessDenied username={username} />
  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] sm:px-6">
      <header className="mb-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-mint-700">Наш маршрут</p><h1 className="text-3xl font-bold tracking-tight text-ink">{selectedCountry.emoji} {selectedCountry.name}</h1></div>
          <button onClick={() => loadItems(false)} className={`flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-semibold shadow-sm ${syncStatus === 'online' ? 'text-mint-700' : 'text-red-600'}`} title={lastSync ? `Синхронизировано ${lastSync.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Подключение'}>
            {syncStatus === 'online' ? <Wifi size={14} /> : <WifiOff size={14} />}{refreshing ? <RefreshCw size={14} className="animate-spin" /> : syncStatus === 'online' ? 'В сети' : 'Нет связи'}
          </button>
        </div>
        <div className="mb-4 grid grid-cols-2 rounded-2xl bg-mint-50 p-1">
          {COUNTRIES.map((item) => <button key={item.id} onClick={() => { setCountry(item.id); haptic() }} className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${country === item.id ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}>{item.emoji} {item.name}</button>)}
        </div>
        <div className="rounded-3xl border border-white bg-white/90 p-4 shadow-soft backdrop-blur">
          <div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium text-muted">{countryItems.length - completed} в планах · {completed} готово</span><span className="font-bold text-mint-700">{progress}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-mint-50"><div className="h-full rounded-full bg-mint-500 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
        </div>
      </header>

      <div className="mb-5 space-y-3">
        <div className="relative"><Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="field py-3 pl-11 pr-10 shadow-sm" placeholder="Найти место или идею" />{query && <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted" aria-label="Очистить поиск"><X size={17} /></button>}</div>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((item) => <button key={item.id} onClick={() => setFilter(item.id)} className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition ${filter === item.id ? 'bg-ink text-white' : 'bg-white text-muted shadow-sm'}`}>{item.label}</button>)}
        </div>
        <div className="flex items-center justify-between gap-3 px-1"><span className="text-xs font-medium text-muted">Показано: {visibleItems.length}</span><label className="relative shrink-0"><select value={sortMode} onChange={(event) => setSortMode(event.target.value)} className="appearance-none rounded-full bg-white py-2 pl-3.5 pr-8 text-xs font-semibold text-muted shadow-sm outline-none"><option value="smart">Сначала важное</option><option value="date">По дате</option><option value="priority">По приоритету</option><option value="newest">Сначала новые</option></select><ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" /></label></div>
      </div>

      {error && <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть"><X size={17} /></button></div>}
      {loading ? <div className="grid place-items-center py-24 text-mint-600"><LoaderCircle className="animate-spin" /></div>
        : visibleItems.length === 0 && (query || filter !== 'all') ? <EmptySearch onReset={() => { setQuery(''); setFilter('all') }} />
          : <main className="space-y-7">{CATEGORIES.map((category) => {
            const categoryItems = visibleItems.filter((item) => item.category === category)
            const isCollapsed = collapsed.has(category)
            if (!categoryItems.length && (query || filter !== 'all')) return null
            return <section key={category}>
              <button onClick={() => toggleCategory(category)} className="mb-3 flex w-full items-center justify-between text-left"><span className="text-lg font-bold underline decoration-mint-200 decoration-4 underline-offset-4">{category}</span><span className="flex items-center gap-2"><span className="rounded-full bg-mint-50 px-2.5 py-1 text-xs font-semibold text-mint-700">{categoryItems.length}</span><ChevronDown size={17} className={`text-muted transition ${isCollapsed ? '-rotate-90' : ''}`} /></span></button>
              {!isCollapsed && (categoryItems.length ? <div className="space-y-3">{categoryItems.map((item) => <ChecklistCard key={item.id} item={item} onToggle={() => { haptic(); void updateItem(item, { is_completed: !item.is_completed }) }} onFavorite={() => { haptic(); void updateItem(item, { is_favorite: !item.is_favorite }) }} onEdit={openEdit} onDelete={scheduleDelete} onShare={shareItem} />)}</div> : <button onClick={() => openCreate(category)} className="w-full rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-5 text-sm text-muted transition hover:border-mint-300 hover:text-mint-700">+ Добавить первый пункт</button>)}
            </section>
          })}</main>}

      <button onClick={() => openCreate()} className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-ink px-5 py-3.5 text-sm font-semibold text-white shadow-xl transition hover:bg-mint-700 active:scale-95"><Plus size={19} /> Добавить место</button>
      {pendingDelete && <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-2xl"><span className="truncate">«{pendingDelete.title}» удалено</span><button onClick={undoDelete} className="flex shrink-0 items-center gap-1.5 font-bold text-mint-200"><RotateCcw size={16} /> Вернуть</button></div>}
      {notice && <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-xl">{notice}</div>}
      {modalOpen && <ItemModal country={country} username={username} item={editingItem} initialCategory={createCategory} onClose={() => setModalOpen(false)} onSaved={(saved) => { setItems((current) => upsertItem(current, saved)); setLastSync(new Date()); setModalOpen(false); notifyHaptic('success') }} onError={setError} />}
    </div>
  )
}

function ChecklistCard({ item, onToggle, onFavorite, onEdit, onDelete, onShare }) {
  const mapsUrl = item.latitude != null && item.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}` : null
  const priority = Number(item.priority || 1)
  return <article className={`overflow-hidden rounded-3xl border bg-white shadow-sm transition ${item.is_completed ? 'border-mint-100' : 'border-slate-100'}`}>
    {item.photo_url && <div className="relative"><img src={item.photo_url} alt="" className={`h-44 w-full object-cover transition ${item.is_completed ? 'opacity-70' : ''}`} loading="lazy" /><button onClick={onFavorite} className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-2xl bg-white/90 shadow-sm backdrop-blur" aria-label="Избранное"><Star size={19} className={item.is_favorite ? 'fill-amber-400 text-amber-400' : 'text-slate-500'} /></button></div>}
    <div className="flex gap-3 p-4">
      <button onClick={onToggle} aria-label={item.is_completed ? 'Вернуть в планы' : 'Отметить готовым'} className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border-2 transition active:scale-90 ${item.is_completed ? 'border-mint-500 bg-mint-500 text-white' : 'border-slate-300 bg-white text-transparent'}`}><Check size={18} strokeWidth={3} /></button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2"><h3 className={`min-w-0 flex-1 break-words font-semibold leading-snug ${item.is_completed ? 'text-muted line-through decoration-mint-400' : 'text-ink'}`}>{item.title}</h3>{!item.photo_url && <button onClick={onFavorite} className="-mt-1 rounded-xl p-1.5" aria-label="Избранное"><Star size={18} className={item.is_favorite ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} /></button>}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold">{priority > 1 && <span className={`rounded-full px-2 py-1 ${priority === 3 ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-700'}`}>{priority === 3 ? 'Важно' : 'Средний приоритет'}</span>}{item.planned_date && <span className="flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-muted"><CalendarDays size={12} /> {formatDate(item.planned_date)}</span>}</div>
        {item.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">{item.description}</p>}
        <div className="mt-3 flex flex-wrap gap-2">{mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-mint-50 px-3 py-2 text-xs font-semibold text-mint-700"><MapPin size={15} /> Карта</a>}{item.external_url && <a href={item.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-muted"><ExternalLink size={14} /> Ссылка</a>}<button onClick={() => onShare(item)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-muted"><Share2 size={14} /> Поделиться</button></div>
      </div>
      <div className="flex shrink-0 flex-col"><button className="icon-button" onClick={() => onEdit(item)} aria-label="Редактировать"><Pencil size={17} /></button><button className="icon-button hover:bg-red-50 hover:text-red-600" onClick={() => onDelete(item)} aria-label="Удалить"><Trash2 size={17} /></button></div>
    </div>
  </article>
}

function ItemModal({ country, username, item, initialCategory, onClose, onSaved, onError }) {
  const draftKey = `travel-checklist-draft-${country}`
  const draft = readJSON(draftKey, {})
  const [form, setForm] = useState(() => item ? {
    title: item.title, description: item.description || '', category: item.category,
    latitude: item.latitude ?? '', longitude: item.longitude ?? '', external_url: item.external_url || '',
    planned_date: item.planned_date || '', priority: String(item.priority || 1), is_favorite: Boolean(item.is_favorite), photo: null,
  } : { ...EMPTY_FORM, ...draft, category: draft.category || initialCategory, photo: null })
  const [preview, setPreview] = useState(item?.photo_url || '')
  const [removePhoto, setRemovePhoto] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const webApp = window.Telegram?.WebApp
    const close = () => { if (!saving) onClose() }
    const onKeyDown = (event) => { if (event.key === 'Escape') close() }
    if (webApp?.isVersionAtLeast?.('6.1')) {
      webApp.BackButton?.show?.(); webApp.onEvent?.('backButtonClicked', close)
    }
    document.addEventListener('keydown', onKeyDown); document.body.style.overflow = 'hidden'
    return () => {
      if (webApp?.isVersionAtLeast?.('6.1')) {
        webApp.offEvent?.('backButtonClicked', close); webApp.BackButton?.hide?.()
      }
      document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = ''
      if (preview.startsWith('blob:')) URL.revokeObjectURL(preview)
    }
  }, [onClose, preview, saving])

  useEffect(() => {
    if (item) return
    const { photo: _photo, ...savedDraft } = form
    try { localStorage.setItem(draftKey, JSON.stringify(savedDraft)) } catch { /* optional draft */ }
  }, [draftKey, form, item])

  function updateField(event) {
    const { name, value, type, checked } = event.target
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }
  function choosePhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return onError('Можно загружать только изображения.')
    if (file.size > 10 * 1024 * 1024) return onError('Фото должно быть меньше 10 МБ.')
    if (preview.startsWith('blob:')) URL.revokeObjectURL(preview)
    setForm((current) => ({ ...current, photo: file })); setPreview(URL.createObjectURL(file)); setRemovePhoto(false)
  }

  async function submit(event) {
    event.preventDefault()
    const title = form.title.trim(); const latitude = normalizeNumber(form.latitude); const longitude = normalizeNumber(form.longitude)
    const hasOneCoordinate = (form.latitude !== '' && form.longitude === '') || (form.latitude === '' && form.longitude !== '')
    const externalUrl = normalizeUrl(form.external_url)
    if (!title) return onError('Введите название.')
    if (form.external_url.trim() && !externalUrl) return onError('Проверьте ссылку.')
    if (hasOneCoordinate || (form.latitude !== '' && latitude === null) || (form.longitude !== '' && longitude === null)) return onError('Укажите корректные широту и долготу — либо оставьте оба поля пустыми.')
    if (latitude !== null && (latitude < -90 || latitude > 90)) return onError('Широта должна быть от −90 до 90.')
    if (longitude !== null && (longitude < -180 || longitude > 180)) return onError('Долгота должна быть от −180 до 180.')
    setSaving(true)
    let uploadedPath = null; let photoUrl = removePhoto ? null : item?.photo_url || null; let photoPath = removePhoto ? null : item?.photo_path || null
    if (form.photo) {
      const optimized = await optimizePhoto(form.photo); uploadedPath = `${country}/${storageFileName(optimized)}`
      const { error: uploadError } = await supabase.storage.from('photos').upload(uploadedPath, optimized, { cacheControl: '3600', contentType: optimized.type, upsert: false })
      if (uploadError) { setSaving(false); return onError(`Не удалось загрузить фото: ${uploadError.message}`) }
      photoPath = uploadedPath; photoUrl = supabase.storage.from('photos').getPublicUrl(uploadedPath).data.publicUrl
    }
    const values = {
      country, category: form.category, title, description: form.description.trim(), latitude, longitude,
      external_url: externalUrl, planned_date: form.planned_date || null, priority: Number(form.priority),
      is_favorite: form.is_favorite, photo_url: photoUrl, photo_path: photoPath, created_by: item?.created_by || username,
    }
    const request = item ? supabase.from('checklist_items').update(values).eq('id', item.id).select().single() : supabase.from('checklist_items').insert(values).select().single()
    const { data, error: saveError } = await request
    if (saveError) {
      if (uploadedPath) await supabase.storage.from('photos').remove([uploadedPath])
      setSaving(false); return onError(`Не удалось сохранить пункт: ${saveError.message}`)
    }
    if (item?.photo_path && (uploadedPath || removePhoto)) await supabase.storage.from('photos').remove([item.photo_path])
    if (!item) localStorage.removeItem(draftKey)
    onSaved(data)
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <div role="dialog" aria-modal="true" aria-labelledby="modal-title" className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-canvas p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:p-6">
      <div className="mb-5 flex items-center justify-between"><div><h2 id="modal-title" className="text-xl font-bold">{item ? 'Редактировать' : 'Новое место'}</h2>{!item && <p className="mt-0.5 text-xs text-muted">Черновик сохраняется автоматически</p>}</div><button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="Закрыть"><X size={21} /></button></div>
      <form onSubmit={submit} className="space-y-4">
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Название *</span><input id="item-title" name="title" value={form.title} onChange={updateField} className="field" maxLength={160} autoFocus placeholder="Например, водопад Бахо" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="block"><span className="mb-1.5 block text-sm font-semibold">Категория</span><select name="category" value={form.category} onChange={updateField} className="field">{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-sm font-semibold">Дата</span><input type="date" name="planned_date" value={form.planned_date} onChange={updateField} className="field" /></label></div>
        <div><span className="mb-1.5 block text-sm font-semibold">Приоритет</span><div className="grid grid-cols-3 rounded-2xl bg-slate-100 p-1">{[['1', 'Обычный'], ['2', 'Средний'], ['3', 'Важно']].map(([value, label]) => <button type="button" key={value} onClick={() => setForm((current) => ({ ...current, priority: value }))} className={`rounded-xl px-2 py-2 text-xs font-semibold transition ${form.priority === value ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}>{label}</button>)}</div></div>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Описание</span><textarea name="description" value={form.description} onChange={updateField} className="field min-h-24 resize-y" placeholder="Что важно знать об этом месте" /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Ссылка</span><span className="relative block"><Link2 size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input name="external_url" inputMode="url" value={form.external_url} onChange={updateField} className="field pl-10" placeholder="Сайт, пост или бронь" /></span></label>
        <div><span className="mb-1.5 block text-sm font-semibold">Фото</span>{preview && !removePhoto ? <div className="relative overflow-hidden rounded-2xl bg-slate-100"><img src={preview} alt="Предпросмотр" className="h-48 w-full object-cover" /><button type="button" onClick={() => { setRemovePhoto(true); setForm((current) => ({ ...current, photo: null })) }} className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-xl bg-white/90 text-red-600 shadow-sm" aria-label="Удалить фото"><Trash2 size={17} /></button></div> : <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm font-medium text-muted transition hover:border-mint-400 hover:text-mint-700"><ImagePlus size={20} /> Выбрать фото<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={choosePhoto} className="sr-only" /></label>}</div>
        <div><span className="mb-1.5 block text-sm font-semibold">Координаты</span><div className="grid grid-cols-2 gap-3"><input name="latitude" inputMode="decimal" value={form.latitude} onChange={updateField} className="field" placeholder="Широта" /><input name="longitude" inputMode="decimal" value={form.longitude} onChange={updateField} className="field" placeholder="Долгота" /></div><p className="mt-1.5 text-xs text-muted">Можно скопировать из Google Maps</p></div>
        <label className="flex cursor-pointer items-center justify-between rounded-2xl bg-white px-4 py-3"><span className="flex items-center gap-2 text-sm font-semibold"><Star size={18} className="text-amber-400" /> Добавить в избранное</span><input type="checkbox" name="is_favorite" checked={form.is_favorite} onChange={updateField} className="h-5 w-5 accent-teal-600" /></label>
        <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mint-600 px-5 py-3.5 font-semibold text-white shadow-sm transition hover:bg-mint-700 disabled:opacity-60">{saving ? <><LoaderCircle size={19} className="animate-spin" /> Сохраняю…</> : <><Check size={19} /> Сохранить</>}</button>
      </form>
    </div>
  </div>
}

function EmptySearch({ onReset }) {
  return <div className="rounded-3xl bg-white px-6 py-12 text-center shadow-sm"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-mint-50 text-mint-700"><Search size={22} /></div><h2 className="font-bold">Ничего не найдено</h2><p className="mt-1 text-sm text-muted">Попробуйте другой запрос или сбросьте фильтры.</p><button onClick={onReset} className="mt-4 rounded-xl bg-mint-50 px-4 py-2 text-sm font-semibold text-mint-700">Сбросить фильтры</button></div>
}

function AccessDenied({ username }) {
  return <main className="grid min-h-dvh place-items-center px-6 text-center"><div className="max-w-sm"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-white text-mint-700 shadow-soft"><LockKeyhole size={28} /></div><h1 className="text-2xl font-bold tracking-tight">Доступ закрыт</h1><p className="mt-2 text-sm leading-relaxed text-muted">{username ? `Аккаунт @${username} не добавлен в белый список.` : 'Откройте приложение внутри Telegram из меню бота.'}</p></div></main>
}
