import { Worker } from 'node:worker_threads';
function run(pattern, text, ms) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { pattern, text } });
    const timer = setTimeout(() => { w.terminate(); resolve(`TIMEOUT after ${(performance.now() - t0).toFixed(0)} ms`); }, ms);
    w.on('message', (m) => { clearTimeout(timer); w.terminate(); resolve(`done ${m} in ${(performance.now() - t0).toFixed(0)} ms`); });
    w.on('error', (e) => { clearTimeout(timer); resolve('error ' + e.message); });
  });
}
const evil = 'a-a-a-a-a-a-a-a-a-a-b';
console.log('benign :', await run('^!%a+$', '!song', 2000));
console.log('bad pat:', await run('[', 'x', 2000));
console.log('evil   :', await run(evil, 'a'.repeat(200), 1500));
let ticks = 0; const iv = setInterval(() => ticks++, 50);
await run(evil, 'a'.repeat(200), 1500); clearInterval(iv);
console.log('main thread stayed responsive, ticks during 1.5 s evil run:', ticks);
