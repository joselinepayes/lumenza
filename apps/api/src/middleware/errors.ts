import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, _res, next) => next(new HttpError(404, 'Recurso no encontrado', 'not_found'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'validation', message: 'Datos inválidos', issues: err.issues } });
    return;
  }
  if (err instanceof multer.MulterError) {
    const big = err.code === 'LIMIT_FILE_SIZE';
    res.status(big ? 413 : 400).json({ error: { code: big ? 'file_too_large' : 'upload_error', message: big ? 'La imagen supera el máximo de 15 MB' : 'Carga de archivo inválida' } });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  logger.error({ err, path: req.path }, 'Error no controlado');
  res.status(500).json({ error: { code: 'internal', message: 'Error interno del servidor' } });
};
