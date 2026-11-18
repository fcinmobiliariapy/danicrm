export const BOOTSTRAPPED_ADMIN_EMAIL = 'luistreviso@gmail.com';

export type RoleSlug = 'super_admin' | 'admin' | 'coordinator' | 'viewer';

export interface RoleDefinition {
  slug: RoleSlug;
  name: string;
  description: string;
}

export interface PermissionDefinition {
  key: string;
  module: string;
  action: string;
  label: string;
}

export const ROLES: RoleDefinition[] = [
  {
    slug: 'super_admin',
    name: 'Administrador principal',
    description: 'Acceso total, configuración general, usuarios, permisos y respaldos.',
  },
  {
    slug: 'admin',
    name: 'Administrador',
    description: 'Gestión operativa completa de módulos autorizados y generación de informes.',
  },
  {
    slug: 'coordinator',
    name: 'Coordinador',
    description: 'Carga y consulta de coordinadores, jóvenes, mujeres, proyecciones y agenda.',
  },
  {
    slug: 'viewer',
    name: 'Usuario de consulta',
    description: 'Solo lectura en módulos autorizados con protección de datos sensibles.',
  },
];

export const ALL_PERMISSIONS: PermissionDefinition[] = [
  { key: 'dashboard:view', module: 'dashboard', action: 'view', label: 'Ver Panel Principal' },
  { key: 'coordinators:view', module: 'coordinators', action: 'view', label: 'Ver Coordinadores' },
  { key: 'coordinators:create', module: 'coordinators', action: 'create', label: 'Registrar Coordinadores' },
  { key: 'coordinators:edit', module: 'coordinators', action: 'edit', label: 'Editar Coordinadores' },
  { key: 'coordinators:delete', module: 'coordinators', action: 'delete', label: 'Eliminar Coordinadores' },
  { key: 'youth:view', module: 'youth', action: 'view', label: 'Ver Jóvenes' },
  { key: 'youth:create', module: 'youth', action: 'create', label: 'Registrar Jóvenes' },
  { key: 'youth:edit', module: 'youth', action: 'edit', label: 'Editar Jóvenes' },
  { key: 'youth:delete', module: 'youth', action: 'delete', label: 'Eliminar Jóvenes' },
  { key: 'women:view', module: 'women', action: 'view', label: 'Ver Mujeres' },
  { key: 'women:create', module: 'women', action: 'create', label: 'Registrar Mujeres' },
  { key: 'women:edit', module: 'women', action: 'edit', label: 'Editar Mujeres' },
  { key: 'women:delete', module: 'women', action: 'delete', label: 'Eliminar Mujeres' },
  { key: 'onp:view', module: 'onp', action: 'view', label: 'Ver ONP (Organización No Política)' },
  { key: 'onp:create', module: 'onp', action: 'create', label: 'Registrar en ONP' },
  { key: 'onp:edit', module: 'onp', action: 'edit', label: 'Editar Registros ONP' },
  { key: 'onp:delete', module: 'onp', action: 'delete', label: 'Eliminar Registros ONP' },
  { key: 'projections:view', module: 'projections', action: 'view', label: 'Ver Proyección de Votos' },
  { key: 'projections:create', module: 'projections', action: 'create', label: 'Registrar Proyección' },
  { key: 'projections:edit', module: 'projections', action: 'edit', label: 'Editar Proyección' },
  { key: 'projections:delete', module: 'projections', action: 'delete', label: 'Eliminar Proyección' },
  { key: 'agenda:view', module: 'agenda', action: 'view', label: 'Ver Agenda y Calendario' },
  { key: 'agenda:create', module: 'agenda', action: 'create', label: 'Crear Eventos en Agenda' },
  { key: 'agenda:edit', module: 'agenda', action: 'edit', label: 'Editar Agenda' },
  { key: 'agenda:delete', module: 'agenda', action: 'delete', label: 'Eliminar Eventos' },
  { key: 'reports:view', module: 'reports', action: 'view', label: 'Ver Centro de Reportes' },
  { key: 'reports:export', module: 'reports', action: 'export', label: 'Exportar PDF y Excel' },
  { key: 'statistics:view', module: 'statistics', action: 'view', label: 'Ver Estadísticas' },
  { key: 'territorial:view', module: 'territorial', action: 'view', label: 'Ver Configuración Territorial' },
  { key: 'territorial:manage', module: 'territorial', action: 'manage', label: 'Administrar Deptos/Distritos/Seccionales' },
  { key: 'admin:manage', module: 'admin', action: 'manage', label: 'Acceso al Panel de Administración General' },
  { key: 'sensitive_data:view', module: 'sensitive_data', action: 'view', label: 'Ver C.I. y Teléfonos Completos' },
];

export const DEFAULT_ROLE_PERMISSION_KEYS: Record<RoleSlug, string[]> = {
  super_admin: ALL_PERMISSIONS.map((p) => p.key),
  admin: ALL_PERMISSIONS.filter((p) => p.key !== 'admin:manage').map((p) => p.key),
  coordinator: [
    'dashboard:view',
    'coordinators:view', 'coordinators:create', 'coordinators:edit',
    'youth:view', 'youth:create', 'youth:edit',
    'women:view', 'women:create', 'women:edit',
    'onp:view', 'onp:create', 'onp:edit',
    'projections:view', 'projections:create', 'projections:edit',
    'agenda:view', 'agenda:create', 'agenda:edit',
    'reports:view', 'reports:export',
    'statistics:view', 'territorial:view', 'sensitive_data:view',
  ],
  viewer: [
    'dashboard:view',
    'coordinators:view',
    'youth:view',
    'women:view',
    'onp:view',
    'projections:view',
    'agenda:view',
    'reports:view',
    'statistics:view',
    'territorial:view',
  ],
};

export function getRoleName(slug: RoleSlug): string {
  return ROLES.find((r) => r.slug === slug)?.name || 'Usuario de consulta';
}

export function computeEffectivePermissions(
  roleSlug: RoleSlug,
  customPermissions?: Record<string, boolean>
): Record<string, boolean> {
  const baseKeys = new Set(DEFAULT_ROLE_PERMISSION_KEYS[roleSlug] || DEFAULT_ROLE_PERMISSION_KEYS.viewer);
  const perms: Record<string, boolean> = {};
  for (const p of ALL_PERMISSIONS) {
    perms[p.key] = baseKeys.has(p.key);
  }
  if (customPermissions) {
    for (const [k, v] of Object.entries(customPermissions)) {
      perms[k] = Boolean(v);
    }
  }
  return perms;
}
