import { Database, ShieldCheck } from 'lucide-react';
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export const LoginPage: React.FC = () => {
  const { loginWithGoogle, settings } = useApp();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleSignIn = async () => {
    setError('');
    setSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.';
      if (msg.includes('popup-closed-by-user')) {
        setError('Se cerró la ventana de acceso antes de completar el inicio de sesión.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-slate-50">
      {/* Left Institutional Visual */}
      <div className="relative hidden lg:flex lg:col-span-7 flex-col justify-between overflow-hidden bg-slate-900 p-12 text-white">
        <img
          src={settings.institutional_image_url}
          alt={settings.organization_name}
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover opacity-55"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/50 to-slate-950/40" />

        <div className="relative z-10 flex items-center gap-3">
          <img
            src={settings.logo_url}
            alt={settings.organization_name}
            referrerPolicy="no-referrer"
            className="h-12 w-12 rounded-xl object-cover bg-white p-0.5 shadow-md"
          />
          <div>
            <div className="text-sm font-semibold tracking-wide text-slate-200">{settings.campaign_reference}</div>
            <div className="text-base font-bold text-white">{settings.organization_name}</div>
          </div>
        </div>

        <div className="relative z-10 max-w-xl">
          <h1 className="text-4xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]">
            {settings.platform_name}
          </h1>
          <p className="mt-4 text-base text-slate-200 leading-relaxed">{settings.institutional_text}</p>
          <div className="mt-8 flex flex-wrap items-center gap-6 text-xs text-slate-300 border-t border-white/15 pt-5">
            <span>18 Departamentos de Paraguay</span>
            <span aria-hidden="true">·</span>
            <span>Estructura de Coordinadores, Jóvenes y Mujeres</span>
            <span aria-hidden="true">·</span>
            <span>Proyección de Votos y Agenda</span>
          </div>
        </div>
      </div>

      {/* Right Authentication Form */}
      <div className="lg:col-span-5 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs">
          <div className="flex items-center gap-3 mb-6">
            <img
              src={settings.logo_url}
              alt={settings.organization_name}
              referrerPolicy="no-referrer"
              className="h-11 w-11 rounded-lg object-cover border border-slate-200"
            />
            <div>
              <h2 className="text-xl font-bold text-slate-900">Acceso al Sistema</h2>
              <p className="text-xs text-slate-500">{settings.campaign_reference}</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              Ingrese con su cuenta institucional de Google para acceder a la base de datos territorial en tiempo real.
            </p>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={submitting}
              style={{ backgroundColor: settings.primary_color }}
              className="w-full min-h-[46px] inline-flex items-center justify-center gap-2.5 rounded-lg py-2.5 px-4 text-sm font-semibold text-white hover:opacity-95 transition-opacity disabled:opacity-60"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81z"
                />
              </svg>
              <span>{submitting ? 'Conectando con Google...' : 'Ingresar con Google'}</span>
            </button>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-200 space-y-2.5 text-xs text-slate-600">
            <div className="flex items-start gap-2">
              <Database className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
              <span>Persistencia sincronizada en la nube con Firebase Firestore y control por roles.</span>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
              <span>
                Los usuarios nuevos quedan pendientes de aprobación hasta que el administrador habilite su rol territorial.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
