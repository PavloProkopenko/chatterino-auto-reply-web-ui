// THROW-AWAY manual check for Phase 2b (dev server only, not part of the production build; deleted after the check).
// It reports what the browser allows on the owner's real plugin folder. It never prints file contents.
/* eslint-disable @typescript-eslint/no-explicit-any */
const out = document.getElementById('out') as HTMLPreElement;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (s = '') => {
  out.textContent += s + '\n';
};
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

let dir: any = null; // FileSystemDirectoryHandle
let file: any = null; // FileSystemFileHandle
let current: any = null;

const w = window as any;
log(`Браузер: ${navigator.userAgent}`);
log(`Безопасный контекст: ${window.isSecureContext}`);
log(`showDirectoryPicker: ${typeof w.showDirectoryPicker === 'function' ? 'есть' : 'НЕТ'}; showOpenFilePicker: ${typeof w.showOpenFilePicker === 'function' ? 'есть' : 'НЕТ'}`);
log();

async function permission(handle: any, mode: 'read' | 'readwrite') {
  try {
    return await handle.queryPermission({ mode });
  } catch (e) {
    return errText(e);
  }
}

async function readText(handle: any): Promise<{ text: string; size: number; modified: string }> {
  const f = await handle.getFile();
  return { text: await f.text(), size: f.size, modified: new Date(f.lastModified).toISOString() };
}

async function describeConfig(configHandle: any, label: string) {
  try {
    const { text, size, modified } = await readText(configHandle);
    let json = 'не разобран';
    try {
      JSON.parse(text);
      json = 'корректный JSON';
    } catch (e) {
      json = `НЕ JSON (${errText(e)})`;
    }
    log(`${label}: читается, ${size} байт, изменён ${modified}, ${json}`);
  } catch (e) {
    log(`${label}: НЕ читается: ${errText(e)}`);
  }
}

// ---- 1. folder
$('pick-dir').addEventListener('click', async () => {
  log('--- Выбор папки плагина ---');
  try {
    dir = await w.showDirectoryPicker({ id: 'auto-reply-check', mode: 'readwrite' });
    current = dir;
    file = null;
    log(`Браузер разрешил папку: «${dir.name}»`);
    log(`Разрешение сейчас: чтение=${await permission(dir, 'read')}, запись=${await permission(dir, 'readwrite')}`);
    try {
      const info = JSON.parse((await readText(await dir.getFileHandle('info.json'))).text);
      log(`info.json: имя «${info.name}», версия ${info.version}`);
    } catch (e) {
      log(`info.json: не найден или не читается (${errText(e)}). Вы выбрали именно папку плагина?`);
    }
    try {
      const data = await dir.getDirectoryHandle('data');
      const names: string[] = [];
      for await (const [name] of data.entries()) names.push(name);
      log(`Папка data: найдена, внутри ${names.length} файл(ов): ${names.join(', ')}`);
      try {
        await describeConfig(await data.getFileHandle('config.json'), 'data/config.json');
      } catch (e) {
        log(`data/config.json: нет такого файла (${errText(e)})`);
      }
    } catch (e) {
      log(`Папка data: не найдена (${errText(e)})`);
    }
    for (const id of ['write-tmp', 'write-config', 'remember', 'regrant']) $<HTMLButtonElement>(id).disabled = false;
  } catch (e) {
    log(`НЕ УДАЛОСЬ: ${errText(e)}`);
    log('(SecurityError или AbortError с текстом про системные файлы значит, что браузер не разрешает эту папку.)');
  }
  log();
});

$('write-tmp').addEventListener('click', async () => {
  log('--- Проверка записи в папку data (временный файл) ---');
  try {
    const data = await dir.getDirectoryHandle('data', { create: false });
    const tmp = await data.getFileHandle('fsa-check.tmp', { create: true });
    const stream = await tmp.createWritable();
    await stream.write('проверка');
    await stream.close();
    const back = (await readText(tmp)).text;
    await data.removeEntry('fsa-check.tmp');
    log(`OK: файл создан, записан, прочитан («${back}») и удалён.`);
  } catch (e) {
    log(`НЕ УДАЛОСЬ: ${errText(e)}`);
  }
  log();
});

$('write-config').addEventListener('click', async () => {
  log('--- Проверка записи в config.json (тот же текст) ---');
  try {
    const data = await dir.getDirectoryHandle('data');
    const handle = await data.getFileHandle('config.json');
    const before = await readText(handle);
    const stream = await handle.createWritable();
    await stream.write(before.text);
    await stream.close();
    const after = await readText(handle);
    log(`OK: записано ${after.size} байт, содержимое ${after.text === before.text ? 'совпадает с исходным' : 'ОТЛИЧАЕТСЯ!'}; время изменения ${before.modified} -> ${after.modified}`);
    log('Теперь подождите несколько секунд (плагин 0.7.0+) или выполните /autoreply reload в Leafyrino и посмотрите, нет ли предупреждений и файла config.json.bad.');
    const names: string[] = [];
    for await (const [name] of data.entries()) names.push(name);
    log(`Файлы в data сейчас: ${names.join(', ')} (временных файлов вроде .crswap быть не должно)`);
  } catch (e) {
    log(`НЕ УДАЛОСЬ: ${errText(e)}`);
  }
  log();
});

// ---- 2. only the file
$('pick-file').addEventListener('click', async () => {
  log('--- Выбор только config.json ---');
  try {
    [file] = await w.showOpenFilePicker({ id: 'auto-reply-check-file', types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
    current = file;
    dir = null;
    log(`Браузер разрешил файл: «${file.name}»`);
    log(`Разрешение сейчас: чтение=${await permission(file, 'read')}, запись=${await permission(file, 'readwrite')}`);
    try {
      const r = await file.requestPermission({ mode: 'readwrite' });
      log(`Запрос разрешения на запись: ${r}`);
    } catch (e) {
      log(`Запрос разрешения на запись: ${errText(e)}`);
    }
    await describeConfig(file, file.name);
    $<HTMLButtonElement>('write-file').disabled = false;
    $<HTMLButtonElement>('remember').disabled = false;
    $<HTMLButtonElement>('regrant').disabled = false;
  } catch (e) {
    log(`НЕ УДАЛОСЬ: ${errText(e)}`);
  }
  log();
});

$('write-file').addEventListener('click', async () => {
  log('--- Проверка записи в выбранный файл (тот же текст) ---');
  try {
    const before = await readText(file);
    const stream = await file.createWritable();
    await stream.write(before.text);
    await stream.close();
    const after = await readText(file);
    log(`OK: записано ${after.size} байт, содержимое ${after.text === before.text ? 'совпадает с исходным' : 'ОТЛИЧАЕТСЯ!'}`);
  } catch (e) {
    log(`НЕ УДАЛОСЬ: ${errText(e)}`);
  }
  log();
});

// ---- 3. remembering (IndexedDB)
const DB = 'fsa-check';
const idb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('h');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const idbGet = async (key: string): Promise<any> => {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('h').objectStore('h').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
};
const idbPut = async (key: string, value: unknown) => {
  const db = await idb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('h', 'readwrite');
    tx.objectStore('h').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

$('remember').addEventListener('click', async () => {
  try {
    await idbPut('last', { kind: dir ? 'folder' : 'file', handle: current });
    log(`Запомнено (${dir ? 'папка' : 'файл'} «${current.name}»). Перезагрузите страницу и посмотрите результат наверху.`);
  } catch (e) {
    log(`Не удалось запомнить: ${errText(e)}`);
  }
});

$('regrant').addEventListener('click', async () => {
  try {
    log(`Запрос разрешения: ${await current.requestPermission({ mode: 'readwrite' })}`);
  } catch (e) {
    log(`Запрос разрешения: ${errText(e)}`);
  }
});

(async () => {
  try {
    const saved = await idbGet('last');
    if (saved) {
      current = saved.handle;
      if (saved.kind === 'folder') dir = saved.handle;
      else file = saved.handle;
      log(`Найдено запомненное (${saved.kind === 'folder' ? 'папка' : 'файл'} «${saved.handle.name}»).`);
      log(`Разрешение после перезагрузки: чтение=${await permission(saved.handle, 'read')}, запись=${await permission(saved.handle, 'readwrite')}`);
      log('(granted = работает сразу; prompt = нужен один клик «Запросить разрешение снова»; denied = запрещено)');
      for (const id of ['regrant']) $<HTMLButtonElement>(id).disabled = false;
      if (dir) for (const id of ['write-tmp', 'write-config']) $<HTMLButtonElement>(id).disabled = false;
      if (file) $<HTMLButtonElement>('write-file').disabled = false;
      log();
    }
  } catch (e) {
    log(`Чтение запомненного не удалось: ${errText(e)}`);
  }
})();

$('copy').addEventListener('click', () => void navigator.clipboard.writeText(out.textContent ?? ''));
