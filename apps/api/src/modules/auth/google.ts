import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export interface GoogleAuthStart {
  url: string;
  state: string;
  verifier: string;
  nonce: string;
}

/** Abstracción del proveedor para poder probar la lógica de vinculación sin llamar a Google. */
export interface GoogleProvider {
  readonly enabled: boolean;
  start(): GoogleAuthStart;
  /** Intercambia el código (con PKCE) y valida el id_token (firma, audiencia, expiración y nonce). */
  exchange(code: string, verifier: string, nonce: string): Promise<GoogleClaims>;
}

const b64 = (b: Buffer) => b.toString('base64url');

export class RealGoogleProvider implements GoogleProvider {
  private client?: OAuth2Client;
  constructor() {
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI) {
      this.client = new OAuth2Client({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI });
    }
  }
  get enabled() {
    return Boolean(this.client);
  }

  start(): GoogleAuthStart {
    const state = b64(randomBytes(24));
    const verifier = b64(randomBytes(48));
    const nonce = b64(randomBytes(16));
    const url = this.client!.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      nonce,
      prompt: 'select_account',
      code_challenge: b64(createHash('sha256').update(verifier).digest()),
      code_challenge_method: CodeChallengeMethod.S256,
    });
    return { url, state, verifier, nonce };
  }

  async exchange(code: string, verifier: string, nonce: string): Promise<GoogleClaims> {
    const { tokens } = await this.client!.getToken({ code, codeVerifier: verifier });
    if (!tokens.id_token) throw new Error('Google no devolvió id_token');
    const ticket = await this.client!.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('Claims incompletos');
    if (p.nonce !== nonce) throw new Error('Nonce no coincide');
    return { sub: p.sub, email: p.email.toLowerCase(), emailVerified: p.email_verified === true, name: p.name };
  }
}
