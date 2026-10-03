import * as db from './db.js';
import { CATEGORIES, KINDS, categoryById, hasKey, organizeWithClaude, organizeOffline } from './ai.js';

const PENDING = '__pending';
const app = document.getElementById('app');

// ---------- tiny DOM helper (all user text goes through textContent) ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || (k in el && typeof v !== 'string')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach((old) => old.remove());
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// ---------- formatting ----------

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now - 864e5).toDateString() === d.toDateString();
  if (sameDay) return `Today · ${time}`;
  if (yesterday) return `Yesterday · ${time}`;
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString([], opts)} · ${time}`;
}

const KIND_LABEL = { idea: '💡 Idea', todo: '✅ To-do', reference: '🔖 Reference', question: '❓ Question', journal: '📝 Journal' };

// ---------- data helpers ----------

async function loadAll() {
  const [projects, notes, images] = await Promise.all([db.getAll('projects'), db.getAll('notes'), db.getAll('images')]);
  return { projects, notes, images };
}

async function touchProject(id) {
  const p = await db.get('projects', id);
  if (p) await db.put('projects', { ...p, updatedAt: Date.now() });
}

async function deleteProject(id) {
  for (const n of await db.byProject('notes', id)) await db.remove('notes', n.id);
  for (const i of await db.byProject('images', id)) await db.remove('images', i.id);
  await db.remove('projects', id);
}

// ---------- images ----------

async function resizeImage(file, max = 1568) {
  const bitmap = await createImageBitmap(file).catch(async () => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    return img;
  });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const urlCache = new Map();
function imgURL(image) {
  if (!urlCache.has(image.id)) urlCache.set(image.id, URL.createObjectURL(image.blob));
  return urlCache.get(image.id);
}

function pickImages(multiple = true) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve([...input.files]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

// ---------- filing: raw note -> organized notes in projects ----------

let filing = Promise.resolve();

// Saves the raw capture first (so nothing is lost if the phone locks mid-way),
// then sorts it. Captures are filed one at a time so a new project created by
// one note is visible when the next note is sorted.
async function capture({ text, imageBlob }) {
  const createdAt = Date.now();
  let imageId = null;
  if (imageBlob) {
    imageId = db.uid();
    await db.put('images', { id: imageId, projectId: PENDING, blob: imageBlob, createdAt, caption: '' });
  }
  const pending = await db.put('notes', { id: db.uid(), projectId: PENDING, text, raw: text, imageId, createdAt });
  filing = filing.then(() => fileNote(pending)).catch((e) => console.error(e));
  return filing;
}

async function resolveProject(item, projects) {
  let project = item.project_id && projects.find((p) => p.id === item.project_id);
  if (!project && item.new_project_name) {
    const name = item.new_project_name.trim().toLowerCase();
    project = projects.find((p) => p.name.trim().toLowerCase() === name);
  }
  if (!project) {
    project = {
      id: db.uid(),
      name: item.new_project_name || 'Untitled project',
      category: item.new_project_category,
      summary: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    projects.push(project);
  }
  if (item.project_summary) project.summary = item.project_summary;
  if (!CATEGORIES.some((c) => c.id === project.category)) project.category = item.new_project_category;
  project.updatedAt = Date.now();
  await db.put('projects', project);
  return project;
}

async function sortText({ text, imageBlob, createdAt, projects }) {
  if (hasKey() && navigator.onLine) {
    try {
      const image = imageBlob ? { base64: await blobToBase64(imageBlob), mediaType: imageBlob.type || 'image/jpeg' } : null;
      const items = await organizeWithClaude({ text, image, projects, when: new Date(createdAt) });
      return { items, by: 'claude' };
    } catch (e) {
      console.error(e);
      toast(`Couldn't reach Claude (${e.message || e}). Filed by keywords for now.`, 4000);
    }
  }
  return { items: organizeOffline({ text: text || 'Screenshot', projects }), by: 'keywords' };
}

async function fileNote(pending) {
  setBusy(true);
  try {
    const projects = await db.getAll('projects');
    const image = pending.imageId ? await db.get('images', pending.imageId) : null;
    const { items, by } = await sortText({
      text: pending.text,
      imageBlob: image?.blob,
      createdAt: pending.createdAt,
      projects,
    });

    let firstProject = null;
    const names = new Set();
    for (const [i, item] of items.entries()) {
      const project = await resolveProject(item, projects);
      firstProject ||= project;
      names.add(project.name);
      if (image && !pending.text.trim() && i === 0) {
        // A bare screenshot: its description becomes the image caption, not a separate note.
        continue;
      }
      await db.put('notes', {
        id: i === 0 ? pending.id : db.uid(),
        projectId: project.id,
        title: item.title,
        text: item.note,
        raw: pending.raw,
        kind: KINDS.includes(item.kind) ? item.kind : 'idea',
        tags: item.tags || [],
        createdAt: pending.createdAt,
        organizedBy: by,
      });
    }
    if (image && !pending.text.trim()) await db.remove('notes', pending.id);
    if (image) {
      await db.put('images', {
        ...image,
        projectId: firstProject.id,
        caption: items[0].title,
        description: items[0].note,
        organizedBy: by,
      });
    }
    toast(`Filed under ${[...names].join(', ')}${by === 'claude' ? ' ✨' : ''}`);
  } finally {
    setBusy(false);
    render();
  }
}

// Re-sort notes that were filed by keywords (no key / offline at the time).
async function resortWithClaude() {
  const notes = (await db.getAll('notes')).filter((n) => n.organizedBy === 'keywords');
  const images = (await db.getAll('images')).filter((i) => i.organizedBy === 'keywords');
  if (!notes.length && !images.length) return toast('Nothing to re-sort.');
  setBusy(true);
  let done = 0;
  try {
    const projects = await db.getAll('projects');
    const autoProjects = new Set();
    for (const n of notes) {
      const items = await organizeWithClaude({ text: n.raw || n.text, projects, when: new Date(n.createdAt) });
      autoProjects.add(n.projectId);
      for (const [i, item] of items.entries()) {
        const project = await resolveProject(item, projects);
        await db.put('notes', {
          ...n,
          id: i === 0 ? n.id : db.uid(),
          projectId: project.id,
          title: item.title,
          text: item.note,
          kind: item.kind,
          tags: item.tags,
          organizedBy: 'claude',
        });
      }
      done++;
    }
    for (const img of images) {
      const items = await organizeWithClaude({
        text: '',
        image: { base64: await blobToBase64(img.blob), mediaType: img.blob.type || 'image/jpeg' },
        projects,
        when: new Date(img.createdAt),
      });
      autoProjects.add(img.projectId);
      const project = await resolveProject(items[0], projects);
      await db.put('images', { ...img, projectId: project.id, caption: items[0].title, description: items[0].note, organizedBy: 'claude' });
      done++;
    }
    // Drop keyword "inbox" projects that are now empty.
    for (const id of autoProjects) {
      const [n, i] = await Promise.all([db.byProject('notes', id), db.byProject('images', id)]);
      if (!n.length && !i.length) await db.remove('projects', id);
    }
    toast(`Re-sorted ${done} item${done === 1 ? '' : 's'} ✨`);
  } catch (e) {
    toast(`Stopped after ${done}: ${e.message || e}`, 4000);
  } finally {
    setBusy(false);
    render();
  }
}

// Anything left pending (app closed mid-sort) gets filed on the next launch.
async function resumePending() {
  for (const n of await db.byProject('notes', PENDING)) filing = filing.then(() => fileNote(n));
}

let busyCount = 0;
function setBusy(on) {
  busyCount += on ? 1 : -1;
  document.body.classList.toggle('busy', busyCount > 0);
}

// ---------- voice ----------

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const rec = { on: false, recognizer: null, finalText: '', interim: '', base: '' };

function startListening(textarea, onChange) {
  if (!SR) {
    textarea.focus();
    toast('Tap the 🎤 on your keyboard to dictate.', 3500);
    return false;
  }
  rec.on = true;
  rec.base = textarea.value ? textarea.value.trimEnd() + ' ' : '';
  rec.finalText = '';
  rec.interim = '';
  const begin = () => {
    const r = new SR();
    r.lang = localStorage.getItem('ic.lang') || navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = true;
    let sessionFinal = '';
    r.onresult = (e) => {
      let interim = '';
      sessionFinal = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) sessionFinal += res[0].transcript;
        else interim += res[0].transcript;
      }
      rec.interim = sessionFinal + interim;
      onChange(rec.base + rec.finalText + rec.interim);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        rec.on = false;
        toast('Microphone or speech recognition is blocked. Use the keyboard 🎤 instead, or allow it in Settings › Safari.', 5000);
        onChange(textarea.value, true);
      }
    };
    // iOS stops listening after a pause; keep going until the user taps stop.
    r.onend = () => {
      rec.finalText += rec.interim ? rec.interim + ' ' : '';
      rec.interim = '';
      if (rec.on) {
        try {
          begin();
        } catch {
          rec.on = false;
          onChange(textarea.value, true);
        }
      }
    };
    rec.recognizer = r;
    r.start();
  };
  try {
    begin();
  } catch (e) {
    rec.on = false;
    toast(`Couldn't start listening: ${e.message}`);
    return false;
  }
  return true;
}

function stopListening() {
  rec.on = false;
  try {
    rec.recognizer?.stop();
  } catch {}
}

// ---------- views ----------

function header(title, ...right) {
  return h('header', { class: 'top' }, h('h1', {}, title), h('div', { class: 'top-actions' }, ...right));
}

function noteCard(note, projectsById, { showProject = true } = {}) {
  const project = projectsById[note.projectId];
  const cat = project && categoryById(project.category);
  const menu = h(
    'select',
    {
      class: 'move',
      'aria-label': 'Move to project',
      onchange: async (e) => {
        if (!e.target.value) return;
        await db.put('notes', { ...note, projectId: e.target.value, organizedBy: 'manual' });
        await touchProject(e.target.value);
        toast(`Moved to ${projectsById[e.target.value].name}`);
        render();
      },
    },
    h('option', { value: '' }, 'Move…'),
    Object.values(projectsById)
      .filter((p) => p.id !== note.projectId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => h('option', { value: p.id }, `${categoryById(p.category).emoji} ${p.name}`))
  );
  return h(
    'article',
    { class: `note kind-${note.kind || 'idea'}` },
    h(
      'div',
      { class: 'note-meta' },
      h('time', { datetime: new Date(note.createdAt).toISOString() }, fmtTime(note.createdAt)),
      h('span', { class: 'kind' }, KIND_LABEL[note.kind] || KIND_LABEL.idea)
    ),
    note.title && h('h3', {}, note.title),
    h('p', { class: 'note-text' }, note.text),
    note.tags?.length ? h('div', { class: 'tags' }, note.tags.map((t) => h('span', { class: 'tag' }, `#${t}`))) : null,
    h(
      'div',
      { class: 'note-actions' },
      showProject && project
        ? h('a', { class: 'chip', href: `#/project/${project.id}` }, `${cat.emoji} ${project.name}`)
        : h('span'),
      h(
        'div',
        { class: 'row' },
        menu,
        h(
          'button',
          {
            class: 'icon danger',
            'aria-label': 'Delete note',
            onclick: async () => {
              if (!confirm('Delete this note?')) return;
              await db.remove('notes', note.id);
              toast('Note deleted');
              render();
            },
          },
          '🗑'
        )
      )
    )
  );
}

let draftImage = null; // { blob, url }

async function captureView() {
  const { projects, notes } = await loadAll();
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const pendingCount = notes.filter((n) => n.projectId === PENDING).length;
  const recent = notes
    .filter((n) => n.projectId !== PENDING)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 15);

  const textarea = h('textarea', {
    class: 'draft',
    placeholder: SR ? 'Tap the mic and talk, or type here…' : 'Type, or tap 🎤 on the keyboard to dictate…',
    rows: 4,
    value: localStorage.getItem('ic.draft') || '',
    oninput: () => localStorage.setItem('ic.draft', textarea.value),
  });

  const status = h('p', { class: 'mic-status' }, rec.on ? 'Listening… tap to stop and save' : 'Tap to talk');
  const mic = h('button', { class: `mic ${rec.on ? 'on' : ''}`, 'aria-label': 'Record a note' }, h('span', { class: 'mic-icon' }, '🎙️'));

  const preview = h('div', { class: 'draft-image' });
  const showPreview = () => {
    preview.replaceChildren();
    if (!draftImage) return;
    preview.append(
      h('img', { src: draftImage.url, alt: 'Screenshot to attach' }),
      h(
        'button',
        {
          class: 'icon',
          'aria-label': 'Remove screenshot',
          onclick: () => {
            URL.revokeObjectURL(draftImage.url);
            draftImage = null;
            showPreview();
          },
        },
        '✕'
      )
    );
  };
  showPreview();

  const save = async () => {
    const text = textarea.value.trim();
    if (!text && !draftImage) return toast('Nothing to save yet.');
    const imageBlob = draftImage?.blob;
    if (draftImage) URL.revokeObjectURL(draftImage.url);
    draftImage = null;
    textarea.value = '';
    localStorage.removeItem('ic.draft');
    showPreview();
    toast(hasKey() ? 'Saved — sorting it out…' : 'Saved');
    await capture({ text, imageBlob });
  };

  const setListeningUI = (on) => {
    mic.classList.toggle('on', on);
    status.textContent = on ? 'Listening… tap to stop and save' : 'Tap to talk';
  };

  mic.addEventListener('click', async () => {
    if (rec.on) {
      stopListening();
      setListeningUI(false);
      // Give the recognizer a moment to deliver the last words.
      setTimeout(() => {
        if (localStorage.getItem('ic.autosave') !== 'off') save();
      }, 600);
    } else if (startListening(textarea, (t, stopped) => {
      textarea.value = t;
      localStorage.setItem('ic.draft', t);
      if (stopped) setListeningUI(false);
    })) {
      setListeningUI(true);
      navigator.vibrate?.(20);
    }
  });

  return h(
    'main',
    { class: 'view capture' },
    header('Idea Catcher', h('a', { class: 'icon', href: '#/search', 'aria-label': 'Search' }, '🔍')),
    !hasKey() &&
      h('a', { class: 'banner', href: '#/settings' }, 'Add a Claude API key in Settings to have notes sorted into projects automatically. Until then they are filed by keywords.'),
    h('section', { class: 'recorder' }, mic, status),
    textarea,
    preview,
    h(
      'div',
      { class: 'row capture-actions' },
      h(
        'button',
        {
          class: 'secondary',
          onclick: async () => {
            const [file] = await pickImages(false);
            if (!file) return;
            const blob = await resizeImage(file);
            if (draftImage) URL.revokeObjectURL(draftImage.url);
            draftImage = { blob, url: URL.createObjectURL(blob) };
            showPreview();
          },
        },
        '🖼 Screenshot'
      ),
      h('button', { class: 'primary', onclick: save }, 'Save note')
    ),
    pendingCount ? h('p', { class: 'muted center' }, `Sorting ${pendingCount} note${pendingCount > 1 ? 's' : ''}…`) : null,
    h('h2', { class: 'section-title' }, 'Recent'),
    recent.length
      ? h('div', { class: 'notes' }, recent.map((n) => noteCard(n, byId)))
      : h('p', { class: 'muted center empty' }, 'Your notes will show up here, with the time you said them.')
  );
}

async function projectsView() {
  const { projects, notes, images } = await loadAll();
  const counts = {};
  for (const n of notes) counts[n.projectId] = (counts[n.projectId] || 0) + 1;
  const imgCounts = {};
  for (const i of images) imgCounts[i.projectId] = (imgCounts[i.projectId] || 0) + 1;

  const groups = {};
  for (const c of CATEGORIES) (groups[c.group] ||= []).push(c);

  const sections = Object.entries(groups).map(([group, cats]) => {
    const blocks = cats
      .map((c) => {
        const list = projects.filter((p) => p.category === c.id).sort((a, b) => b.updatedAt - a.updatedAt);
        if (!list.length) return null;
        return h(
          'div',
          { class: 'cat' },
          h('h3', { class: 'cat-title' }, `${c.emoji} ${c.label}`),
          list.map((p) =>
            h(
              'a',
              { class: 'project-card', href: `#/project/${p.id}` },
              h('div', { class: 'pc-name' }, p.name),
              p.summary && h('div', { class: 'pc-summary' }, p.summary),
              h(
                'div',
                { class: 'pc-meta' },
                `${counts[p.id] || 0} note${counts[p.id] === 1 ? '' : 's'}`,
                imgCounts[p.id] ? ` · ${imgCounts[p.id]} image${imgCounts[p.id] === 1 ? '' : 's'}` : '',
                ` · ${fmtTime(p.updatedAt)}`
              )
            )
          )
        );
      })
      .filter(Boolean);
    return h('section', {}, h('h2', { class: 'section-title' }, group), blocks.length ? blocks : h('p', { class: 'muted' }, 'Nothing here yet.'));
  });

  return h(
    'main',
    { class: 'view' },
    header(
      'Projects',
      h('a', { class: 'icon', href: '#/search', 'aria-label': 'Search' }, '🔍'),
      h(
        'button',
        {
          class: 'icon',
          'aria-label': 'New project',
          onclick: async () => {
            const name = prompt('Project name');
            if (!name?.trim()) return;
            const p = { id: db.uid(), name: name.trim(), category: 'other-project', summary: '', createdAt: Date.now(), updatedAt: Date.now() };
            await db.put('projects', p);
            location.hash = `#/project/${p.id}`;
          },
        },
        '＋'
      )
    ),
    projects.length ? sections : h('p', { class: 'muted center empty' }, 'Projects appear here as you talk. Try: “For the living room, a sage green accent wall with a walnut shelf.”')
  );
}

async function projectView(id, tab = 'notes') {
  const project = await db.get('projects', id);
  if (!project) return h('main', { class: 'view' }, header('Not found'), h('p', {}, h('a', { href: '#/projects' }, 'Back to projects')));
  const [notes, images, allProjects] = await Promise.all([db.byProject('notes', id), db.byProject('images', id), db.getAll('projects')]);
  const byId = Object.fromEntries(allProjects.map((p) => [p.id, p]));
  const cat = categoryById(project.category);

  const catSelect = h(
    'select',
    {
      class: 'cat-select',
      'aria-label': 'Category',
      onchange: async (e) => {
        await db.put('projects', { ...project, category: e.target.value, updatedAt: Date.now() });
        render();
      },
    },
    CATEGORIES.map((c) => h('option', { value: c.id, selected: c.id === project.category }, `${c.emoji} ${c.label}`))
  );

  const tabs = h(
    'div',
    { class: 'tabs', role: 'tablist' },
    ['notes', 'board'].map((t) =>
      h('a', { class: `tab ${t === tab ? 'active' : ''}`, href: `#/project/${id}/${t}`, role: 'tab' }, t === 'notes' ? `Notes (${notes.length})` : `Board (${notes.length + images.length})`)
    )
  );

  const addNote = async () => {
    const text = prompt('Add a note to this project');
    if (!text?.trim()) return;
    await db.put('notes', { id: db.uid(), projectId: id, title: '', text: text.trim(), raw: text.trim(), kind: 'idea', tags: [], createdAt: Date.now(), organizedBy: 'manual' });
    await touchProject(id);
    render();
  };

  const addScreenshots = async () => {
    const files = await pickImages(true);
    for (const f of files) {
      const blob = await resizeImage(f);
      await db.put('images', { id: db.uid(), projectId: id, blob, createdAt: Date.now(), caption: '', organizedBy: 'manual' });
    }
    if (files.length) {
      await touchProject(id);
      toast(`Added ${files.length} image${files.length > 1 ? 's' : ''} to the board`);
      location.hash = `#/project/${id}/board`;
      render();
    }
  };

  const body =
    tab === 'board'
      ? boardView(project, notes, images)
      : h(
          'div',
          { class: 'notes' },
          notes.length
            ? notes.sort((a, b) => b.createdAt - a.createdAt).map((n) => noteCard(n, byId, { showProject: false }))
            : h('p', { class: 'muted center empty' }, 'No notes yet.')
        );

  return h(
    'main',
    { class: `view project ${tab === 'board' ? 'wide' : ''}` },
    h(
      'header',
      { class: 'top' },
      h('a', { class: 'icon', href: '#/projects', 'aria-label': 'Back' }, '‹'),
      h(
        'h1',
        {
          class: 'editable',
          title: 'Tap to rename',
          onclick: async () => {
            const name = prompt('Rename project', project.name);
            if (!name?.trim()) return;
            await db.put('projects', { ...project, name: name.trim() });
            render();
          },
        },
        `${cat.emoji} ${project.name}`
      ),
      h(
        'div',
        { class: 'top-actions' },
        h(
          'button',
          {
            class: 'icon danger',
            'aria-label': 'Delete project',
            onclick: async () => {
              if (!confirm(`Delete “${project.name}” with its ${notes.length} notes and ${images.length} images?`)) return;
              await deleteProject(id);
              toast('Project deleted');
              location.hash = '#/projects';
            },
          },
          '🗑'
        )
      )
    ),
    h('div', { class: 'project-head' }, catSelect, project.summary && h('p', { class: 'summary' }, project.summary)),
    h('div', { class: 'row project-actions' }, h('button', { class: 'secondary', onclick: addNote }, '＋ Note'), h('button', { class: 'secondary', onclick: addScreenshots }, '🖼 Add screenshots')),
    tabs,
    body
  );
}

// ---------- whiteboard ----------

const CARD_W = 160;
const GAP = 16;

function boardView(project, notes, images) {
  const items = [
    ...images.map((i) => ({ type: 'image', rec: i })),
    ...notes.map((n) => ({ type: 'note', rec: n })),
  ].sort((a, b) => a.rec.createdAt - b.rec.createdAt);

  // Auto-place anything that hasn't been dragged yet in a grid below the placed ones.
  const placed = items.filter((it) => it.rec.board);
  let y0 = placed.reduce((m, it) => Math.max(m, it.rec.board.y + 220), GAP);
  let col = 0;
  const cols = Math.max(2, Math.floor((Math.min(window.innerWidth, 900) - GAP) / (CARD_W + GAP)));
  for (const it of items) {
    if (it.rec.board) continue;
    it.pos = { x: GAP + col * (CARD_W + GAP), y: y0 };
    col++;
    if (col >= cols) {
      col = 0;
      y0 += 220;
    }
  }

  const height = Math.max(900, ...items.map((it) => (it.rec.board || it.pos).y + 400));
  const canvas = h('div', { class: 'board-canvas', style: { height: `${height}px` } });
  const board = h('div', { class: 'board' }, canvas);

  for (const it of items) {
    const pos = it.rec.board || it.pos;
    const store = it.type === 'image' ? 'images' : 'notes';
    const card =
      it.type === 'image'
        ? h('div', { class: 'card card-image' }, h('img', { src: imgURL(it.rec), alt: it.rec.caption || 'Screenshot', draggable: false }), it.rec.caption && h('div', { class: 'card-caption' }, it.rec.caption))
        : h('div', { class: `card card-note kind-${it.rec.kind || 'idea'}` }, it.rec.title && h('strong', {}, it.rec.title), h('div', { class: 'card-text' }, it.rec.text));
    card.style.left = `${pos.x}px`;
    card.style.top = `${pos.y}px`;
    card.append(h('time', { class: 'card-time' }, fmtTime(it.rec.createdAt)));
    makeDraggable(card, async (x, y) => {
      it.rec.board = { x, y };
      await db.put(store, it.rec);
    }, () => (it.type === 'image' ? openImage(it.rec) : openNote(it.rec)));
    canvas.append(card);
  }

  if (!items.length) canvas.append(h('p', { class: 'muted center empty' }, 'Add screenshots or notes and arrange them here.'));

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'row board-tools' },
      h('span', { class: 'muted small' }, 'Drag cards to arrange · tap to open'),
      h(
        'button',
        {
          class: 'link',
          onclick: async () => {
            for (const it of items) {
              delete it.rec.board;
              await db.put(it.type === 'image' ? 'images' : 'notes', it.rec);
            }
            render();
          },
        },
        'Tidy up'
      )
    ),
    board
  );
}

function makeDraggable(el, onDrop, onTap) {
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    start = { px: e.clientX, py: e.clientY, x: el.offsetLeft, y: el.offsetTop, moved: false, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
    el.classList.add('lifted');
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.px;
    const dy = e.clientY - start.py;
    if (!start.moved && Math.hypot(dx, dy) < 6) return;
    start.moved = true;
    el.style.left = `${Math.max(0, start.x + dx)}px`;
    el.style.top = `${Math.max(0, start.y + dy)}px`;
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    el.classList.remove('lifted');
    const s = start;
    start = null;
    if (s.moved) onDrop(el.offsetLeft, el.offsetTop);
    else if (e.type === 'pointerup') onTap();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function overlay(content) {
  const close = () => wrap.remove();
  const wrap = h('div', { class: 'overlay', onclick: (e) => e.target === wrap && close() }, h('div', { class: 'sheet' }, h('button', { class: 'icon close', 'aria-label': 'Close', onclick: close }, '✕'), content(close)));
  document.body.append(wrap);
}

function openImage(image) {
  overlay((close) =>
    h(
      'div',
      { class: 'viewer' },
      h('img', { src: imgURL(image), alt: image.caption || 'Screenshot' }),
      h('time', { class: 'muted small' }, fmtTime(image.createdAt)),
      image.caption && h('h3', {}, image.caption),
      image.description && h('p', {}, image.description),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'secondary',
            onclick: async () => {
              const caption = prompt('Caption', image.caption || '');
              if (caption == null) return;
              await db.put('images', { ...image, caption });
              close();
              render();
            },
          },
          'Edit caption'
        ),
        h(
          'button',
          {
            class: 'danger-btn',
            onclick: async () => {
              if (!confirm('Delete this image?')) return;
              await db.remove('images', image.id);
              URL.revokeObjectURL(urlCache.get(image.id));
              urlCache.delete(image.id);
              close();
              toast('Image deleted');
              render();
            },
          },
          'Delete'
        )
      )
    )
  );
}

function openNote(note) {
  overlay((close) =>
    h(
      'div',
      { class: 'viewer' },
      h('time', { class: 'muted small' }, fmtTime(note.createdAt)),
      note.title && h('h3', {}, note.title),
      h('p', { class: 'note-text' }, note.text),
      note.raw && note.raw !== note.text && h('details', {}, h('summary', {}, 'What you said'), h('p', { class: 'muted' }, note.raw)),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'secondary',
            onclick: async () => {
              const text = prompt('Edit note', note.text);
              if (text == null) return;
              await db.put('notes', { ...note, text });
              close();
              render();
            },
          },
          'Edit'
        ),
        h(
          'button',
          {
            class: 'danger-btn',
            onclick: async () => {
              if (!confirm('Delete this note?')) return;
              await db.remove('notes', note.id);
              close();
              toast('Note deleted');
              render();
            },
          },
          'Delete'
        )
      )
    )
  );
}

// ---------- search ----------

let lastQuery = '';

async function searchView() {
  const { projects, notes, images } = await loadAll();
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const results = h('div', { class: 'notes' });

  const run = (q) => {
    lastQuery = q;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    results.replaceChildren();
    if (!terms.length) return results.append(h('p', { class: 'muted center' }, 'Search every note, tag, project and screenshot caption.'));
    const match = (s) => terms.every((t) => s.toLowerCase().includes(t));
    const ps = projects.filter((p) => match(`${p.name} ${p.summary} ${categoryById(p.category).label}`));
    const ns = notes
      .filter((n) => n.projectId !== PENDING && match(`${n.title || ''} ${n.text} ${(n.tags || []).join(' ')} ${byId[n.projectId]?.name || ''}`))
      .sort((a, b) => b.createdAt - a.createdAt);
    const is = images.filter((i) => match(`${i.caption || ''} ${i.description || ''}`));
    if (!ps.length && !ns.length && !is.length) return results.append(h('p', { class: 'muted center' }, 'No matches.'));
    if (ps.length)
      results.append(
        h('h2', { class: 'section-title' }, 'Projects'),
        ...ps.map((p) => h('a', { class: 'project-card', href: `#/project/${p.id}` }, h('div', { class: 'pc-name' }, `${categoryById(p.category).emoji} ${p.name}`), p.summary && h('div', { class: 'pc-summary' }, p.summary)))
      );
    if (is.length)
      results.append(
        h('h2', { class: 'section-title' }, 'Screenshots'),
        h('div', { class: 'thumbs' }, is.map((i) => h('button', { class: 'thumb', onclick: () => openImage(i) }, h('img', { src: imgURL(i), alt: i.caption || '' }))))
      );
    if (ns.length) results.append(h('h2', { class: 'section-title' }, `Notes (${ns.length})`), ...ns.map((n) => noteCard(n, byId)));
  };

  const input = h('input', { type: 'search', class: 'search', placeholder: 'wedding flowers, sage green, game boss…', value: lastQuery, oninput: (e) => run(e.target.value) });
  run(lastQuery);
  setTimeout(() => input.focus(), 50);
  return h('main', { class: 'view' }, header('Search'), input, results);
}

// ---------- settings ----------

async function settingsView() {
  const keyInput = h('input', { type: 'password', autocomplete: 'off', placeholder: 'sk-ant-…', value: localStorage.getItem('ic.apiKey') || '' });
  const keywordCount =
    (await db.getAll('notes')).filter((n) => n.organizedBy === 'keywords').length +
    (await db.getAll('images')).filter((i) => i.organizedBy === 'keywords').length;
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  return h(
    'main',
    { class: 'view settings' },
    header('Settings'),
    !isStandalone &&
      h(
        'section',
        { class: 'card-section' },
        h('h2', {}, 'Put it on your Home Screen'),
        h('ol', {}, h('li', {}, 'Open this page in Safari.'), h('li', {}, 'Tap the Share button, then “Add to Home Screen”.'), h('li', {}, 'Open Idea Catcher from its icon; it runs full screen like an app.'))
      ),
    h(
      'section',
      { class: 'card-section' },
      h('h2', {}, 'Claude API key'),
      h('p', { class: 'muted small' }, 'Used to sort notes into projects, clean up dictation and read screenshots. It is stored only on this phone and sent only to Anthropic. Get one at console.anthropic.com.'),
      keyInput,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'primary',
            onclick: () => {
              const v = keyInput.value.trim();
              if (v) localStorage.setItem('ic.apiKey', v);
              else localStorage.removeItem('ic.apiKey');
              toast(v ? 'Key saved' : 'Key removed');
              render();
            },
          },
          'Save key'
        ),
        keywordCount && hasKey() ? h('button', { class: 'secondary', onclick: resortWithClaude }, `Re-sort ${keywordCount} with Claude`) : null
      )
    ),
    h(
      'section',
      { class: 'card-section' },
      h('h2', {}, 'Voice'),
      h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          checked: localStorage.getItem('ic.autosave') !== 'off',
          onchange: (e) => localStorage.setItem('ic.autosave', e.target.checked ? 'on' : 'off'),
        }),
        ' Save as soon as I tap stop'
      ),
      h('label', { class: 'small muted' }, 'Speech language (e.g. en-US, zh-CN)'),
      h('input', {
        type: 'text',
        value: localStorage.getItem('ic.lang') || navigator.language || 'en-US',
        onchange: (e) => localStorage.setItem('ic.lang', e.target.value.trim()),
      }),
      h('p', { class: 'muted small' }, SR ? 'If the big mic button ever stops working, the 🎤 on the iPhone keyboard always works in the text box.' : 'Live speech recognition is not available here, so use the 🎤 on the iPhone keyboard to dictate into the text box.')
    ),
    h(
      'section',
      { class: 'card-section' },
      h('h2', {}, 'Backup'),
      h('p', { class: 'muted small' }, 'Notes live on this phone only. Export a backup now and then (save it to Files or iCloud Drive).'),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'secondary',
            onclick: async () => {
              const data = await db.exportAll();
              const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
              const name = `idea-catcher-${new Date().toISOString().slice(0, 10)}.json`;
              const file = new File([blob], name, { type: 'application/json' });
              if (navigator.canShare?.({ files: [file] })) {
                await navigator.share({ files: [file] }).catch(() => {});
              } else {
                const a = h('a', { href: URL.createObjectURL(blob), download: name });
                a.click();
              }
            },
          },
          'Export backup'
        ),
        h(
          'button',
          {
            class: 'secondary',
            onclick: () => {
              const input = h('input', { type: 'file', accept: 'application/json,.json' });
              input.addEventListener('change', async () => {
                try {
                  await db.importAll(JSON.parse(await input.files[0].text()));
                  toast('Backup restored');
                  render();
                } catch (e) {
                  toast(e.message, 4000);
                }
              });
              input.click();
            },
          },
          'Restore backup'
        )
      ),
      h(
        'button',
        {
          class: 'danger-btn',
          onclick: async () => {
            if (!confirm('Delete ALL projects, notes and images on this phone?')) return;
            if (!confirm('Really? This cannot be undone.')) return;
            await db.clearAll();
            toast('Everything deleted');
            render();
          },
        },
        'Delete everything'
      )
    )
  );
}

// ---------- router ----------

function nav(active) {
  const item = (href, icon, label, key) => h('a', { href, class: `nav-item ${active === key ? 'active' : ''}` }, h('span', { class: 'nav-icon' }, icon), h('span', {}, label));
  return h('nav', { class: 'tabbar' }, item('#/', '🎙️', 'Capture', 'capture'), item('#/projects', '🗂️', 'Projects', 'projects'), item('#/settings', '⚙️', 'Settings', 'settings'));
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const [, route, id, tab] = (location.hash || '#/').split('/');
  let view;
  let active = 'capture';
  if (route === 'projects') {
    view = await projectsView();
    active = 'projects';
  } else if (route === 'project' && id) {
    view = await projectView(id, tab || 'notes');
    active = 'projects';
  } else if (route === 'search') {
    view = await searchView();
    active = 'projects';
  } else if (route === 'settings') {
    view = await settingsView();
    active = 'settings';
  } else {
    // Re-rendering the capture screen while typing would steal focus.
    if (document.activeElement?.classList.contains('draft') && token > 1 && app.querySelector('.capture')) {
      const fresh = await captureView();
      const oldNotes = app.querySelector('.capture .notes, .capture .empty');
      const newNotes = fresh.querySelector('.notes, .empty');
      if (oldNotes && newNotes) oldNotes.replaceWith(newNotes);
      return;
    }
    view = await captureView();
  }
  if (token !== renderToken) return;
  const scroll = route === 'project' ? window.scrollY : 0;
  app.replaceChildren(view, nav(active));
  window.scrollTo(0, scroll);
}

window.addEventListener('hashchange', () => {
  if (rec.on) stopListening();
  render();
});

render();
resumePending();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.();
