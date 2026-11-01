// Recipe photos. Each photo is shrunk on the device, kept in the browser's database
// for offline use, and copied to your Supabase storage so your other devices get it.
import { sync } from './sync.js';
import { uid } from './model.js';

const DB = 'meals-photos';
const STORE = 'photos';
const QUEUE_KEY = 'meals-app.photoQueue';
const BUCKET = 'meal-photos';
const MAX = 1200;

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const idbGet = (id) => idb('readonly', (s) => s.get(id));
const idbPut = (id, blob) => idb('readwrite', (s) => s.put(blob, id));

const urls = new Map();
const loading = new Set();
const missing = new Set();
let onChange = () => {};

const loadQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; } };
const saveQueue = (q) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* full */ } };

function setUrl(id, blob) {
  if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
  urls.set(id, URL.createObjectURL(blob));
}

// The picture's address for an <img>, or '' while it loads (the page redraws when it's ready).
export function photoUrl(id) {
  if (!id) return '';
  if (urls.has(id)) return urls.get(id);
  if (!loading.has(id) && !missing.has(id)) {
    loading.add(id);
    idbGet(id)
      .then((blob) => {
        if (blob) { setUrl(id, blob); onChange(); } else { missing.add(id); fetchMissing(); }
      })
      .catch(() => {})
      .finally(() => loading.delete(id));
  }
  return '';
}

async function shrink(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  } finally {
    URL.revokeObjectURL(src);
  }
}

// Saves a picked or taken photo and returns its id.
export async function savePhoto(file) {
  const blob = await shrink(file);
  if (!blob) throw new Error('Could not read that picture.');
  const id = uid();
  await idbPut(id, blob);
  setUrl(id, blob);
  saveQueue([...loadQueue(), id]);
  if (sync.user) sync.syncNow();
  return id;
}

const path = (id) => `${BUCKET}/${sync.user.id}/${id}.jpg`;

async function upload() {
  for (const id of loadQueue()) {
    const blob = await idbGet(id);
    if (blob) {
      const res = await sync.fileRequest(`/storage/v1/object/${path(id)}`, {
        method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
      });
      if (!res.ok) continue; // try again next sync
    }
    saveQueue(loadQueue().filter((x) => x !== id));
  }
}

let fetching = false;
async function fetchMissing() {
  if (fetching || !sync.user || !missing.size || !navigator.onLine) return;
  fetching = true;
  try {
    for (const id of [...missing]) {
      const res = await sync.fileRequest(`/storage/v1/object/authenticated/${path(id)}`);
      if (!res.ok) continue; // not uploaded yet from the other device
      const blob = await res.blob();
      await idbPut(id, blob);
      missing.delete(id);
      setUrl(id, blob);
      onChange();
    }
  } catch { /* offline: try again next sync */ } finally {
    fetching = false;
  }
}

export function pendingPhotos() { return loadQueue().length; }

export function initPhotos(redraw) {
  onChange = redraw;
  sync.afterSync(async () => {
    await upload();
    await fetchMissing();
  });
}
