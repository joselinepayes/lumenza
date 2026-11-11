import { env } from '../config/env.js';
import { S3Storage, type StorageService } from './storage.service.js';

let instance: StorageService | undefined;

/** Proveedor elegido por variables de entorno (S3_ENDPOINT => RustFS local; vacío => Amazon S3). */
export function getStorage(): StorageService {
  instance ??= new S3Storage({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  return instance;
}

export { StorageError, type StorageService } from './storage.service.js';
