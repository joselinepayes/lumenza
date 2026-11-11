import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    grecaptcha?: { render: (el: HTMLElement, o: Record<string, unknown>) => number; reset: (id?: number) => void };
    onLumenzaRecaptcha?: () => void;
  }
}

/** reCAPTCHA v2 real (solo se monta si el backend reporta siteKey). El token lo valida el servidor. */
export function Recaptcha({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (t: string | null) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);

  useEffect(() => {
    const mount = () => {
      if (!box.current || id.current !== null || !window.grecaptcha) return;
      id.current = window.grecaptcha.render(box.current, {
        sitekey: siteKey,
        callback: (t: string) => onToken(t),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    };
    if (window.grecaptcha?.render) return mount();
    window.onLumenzaRecaptcha = mount;
    if (!document.getElementById('recaptcha-script')) {
      const s = document.createElement('script');
      s.id = 'recaptcha-script';
      s.src = 'https://www.google.com/recaptcha/api.js?onload=onLumenzaRecaptcha&render=explicit';
      s.async = true;
      document.head.appendChild(s);
    }
  }, [siteKey, onToken]);

  useEffect(() => {
    if (resetKey && id.current !== null) window.grecaptcha?.reset(id.current);
  }, [resetKey]);

  return <div ref={box} />;
}
