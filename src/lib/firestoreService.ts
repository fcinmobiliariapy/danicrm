import { User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  AgendaEvent,
  AuditLogEntry,
  CustomField,
  Department,
  District,
  OnpRecord,
  PersonRecord,
  RoleSlug,
  SavedReport,
  Seccional,
  SystemSettings,
  User,
  UserInvite,
  VoteProjection,
} from '../types';
import { handleFirestoreError, OperationType } from './firestoreErrors';
import { DEFAULT_BRANDING_DOC, DEFAULT_SYSTEM_SETTINGS_DOC } from './firestoreSeed';
import { BOOTSTRAPPED_ADMIN_EMAIL, computeEffectivePermissions, getRoleName } from './rbac';

// --- Defensive Payload Sanitization synchronized with firebase-blueprint.json ---

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const ID_RE = /^[a-zA-Z0-9_\-]+$/;

function clampStr(v: unknown, max: number, fallback = ''): string {
  const s = String(v ?? fallback).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function safeColor(v: unknown, fallback: string): string {
  const s = String(v ?? '').trim();
  return HEX_COLOR_RE.test(s) ? s : fallback;
}

function safeId(prefix = 'id'): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const id = `${prefix}_${raw}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return id.slice(0, 120);
}

function formatTs(ts: unknown): string {
  if (!ts) return '';
  if (ts instanceof Timestamp) {
    return ts.toDate().toISOString();
  }
  if (typeof ts === 'string') return ts;
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    return new Date((ts as { seconds: number }).seconds * 1000).toISOString();
  }
  return '';
}

export function isBootstrappedAdminEmail(email?: string | null): boolean {
  return (email || '').trim().toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
}

function maskCi(ci: string): string {
  if (!ci) return '****';
  const clean = ci.trim();
  if (clean.length <= 3) return '***';
  return `${'*'.repeat(Math.max(3, clean.length - 3))}${clean.slice(-3)}`;
}

function maskPhone(phone: string): string {
  if (!phone) return '****';
  const digits = phone.replace(/\s+/g, '');
  if (digits.length <= 4) return '****';
  return `${digits.slice(0, 4)}***${digits.slice(-3)}`;
}

function sanitizeCustomFieldsMap(raw?: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw).slice(0, 30)) {
    const cleanKey = k.replace(/[^a-z0-9_]/gi, '_').slice(0, 64);
    if (!cleanKey) continue;
    if (typeof v === 'number' && !isNaN(v)) {
      out[cleanKey] = v;
    } else {
      out[cleanKey] = clampStr(v, 500);
    }
  }
  return out;
}

async function queryCollectionForUser(colName: string, user: User) {
  try {
    if (isBootstrappedAdminEmail(user.email)) {
      return await getDocs(collection(db, colName));
    }
    return await getDocs(query(collection(db, colName), where('ownerUid', '==', user.uid)));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, colName);
  }
}

async function queryCatalogForUser(colName: string, user: User) {
  try {
    if (isBootstrappedAdminEmail(user.email)) {
      return await getDocs(collection(db, colName));
    }
    return await getDocs(query(collection(db, colName), where('active', '==', true)));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, colName);
  }
}

export async function logAudit(
  user: User,
  action: string,
  module: string,
  entityId: string,
  details: string
): Promise<void> {
  try {
    const id = safeId('audit');
    await setDoc(doc(db, 'audit_logs', id), {
      user_uid: user.uid,
      username: clampStr(user.username || user.email, 80, 'usuario'),
      action: clampStr(action, 40, 'ACCION'),
      module: clampStr(module, 40, 'sistema'),
      entity_id: clampStr(entityId, 128),
      details: clampStr(details, 500),
      ownerUid: user.uid,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'audit_logs');
  }
}

// --- Public Branding & System Settings ---

export async function getPublicBranding(): Promise<SystemSettings> {
  try {
    const snap = await getDoc(doc(db, 'public_branding', 'main'));
    if (!snap.exists()) {
      return {
        ...DEFAULT_SYSTEM_SETTINGS_DOC,
        id: 'main',
      } as SystemSettings;
    }
    const d = snap.data();
    return {
      ...DEFAULT_SYSTEM_SETTINGS_DOC,
      id: 'main',
      platform_name: clampStr(d.platform_name, 120, DEFAULT_BRANDING_DOC.platform_name),
      organization_name: clampStr(d.organization_name, 140, DEFAULT_BRANDING_DOC.organization_name),
      campaign_reference: clampStr(d.campaign_reference, 80, DEFAULT_BRANDING_DOC.campaign_reference),
      logo_url: clampStr(d.logo_url, 500000, DEFAULT_BRANDING_DOC.logo_url),
      institutional_image_url: clampStr(d.institutional_image_url, 500000, DEFAULT_BRANDING_DOC.institutional_image_url),
      primary_color: safeColor(d.primary_color, DEFAULT_BRANDING_DOC.primary_color),
      secondary_color: safeColor(d.secondary_color, DEFAULT_BRANDING_DOC.secondary_color),
      theme_mode: (d.theme_mode as SystemSettings['theme_mode']) || 'light',
      background_color: safeColor(d.background_color, DEFAULT_BRANDING_DOC.background_color),
      surface_color: safeColor(d.surface_color, DEFAULT_BRANDING_DOC.surface_color),
      text_color: safeColor(d.text_color, DEFAULT_BRANDING_DOC.text_color),
      font_family: clampStr(d.font_family, 60, DEFAULT_BRANDING_DOC.font_family),
      font_size_scale: (d.font_size_scale as SystemSettings['font_size_scale']) || 'normal',
      border_radius: (d.border_radius as SystemSettings['border_radius']) || 'rounded',
      institutional_text: clampStr(d.institutional_text, 600, DEFAULT_BRANDING_DOC.institutional_text),
    } as SystemSettings;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'public_branding/main');
  }
}

export async function getSystemSettings(): Promise<SystemSettings> {
  try {
    const snap = await getDoc(doc(db, 'system_settings', 'main'));
    if (!snap.exists()) {
      return { ...DEFAULT_SYSTEM_SETTINGS_DOC, id: 'main' } as SystemSettings;
    }
    const d = snap.data();
    return {
      id: 'main',
      platform_name: clampStr(d.platform_name, 120, DEFAULT_SYSTEM_SETTINGS_DOC.platform_name),
      organization_name: clampStr(d.organization_name, 140, DEFAULT_SYSTEM_SETTINGS_DOC.organization_name),
      campaign_reference: clampStr(d.campaign_reference, 80, DEFAULT_SYSTEM_SETTINGS_DOC.campaign_reference),
      logo_url: clampStr(d.logo_url, 500000, DEFAULT_SYSTEM_SETTINGS_DOC.logo_url),
      institutional_image_url: clampStr(d.institutional_image_url, 500000, DEFAULT_SYSTEM_SETTINGS_DOC.institutional_image_url),
      primary_color: safeColor(d.primary_color, DEFAULT_SYSTEM_SETTINGS_DOC.primary_color),
      secondary_color: safeColor(d.secondary_color, DEFAULT_SYSTEM_SETTINGS_DOC.secondary_color),
      theme_mode: (d.theme_mode as SystemSettings['theme_mode']) || 'light',
      background_color: safeColor(d.background_color, DEFAULT_SYSTEM_SETTINGS_DOC.background_color),
      surface_color: safeColor(d.surface_color, DEFAULT_SYSTEM_SETTINGS_DOC.surface_color),
      text_color: safeColor(d.text_color, DEFAULT_SYSTEM_SETTINGS_DOC.text_color),
      font_family: clampStr(d.font_family, 60, DEFAULT_SYSTEM_SETTINGS_DOC.font_family),
      font_size_scale: (d.font_size_scale as SystemSettings['font_size_scale']) || 'normal',
      border_radius: (d.border_radius as SystemSettings['border_radius']) || 'rounded',
      header_text: clampStr(d.header_text, 200),
      footer_text: clampStr(d.footer_text, 240),
      institutional_text: clampStr(d.institutional_text, 600),
      contact_phone: clampStr(d.contact_phone, 40),
      contact_email: clampStr(d.contact_email, 120),
      contact_address: clampStr(d.contact_address, 180),
      document_format: d.document_format === 'LETTER' ? 'LETTER' : 'A4',
      date_format: d.date_format === 'YYYY-MM-DD' ? 'YYYY-MM-DD' : 'DD/MM/YYYY',
      report_show_charts: d.report_show_charts !== false,
      report_show_totals: d.report_show_totals !== false,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'system_settings/main');
  }
}

export async function saveSystemSettings(user: User, s: SystemSettings): Promise<void> {
  const logoUrl = clampStr(s.logo_url, 500000);
  const instUrl = clampStr(s.institutional_image_url, 500000);
  if (logoUrl.length >= 499000 || instUrl.length >= 499000) {
    throw new Error('Las imágenes exceden el límite permitido (500 KB). Reduzca el tamaño antes de guardar.');
  }
  const commonBranding = {
    platform_name: clampStr(s.platform_name, 120, 'CRM Político – Gestión Territorial'),
    organization_name: clampStr(s.organization_name, 140, 'Organización'),
    campaign_reference: clampStr(s.campaign_reference, 80),
    logo_url: logoUrl,
    institutional_image_url: instUrl,
    primary_color: safeColor(s.primary_color, '#1E3A8A'),
    secondary_color: safeColor(s.secondary_color, '#B91C1C'),
    theme_mode: ['light', 'dark', 'custom'].includes(s.theme_mode) ? s.theme_mode : 'light',
    background_color: safeColor(s.background_color, '#F8FAFC'),
    surface_color: safeColor(s.surface_color, '#FFFFFF'),
    text_color: safeColor(s.text_color, '#0F172A'),
    font_family: clampStr(s.font_family, 60, 'Plus Jakarta Sans'),
    font_size_scale: ['compact', 'normal', 'large'].includes(s.font_size_scale) ? s.font_size_scale : 'normal',
    border_radius: ['sharp', 'rounded', 'soft'].includes(s.border_radius) ? s.border_radius : 'rounded',
    institutional_text: clampStr(s.institutional_text, 600),
  };

  try {
    const existingSettings = await getDoc(doc(db, 'system_settings', 'main'));
    const batch = writeBatch(db);
    if (existingSettings.exists()) {
      batch.update(doc(db, 'system_settings', 'main'), {
        ...commonBranding,
        header_text: clampStr(s.header_text, 200),
        footer_text: clampStr(s.footer_text, 240),
        contact_phone: clampStr(s.contact_phone, 40),
        contact_email: clampStr(s.contact_email, 120),
        contact_address: clampStr(s.contact_address, 180),
        document_format: s.document_format === 'LETTER' ? 'LETTER' : 'A4',
        date_format: s.date_format === 'YYYY-MM-DD' ? 'YYYY-MM-DD' : 'DD/MM/YYYY',
        report_show_charts: Boolean(s.report_show_charts),
        report_show_totals: Boolean(s.report_show_totals),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(doc(db, 'system_settings', 'main'), {
        ...commonBranding,
        header_text: clampStr(s.header_text, 200),
        footer_text: clampStr(s.footer_text, 240),
        contact_phone: clampStr(s.contact_phone, 40),
        contact_email: clampStr(s.contact_email, 120),
        contact_address: clampStr(s.contact_address, 180),
        document_format: s.document_format === 'LETTER' ? 'LETTER' : 'A4',
        date_format: s.date_format === 'YYYY-MM-DD' ? 'YYYY-MM-DD' : 'DD/MM/YYYY',
        report_show_charts: Boolean(s.report_show_charts),
        report_show_totals: Boolean(s.report_show_totals),
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'public_branding', 'main'), {
      ...commonBranding,
      ownerUid: user.uid,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    await logAudit(user, 'ACTUALIZAR_CONFIGURACION', 'admin', 'main', 'Actualización de configuración general e identidad visual.');
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'system_settings/main');
  }
}

// --- User Profile & Auth Resolution ---

export async function ensureUserProfile(fbUser: FirebaseUser): Promise<User> {
  const uid = fbUser.uid;
  const email = (fbUser.email || '').trim().toLowerCase();
  const displayName = clampStr(fbUser.displayName || email.split('@')[0] || 'Usuario', 120);
  const fullNameSafe = displayName.length >= 2 ? displayName : 'Usuario CRM';
  const usernameBase = clampStr(email.split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '') || 'usuario', 60);
  const usernameSafe = usernameBase.length >= 2 ? usernameBase : `u_${uid.slice(0, 6)}`;
  const isBootstrapped = isBootstrappedAdminEmail(email);

  const userRef = doc(db, 'users', uid);
  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }

  const nowIso = new Date().toISOString();

  if (!snap.exists()) {
    const roleSlug: RoleSlug = isBootstrapped ? 'super_admin' : 'viewer';
    const roleName = getRoleName(roleSlug);
    const active = isBootstrapped;
    try {
      await setDoc(userRef, {
        uid,
        username: usernameSafe,
        full_name: fullNameSafe,
        email: email || `${uid}@no-email.local`,
        role_slug: roleSlug,
        role_name: roleName,
        active,
        custom_permissions: {},
        last_login_at: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${uid}`);
    }
    return {
      id: uid,
      uid,
      username: usernameSafe,
      full_name: fullNameSafe,
      email,
      role_slug: roleSlug,
      role_name: roleName,
      active,
      custom_permissions: {},
      permissions: computeEffectivePermissions(roleSlug, {}),
      last_login_at: nowIso,
    };
  }

  const d = snap.data();
  // Keep self-update strictly within ['full_name', 'last_login_at', 'updatedAt'] for non-admins
  try {
    if (isBootstrapped && (d.role_slug !== 'super_admin' || !d.active)) {
      await updateDoc(userRef, {
        role_slug: 'super_admin',
        role_name: getRoleName('super_admin'),
        active: true,
        last_login_at: nowIso,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        last_login_at: nowIso,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }

  const roleSlug: RoleSlug = isBootstrapped
    ? 'super_admin'
    : ((d.role_slug as RoleSlug) || 'viewer');
  const customPerms = (d.custom_permissions as Record<string, boolean>) || {};
  return {
    id: uid,
    uid,
    username: clampStr(d.username, 60, usernameSafe),
    full_name: clampStr(d.full_name, 120, fullNameSafe),
    email: clampStr(d.email, 160, email),
    role_slug: roleSlug,
    role_name: clampStr(d.role_name, 60, getRoleName(roleSlug)),
    active: isBootstrapped ? true : Boolean(d.active),
    custom_permissions: customPerms,
    permissions: computeEffectivePermissions(roleSlug, customPerms),
    last_login_at: nowIso,
  };
}

// --- Territorial Tree & CRUD ---

export async function getTerritorialTree(user: User): Promise<{
  departments: Department[];
  districts: District[];
  seccionales: Seccional[];
}> {
  const [deptSnap, distSnap, seccSnap] = await Promise.all([
    queryCatalogForUser('departments', user),
    queryCatalogForUser('districts', user),
    queryCatalogForUser('seccionales', user),
  ]);

  const departments: Department[] = deptSnap.docs
    .map((docSnap) => {
      const d = docSnap.data();
      return {
        id: docSnap.id,
        code: String(d.code || ''),
        name: String(d.name || ''),
        active: Boolean(d.active),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));

  const districts: District[] = distSnap.docs
    .map((docSnap) => {
      const d = docSnap.data();
      return {
        id: docSnap.id,
        department_id: String(d.department_id || ''),
        name: String(d.name || ''),
        active: Boolean(d.active),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const seccionales: Seccional[] = seccSnap.docs
    .map((docSnap) => {
      const d = docSnap.data();
      return {
        id: docSnap.id,
        department_id: String(d.department_id || ''),
        district_id: String(d.district_id || ''),
        number: Number(d.number || 0),
        name: String(d.name || ''),
        active: Boolean(d.active),
      };
    })
    .sort((a, b) => a.number - b.number);

  return { departments, districts, seccionales };
}

export async function saveDepartment(
  user: User,
  payload: { code: string; name: string; active?: boolean },
  editingId?: string
): Promise<void> {
  const code = clampStr(payload.code || '18', 10);
  const name = clampStr(payload.name, 80);
  if (name.length < 2) throw new Error('Ingrese un nombre de departamento válido.');

  try {
    if (editingId) {
      await updateDoc(doc(db, 'departments', editingId), {
        code,
        name,
        active: payload.active !== undefined ? Boolean(payload.active) : true,
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'EDITAR_DEPARTAMENTO', 'territorial', editingId, `Departamento actualizado: ${name}`);
    } else {
      const id = safeId('dept');
      await setDoc(doc(db, 'departments', id), {
        code,
        name,
        active: payload.active !== undefined ? Boolean(payload.active) : true,
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'CREAR_DEPARTAMENTO', 'territorial', id, `Departamento creado: ${name}`);
    }
  } catch (err) {
    handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'departments');
  }
}

export async function toggleDepartmentActive(user: User, dept: Department): Promise<void> {
  try {
    await updateDoc(doc(db, 'departments', dept.id), {
      active: !dept.active,
      updatedAt: serverTimestamp(),
    });
    await logAudit(user, 'ESTADO_DEPARTAMENTO', 'territorial', dept.id, `${dept.name}: ${!dept.active ? 'Activo' : 'Inactivo'}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `departments/${dept.id}`);
  }
}

export async function deleteDepartment(user: User, deptId: string, label: string): Promise<void> {
  try {
    const linkedDist = await getDocs(query(collection(db, 'districts'), where('department_id', '==', deptId), limit(1)));
    if (!linkedDist.empty) {
      throw new Error('No se puede eliminar este departamento porque tiene distritos vinculados.');
    }
    await deleteDoc(doc(db, 'departments', deptId));
    await logAudit(user, 'ELIMINAR_DEPARTAMENTO', 'territorial', deptId, `Departamento eliminado: ${label}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('distritos vinculados')) throw err;
    handleFirestoreError(err, OperationType.DELETE, `departments/${deptId}`);
  }
}

export async function saveDistrict(
  user: User,
  payload: { department_id: string; name: string; active?: boolean },
  editingId?: string
): Promise<void> {
  const department_id = clampStr(payload.department_id, 128);
  const name = clampStr(payload.name, 100);
  if (!ID_RE.test(department_id) || name.length < 2) {
    throw new Error('Seleccione un departamento y un nombre de distrito válido.');
  }
  try {
    if (editingId) {
      await updateDoc(doc(db, 'districts', editingId), {
        department_id,
        name,
        active: payload.active !== undefined ? Boolean(payload.active) : true,
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'EDITAR_DISTRITO', 'territorial', editingId, `Distrito actualizado: ${name}`);
    } else {
      const id = safeId('dist');
      await setDoc(doc(db, 'districts', id), {
        department_id,
        name,
        active: payload.active !== undefined ? Boolean(payload.active) : true,
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'CREAR_DISTRITO', 'territorial', id, `Distrito creado: ${name}`);
    }
  } catch (err) {
    handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'districts');
  }
}

export async function toggleDistrictActive(user: User, dist: District): Promise<void> {
  try {
    await updateDoc(doc(db, 'districts', dist.id), {
      active: !dist.active,
      updatedAt: serverTimestamp(),
    });
    await logAudit(user, 'ESTADO_DISTRITO', 'territorial', dist.id, `${dist.name}: ${!dist.active ? 'Activo' : 'Inactivo'}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `districts/${dist.id}`);
  }
}

export async function deleteDistrict(user: User, distId: string, label: string): Promise<void> {
  try {
    const linkedSecc = await getDocs(query(collection(db, 'seccionales'), where('district_id', '==', distId), limit(1)));
    if (!linkedSecc.empty) {
      throw new Error('No se puede eliminar este distrito porque tiene seccionales vinculadas.');
    }
    await deleteDoc(doc(db, 'districts', distId));
    await logAudit(user, 'ELIMINAR_DISTRITO', 'territorial', distId, `Distrito eliminado: ${label}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('seccionales vinculadas')) throw err;
    handleFirestoreError(err, OperationType.DELETE, `districts/${distId}`);
  }
}

export async function saveSeccional(
  user: User,
  payload: { department_id: string; district_id: string; number: number; name?: string; active?: boolean },
  editingId?: string
): Promise<void> {
  const department_id = clampStr(payload.department_id, 128);
  const district_id = clampStr(payload.district_id, 128);
  const num = Math.trunc(Number(payload.number));
  const name = clampStr(payload.name || '', 120);
  if (!ID_RE.test(department_id) || !ID_RE.test(district_id) || isNaN(num) || num < 1 || num > 99999) {
    throw new Error('Complete departamento, distrito y un número de seccional válido (1-99999).');
  }
  try {
    if (editingId) {
      await updateDoc(doc(db, 'seccionales', editingId), {
        department_id,
        district_id,
        number: num,
        name,
        active: payload.active !== undefined ? Boolean(payload.active) : true,
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'EDITAR_SECCIONAL', 'territorial', editingId, `Seccional N° ${num} actualizada.`);
    } else {
      const id = safeId('secc');
      await setDoc(doc(db, 'seccionales', id), {
        department_id,
        district_id,
        number: num,
        name,
        active: payload.active !== undefined ? Boolean(payload.active) : true,
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'CREAR_SECCIONAL', 'territorial', id, `Seccional N° ${num} creada.`);
    }
  } catch (err) {
    handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'seccionales');
  }
}

export async function toggleSeccionalActive(user: User, secc: Seccional): Promise<void> {
  try {
    await updateDoc(doc(db, 'seccionales', secc.id), {
      active: !secc.active,
      updatedAt: serverTimestamp(),
    });
    await logAudit(user, 'ESTADO_SECCIONAL', 'territorial', secc.id, `Seccional N° ${secc.number}: ${!secc.active ? 'Activa' : 'Inactiva'}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `seccionales/${secc.id}`);
  }
}

export async function deleteSeccional(user: User, seccId: string, label: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'seccionales', seccId));
    await logAudit(user, 'ELIMINAR_SECCIONAL', 'territorial', seccId, `Seccional eliminada: ${label}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `seccionales/${seccId}`);
  }
}

// --- Custom Fields ---

export async function listCustomFields(user: User, onlyActive = true): Promise<CustomField[]> {
  const snap = onlyActive
    ? await queryCatalogForUser('custom_fields', user)
    : await queryCollectionForUser('custom_fields', user);

  return snap.docs
    .map((docSnap) => {
      const d = docSnap.data();
      return {
        id: docSnap.id,
        module: d.module as CustomField['module'],
        field_key: String(d.field_key || ''),
        label: String(d.label || ''),
        field_type: d.field_type as CustomField['field_type'],
        required: Boolean(d.required),
        active: Boolean(d.active),
        sort_order: Number(d.sort_order || 0),
        options: Array.isArray(d.options) ? d.options.map(String) : [],
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

export async function createCustomField(
  user: User,
  payload: {
    module: CustomField['module'];
    label: string;
    field_type: CustomField['field_type'];
    required: boolean;
    options: string[];
    sort_order?: number;
  }
): Promise<void> {
  const label = clampStr(payload.label, 80);
  if (!label) throw new Error('Ingrese una etiqueta válida para el campo.');
  const baseKey = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 52);
  const field_key = `${baseKey || 'campo'}_${Date.now().toString().slice(-4)}`.slice(0, 64);
  const options = (payload.options || []).map((o) => clampStr(o, 80)).filter(Boolean).slice(0, 30);

  try {
    const id = safeId('cf');
    await setDoc(doc(db, 'custom_fields', id), {
      module: payload.module,
      field_key,
      label,
      field_type: payload.field_type,
      required: Boolean(payload.required),
      active: true,
      sort_order: Math.max(0, Math.min(1000, Math.trunc(Number(payload.sort_order ?? 10)))),
      options,
      ownerUid: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logAudit(user, 'CREAR_CAMPO_PERSONALIZADO', 'admin', id, `Campo "${label}" agregado a ${payload.module}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'custom_fields');
  }
}

export async function updateCustomField(
  user: User,
  id: string,
  patch: Partial<{ label: string; field_type: CustomField['field_type']; required: boolean; active: boolean; sort_order: number; options: string[] }>
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.label !== undefined) payload.label = clampStr(patch.label, 80);
  if (patch.field_type !== undefined) payload.field_type = patch.field_type;
  if (patch.required !== undefined) payload.required = Boolean(patch.required);
  if (patch.active !== undefined) payload.active = Boolean(patch.active);
  if (patch.sort_order !== undefined) payload.sort_order = Math.max(0, Math.min(1000, Math.trunc(Number(patch.sort_order))));
  if (patch.options !== undefined) payload.options = patch.options.map((o) => clampStr(o, 80)).filter(Boolean).slice(0, 30);

  try {
    await updateDoc(doc(db, 'custom_fields', id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `custom_fields/${id}`);
  }
}

export async function deleteCustomField(user: User, id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'custom_fields', id));
    await logAudit(user, 'ELIMINAR_CAMPO_PERSONALIZADO', 'admin', id, `Campo personalizado eliminado (${id}).`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `custom_fields/${id}`);
  }
}

// --- People Modules (Coordinators, Youth, Women) ---

export type PeopleModuleKey = 'coordinators' | 'youth' | 'women';

const PEOPLE_COLLECTION_MAP: Record<PeopleModuleKey, string> = {
  coordinators: 'coordinators',
  youth: 'youth_members',
  women: 'women_members',
};

export interface TerritorialMaps {
  deptMap: Record<string, string>;
  distMap: Record<string, string>;
}

async function fetchAllPeopleRecords(
  user: User,
  moduleKey: PeopleModuleKey,
  maps: TerritorialMaps,
  canViewSensitive: boolean
): Promise<PersonRecord[]> {
  const colName = PEOPLE_COLLECTION_MAP[moduleKey];
  const snap = await queryCollectionForUser(colName, user);
  return snap.docs.map((docSnap) => {
    const d = docSnap.data();
    const rawCi = String(d.ci || '');
    const rawPhone = String(d.phone || '');
    const deptId = String(d.department_id || '');
    const distId = String(d.district_id || '');
    return {
      id: docSnap.id,
      first_name: String(d.first_name || ''),
      last_name: String(d.last_name || ''),
      ci: canViewSensitive ? rawCi : maskCi(rawCi),
      ci_raw: canViewSensitive ? rawCi : undefined,
      department_id: deptId,
      district_id: distId,
      department_name: maps.deptMap[deptId] || '—',
      district_name: maps.distMap[distId] || '—',
      seccional_number: Number(d.seccional_number || 0),
      phone: canViewSensitive ? rawPhone : maskPhone(rawPhone),
      phone_raw: canViewSensitive ? rawPhone : undefined,
      registered_at: String(d.registered_at || ''),
      notes: String(d.notes || ''),
      consent_accepted: Boolean(d.consent_accepted),
      custom_fields: (d.custom_fields as Record<string, string | number>) || {},
      created_at: formatTs(d.createdAt),
    };
  });
}

export async function listPeople(
  user: User,
  moduleKey: PeopleModuleKey,
  params: {
    search?: string;
    department_id?: string;
    district_id?: string;
    seccional_number?: string;
    page?: number;
    limit?: number;
  },
  maps: TerritorialMaps,
  canViewSensitive: boolean
) {
  const all = await fetchAllPeopleRecords(user, moduleKey, maps, canViewSensitive);
  const q = (params.search || '').trim().toLowerCase();
  const filtered = all
    .filter((r) => {
      if (params.department_id && r.department_id !== params.department_id) return false;
      if (params.district_id && r.district_id !== params.district_id) return false;
      if (params.seccional_number && String(r.seccional_number) !== params.seccional_number.trim()) return false;
      if (q) {
        const hay = `${r.first_name} ${r.last_name} ${r.ci_raw || r.ci} ${r.phone_raw || r.phone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));

  const locCounts = new Map<string, { department_name: string; district_name: string; total: number }>();
  for (const r of filtered) {
    const key = `${r.department_id}::${r.district_id}`;
    const cur = locCounts.get(key) || {
      department_name: r.department_name || '—',
      district_name: r.district_name || '—',
      total: 0,
    };
    cur.total += 1;
    locCounts.set(key, cur);
  }

  const pageSize = Math.max(1, params.limit || 12);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, params.page || 1), totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    items: filtered.slice(start, start + pageSize),
    total,
    page: currentPage,
    limit: pageSize,
    totalPages,
    locationSummary: Array.from(locCounts.values()).slice(0, 8),
    canViewSensitive,
  };
}

export async function searchCoordinators(user: User, qText: string, maps: TerritorialMaps) {
  const all = await fetchAllPeopleRecords(user, 'coordinators', maps, true);
  const q = qText.trim().toLowerCase();
  return all
    .filter((c) => {
      if (!q) return true;
      return `${c.first_name} ${c.last_name} ${c.ci} ${c.seccional_number} ${c.district_name}`.toLowerCase().includes(q);
    })
    .slice(0, 30)
    .map((c) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      ci: c.ci,
      department_id: c.department_id,
      district_id: c.district_id,
      seccional_number: c.seccional_number,
      department_name: c.department_name || '—',
      district_name: c.district_name || '—',
    }));
}

export async function savePerson(
  user: User,
  moduleKey: PeopleModuleKey,
  payload: {
    first_name: string;
    last_name: string;
    ci: string;
    department_id: string;
    district_id: string;
    seccional_number: number;
    phone: string;
    registered_at: string;
    notes: string;
    consent_accepted: boolean;
    custom_fields?: Record<string, unknown>;
  },
  editingId?: string
): Promise<void> {
  const colName = PEOPLE_COLLECTION_MAP[moduleKey];
  const first_name = clampStr(payload.first_name, 80);
  const last_name = clampStr(payload.last_name, 80);
  const ci = clampStr(payload.ci.replace(/\./g, ''), 20);
  const department_id = clampStr(payload.department_id, 128);
  const district_id = clampStr(payload.district_id, 128);
  const seccional_number = Math.trunc(Number(payload.seccional_number));
  const phone = clampStr(payload.phone, 30);
  const registered_at = DATE_RE.test(payload.registered_at)
    ? payload.registered_at
    : new Date().toISOString().slice(0, 10);
  const notes = clampStr(payload.notes, 1000);
  const custom_fields = sanitizeCustomFieldsMap(payload.custom_fields);

  if (!first_name || !last_name) throw new Error('Nombres y apellidos son obligatorios.');
  if (ci.length < 4) throw new Error('La Cédula de Identidad debe tener al menos 4 caracteres.');
  if (!ID_RE.test(department_id) || !ID_RE.test(district_id)) {
    throw new Error('Seleccione departamento y distrito válidos.');
  }
  if (isNaN(seccional_number) || seccional_number < 1 || seccional_number > 99999) {
    throw new Error('Ingrese un número de seccional válido.');
  }
  if (phone.length < 6) throw new Error('Ingrese un teléfono válido (mínimo 6 caracteres).');
  if (!payload.consent_accepted) {
    throw new Error('Debe aceptar el consentimiento de registro de datos personales.');
  }

  // Duplicate CI check within module scope
  const existingSnap = await queryCollectionForUser(colName, user);
  const dup = existingSnap.docs.find(
    (d) => d.id !== editingId && String(d.data().ci || '').trim().toLowerCase() === ci.toLowerCase()
  );
  if (dup) {
    throw new Error(`Ya existe un registro con la C.I. ${ci} en este módulo.`);
  }

  try {
    if (editingId) {
      await updateDoc(doc(db, colName, editingId), {
        first_name,
        last_name,
        ci,
        department_id,
        district_id,
        seccional_number,
        phone,
        registered_at,
        notes,
        consent_accepted: true,
        custom_fields,
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'ACTUALIZAR_REGISTRO', moduleKey, editingId, `${first_name} ${last_name} (C.I. ${ci})`);
    } else {
      const id = safeId(moduleKey.slice(0, 5));
      await setDoc(doc(db, colName, id), {
        first_name,
        last_name,
        ci,
        department_id,
        district_id,
        seccional_number,
        phone,
        registered_at,
        notes,
        consent_accepted: true,
        custom_fields,
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'CREAR_REGISTRO', moduleKey, id, `${first_name} ${last_name} (C.I. ${ci})`);
    }
  } catch (err) {
    handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, colName);
  }
}

export async function deletePerson(
  user: User,
  moduleKey: PeopleModuleKey,
  id: string,
  label: string
): Promise<void> {
  const colName = PEOPLE_COLLECTION_MAP[moduleKey];
  try {
    await deleteDoc(doc(db, colName, id));
    await logAudit(user, 'ELIMINAR_REGISTRO', moduleKey, id, `Registro eliminado: ${label}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${colName}/${id}`);
  }
}

// --- ONP Module ---

export async function listOnp(
  user: User,
  params: {
    search?: string;
    organization?: string;
    sort_by?: 'full_name' | 'organization' | 'id';
    page?: number;
    limit?: number;
  },
  canViewSensitive: boolean
) {
  const snap = await queryCollectionForUser('onp_members', user);
  const all: OnpRecord[] = snap.docs.map((docSnap) => {
    const d = docSnap.data();
    const rawPhone = String(d.phone || '');
    return {
      id: docSnap.id,
      full_name: String(d.full_name || ''),
      phone: canViewSensitive ? rawPhone : maskPhone(rawPhone),
      phone_raw: canViewSensitive ? rawPhone : undefined,
      organization: String(d.organization || ''),
      registered_at: String(d.registered_at || ''),
      notes: String(d.notes || ''),
      custom_fields: (d.custom_fields as Record<string, string | number>) || {},
      created_at: formatTs(d.createdAt),
    };
  });

  const orgMap = new Map<string, number>();
  for (const r of all) {
    orgMap.set(r.organization, (orgMap.get(r.organization) || 0) + 1);
  }
  const organizations = Array.from(orgMap.entries())
    .map(([organization, total]) => ({ organization, total }))
    .sort((a, b) => a.organization.localeCompare(b.organization));

  const q = (params.search || '').trim().toLowerCase();
  const filtered = all.filter((r) => {
    if (params.organization && r.organization !== params.organization) return false;
    if (q) {
      const hay = `${r.full_name} ${r.phone_raw || r.phone} ${r.organization}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sortBy = params.sort_by || 'full_name';
  filtered.sort((a, b) => {
    if (sortBy === 'organization') {
      return a.organization.localeCompare(b.organization) || a.full_name.localeCompare(b.full_name);
    }
    if (sortBy === 'id') {
      return (a.created_at || a.id).localeCompare(b.created_at || b.id);
    }
    return a.full_name.localeCompare(b.full_name);
  });

  const pageSize = Math.max(1, params.limit || 15);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, params.page || 1), totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    items: filtered.slice(start, start + pageSize),
    total,
    page: currentPage,
    limit: pageSize,
    totalPages,
    organizations,
    canViewSensitive,
  };
}

export async function saveOnp(
  user: User,
  payload: {
    full_name: string;
    phone: string;
    organization: string;
    registered_at: string;
    notes: string;
    custom_fields?: Record<string, unknown>;
  },
  editingId?: string
): Promise<void> {
  const full_name = clampStr(payload.full_name, 140);
  const phone = clampStr(payload.phone, 30);
  const organization = clampStr(payload.organization, 160);
  const registered_at = DATE_RE.test(payload.registered_at)
    ? payload.registered_at
    : new Date().toISOString().slice(0, 10);
  const notes = clampStr(payload.notes, 1000);
  const custom_fields = sanitizeCustomFieldsMap(payload.custom_fields);

  if (full_name.length < 2) throw new Error('Ingrese nombres y apellidos válidos.');
  if (phone.length < 6) throw new Error('Ingrese un número de teléfono válido.');
  if (organization.length < 2) throw new Error('Ingrese el nombre de la organización o institución.');

  try {
    if (editingId) {
      await updateDoc(doc(db, 'onp_members', editingId), {
        full_name,
        phone,
        organization,
        registered_at,
        notes,
        custom_fields,
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'ACTUALIZAR_ONP', 'onp', editingId, `${full_name} (${organization})`);
    } else {
      const id = safeId('onp');
      await setDoc(doc(db, 'onp_members', id), {
        full_name,
        phone,
        organization,
        registered_at,
        notes,
        custom_fields,
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'CREAR_ONP', 'onp', id, `${full_name} (${organization})`);
    }
  } catch (err) {
    handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'onp_members');
  }
}

export async function deleteOnp(user: User, id: string, label: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'onp_members', id));
    await logAudit(user, 'ELIMINAR_ONP', 'onp', id, `Registro ONP eliminado: ${label}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `onp_members/${id}`);
  }
}

// --- Vote Projections ---

async function fetchEnrichedProjections(
  user: User,
  maps: TerritorialMaps,
  canViewSensitive: boolean
): Promise<VoteProjection[]> {
  const [projSnap, coordSnap] = await Promise.all([
    queryCollectionForUser('vote_projections', user),
    queryCollectionForUser('coordinators', user),
  ]);

  const coordMap = new Map<string, { first_name: string; last_name: string; ci: string }>();
  for (const docSnap of coordSnap.docs) {
    const c = docSnap.data();
    coordMap.set(docSnap.id, {
      first_name: String(c.first_name || ''),
      last_name: String(c.last_name || ''),
      ci: String(c.ci || ''),
    });
  }

  return projSnap.docs.map((docSnap) => {
    const d = docSnap.data();
    const coordId = String(d.coordinator_id || '');
    const coord = coordMap.get(coordId);
    const deptId = String(d.department_id || '');
    const distId = String(d.district_id || '');
    const rawCi = coord?.ci || '';
    return {
      id: docSnap.id,
      coordinator_id: coordId,
      first_name: coord?.first_name || 'Coordinador',
      last_name: coord?.last_name || '',
      ci: canViewSensitive ? rawCi : maskCi(rawCi),
      department_id: deptId,
      district_id: distId,
      department_name: maps.deptMap[deptId] || '—',
      district_name: maps.distMap[distId] || '—',
      seccional_number: Number(d.seccional_number || 0),
      estimated_votes: Number(d.estimated_votes || 0),
      responsible_name: String(d.responsible_name || ''),
      notes: String(d.notes || ''),
      updated_at: formatTs(d.updatedAt) || new Date().toISOString().slice(0, 10),
    };
  });
}

export async function listProjections(
  user: User,
  params: { department_id?: string; district_id?: string; seccional_number?: string; search?: string },
  maps: TerritorialMaps,
  canViewSensitive: boolean
) {
  const all = await fetchEnrichedProjections(user, maps, canViewSensitive);
  const q = (params.search || '').trim().toLowerCase();
  const items = all
    .filter((r) => {
      if (params.department_id && r.department_id !== params.department_id) return false;
      if (params.district_id && r.district_id !== params.district_id) return false;
      if (params.seccional_number && String(r.seccional_number) !== params.seccional_number.trim()) return false;
      if (q) {
        const hay = `${r.first_name} ${r.last_name} ${r.ci} ${r.responsible_name} ${r.seccional_number}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.estimated_votes - a.estimated_votes);

  const deptAgg = new Map<string, { id: string; name: string; total_votes: number; records_count: number }>();
  const distAgg = new Map<string, { id: string; name: string; department_name: string; total_votes: number; records_count: number }>();
  const seccAgg = new Map<string, { seccional_number: number; department_name: string; district_name: string; total_votes: number; records_count: number }>();

  let grandTotal = 0;
  for (const r of items) {
    grandTotal += r.estimated_votes;

    const dCur = deptAgg.get(r.department_id) || { id: r.department_id, name: r.department_name, total_votes: 0, records_count: 0 };
    dCur.total_votes += r.estimated_votes;
    dCur.records_count += 1;
    deptAgg.set(r.department_id, dCur);

    const distCur = distAgg.get(r.district_id) || { id: r.district_id, name: r.district_name, department_name: r.department_name, total_votes: 0, records_count: 0 };
    distCur.total_votes += r.estimated_votes;
    distCur.records_count += 1;
    distAgg.set(r.district_id, distCur);

    const seccKey = `${r.district_id}::${r.seccional_number}`;
    const sCur = seccAgg.get(seccKey) || {
      seccional_number: r.seccional_number,
      department_name: r.department_name,
      district_name: r.district_name,
      total_votes: 0,
      records_count: 0,
    };
    sCur.total_votes += r.estimated_votes;
    sCur.records_count += 1;
    seccAgg.set(seccKey, sCur);
  }

  return {
    items,
    byDepartment: Array.from(deptAgg.values()).sort((a, b) => b.total_votes - a.total_votes),
    byDistrict: Array.from(distAgg.values()).sort((a, b) => b.total_votes - a.total_votes),
    bySeccional: Array.from(seccAgg.values()).sort((a, b) => b.total_votes - a.total_votes),
    grandTotal,
  };
}

export async function saveProjection(
  user: User,
  payload: {
    coordinator_id: string;
    department_id: string;
    district_id: string;
    seccional_number: number;
    estimated_votes: number;
    responsible_name: string;
    notes: string;
  },
  editingId?: string
): Promise<void> {
  const estimated_votes = Math.max(0, Math.min(10000000, Math.trunc(Number(payload.estimated_votes))));
  const responsible_name = clampStr(payload.responsible_name, 120);
  const notes = clampStr(payload.notes, 1000);
  if (isNaN(estimated_votes) || responsible_name.length < 2) {
    throw new Error('Complete la cantidad de votos estimados y el nombre del responsable.');
  }

  try {
    if (editingId) {
      await updateDoc(doc(db, 'vote_projections', editingId), {
        estimated_votes,
        responsible_name,
        notes,
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'ACTUALIZAR_PROYECCION', 'projections', editingId, `Proyección actualizada a ${estimated_votes} votos.`);
    } else {
      const existingSnap = await queryCollectionForUser('vote_projections', user);
      const dup = existingSnap.docs.find((d) => {
        const data = d.data();
        return (
          data.coordinator_id === payload.coordinator_id &&
          String(data.responsible_name || '').trim().toLowerCase() === responsible_name.toLowerCase()
        );
      });
      if (dup) {
        throw new Error('Ya existe una proyección registrada para este coordinador y responsable. Edite el registro existente.');
      }

      const id = safeId('vp');
      await setDoc(doc(db, 'vote_projections', id), {
        coordinator_id: clampStr(payload.coordinator_id, 128),
        department_id: clampStr(payload.department_id, 128),
        district_id: clampStr(payload.district_id, 128),
        seccional_number: Math.trunc(Number(payload.seccional_number)),
        estimated_votes,
        responsible_name,
        notes,
        custom_fields: {},
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'CREAR_PROYECCION', 'projections', id, `Proyección registrada: ${estimated_votes} votos.`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Ya existe una proyección')) throw err;
    handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'vote_projections');
  }
}

export async function deleteProjection(user: User, id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'vote_projections', id));
    await logAudit(user, 'ELIMINAR_PROYECCION', 'projections', id, 'Proyección de votos eliminada.');
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `vote_projections/${id}`);
  }
}

// --- Agenda Events ---

export async function listAgendaEvents(
  user: User,
  params: { search?: string; event_type?: string },
  maps: TerritorialMaps
): Promise<AgendaEvent[]> {
  const snap = await queryCollectionForUser('agenda_events', user);
  const q = (params.search || '').trim().toLowerCase();

  return snap.docs
    .map((docSnap) => {
      const d = docSnap.data();
      const deptId = d.department_id ? String(d.department_id) : null;
      const distId = d.district_id ? String(d.district_id) : null;
      return {
        id: docSnap.id,
        title: String(d.title || ''),
        event_type: String(d.event_type || ''),
        event_date: String(d.event_date || ''),
        start_time: String(d.start_time || '09:00'),
        end_time: String(d.end_time || '10:00'),
        department_id: deptId,
        district_id: distId,
        department_name: deptId ? maps.deptMap[deptId] || '—' : undefined,
        district_name: distId ? maps.distMap[distId] || '—' : undefined,
        seccional_number: d.seccional_number != null ? Number(d.seccional_number) : null,
        location: String(d.location || ''),
        responsible: String(d.responsible || ''),
        participants: String(d.participants || ''),
        description: String(d.description || ''),
        notes: String(d.notes || ''),
        reminder_minutes: Number(d.reminder_minutes ?? 60),
        status: (d.status as AgendaEvent['status']) || 'programado',
        activity_summary: String(d.activity_summary || ''),
        attendance_count: Number(d.attendance_count ?? 0),
        activity_outcomes: String(d.activity_outcomes || ''),
      };
    })
    .filter((ev) => {
      if (params.event_type && ev.event_type !== params.event_type) return false;
      if (q) {
        const hay = `${ev.title} ${ev.location} ${ev.responsible} ${ev.event_type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time));
}

export async function saveAgendaEvent(
  user: User,
  payload: {
    title: string;
    event_type: string;
    event_date: string;
    start_time: string;
    end_time: string;
    department_id: string | null;
    district_id: string | null;
    seccional_number: number | null;
    location: string;
    responsible: string;
    participants: string;
    description: string;
    notes: string;
    reminder_minutes: number;
    status: 'programado' | 'realizado' | 'cancelado';
  },
  editingId?: string
): Promise<void> {
  const title = clampStr(payload.title, 180);
  const event_type = clampStr(payload.event_type, 80);
  const event_date = DATE_RE.test(payload.event_date) ? payload.event_date : new Date().toISOString().slice(0, 10);
  const start_time = TIME_RE.test(payload.start_time) ? payload.start_time : '09:00';
  const end_time = TIME_RE.test(payload.end_time) ? payload.end_time : '10:00';
  if (title.length < 2 || event_type.length < 2) {
    throw new Error('Ingrese un título y tipo de actividad válidos.');
  }

  const cleanDoc = {
    title,
    event_type,
    event_date,
    start_time,
    end_time,
    department_id: payload.department_id && ID_RE.test(payload.department_id) ? payload.department_id : null,
    district_id: payload.district_id && ID_RE.test(payload.district_id) ? payload.district_id : null,
    seccional_number:
      payload.seccional_number && Number(payload.seccional_number) >= 1
        ? Math.trunc(Number(payload.seccional_number))
        : null,
    location: clampStr(payload.location, 200),
    responsible: clampStr(payload.responsible, 120),
    participants: clampStr(payload.participants, 400),
    description: clampStr(payload.description, 1200),
    notes: clampStr(payload.notes, 1000),
    reminder_minutes: Math.max(0, Math.min(10080, Math.trunc(Number(payload.reminder_minutes ?? 60)))),
    status: ['programado', 'realizado', 'cancelado'].includes(payload.status) ? payload.status : 'programado',
  };

  try {
    if (editingId) {
      await updateDoc(doc(db, 'agenda_events', editingId), {
        ...cleanDoc,
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'ACTUALIZAR_AGENDA', 'agenda', editingId, `Actividad actualizada: ${title}`);
    } else {
      const id = safeId('ev');
      await setDoc(doc(db, 'agenda_events', id), {
        ...cleanDoc,
        activity_summary: '',
        attendance_count: 0,
        activity_outcomes: '',
        custom_fields: {},
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAudit(user, 'CREAR_AGENDA', 'agenda', id, `Actividad creada: ${title}`);
    }
  } catch (err) {
    handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'agenda_events');
  }
}

export async function saveAgendaFollowUp(
  user: User,
  eventId: string,
  followUp: {
    summary: string;
    attendance_count: number;
    outcomes: string;
    status: 'programado' | 'realizado' | 'cancelado';
  }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'agenda_events', eventId), {
      activity_summary: clampStr(followUp.summary, 1200),
      attendance_count: Math.max(0, Math.min(1000000, Math.trunc(Number(followUp.attendance_count || 0)))),
      activity_outcomes: clampStr(followUp.outcomes, 1200),
      status: ['programado', 'realizado', 'cancelado'].includes(followUp.status) ? followUp.status : 'realizado',
      updatedAt: serverTimestamp(),
    });
    await logAudit(user, 'ACTA_AGENDA', 'agenda', eventId, `Seguimiento guardado (${followUp.status}).`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `agenda_events/${eventId}`);
  }
}

export async function deleteAgendaEvent(user: User, eventId: string, title: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'agenda_events', eventId));
    await logAudit(user, 'ELIMINAR_AGENDA', 'agenda', eventId, `Actividad eliminada: ${title}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `agenda_events/${eventId}`);
  }
}

// --- Dashboard Aggregations ---

export async function getDashboardData(
  user: User,
  maps: TerritorialMaps,
  territorial: { departments: Department[]; districts: District[]; seccionales: Seccional[] },
  canViewSensitive: boolean
) {
  const [coords, youth, women, onpSnap, projections, agenda] = await Promise.all([
    fetchAllPeopleRecords(user, 'coordinators', maps, canViewSensitive),
    fetchAllPeopleRecords(user, 'youth', maps, canViewSensitive),
    fetchAllPeopleRecords(user, 'women', maps, canViewSensitive),
    queryCollectionForUser('onp_members', user),
    fetchEnrichedProjections(user, maps, canViewSensitive),
    listAgendaEvents(user, {}, maps),
  ]);

  const totalEstimatedVotes = projections.reduce((acc, p) => acc + p.estimated_votes, 0);
  const scheduledMeetings = agenda.filter((e) => e.status === 'programado').length;

  const deptChartMap = new Map<string, { name: string; coordinadores: number; jovenes: number; mujeres: number; votos_estimados: number }>();
  for (const d of territorial.departments) {
    deptChartMap.set(d.id, { name: d.name, coordinadores: 0, jovenes: 0, mujeres: 0, votos_estimados: 0 });
  }
  for (const c of coords) {
    const entry = deptChartMap.get(c.department_id);
    if (entry) entry.coordinadores += 1;
  }
  for (const y of youth) {
    const entry = deptChartMap.get(y.department_id);
    if (entry) entry.jovenes += 1;
  }
  for (const w of women) {
    const entry = deptChartMap.get(w.department_id);
    if (entry) entry.mujeres += 1;
  }
  for (const p of projections) {
    const entry = deptChartMap.get(p.department_id);
    if (entry) entry.votos_estimados += p.estimated_votes;
  }

  const distChartMap = new Map<string, { name: string; department_name: string; total_estructura: number; votos_estimados: number }>();
  for (const dist of territorial.districts) {
    distChartMap.set(dist.id, {
      name: dist.name,
      department_name: maps.deptMap[dist.department_id] || '—',
      total_estructura: 0,
      votos_estimados: 0,
    });
  }
  for (const rec of [...coords, ...youth, ...women]) {
    const entry = distChartMap.get(rec.district_id);
    if (entry) entry.total_estructura += 1;
  }
  for (const p of projections) {
    const entry = distChartMap.get(p.district_id);
    if (entry) entry.votos_estimados += p.estimated_votes;
  }

  const seccMap = new Map<string, { seccional_number: number; district_name: string; votos_estimados: number; coordinadores: number }>();
  for (const p of projections) {
    const key = `${p.district_id}::${p.seccional_number}`;
    const entry = seccMap.get(key) || {
      seccional_number: p.seccional_number,
      district_name: p.district_name,
      votos_estimados: 0,
      coordinadores: 0,
    };
    entry.votos_estimados += p.estimated_votes;
    seccMap.set(key, entry);
  }
  for (const c of coords) {
    const key = `${c.district_id}::${c.seccional_number}`;
    const entry = seccMap.get(key);
    if (entry) entry.coordinadores += 1;
  }

  const recentRecords = [
    ...coords.map((r) => ({ tipo: 'Coordinador', ...r })),
    ...youth.map((r) => ({ tipo: 'Joven', ...r })),
    ...women.map((r) => ({ tipo: 'Mujer', ...r })),
  ]
    .sort((a, b) => (b.registered_at || '').localeCompare(a.registered_at || ''))
    .slice(0, 8)
    .map((r) => ({
      tipo: r.tipo,
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      ci: r.ci,
      seccional_number: r.seccional_number,
      department_name: r.department_name || '—',
      district_name: r.district_name || '—',
      registered_at: r.registered_at,
    }));

  return {
    kpis: {
      totalCoordinators: coords.length,
      totalYouth: youth.length,
      totalWomen: women.length,
      totalOnp: onpSnap.size,
      totalDepartments: territorial.departments.filter((d) => d.active).length,
      totalDistricts: territorial.districts.filter((d) => d.active).length,
      totalSeccionales: territorial.seccionales.filter((s) => s.active).length,
      totalEstimatedVotes,
      scheduledMeetings,
    },
    upcomingEvents: agenda
      .filter((e) => e.status === 'programado')
      .slice(0, 6)
      .map((e) => ({
        id: e.id,
        title: e.title,
        event_type: e.event_type,
        event_date: e.event_date,
        start_time: e.start_time,
        department_name: e.department_name,
        district_name: e.district_name,
        location: e.location,
      })),
    recentRecords,
    charts: {
      byDepartment: Array.from(deptChartMap.values()),
      byDistrict: Array.from(distChartMap.values())
        .filter((d) => d.total_estructura > 0 || d.votos_estimados > 0)
        .sort((a, b) => b.votos_estimados - a.votos_estimados)
        .slice(0, 12),
      bySeccional: Array.from(seccMap.values())
        .sort((a, b) => b.votos_estimados - a.votos_estimados)
        .slice(0, 12),
    },
  };
}

// --- Statistics ---

function computeModuleStats(records: PersonRecord[]) {
  const total = records.length;
  const deptSet = new Set(records.map((r) => r.department_id));
  const distSet = new Set(records.map((r) => r.district_id));
  const seccSet = new Set(records.map((r) => `${r.district_id}::${r.seccional_number}`));

  const byDeptMap = new Map<string, { name: string; count: number; dists: Set<string>; seccs: Set<string> }>();
  const byDistMap = new Map<string, { name: string; department_name: string; count: number; seccs: Set<string> }>();
  const bySeccMap = new Map<string, { seccional: number; district_name: string; department_name: string; count: number }>();

  for (const r of records) {
    const dEntry = byDeptMap.get(r.department_id) || {
      name: r.department_name || '—',
      count: 0,
      dists: new Set<string>(),
      seccs: new Set<string>(),
    };
    dEntry.count += 1;
    dEntry.dists.add(r.district_id);
    dEntry.seccs.add(`${r.district_id}::${r.seccional_number}`);
    byDeptMap.set(r.department_id, dEntry);

    const distEntry = byDistMap.get(r.district_id) || {
      name: r.district_name || '—',
      department_name: r.department_name || '—',
      count: 0,
      seccs: new Set<string>(),
    };
    distEntry.count += 1;
    distEntry.seccs.add(`${r.district_id}::${r.seccional_number}`);
    byDistMap.set(r.district_id, distEntry);

    const sKey = `${r.district_id}::${r.seccional_number}`;
    const sEntry = bySeccMap.get(sKey) || {
      seccional: r.seccional_number,
      district_name: r.district_name || '—',
      department_name: r.department_name || '—',
      count: 0,
    };
    sEntry.count += 1;
    bySeccMap.set(sKey, sEntry);
  }

  return {
    total,
    coveredDepartments: deptSet.size,
    coveredDistricts: distSet.size,
    coveredSeccionales: seccSet.size,
    byDept: Array.from(byDeptMap.values())
      .map((d) => ({
        name: d.name,
        count: d.count,
        pct: total > 0 ? Math.round((d.count / total) * 1000) / 10 : 0,
        districts_covered: d.dists.size,
        seccionales_covered: d.seccs.size,
      }))
      .sort((a, b) => b.count - a.count),
    byDist: Array.from(byDistMap.values())
      .map((d) => ({
        name: d.name,
        department_name: d.department_name,
        count: d.count,
        pct: total > 0 ? Math.round((d.count / total) * 1000) / 10 : 0,
        seccionales_covered: d.seccs.size,
      }))
      .sort((a, b) => b.count - a.count),
    bySecc: Array.from(bySeccMap.values())
      .map((s) => ({
        ...s,
        pct: total > 0 ? Math.round((s.count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function getStatisticsData(
  user: User,
  params: { department_id?: string; district_id?: string },
  maps: TerritorialMaps,
  territorial: { departments: Department[]; districts: District[]; seccionales: Seccional[] }
) {
  const [allCoords, allYouth, allWomen, allProj] = await Promise.all([
    fetchAllPeopleRecords(user, 'coordinators', maps, false),
    fetchAllPeopleRecords(user, 'youth', maps, false),
    fetchAllPeopleRecords(user, 'women', maps, false),
    fetchEnrichedProjections(user, maps, false),
  ]);

  const filterLoc = <T extends { department_id: string; district_id: string }>(arr: T[]) =>
    arr.filter((r) => {
      if (params.department_id && r.department_id !== params.department_id) return false;
      if (params.district_id && r.district_id !== params.district_id) return false;
      return true;
    });

  const coords = filterLoc(allCoords);
  const youth = filterLoc(allYouth);
  const women = filterLoc(allWomen);
  const projections = filterLoc(allProj);

  const globalDepts = new Set([
    ...coords.map((r) => r.department_id),
    ...youth.map((r) => r.department_id),
    ...women.map((r) => r.department_id),
    ...projections.map((r) => r.department_id),
  ]);
  const globalDists = new Set([
    ...coords.map((r) => r.district_id),
    ...youth.map((r) => r.district_id),
    ...women.map((r) => r.district_id),
    ...projections.map((r) => r.district_id),
  ]);
  const globalSeccs = new Set([
    ...coords.map((r) => `${r.district_id}::${r.seccional_number}`),
    ...youth.map((r) => `${r.district_id}::${r.seccional_number}`),
    ...women.map((r) => `${r.district_id}::${r.seccional_number}`),
    ...projections.map((r) => `${r.district_id}::${r.seccional_number}`),
  ]);

  const totalVotes = projections.reduce((acc, p) => acc + p.estimated_votes, 0);
  const vDeptMap = new Map<string, { name: string; votes: number; records: number; coords: Set<string>; dists: Set<string>; seccs: Set<string> }>();
  const vDistMap = new Map<string, { name: string; department_name: string; votes: number; records: number; coords: Set<string>; seccs: Set<string> }>();
  const vSeccMap = new Map<string, { seccional: number; department_name: string; district_name: string; votes: number; coords: Set<string> }>();

  for (const p of projections) {
    const dEntry = vDeptMap.get(p.department_id) || {
      name: p.department_name,
      votes: 0,
      records: 0,
      coords: new Set<string>(),
      dists: new Set<string>(),
      seccs: new Set<string>(),
    };
    dEntry.votes += p.estimated_votes;
    dEntry.records += 1;
    dEntry.coords.add(p.coordinator_id);
    dEntry.dists.add(p.district_id);
    dEntry.seccs.add(`${p.district_id}::${p.seccional_number}`);
    vDeptMap.set(p.department_id, dEntry);

    const distEntry = vDistMap.get(p.district_id) || {
      name: p.district_name,
      department_name: p.department_name,
      votes: 0,
      records: 0,
      coords: new Set<string>(),
      seccs: new Set<string>(),
    };
    distEntry.votes += p.estimated_votes;
    distEntry.records += 1;
    distEntry.coords.add(p.coordinator_id);
    distEntry.seccs.add(`${p.district_id}::${p.seccional_number}`);
    vDistMap.set(p.district_id, distEntry);

    const sKey = `${p.district_id}::${p.seccional_number}`;
    const sEntry = vSeccMap.get(sKey) || {
      seccional: p.seccional_number,
      department_name: p.department_name,
      district_name: p.district_name,
      votes: 0,
      coords: new Set<string>(),
    };
    sEntry.votes += p.estimated_votes;
    sEntry.coords.add(p.coordinator_id);
    vSeccMap.set(sKey, sEntry);
  }

  return {
    territorialTotals: {
      totalActiveDepts: territorial.departments.filter((d) => d.active).length,
      totalActiveDistricts: territorial.districts.filter((d) => d.active).length,
      totalActiveSeccionales: territorial.seccionales.filter((s) => s.active).length,
      coveredDepartments: globalDepts.size,
      coveredDistricts: globalDists.size,
      coveredSeccionales: globalSeccs.size,
    },
    coordinators: computeModuleStats(coords),
    youth: computeModuleStats(youth),
    women: computeModuleStats(women),
    votes: {
      total: totalVotes,
      coveredDepartments: vDeptMap.size,
      coveredDistricts: vDistMap.size,
      coveredSeccionales: vSeccMap.size,
      coordinatorsCovered: new Set(projections.map((p) => p.coordinator_id)).size,
      byDept: Array.from(vDeptMap.values())
        .map((d) => ({
          name: d.name,
          votes: d.votes,
          records: d.records,
          coordinators_count: d.coords.size,
          districts_covered: d.dists.size,
          seccionales_covered: d.seccs.size,
          pct: totalVotes > 0 ? Math.round((d.votes / totalVotes) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.votes - a.votes),
      byDist: Array.from(vDistMap.values())
        .map((d) => ({
          name: d.name,
          department_name: d.department_name,
          votes: d.votes,
          records: d.records,
          coordinators_count: d.coords.size,
          seccionales_covered: d.seccs.size,
        }))
        .sort((a, b) => b.votes - a.votes),
      bySecc: Array.from(vSeccMap.values())
        .map((s) => ({
          seccional: s.seccional,
          department_name: s.department_name,
          district_name: s.district_name,
          votes: s.votes,
          coordinators_count: s.coords.size,
        }))
        .sort((a, b) => b.votes - a.votes),
    },
  };
}

// --- Reports ---

export async function generateReportPreview(
  user: User,
  params: {
    reportType: SavedReport['report_type'];
    department_id?: string | null;
    district_id?: string | null;
    seccional_number?: string | null;
    organization?: string | null;
    sort_by?: 'full_name' | 'organization' | 'id';
    date_from?: string | null;
    date_to?: string | null;
  },
  maps: TerritorialMaps,
  canViewSensitive: boolean
) {
  const { reportType } = params;

  if (reportType === 'coordinators' || reportType === 'youth' || reportType === 'women') {
    const all = await fetchAllPeopleRecords(user, reportType, maps, canViewSensitive);
    const rows = all
      .filter((r) => {
        if (params.department_id && r.department_id !== params.department_id) return false;
        if (params.district_id && r.district_id !== params.district_id) return false;
        if (params.seccional_number && String(r.seccional_number) !== params.seccional_number.trim()) return false;
        if (params.date_from && r.registered_at < params.date_from) return false;
        if (params.date_to && r.registered_at > params.date_to) return false;
        return true;
      })
      .sort((a, b) => a.last_name.localeCompare(b.last_name));

    const subMap = new Map<string, number>();
    rows.forEach((r) => subMap.set(r.department_name || '—', (subMap.get(r.department_name || '—') || 0) + 1));

    return {
      rows: rows as unknown as Record<string, unknown>[],
      subtotals: Array.from(subMap.entries()).map(([label, count]) => ({ label, count })),
      totalCount: rows.length,
      totalVotes: null,
    };
  }

  if (reportType === 'onp') {
    const res = await listOnp(
      user,
      {
        sort_by: params.sort_by || 'full_name',
        page: 1,
        limit: 5000,
      },
      canViewSensitive
    );
    const orgQ = (params.organization || '').trim().toLowerCase();
    const rows = res.items.filter((r) => {
      if (orgQ && !r.organization.toLowerCase().includes(orgQ)) return false;
      if (params.date_from && r.registered_at < params.date_from) return false;
      if (params.date_to && r.registered_at > params.date_to) return false;
      return true;
    });
    const subMap = new Map<string, number>();
    rows.forEach((r) => subMap.set(r.organization, (subMap.get(r.organization) || 0) + 1));
    return {
      rows: rows as unknown as Record<string, unknown>[],
      subtotals: Array.from(subMap.entries()).map(([label, count]) => ({ label, count })),
      totalCount: rows.length,
      totalVotes: null,
    };
  }

  // Projection reports
  const projRes = await listProjections(
    user,
    {
      department_id: params.department_id || undefined,
      district_id: params.district_id || undefined,
      seccional_number: params.seccional_number || undefined,
    },
    maps,
    canViewSensitive
  );

  if (reportType === 'projections_general') {
    return {
      rows: projRes.items as unknown as Record<string, unknown>[],
      subtotals: projRes.byDepartment.map((d) => ({ label: d.name, count: d.total_votes })),
      totalCount: projRes.items.length,
      totalVotes: projRes.grandTotal,
    };
  }

  if (reportType === 'projections_dept') {
    const rows = projRes.byDepartment.map((d) => ({
      department_name: d.name,
      total_coordinadores: d.records_count,
      estimated_votes: d.total_votes,
    }));
    return {
      rows,
      subtotals: rows.map((r) => ({ label: r.department_name, count: r.estimated_votes })),
      totalCount: rows.length,
      totalVotes: projRes.grandTotal,
    };
  }

  if (reportType === 'projections_district') {
    const rows = projRes.byDistrict.map((d) => ({
      department_name: d.department_name,
      district_name: d.name,
      total_coordinadores: d.records_count,
      estimated_votes: d.total_votes,
    }));
    return {
      rows,
      subtotals: rows.slice(0, 12).map((r) => ({ label: r.district_name, count: r.estimated_votes })),
      totalCount: rows.length,
      totalVotes: projRes.grandTotal,
    };
  }

  const rows = projRes.bySeccional.map((s) => ({
    department_name: s.department_name,
    district_name: s.district_name,
    seccional_number: s.seccional_number,
    total_coordinadores: s.records_count,
    estimated_votes: s.total_votes,
  }));
  return {
    rows,
    subtotals: rows.slice(0, 12).map((r) => ({ label: `Secc. ${r.seccional_number}`, count: r.estimated_votes })),
    totalCount: rows.length,
    totalVotes: projRes.grandTotal,
  };
}

export async function listSavedReports(user: User): Promise<SavedReport[]> {
  const snap = await queryCollectionForUser('saved_reports', user);
  return snap.docs.map((docSnap) => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      title: String(d.title || ''),
      report_type: d.report_type as SavedReport['report_type'],
      filters: (d.filters as Record<string, string>) || {},
      columns: Array.isArray(d.columns) ? d.columns.map(String) : [],
      generated_by: String(d.generated_by || ''),
    };
  });
}

export async function createSavedReport(
  user: User,
  payload: {
    title: string;
    report_type: SavedReport['report_type'];
    filters: Record<string, string>;
    columns: string[];
  }
): Promise<void> {
  const title = clampStr(payload.title, 120);
  if (!title || payload.columns.length === 0) return;
  try {
    const id = safeId('rep');
    await setDoc(doc(db, 'saved_reports', id), {
      title,
      report_type: clampStr(payload.report_type, 40),
      filters: payload.filters || {},
      columns: payload.columns.slice(0, 25).map((c) => clampStr(c, 60)),
      generated_by: clampStr(user.username || user.full_name, 80, 'usuario'),
      ownerUid: user.uid,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'saved_reports');
  }
}

export async function deleteSavedReport(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'saved_reports', id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `saved_reports/${id}`);
  }
}

// --- Admin Users, Invites, Audit Logs, Backup & Restore ---

export async function listAdminUsers(user: User): Promise<User[]> {
  const snap = isBootstrappedAdminEmail(user.email)
    ? await (async () => {
        try {
          return await getDocs(collection(db, 'users'));
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'users');
        }
      })()
    : await (async () => {
        try {
          return await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'users');
        }
      })();

  return snap.docs.map((docSnap) => {
    const d = docSnap.data();
    const roleSlug = (d.role_slug as RoleSlug) || 'viewer';
    const customPerms = (d.custom_permissions as Record<string, boolean>) || {};
    return {
      id: docSnap.id,
      uid: String(d.uid || docSnap.id),
      username: String(d.username || ''),
      full_name: String(d.full_name || ''),
      email: String(d.email || ''),
      role_slug: roleSlug,
      role_name: String(d.role_name || getRoleName(roleSlug)),
      active: Boolean(d.active),
      custom_permissions: customPerms,
      permissions: computeEffectivePermissions(roleSlug, customPerms),
      last_login_at: d.last_login_at ? String(d.last_login_at) : null,
    };
  });
}

export async function updateAdminUser(
  adminUser: User,
  targetUid: string,
  patch: {
    username: string;
    full_name: string;
    email: string;
    role_slug: RoleSlug;
    active: boolean;
    custom_permissions: Record<string, boolean>;
  }
): Promise<void> {
  const username = clampStr(patch.username, 60);
  const full_name = clampStr(patch.full_name, 120);
  const email = clampStr(patch.email, 160);
  if (username.length < 2 || full_name.length < 2 || email.length < 3) {
    throw new Error('Complete usuario, nombre completo y correo válidos.');
  }
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      username,
      full_name,
      email,
      role_slug: patch.role_slug,
      role_name: getRoleName(patch.role_slug),
      active: Boolean(patch.active),
      custom_permissions: patch.custom_permissions || {},
      updatedAt: serverTimestamp(),
    });
    await logAudit(adminUser, 'ACTUALIZAR_USUARIO', 'admin', targetUid, `Usuario ${username} actualizado (${patch.role_slug}).`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
  }
}

export async function deleteAdminUser(adminUser: User, targetUid: string, username: string): Promise<void> {
  if (targetUid === adminUser.uid) {
    throw new Error('No puede eliminar su propio usuario administrador.');
  }
  try {
    await deleteDoc(doc(db, 'users', targetUid));
    await logAudit(adminUser, 'ELIMINAR_USUARIO', 'admin', targetUid, `Usuario eliminado: ${username}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${targetUid}`);
  }
}

export async function listUserInvites(user: User): Promise<UserInvite[]> {
  try {
    const snap = isBootstrappedAdminEmail(user.email)
      ? await getDocs(collection(db, 'user_invites'))
      : await getDocs(query(collection(db, 'user_invites'), where('email', '==', user.email)));
    return snap.docs.map((docSnap) => {
      const d = docSnap.data();
      const roleSlug = (d.role_slug as RoleSlug) || 'viewer';
      return {
        id: docSnap.id,
        username: String(d.username || ''),
        full_name: String(d.full_name || ''),
        email: String(d.email || ''),
        role_slug: roleSlug,
        role_name: String(d.role_name || getRoleName(roleSlug)),
        active: Boolean(d.active),
        custom_permissions: (d.custom_permissions as Record<string, boolean>) || {},
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'user_invites');
  }
}

export async function createUserInvite(
  adminUser: User,
  payload: {
    username: string;
    full_name: string;
    email: string;
    role_slug: RoleSlug;
    active: boolean;
    custom_permissions: Record<string, boolean>;
  }
): Promise<void> {
  const username = clampStr(payload.username, 60);
  const full_name = clampStr(payload.full_name, 120);
  const email = clampStr(payload.email.toLowerCase(), 160);
  if (username.length < 2 || full_name.length < 2 || !email.includes('@')) {
    throw new Error('Complete usuario, nombre completo y un correo Google válido.');
  }
  try {
    const id = safeId('inv');
    await setDoc(doc(db, 'user_invites', id), {
      username,
      full_name,
      email,
      role_slug: payload.role_slug,
      role_name: getRoleName(payload.role_slug),
      active: Boolean(payload.active),
      custom_permissions: payload.custom_permissions || {},
      ownerUid: adminUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logAudit(adminUser, 'INVITAR_USUARIO', 'admin', id, `Invitación creada para ${email} (${payload.role_slug}).`);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'user_invites');
  }
}

export async function deleteUserInvite(adminUser: User, inviteId: string, email: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'user_invites', inviteId));
    await logAudit(adminUser, 'ELIMINAR_INVITACION', 'admin', inviteId, `Invitación eliminada: ${email}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `user_invites/${inviteId}`);
  }
}

export async function listAuditLogs(user: User, search = ''): Promise<AuditLogEntry[]> {
  const snap = await queryCollectionForUser('audit_logs', user);
  const q = search.trim().toLowerCase();
  return snap.docs
    .map((docSnap) => {
      const d = docSnap.data();
      return {
        id: docSnap.id,
        user_uid: String(d.user_uid || ''),
        username: String(d.username || ''),
        action: String(d.action || ''),
        module: String(d.module || ''),
        entity_id: String(d.entity_id || ''),
        details: String(d.details || ''),
        created_at: formatTs(d.createdAt),
      };
    })
    .filter((l) => {
      if (!q) return true;
      return `${l.username} ${l.action} ${l.module} ${l.details}`.toLowerCase().includes(q);
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 150);
}

export async function exportFullBackup(user: User): Promise<Record<string, unknown>> {
  const collections = [
    'departments',
    'districts',
    'seccionales',
    'coordinators',
    'youth_members',
    'women_members',
    'onp_members',
    'vote_projections',
    'agenda_events',
    'custom_fields',
    'saved_reports',
  ];

  const backup: Record<string, unknown> = {
    version: 'firestore-v1',
    exportedAt: new Date().toISOString(),
    exportedBy: user.email,
    collections: {},
  };

  const colMap: Record<string, unknown[]> = {};
  for (const colName of collections) {
    const snap = await queryCollectionForUser(colName, user);
    colMap[colName] = snap.docs.map((d) => {
      const data = d.data();
      const cleaned: Record<string, unknown> = { id: d.id };
      for (const [k, v] of Object.entries(data)) {
        if (k === 'createdAt' || k === 'updatedAt' || k === 'ownerUid') continue;
        cleaned[k] = v;
      }
      return cleaned;
    });
  }
  backup.collections = colMap;
  await logAudit(user, 'DESCARGAR_RESPALDO', 'admin', 'backup', 'Descarga de copia de seguridad JSON desde Firestore.');
  return backup;
}

export async function restoreFullBackup(user: User, raw: Record<string, unknown>): Promise<void> {
  const cols = (raw.collections || raw) as Record<string, Record<string, unknown>[]>;
  if (!cols || typeof cols !== 'object') {
    throw new Error('El archivo JSON no contiene colecciones válidas.');
  }

  const restoreWave = async (colName: string) => {
    const list = Array.isArray(cols[colName]) ? cols[colName] : [];
    if (list.length === 0) return;
    const CHUNK = 6;
    for (let i = 0; i < list.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const item of list.slice(i, i + CHUNK)) {
        const docId = clampStr(item.id || safeId(colName.slice(0, 4)), 128).replace(/[^a-zA-Z0-9_\-]/g, '_');
        const payload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(item)) {
          if (k === 'id' || k === 'createdAt' || k === 'updatedAt' || k === 'ownerUid') continue;
          payload[k] = v;
        }
        payload.ownerUid = user.uid;
        payload.createdAt = serverTimestamp();
        if (colName !== 'saved_reports') {
          payload.updatedAt = serverTimestamp();
        }
        batch.set(doc(db, colName, docId), payload);
      }
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, colName);
      }
    }
  };

  // Ordered waves to satisfy Firestore relational exists() checks
  await restoreWave('departments');
  await restoreWave('districts');
  await restoreWave('seccionales');
  await restoreWave('custom_fields');
  await restoreWave('coordinators');
  await restoreWave('youth_members');
  await restoreWave('women_members');
  await restoreWave('onp_members');
  await restoreWave('agenda_events');
  await restoreWave('vote_projections');
  await restoreWave('saved_reports');

  await logAudit(user, 'RESTAURAR_RESPALDO', 'admin', 'restore', 'Restauración completa desde respaldo JSON en Firestore.');
}
