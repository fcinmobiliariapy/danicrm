import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth, googleProvider } from '../firebase';
import { seedFirestoreIfNeeded } from '../lib/firestoreSeed';
import {
  ensureUserProfile,
  getPublicBranding,
  getSystemSettings,
  getTerritorialTree,
  isBootstrappedAdminEmail,
  listCustomFields,
  TerritorialMaps,
} from '../lib/firestoreService';
import { CustomField, Department, District, Seccional, SystemSettings, User } from '../types';

interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info';
  text: string;
}

interface AppContextValue {
  user: User | null;
  loadingAuth: boolean;
  settings: SystemSettings;
  departments: Department[];
  districts: District[];
  seccionales: Seccional[];
  territorialMaps: TerritorialMaps;
  customFields: CustomField[];
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshTerritorial: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshCustomFields: () => Promise<void>;
  applyThemePreview: (s: SystemSettings) => void;
  hasPermission: (key: string) => boolean;
  notify: (text: string, type?: 'success' | 'error' | 'info') => void;
}

const DEFAULT_SETTINGS: SystemSettings = {
  id: 'main',
  platform_name: 'CRM Político – Gestión Territorial',
  organization_name: 'Comando Territorial Dani Centurión 2018',
  campaign_reference: 'DANI CENTURIÓN 2018',
  logo_url: '/src/assets/images/brand_emblem_1794844008906.jpg',
  institutional_image_url: '/src/assets/images/campaign_banner_1794844011380.jpg',
  primary_color: '#1E3A8A',
  secondary_color: '#B91C1C',
  theme_mode: 'light',
  background_color: '#F8FAFC',
  surface_color: '#FFFFFF',
  text_color: '#0F172A',
  font_family: 'Plus Jakarta Sans',
  font_size_scale: 'normal',
  border_radius: 'rounded',
  header_text: 'CRM POLÍTICO – GESTIÓN TERRITORIAL | DANI CENTURIÓN 2018',
  footer_text: 'Documento de uso interno y confidencial · Estructura Territorial Paraguay',
  institutional_text:
    'Plataforma centralizada de organización territorial, coordinación electoral, agenda política y proyección estadística.',
  contact_phone: '+595 21 440 2018',
  contact_email: 'coordinacion@danicenturion2018.org.py',
  contact_address: 'Asunción, República del Paraguay',
  document_format: 'A4',
  date_format: 'DD/MM/YYYY',
  report_show_charts: true,
  report_show_totals: true,
};

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [seccionales, setSeccionales] = useState<Seccional[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((text: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const applyThemeColors = useCallback((s: SystemSettings) => {
    const root = document.documentElement;
    const isDark = s.theme_mode === 'dark';
    root.classList.toggle('dark', isDark);

    root.style.setProperty('--brand-primary', s.primary_color || '#1E3A8A');
    root.style.setProperty('--brand-secondary', s.secondary_color || '#B91C1C');
    root.style.setProperty('--app-bg', s.background_color || (isDark ? '#0F172A' : '#F8FAFC'));
    root.style.setProperty('--app-surface', s.surface_color || (isDark ? '#1E293B' : '#FFFFFF'));
    root.style.setProperty('--app-text', s.text_color || (isDark ? '#F8FAFC' : '#0F172A'));
    root.style.setProperty('--app-border', isDark ? '#334155' : '#E2E8F0');

    const chosenFont = s.font_family || 'Plus Jakarta Sans';
    root.style.setProperty('--app-font', `"${chosenFont}", system-ui, sans-serif`);
    root.style.setProperty('--app-display-font', `"${chosenFont}", system-ui, sans-serif`);

    const scaleMap = { compact: '14.5px', normal: '16px', large: '17.5px' };
    root.style.fontSize = scaleMap[s.font_size_scale || 'normal'] || '16px';

    const radiusMap = { sharp: '4px', rounded: '12px', soft: '18px' };
    root.style.setProperty('--app-radius', radiusMap[s.border_radius || 'rounded'] || '12px');

    document.title = s.platform_name || 'CRM Político – Gestión Territorial';
  }, []);

  const territorialMaps = useMemo<TerritorialMaps>(
    () => ({
      deptMap: Object.fromEntries(departments.map((d) => [d.id, d.name])),
      distMap: Object.fromEntries(districts.map((d) => [d.id, d.name])),
    }),
    [departments, districts]
  );

  const refreshTerritorial = useCallback(async () => {
    if (!user || !user.active) return;
    const data = await getTerritorialTree(user);
    setDepartments(data.departments);
    setDistricts(data.districts);
    setSeccionales(data.seccionales);
  }, [user]);

  const refreshSettings = useCallback(async () => {
    if (!user || !user.active) return;
    const s = await getSystemSettings();
    setSettings(s);
    applyThemeColors(s);
  }, [user, applyThemeColors]);

  const refreshCustomFields = useCallback(async () => {
    if (!user || !user.active) return;
    const cf = await listCustomFields(user, true);
    setCustomFields(cf);
  }, [user]);

  const bootstrapAuthenticated = useCallback(
    async (activeUser: User) => {
      if (isBootstrappedAdminEmail(activeUser.email)) {
        await seedFirestoreIfNeeded(activeUser);
      }
      const [s, tree, cf] = await Promise.all([
        getSystemSettings(),
        getTerritorialTree(activeUser),
        listCustomFields(activeUser, true),
      ]);
      setSettings(s);
      applyThemeColors(s);
      setDepartments(tree.departments);
      setDistricts(tree.districts);
      setSeccionales(tree.seccionales);
      setCustomFields(cf);
    },
    [applyThemeColors]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const pub = await getPublicBranding();
        if (mounted && pub?.platform_name) {
          setSettings(pub);
          applyThemeColors(pub);
        }
      } catch {
        // ignore unauthenticated branding fallback
      }
    })();

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!mounted) return;
      if (!fbUser) {
        setUser(null);
        setDepartments([]);
        setDistricts([]);
        setSeccionales([]);
        setCustomFields([]);
        setLoadingAuth(false);
        return;
      }

      setLoadingAuth(true);
      try {
        const profile = await ensureUserProfile(fbUser);
        if (!mounted) return;
        setUser(profile);
        if (profile.active) {
          await bootstrapAuthenticated(profile);
        }
      } catch (err) {
        console.error('Error al inicializar sesión de Firebase:', err);
        if (mounted) {
          notify(err instanceof Error ? err.message : 'Error al verificar sesión con Firestore.', 'error');
        }
      } finally {
        if (mounted) setLoadingAuth(false);
      }
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, [applyThemeColors, bootstrapAuthenticated, notify]);

  const loginWithGoogle = async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    const displayName = cred.user.displayName || cred.user.email || 'Usuario';
    notify(`Sesión iniciada como ${displayName}`, 'success');
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
  };

  const hasPermission = useCallback(
    (key: string) => {
      if (!user || !user.active) return false;
      if (user.role_slug === 'super_admin') return true;
      return !!user.permissions?.[key];
    },
    [user]
  );

  return (
    <AppContext.Provider
      value={{
        user,
        loadingAuth,
        settings,
        departments,
        districts,
        seccionales,
        territorialMaps,
        customFields,
        loginWithGoogle,
        logout,
        refreshTerritorial,
        refreshSettings,
        refreshCustomFields,
        applyThemePreview: applyThemeColors,
        hasPermission,
        notify,
      }}
    >
      {children}
      <div className="fixed top-4 right-4 z-[70] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm font-medium shadow-lg transition-all ${
              t.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : t.type === 'info'
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp debe utilizarse dentro de AppProvider');
  return ctx;
}
