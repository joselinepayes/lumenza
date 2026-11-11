import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import type { RawImage } from '../images/transforms.js';

/** Recuadro normalizado (0–1) respecto a la imagen orientada. Es lo ÚNICO que se conserva de la detección. */
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

export interface FaceDetector {
  readonly model: string;
  detect(image: RawImage): Promise<FaceBox[]>;
}

export const FACE_MODEL = 'ssd_mobilenetv1@face-api-1.7.15';
const DETECT_SIDE = 1024; // lado máximo del raster de detección (equilibrio precisión/tiempo)
const MIN_CONFIDENCE = 0.5;
const MAX_FACES = 50;

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Detector de rostros con @vladmandic/face-api (fork mantenido de face-api.js, MIT) sobre TensorFlow.js con backend WASM:
 * sin compilación nativa, funciona igual en Windows, Linux y Docker. Solo se carga la red SSD MobileNet v1 de DETECCIÓN
 * (no se cargan las redes de landmarks, reconocimiento, edad/género ni expresiones).
 */
class FaceApiDetector implements FaceDetector {
  readonly model = FACE_MODEL;
  private ready?: Promise<{ faceapi: any; tf: any }>;

  private load() {
    return (this.ready ??= (async () => {
      const require = createRequire(import.meta.url);
      const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
      const tf = faceapi.tf;
      await tf.setBackend('wasm');
      await tf.ready();
      const dir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(dir);
      return { faceapi, tf };
    })());
  }

  async detect(image: RawImage): Promise<FaceBox[]> {
    const { faceapi, tf } = await this.load();
    const scale = Math.min(1, DETECT_SIDE / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));
    const rgb =
      scale < 1
        ? await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } }).resize({ width: w, height: h }).raw().toBuffer()
        : image.data;
    const t = tf.tensor3d(new Uint8Array(rgb), [h, w, 3]);
    try {
      const dets = (await faceapi.detectAllFaces(t, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE }))) as { box: { x: number; y: number; width: number; height: number }; score: number }[];
      return dets
        .map((d) => {
          const x = clamp01(d.box.x / w);
          const y = clamp01(d.box.y / h);
          const x2 = clamp01((d.box.x + d.box.width) / w);
          const y2 = clamp01((d.box.y + d.box.height) / h);
          return { x: round(x), y: round(y), w: round(x2 - x), h: round(y2 - y), score: round(d.score, 3) };
        })
        .filter((b) => b.w > 0.005 && b.h > 0.005)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_FACES)
        .sort((a, b) => a.x - b.x); // orden estable de izquierda a derecha para numerarlos en la interfaz
    } finally {
      t.dispose();
    }
  }
}

let instance: FaceDetector | undefined;
export const getFaceDetector = (): FaceDetector => (instance ??= new FaceApiDetector());
