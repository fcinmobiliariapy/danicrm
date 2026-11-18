export type RoleSlug = 'super_admin' | 'admin' | 'coordinator' | 'viewer';

export interface User {
  id: string;
  uid: string;
  username: string;
  full_name: string;
  email: string;
  role_slug: RoleSlug;
  role_name: string;
  active: boolean;
  custom_permissions?: Record<string, boolean>;
  permissions: Record<string, boolean>;
  last_login_at?: string | null;
}

export interface UserInvite {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role_slug: RoleSlug;
  role_name: string;
  active: boolean;
  custom_permissions?: Record<string, boolean>;
}

export interface SystemSettings {
  id?: string;
  platform_name: string;
  organization_name: string;
  campaign_reference: string;
  logo_url: string;
  institutional_image_url: string;
  primary_color: string;
  secondary_color: string;
  theme_mode: 'light' | 'dark' | 'custom';
  background_color: string;
  surface_color: string;
  text_color: string;
  font_family: string;
  font_size_scale: 'compact' | 'normal' | 'large';
  border_radius: 'sharp' | 'rounded' | 'soft';
  header_text: string;
  footer_text: string;
  institutional_text: string;
  contact_phone: string;
  contact_email: string;
  contact_address: string;
  document_format: 'A4' | 'LETTER';
  date_format: 'DD/MM/YYYY' | 'YYYY-MM-DD';
  report_show_charts: boolean;
  report_show_totals: boolean;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface District {
  id: string;
  department_id: string;
  name: string;
  active: boolean;
}

export interface Seccional {
  id: string;
  department_id: string;
  district_id: string;
  number: number;
  name: string;
  active: boolean;
}

export interface CustomField {
  id: string;
  module: 'coordinators' | 'youth' | 'women' | 'onp' | 'projections' | 'agenda';
  field_key: string;
  label: string;
  field_type: 'text' | 'number' | 'select' | 'date' | 'textarea';
  required: boolean;
  active: boolean;
  sort_order: number;
  options: string[];
}

export interface PersonRecord {
  id: string;
  first_name: string;
  last_name: string;
  ci: string;
  ci_raw?: string;
  department_id: string;
  district_id: string;
  department_name?: string;
  district_name?: string;
  seccional_number: number;
  phone: string;
  phone_raw?: string;
  registered_at: string;
  notes: string;
  consent_accepted: boolean;
  custom_fields: Record<string, string | number>;
  created_at?: string;
}

export interface OnpRecord {
  id: string;
  full_name: string;
  phone: string;
  phone_raw?: string;
  organization: string;
  registered_at: string;
  notes: string;
  custom_fields: Record<string, string | number>;
  created_at?: string;
}

export interface VoteProjection {
  id: string;
  coordinator_id: string;
  first_name: string;
  last_name: string;
  ci: string;
  department_id: string;
  district_id: string;
  department_name: string;
  district_name: string;
  seccional_number: number;
  estimated_votes: number;
  responsible_name: string;
  notes: string;
  updated_at: string;
}

export interface AgendaEvent {
  id: string;
  title: string;
  event_type: string;
  event_date: string;
  start_time: string;
  end_time: string;
  department_id: string | null;
  district_id: string | null;
  department_name?: string;
  district_name?: string;
  seccional_number: number | null;
  location: string;
  responsible: string;
  participants: string;
  description: string;
  notes: string;
  reminder_minutes: number;
  status: 'programado' | 'realizado' | 'cancelado';
  activity_summary?: string;
  attendance_count?: number;
  activity_outcomes?: string;
}

export interface SavedReport {
  id: string;
  title: string;
  report_type:
    | 'coordinators'
    | 'youth'
    | 'women'
    | 'onp'
    | 'projections_general'
    | 'projections_dept'
    | 'projections_district'
    | 'projections_seccional';
  filters: Record<string, string>;
  columns: string[];
  generated_by: string;
}

export interface AuditLogEntry {
  id: string;
  user_uid: string;
  username: string;
  action: string;
  module: string;
  entity_id: string;
  details: string;
  created_at: string;
}

export type PageKey =
  | 'dashboard'
  | 'coordinators'
  | 'youth'
  | 'women'
  | 'onp'
  | 'projections'
  | 'agenda'
  | 'reports'
  | 'statistics'
  | 'territorial'
  | 'admin'
  | 'guide';
