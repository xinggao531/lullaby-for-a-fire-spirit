// Local storage for Idea Catcher. Everything lives in IndexedDB on the phone:
// projects, notes and screenshots (stored as Blobs so they stay full quality).

const DB_NAME = 'idea-catcher';
const DB_VERSION = 1;
const STORES = ['projects', 'notes', 'images'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (name !== 'projects') store.createIndex('projectId', 'projectId');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode = 'readonly') {
  const db = await open();
  return db.transaction(store, mode).objectStore(store);
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function getAll(store) {
  return wrap((await tx(store)).getAll());
}

export async function get(store, id) {
  return wrap((await tx(store)).get(id));
}

export async function put(store, value) {
  await wrap((await tx(store, 'readwrite')).put(value));
  return value;
}

export async function remove(store, id) {
  return wrap((await tx(store, 'readwrite')).delete(id));
}

export async function byProject(store, projectId) {
  return wrap((await tx(store)).index('projectId').getAll(projectId));
}

export async function clearAll() {
  for (const s of STORES) await wrap((await tx(s, 'readwrite')).clear());
}

// ---------- Backup ----------

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function exportAll() {
  const images = await getAll('images');
  return {
    app: 'idea-catcher',
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: await getAll('projects'),
    notes: await getAll('notes'),
    images: await Promise.all(
      images.map(async ({ blob, ...rest }) => ({ ...rest, dataURL: await blobToDataURL(blob) }))
    ),
  };
}

export async function importAll(data) {
  if (!data || data.app !== 'idea-catcher') throw new Error('This is not an Idea Catcher backup file.');
  for (const p of data.projects || []) await put('projects', p);
  for (const n of data.notes || []) await put('notes', n);
  for (const { dataURL, ...rest } of data.images || []) {
    const blob = await (await fetch(dataURL)).blob();
    await put('images', { ...rest, blob });
  }
}
