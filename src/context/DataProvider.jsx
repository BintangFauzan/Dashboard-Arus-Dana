import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore'
import { firestore } from '../firebase'
import { DataContext } from './dataContext'

const PAGE_SIZE = 50
const ACCESS_QUERY_SIZE = 30
const PAGE_CONFIG = {
  users: { orderField: 'createdAt', label: 'pengguna' },
  feedback: { orderField: 'createdAt', label: 'feedback' },
  campaigns: { orderField: 'startAt', label: 'kampanye' },
  activity: { orderField: 'createdAt', label: 'aktivitas' },
}

function mergePage(current, incoming) {
  const documents = new Map(current.map((item) => [item.id, item]))
  incoming.forEach((item) => documents.set(item.id, item))
  return [...documents.values()]
}

function mergeLivePage(current, incoming) {
  const incomingIds = new Set(incoming.map((item) => item.id))
  return [...incoming, ...current.filter((item) => !incomingIds.has(item.id))]
}

export function DashboardDataProvider({ children }) {
  const [userSearch, setUserSearch] = useState('')
  const [userAccessFilter, setUserAccessFilter] = useState('all')
  const [feedbackFilter, setFeedbackFilter] = useState('all')
  const [feedbackSearch, setFeedbackSearch] = useState('')
  const [users, setUsers] = useState([])
  const [access, setAccess] = useState({})
  const [feedback, setFeedback] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [activity, setActivity] = useState([])
  const [config, setConfig] = useState({
    accessPolicy: null,
    trialPolicy: null,
    inAppNotifications: null,
    inAppNotificationTargets: null,
    feedbackPrompts: null,
  })
  const [pendingSources, setPendingSources] = useState([
    'users', 'feedback', 'campaigns', 'activity', 'accessPolicy',
    'trialPolicy', 'inAppNotifications', 'feedbackPrompts', 'access',
    'inAppNotificationTargets',
  ])
  const [sourceErrors, setSourceErrors] = useState({})
  const [hasMore, setHasMore] = useState({
    users: false,
    feedback: false,
    campaigns: false,
    activity: false,
  })
  const [loadingMore, setLoadingMore] = useState({})
  const [referenceTime, setReferenceTime] = useState(null)
  const [usersLoaded, setUsersLoaded] = useState(false)
  const usersCursor = useRef(null)
  const feedbackCursor = useRef(null)
  const campaignsCursor = useRef(null)
  const activityCursor = useRef(null)
  const loadedUserIdsKey = JSON.stringify(users.map((user) => user.id))

  const settleSource = useCallback((source, error = '') => {
    setReferenceTime(Date.now())
    setPendingSources((current) => current.filter((item) => item !== source))
    setSourceErrors((current) => {
      const next = { ...current }
      if (error) next[source] = error
      else delete next[source]
      return next
    })
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setReferenceTime(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!firestore) return undefined

    const unsubscribers = [
      onSnapshot(query(collection(firestore, 'users'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE)), (snapshot) => {
        setUsers((current) => mergeLivePage(current, snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
        usersCursor.current = snapshot.docs.at(-1) || null
        setHasMore((current) => ({ ...current, users: snapshot.size === PAGE_SIZE }))
        setUsersLoaded(true)
        settleSource('users')
        if (snapshot.empty) {
          setAccess({})
          settleSource('access')
        }
      }, () => {
        setUsersLoaded(true)
        settleSource('users', 'Data pengguna belum dapat dibaca. Periksa Firestore Rules.')
        settleSource('access', 'Status akses pengguna belum dapat dibaca. Periksa Firestore Rules.')
      }),
      onSnapshot(query(collection(firestore, 'feedback'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE)), (snapshot) => {
        setFeedback((current) => mergeLivePage(current, snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
        feedbackCursor.current = snapshot.docs.at(-1) || null
        setHasMore((current) => ({ ...current, feedback: snapshot.size === PAGE_SIZE }))
        settleSource('feedback')
      }, () => settleSource('feedback', 'Data feedback belum dapat dibaca. Periksa Firestore Rules.')),
      onSnapshot(query(collection(firestore, 'accessCampaigns'), orderBy('startAt', 'desc'), limit(PAGE_SIZE)), (snapshot) => {
        setCampaigns((current) => mergeLivePage(current, snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
        campaignsCursor.current = snapshot.docs.at(-1) || null
        setHasMore((current) => ({ ...current, campaigns: snapshot.size === PAGE_SIZE }))
        settleSource('campaigns')
      }, () => settleSource('campaigns', 'Data kampanye belum dapat dibaca.')),
      onSnapshot(query(collection(firestore, 'adminActivity'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE)), (snapshot) => {
        setActivity((current) => mergeLivePage(current, snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
        activityCursor.current = snapshot.docs.at(-1) || null
        setHasMore((current) => ({ ...current, activity: snapshot.size === PAGE_SIZE }))
        settleSource('activity')
      }, () => settleSource('activity', 'Log aktivitas belum dapat dibaca.')),
      onSnapshot(doc(firestore, 'config', 'accessPolicy'), (snapshot) => {
        setConfig((current) => ({ ...current, accessPolicy: snapshot.exists() ? snapshot.data() : null }))
        settleSource('accessPolicy')
      }, () => settleSource('accessPolicy', 'Kebijakan akses belum dapat dibaca.')),
      onSnapshot(doc(firestore, 'config', 'trialPolicy'), (snapshot) => {
        setConfig((current) => ({ ...current, trialPolicy: snapshot.exists() ? snapshot.data() : null }))
        settleSource('trialPolicy')
      }, () => settleSource('trialPolicy', 'Kebijakan trial belum dapat dibaca.')),
      onSnapshot(doc(firestore, 'config', 'inAppNotifications'), (snapshot) => {
        setConfig((current) => ({ ...current, inAppNotifications: snapshot.exists() ? snapshot.data() : null }))
        settleSource('inAppNotifications')
      }, () => settleSource('inAppNotifications', 'Konfigurasi pemberitahuan belum dapat dibaca.')),
      onSnapshot(doc(firestore, 'config', 'inAppNotificationTargets'), (snapshot) => {
        setConfig((current) => ({
          ...current,
          inAppNotificationTargets: snapshot.exists() ? snapshot.data() : null,
        }))
        settleSource('inAppNotificationTargets')
      }, () => settleSource('inAppNotificationTargets', 'Target pemberitahuan belum dapat dibaca.')),
      onSnapshot(doc(firestore, 'config', 'feedbackPrompts'), (snapshot) => {
        setConfig((current) => ({ ...current, feedbackPrompts: snapshot.exists() ? snapshot.data() : null }))
        settleSource('feedbackPrompts')
      }, () => settleSource('feedbackPrompts', 'Konfigurasi prompt belum dapat dibaca.')),
    ]

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [settleSource])

  useEffect(() => {
    if (!firestore || !usersLoaded) return undefined

    const userIds = JSON.parse(loadedUserIdsKey)
    if (userIds.length === 0) return undefined

    const chunks = []
    for (let index = 0; index < userIds.length; index += ACCESS_QUERY_SIZE) {
      chunks.push(userIds.slice(index, index + ACCESS_QUERY_SIZE))
    }
    const successfulChunks = new Set()
    const failedChunks = new Set()
    const unsubscribers = chunks.map((chunk, index) => onSnapshot(
      query(collection(firestore, 'access'), where(documentId(), 'in', chunk)),
      (snapshot) => {
        setAccess((current) => ({
          ...current,
          ...Object.fromEntries(snapshot.docs.map((item) => [item.id, item.data()])),
        }))
        successfulChunks.add(index)
        failedChunks.delete(index)
        if (failedChunks.size > 0) {
          settleSource('access', 'Status akses pengguna belum dapat dibaca. Periksa Firestore Rules.')
        } else if (successfulChunks.size === chunks.length) {
          settleSource('access')
        }
      },
      () => {
        failedChunks.add(index)
        settleSource('access', 'Status akses pengguna belum dapat dibaca. Periksa Firestore Rules.')
      },
    ))

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [loadedUserIdsKey, settleSource, usersLoaded])

  const loadMorePage = useCallback(async (source, setRows) => {
    const cursorRef = {
      users: usersCursor,
      feedback: feedbackCursor,
      campaigns: campaignsCursor,
      activity: activityCursor,
    }[source]
    const cursor = cursorRef.current
    if (!firestore || !cursor || !hasMore[source] || loadingMore[source]) return

    setLoadingMore((current) => ({ ...current, [source]: true }))
    try {
      const { orderField } = PAGE_CONFIG[source]
      const snapshot = await getDocs(query(
        collection(firestore, source === 'activity' ? 'adminActivity' : source === 'campaigns' ? 'accessCampaigns' : source),
        orderBy(orderField, 'desc'),
        startAfter(cursor),
        limit(PAGE_SIZE),
      ))
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      if (snapshot.docs.length > 0) cursorRef.current = snapshot.docs.at(-1)
      setRows((current) => mergePage(current, items))
      setHasMore((current) => ({ ...current, [source]: snapshot.size === PAGE_SIZE }))
      setReferenceTime(Date.now())
      setSourceErrors((current) => {
        const next = { ...current }
        delete next[`${source}More`]
        return next
      })
    } catch {
      const { label } = PAGE_CONFIG[source]
      setSourceErrors((current) => ({
        ...current,
        [`${source}More`]: `Halaman berikutnya untuk ${label} gagal dimuat.`,
      }))
    } finally {
      setLoadingMore((current) => ({ ...current, [source]: false }))
    }
  }, [activityCursor, campaignsCursor, feedbackCursor, hasMore, loadingMore, usersCursor])

  const loadMoreUsers = useCallback(() => loadMorePage('users', setUsers), [loadMorePage])
  const loadMoreFeedback = useCallback(() => loadMorePage('feedback', setFeedback), [loadMorePage])
  const loadMoreCampaigns = useCallback(() => loadMorePage('campaigns', setCampaigns), [loadMorePage])
  const loadMoreActivity = useCallback(() => loadMorePage('activity', setActivity), [loadMorePage])
  const updateFeedbackStatus = useCallback((feedbackId, status) => {
    setFeedback((current) => current.map((item) => (
      item.id === feedbackId ? { ...item, status } : item
    )))
  }, [])

  const value = useMemo(
    () => ({
      userSearch,
      setUserSearch,
      userAccessFilter,
      setUserAccessFilter,
      feedbackFilter,
      setFeedbackFilter,
      feedbackSearch,
      setFeedbackSearch,
      users,
      access,
      feedback,
      campaigns,
      activity,
      config,
      referenceTime,
      hasMore,
      loadingMore,
      loadMoreUsers,
      loadMoreFeedback,
      loadMoreCampaigns,
      loadMoreActivity,
      updateFeedbackStatus,
      isLoading: pendingSources.length > 0,
      dataErrors: Object.values(sourceErrors),
    }),
    [
      userSearch,
      userAccessFilter,
      feedbackFilter,
      feedbackSearch,
      users,
      access,
      feedback,
      campaigns,
      activity,
      config,
      referenceTime,
      hasMore,
      loadingMore,
      loadMoreUsers,
      loadMoreFeedback,
      loadMoreCampaigns,
      loadMoreActivity,
      updateFeedbackStatus,
      pendingSources,
      sourceErrors,
    ],
  )

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  )
}
