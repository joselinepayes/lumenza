import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type StorageErrorCode = 'not_found' | 'unavailable' | 'denied';
export class StorageError extends Error {
  constructor(
    public code: StorageErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
  }
}

export interface StoredObject {
  body: Buffer;
  contentType?: string;
  bytes: number;
}

/** Contrato que usa la lógica de negocio; no conoce el proveedor concreto. */
export interface StorageService {
  readonly bucket: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** URL temporal de lectura (bucket privado). */
  signedGetUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Solo desarrollo/pruebas: crea el bucket si no existe (privado por defecto). */
  ensureBucket(): Promise<void>;
  ping(): Promise<boolean>;
}

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/**
 * Única implementación: protocolo S3. Con `endpoint` apunta a RustFS (local);
 * sin `endpoint` usa Amazon S3 (credenciales explícitas o cadena por defecto/rol IAM).
 */
export class S3Storage implements StorageService {
  readonly bucket: string;
  private client: S3Client;

  constructor(cfg: S3StorageConfig) {
    this.bucket = cfg.bucket;
    const conf: S3ClientConfig = {
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle ?? false,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      ...(cfg.accessKeyId && cfg.secretAccessKey
        ? { credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } }
        : {}),
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 2,
    };
    this.client = new S3Client(conf);
  }

  private wrap(e: unknown): StorageError {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = err.$metadata?.httpStatusCode;
    if (err.name === 'NoSuchKey' || err.name === 'NotFound' || status === 404) return new StorageError('not_found', 'Objeto no encontrado', e);
    if (status === 403 || err.name === 'AccessDenied') return new StorageError('denied', 'Acceso denegado al almacenamiento', e);
    return new StorageError('unavailable', 'Almacenamiento no disponible', e);
  }

  async put(key: string, body: Buffer, contentType: string) {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    } catch (e) {
      throw this.wrap(e);
    }
  }

  async get(key: string): Promise<StoredObject> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = Buffer.from(await r.Body!.transformToByteArray());
      return { body, contentType: r.ContentType, bytes: body.length };
    } catch (e) {
      throw this.wrap(e);
    }
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (e) {
      const w = this.wrap(e);
      if (w.code === 'not_found') return false;
      throw w;
    }
  }

  async delete(key: string) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      throw this.wrap(e);
    }
  }

  async signedGetUrl(key: string, expiresInSeconds = 600) {
    try {
      return await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
    } catch (e) {
      throw this.wrap(e);
    }
  }

  async ensureBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (e) {
        throw this.wrap(e);
      }
    }
  }

  async ping() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
