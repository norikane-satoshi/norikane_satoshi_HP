export interface StoredLookAsset {
  id: string
  sessionId: string
  kind: "image" | "lut"
  name: string
  blob: Blob
  createdAt: number
}

const DB_NAME = "ncs-look-gallery"
const STORE_NAME = "assets"
const SESSION_KEY = "ncs-look-gallery-session"

export function getTabSessionId() {
  const existing = window.sessionStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const value = window.crypto.randomUUID()
  window.sessionStorage.setItem(SESSION_KEY, value)
  return value
}

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = window.indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      const store = database.createObjectStore(STORE_NAME, { keyPath: "id" })
      store.createIndex("sessionId", "sessionId")
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error("保存領域を開けませんでした。"))
})

export async function listSessionAssets(sessionId: string) {
  const database = await openDatabase()
  return new Promise<StoredLookAsset[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly")
    const request = transaction.objectStore(STORE_NAME).index("sessionId").getAll(sessionId)
    request.onsuccess = () => resolve(request.result as StoredLookAsset[])
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
  })
}

export async function saveSessionAsset(asset: StoredLookAsset) {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    transaction.objectStore(STORE_NAME).put(asset)
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function deleteSessionAsset(id: string) {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    transaction.objectStore(STORE_NAME).delete(id)
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () => reject(transaction.error)
  })
}
