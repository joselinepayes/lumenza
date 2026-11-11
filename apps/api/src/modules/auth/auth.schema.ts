import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,30}$/, 'Usa 3–30 caracteres: letras, números, punto o guion bajo');

export const passwordSchema = z
  .string()
  .min(10, 'Mínimo 10 caracteres')
  .max(128, 'Máximo 128 caracteres')
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'Debe incluir letras y números');

export const registerSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Ingresa tu nombre').max(60),
    username: usernameSchema,
    email: z.string().trim().toLowerCase().email('Correo inválido').max(254),
    password: passwordSchema,
    confirmPassword: z.string(),
    captchaToken: z.string().max(4096).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Las contraseñas no coinciden' });

export const loginSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(128),
  captchaToken: z.string().max(4096).optional(),
});

const tokenSchema = z.string().min(20).max(200);
export const verifyEmailSchema = z.object({ token: tokenSchema });
export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), captchaToken: z.string().max(4096).optional() });
export const resetSchema = z
  .object({ token: tokenSchema, password: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Las contraseñas no coinciden' });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
