import { randomInt } from 'node:crypto';
import { authRepository, type UserRow } from './auth.repository.js';
import type { GoogleClaims } from './google.js';
import { googleRepository } from './tokens.repository.js';

export type GoogleFailure = 'email_not_verified' | 'account_conflict';
export class GoogleLoginError extends Error {
  constructor(public code: GoogleFailure) {
    super(code);
  }
}

function usernameBase(email: string) {
  const b = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 22);
  return b.length >= 3 ? b : `user${b}`;
}

/** Resuelve la cuenta de LUMENZA para unas claims de Google ya validadas criptográficamente. */
export async function resolveGoogleUser(c: GoogleClaims, ip?: string): Promise<UserRow> {
  // 1) Identidad Google ya vinculada → inicio de sesión
  const bySub = await googleRepository.findBySub(c.sub);
  if (bySub) {
    await authRepository.audit(bySub.id, 'auth.google_login', ip);
    return bySub;
  }
  // 2) Nunca vincular ni crear con un correo que Google no declara verificado
  if (!c.emailVerified) throw new GoogleLoginError('email_not_verified');

  // 3) Cuenta local con el mismo correo → vincular de forma segura
  const local = await authRepository.findByIdentifier(c.email);
  if (local && local.email === c.email) {
    await googleRepository.link(local.id, c.sub, !local.email_verified);
    await authRepository.audit(local.id, 'auth.google_linked', ip, { localEmailWasVerified: local.email_verified });
    return (await authRepository.findById(local.id))!;
  }

  // 4) Cuenta nueva
  const base = usernameBase(c.email);
  for (let i = 0; i < 6; i++) {
    const username = i === 0 ? base : `${base.slice(0, 25)}${randomInt(1000, 9999)}`;
    try {
      const id = await googleRepository.createUser({ email: c.email, username, sub: c.sub, displayName: c.name ?? base });
      await authRepository.audit(id, 'auth.google_signup', ip);
      return (await authRepository.findById(id))!;
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === '23505' && err.constraint?.includes('username')) continue;
      if (err.code === '23505') throw new GoogleLoginError('account_conflict');
      throw e;
    }
  }
  throw new GoogleLoginError('account_conflict');
}
