// Utilidad de desarrollo: npm run storage -w @lumenza/api -- init | put | get
import { env } from '../config/env.js';
import { getStorage } from './index.js';

const s = getStorage();
const key = 'healthcheck/persist.txt';
const cmd = process.argv[2];

try {
  if (cmd === 'init') {
    await s.ensureBucket();
    console.log(`Bucket listo: ${env.S3_BUCKET}`);
  } else if (cmd === 'put') {
    await s.put(key, Buffer.from('sobrevive-al-reinicio'), 'text/plain');
    console.log('put ok');
  } else if (cmd === 'get') {
    const o = await s.get(key);
    console.log('get:', o.body.toString());
    await s.delete(key);
    console.log('existe tras delete:', await s.exists(key));
  } else {
    console.log('Uso: init | put | get');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Fallo controlado de almacenamiento:', (e as Error).message);
  process.exitCode = 1;
}
