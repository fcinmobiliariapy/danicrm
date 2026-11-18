import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { handleFirestoreError, OperationType } from './firestoreErrors';
import { BOOTSTRAPPED_ADMIN_EMAIL } from './rbac';

const PARAGUAY_DEPARTMENTS = [
  { code: '00', name: 'Capital' },
  { code: '01', name: 'Concepción' },
  { code: '02', name: 'San Pedro' },
  { code: '03', name: 'Cordillera' },
  { code: '04', name: 'Guairá' },
  { code: '05', name: 'Caaguazú' },
  { code: '06', name: 'Caazapá' },
  { code: '07', name: 'Itapúa' },
  { code: '08', name: 'Misiones' },
  { code: '09', name: 'Paraguarí' },
  { code: '10', name: 'Alto Paraná' },
  { code: '11', name: 'Central' },
  { code: '12', name: 'Ñeembucú' },
  { code: '13', name: 'Amambay' },
  { code: '14', name: 'Canindeyú' },
  { code: '15', name: 'Presidente Hayes' },
  { code: '16', name: 'Alto Paraguay' },
  { code: '17', name: 'Boquerón' },
];

const INITIAL_DISTRICTS: Record<string, string[]> = {
  Capital: ['Asunción'],
  Concepción: ['Concepción', 'Horqueta', 'Loreto', 'Yby Yaú'],
  'San Pedro': ['San Pedro de Ycuamandyyú', 'Santa Rosa del Aguaray', 'San Estanislao'],
  Cordillera: ['Caacupé', 'Tobatí', 'Piribebuy', 'Eusebio Ayala'],
  Guairá: ['Villarrica', 'Independencia', 'Mbocayaty'],
  Caaguazú: ['Coronel Oviedo', 'Caaguazú', 'J. Eulogio Estigarribia'],
  Caazapá: ['Caazapá', 'San Juan Nepomuceno', 'Yuty'],
  Itapúa: ['Encarnación', 'Cambyretá', 'Hohenau', 'Tomás Romero Pereira'],
  Misiones: ['San Juan Bautista', 'San Ignacio', 'Ayolas'],
  Paraguarí: ['Paraguarí', 'Carapeguá', 'Yaguarón'],
  'Alto Paraná': ['Ciudad del Este', 'Hernandarias', 'Presidente Franco', 'Minga Guazú'],
  Central: [
    'San Lorenzo',
    'Luque',
    'Fernando de la Mora',
    'Lambaré',
    'Capiatá',
    'Mariano Roque Alonso',
    'Ñemby',
    'Villa Elisa',
  ],
  Ñeembucú: ['Pilar', 'Alberdi'],
  Amambay: ['Pedro Juan Caballero', 'Bella Vista Norte'],
  Canindeyú: ['Salto del Guairá', 'Curuguaty'],
  'Presidente Hayes': ['Villa Hayes', 'Benjamín Aceval'],
  'Alto Paraguay': ['Fuerte Olimpo', 'Puerto Casado'],
  Boquerón: ['Filadelfia', 'Loma Plata', 'Mariscal Estigarribia'],
};

interface BatchOp {
  path: string;
  id: string;
  data: Record<string, unknown>;
}

async function commitInWaves(ops: BatchOp[], label: string, chunkSize = 100): Promise<void> {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const chunk = ops.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const op of chunk) {
      batch.set(doc(db, op.path, op.id), op.data);
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, label);
    }
  }
}

export const DEFAULT_BRANDING_DOC = {
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
  institutional_text:
    'Plataforma centralizada de organización territorial, coordinación electoral, agenda política y proyección estadística.',
};

export const DEFAULT_SYSTEM_SETTINGS_DOC = {
  ...DEFAULT_BRANDING_DOC,
  header_text: 'CRM POLÍTICO – GESTIÓN TERRITORIAL | DANI CENTURIÓN 2018',
  footer_text: 'Documento de uso interno y confidencial · Estructura Territorial Paraguay',
  contact_phone: '+595 21 440 2018',
  contact_email: 'coordinacion@danicenturion2018.org.py',
  contact_address: 'Asunción, República del Paraguay',
  document_format: 'A4',
  date_format: 'DD/MM/YYYY',
  report_show_charts: true,
  report_show_totals: true,
};

let seedPromise: Promise<void> | null = null;

export async function seedFirestoreIfNeeded(user: {
  uid: string;
  email: string;
  role_slug: string;
  username: string;
}): Promise<void> {
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    const isAdminUser =
      user.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL ||
      user.role_slug === 'super_admin' ||
      user.role_slug === 'admin';
    if (!isAdminUser) return;

    let settingsExists = false;
    try {
      const settingsSnap = await getDoc(doc(db, 'system_settings', 'main'));
      settingsExists = settingsSnap.exists();
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'system_settings/main');
    }

    let hasDepartments = false;
    let hasSeccionales = false;
    let hasCoords = false;
    try {
      const [deptSnap, seccSnap, coordSnap] = await Promise.all([
        getDocs(query(collection(db, 'departments'), limit(1))),
        getDocs(query(collection(db, 'seccionales'), limit(1))),
        getDocs(query(collection(db, 'coordinators'), limit(1))),
      ]);
      hasDepartments = !deptSnap.empty;
      hasSeccionales = !seccSnap.empty;
      hasCoords = !coordSnap.empty;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'departments');
    }

    if (settingsExists && hasDepartments && hasSeccionales && hasCoords) {
      return;
    }

    const now = serverTimestamp();
    const ownerUid = user.uid;

    // Wave 1: Public branding, system settings, departments, custom fields
    const wave1: BatchOp[] = [];
    if (!settingsExists) {
      wave1.push({
        path: 'public_branding',
        id: 'main',
        data: { ...DEFAULT_BRANDING_DOC, ownerUid, updatedAt: now },
      });
      wave1.push({
        path: 'system_settings',
        id: 'main',
        data: { ...DEFAULT_SYSTEM_SETTINGS_DOC, ownerUid, createdAt: now, updatedAt: now },
      });
    }

    const deptIdByName: Record<string, string> = {};
    const distIdByKey: Record<string, string> = {};
    const wave2: BatchOp[] = [];
    const wave3: BatchOp[] = [];

    if (hasDepartments) {
      try {
        const [allDeptsSnap, allDistsSnap] = await Promise.all([
          getDocs(collection(db, 'departments')),
          getDocs(collection(db, 'districts')),
        ]);
        const deptNameById: Record<string, string> = {};
        for (const docSnap of allDeptsSnap.docs) {
          const dName = String(docSnap.data().name || '');
          if (dName) {
            deptIdByName[dName] = docSnap.id;
            deptNameById[docSnap.id] = dName;
          }
        }
        for (const docSnap of allDistsSnap.docs) {
          const data = docSnap.data();
          const dName = deptNameById[String(data.department_id || '')];
          const distName = String(data.name || '');
          if (dName && distName) {
            distIdByKey[`${dName}::${distName}`] = docSnap.id;
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'departments');
      }
    }

    if (!hasDepartments || !hasSeccionales) {
      for (const d of PARAGUAY_DEPARTMENTS) {
        const deptId = deptIdByName[d.name] || `dept_${d.code}`;
        deptIdByName[d.name] = deptId;
        if (!hasDepartments) {
          wave1.push({
            path: 'departments',
            id: deptId,
            data: {
              code: d.code,
              name: d.name,
              active: true,
              ownerUid,
              createdAt: now,
              updatedAt: now,
            },
          });
        }

        const districts = INITIAL_DISTRICTS[d.name] || [d.name];
        districts.forEach((distName, idx) => {
          const distId = distIdByKey[`${d.name}::${distName}`] || `dist_${d.code}_${idx + 1}`;
          distIdByKey[`${d.name}::${distName}`] = distId;
          if (!hasDepartments) {
            wave2.push({
              path: 'districts',
              id: distId,
              data: {
                department_id: deptId,
                name: distName,
                active: true,
                ownerUid,
                createdAt: now,
                updatedAt: now,
              },
            });
          }

          if (!hasSeccionales) {
            if (d.name === 'Capital') {
              [1, 3, 5, 7, 10, 12, 14, 18, 21, 24, 30, 35, 42].forEach((n) => {
                wave3.push({
                  path: 'seccionales',
                  id: `secc_${d.code}_${n}`,
                  data: {
                    department_id: deptId,
                    district_id: distId,
                    number: n,
                    name: `Seccional Colorada N° ${n} - Asunción`,
                    active: true,
                    ownerUid,
                    createdAt: now,
                    updatedAt: now,
                  },
                });
              });
            } else {
              const base = Number(d.code) * 20 + idx * 5 + 1;
              wave3.push({
                path: 'seccionales',
                id: `secc_${d.code}_${base}`,
                data: {
                  department_id: deptId,
                  district_id: distId,
                  number: base,
                  name: `Seccional N° ${base} - ${distName}`,
                  active: true,
                  ownerUid,
                  createdAt: now,
                  updatedAt: now,
                },
              });
              wave3.push({
                path: 'seccionales',
                id: `secc_${d.code}_${base + 1}`,
                data: {
                  department_id: deptId,
                  district_id: distId,
                  number: base + 1,
                  name: `Seccional N° ${base + 1} - ${distName}`,
                  active: true,
                  ownerUid,
                  createdAt: now,
                  updatedAt: now,
                },
              });
            }
          }
        });
      }

      if (!hasDepartments) {
        const customFieldSeeds = [
          {
            id: 'cf_1',
            module: 'coordinators',
            field_key: 'zona_electoral',
            label: 'Zona o Barrio de Referencia',
            field_type: 'text',
            required: false,
            active: true,
            sort_order: 1,
            options: [],
          },
          {
            id: 'cf_2',
            module: 'coordinators',
            field_key: 'disponibilidad_movilizacion',
            label: 'Disponibilidad de Movilización',
            field_type: 'select',
            required: false,
            active: true,
            sort_order: 2,
            options: ['Vehículo propio', 'Motocicleta', 'Transporte coordinado', 'Sin movilidad'],
          },
          {
            id: 'cf_3',
            module: 'youth',
            field_key: 'area_interes',
            label: 'Área de Militancia Juvenil',
            field_type: 'select',
            required: false,
            active: true,
            sort_order: 1,
            options: ['Redes y Comunicación', 'Brigada Territorial', 'Universitarios', 'Deporte y Cultura'],
          },
          {
            id: 'cf_4',
            module: 'women',
            field_key: 'comision_trabajo',
            label: 'Comisión de Trabajo',
            field_type: 'select',
            required: false,
            active: true,
            sort_order: 1,
            options: ['Emprendedoras', 'Acción Social', 'Organización Electoral', 'Capacitación'],
          },
        ];
        for (const cf of customFieldSeeds) {
          wave1.push({
            path: 'custom_fields',
            id: cf.id,
            data: {
              module: cf.module,
              field_key: cf.field_key,
              label: cf.label,
              field_type: cf.field_type,
              required: cf.required,
              active: cf.active,
              sort_order: cf.sort_order,
              options: cf.options,
              ownerUid,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
      }
    }

    if (wave1.length > 0) await commitInWaves(wave1, 'seed_wave1', 100);
    if (wave2.length > 0) await commitInWaves(wave2, 'seed_wave2_districts', 10);

    const wave4: BatchOp[] = [];
    if (!hasCoords) {
      const loc = (deptName: string, distName: string) => ({
        department_id: deptIdByName[deptName] || '',
        district_id: distIdByKey[`${deptName}::${distName}`] || '',
      });

      const capital = loc('Capital', 'Asunción');
      const sanLorenzo = loc('Central', 'San Lorenzo');
      const luque = loc('Central', 'Luque');
      const lambare = loc('Central', 'Lambaré');
      const fdoMora = loc('Central', 'Fernando de la Mora');
      const cde = loc('Alto Paraná', 'Ciudad del Este');
      const encarnacion = loc('Itapúa', 'Encarnación');
      const caacupe = loc('Cordillera', 'Caacupé');
      const oviedo = loc('Caaguazú', 'Coronel Oviedo');

      const seedCoords = [
        ['coord_1', 'Marcos Antonio', 'Galeano Villalba', '3456120', capital, 14, '0981 452 110', '2026-10-02', 'Referente de barrio Sajonia con equipo completo de mesa.', { zona_electoral: 'Sajonia Norte' }, 1450],
        ['coord_2', 'Derlis Ramón', 'Aquino Paredes', '2984512', capital, 7, '0971 234 890', '2026-10-04', 'Coordinación territorial Zona Obrero.', { zona_electoral: 'Barrio Obrero' }, 980],
        ['coord_3', 'Claudia Mabel', 'Bogado Duarte', '4120987', capital, 21, '0982 678 331', '2026-10-06', 'Equipo logístico de movilización y día D.', { zona_electoral: 'Villa Morra' }, 1120],
        ['coord_4', 'Hugo César', 'Martínez Rojas', '3211450', capital, 30, '0984 510 229', '2026-10-08', 'Enlace con comisiones vecinales de Zeballos Cué.', { zona_electoral: 'Zeballos Cué' }, 860],
        ['coord_5', 'Néstor Fabián', 'González Vera', '3890112', sanLorenzo, 221, '0981 902 441', '2026-10-10', 'Coordinador distrital zona universitaria.', { zona_electoral: 'Centro San Lorenzo' }, 1620],
        ['coord_6', 'Patricia Beatriz', 'Fleitas Cáceres', '4312789', luque, 226, '0985 334 118', '2026-10-12', 'Estructura territorial Cuarto Barrio.', { zona_electoral: 'Cuarto Barrio' }, 1290],
        ['coord_7', 'Óscar Eduardo', 'Salinas Gómez', '2789034', lambare, 236, '0972 441 780', '2026-10-15', 'Red de referentes en Valle Apuá.', { zona_electoral: 'Valle Apuá' }, 940],
        ['coord_8', 'Lourdes Lorena', 'Benítez Ortiz', '3998123', fdoMora, 231, '0983 115 622', '2026-10-17', 'Zona Norte Fernando de la Mora.', { zona_electoral: 'Zona Norte' }, 870],
        ['coord_9', 'Rodrigo Javier', 'Mendoza Silva', '3654890', cde, 201, '0983 770 405', '2026-10-20', 'Coordinador regional Alto Paraná.', { zona_electoral: 'Microcentro CDE' }, 1840],
        ['coord_10', 'Silvia Carolina', 'Núñez Ayala', '4450129', encarnacion, 141, '0985 881 204', '2026-10-24', 'Estructura circuito centro y San Isidro.', { zona_electoral: 'San Isidro' }, 1320],
        ['coord_11', 'Gustavo Adolfo', 'Riquelme Sosa', '3112098', caacupe, 61, '0971 660 512', '2026-10-28', 'Enlace departamental Cordillera.', { zona_electoral: 'Centro Caacupé' }, 740],
        ['coord_12', 'Víctor Manuel', 'Ferreira López', '3509876', oviedo, 101, '0981 309 740', '2026-11-01', 'Referente de base Coronel Oviedo.', { zona_electoral: 'Centro Oviedo' }, 910],
      ] as const;

      seedCoords.forEach(([id, first_name, last_name, ci, locObj, secc, phone, registered_at, notes, custom_fields, estVotes], idx) => {
        wave3.push({
          path: 'coordinators',
          id,
          data: {
            first_name,
            last_name,
            ci,
            department_id: locObj.department_id,
            district_id: locObj.district_id,
            seccional_number: secc,
            phone,
            registered_at,
            notes,
            consent_accepted: true,
            custom_fields,
            ownerUid,
            createdAt: now,
            updatedAt: now,
          },
        });
        wave4.push({
          path: 'vote_projections',
          id: `vp_${idx + 1}`,
          data: {
            coordinator_id: id,
            department_id: locObj.department_id,
            district_id: locObj.district_id,
            seccional_number: secc,
            estimated_votes: estVotes,
            responsible_name: 'Dani Centurión · Dirección General',
            notes: `Estimación territorial relevada con equipo de Seccional N° ${secc}.`,
            custom_fields: {},
            ownerUid,
            createdAt: now,
            updatedAt: now,
          },
        });
      });

      const seedYouth = [
        ['youth_1', 'Lucas Gabriel', 'Pereira Domínguez', '5120345', capital, 14, '0986 211 409', '2026-10-05', 'Juventud universitaria UNA · Redes y brigadas.'],
        ['youth_2', 'Sofía Belén', 'Centurión Morales', '5432890', capital, 7, '0981 742 310', '2026-10-09', 'Coordinación juvenil cultural Barrio Obrero.'],
        ['youth_3', 'Matías Alejandro', 'Cabrera Ruiz', '5612904', sanLorenzo, 221, '0972 885 120', '2026-10-14', 'Voluntariado territorial San Lorenzo.'],
        ['youth_4', 'Camila Montserrat', 'Rolón Giménez', '5349012', luque, 226, '0984 319 044', '2026-10-18', 'Equipo de comunicación digital Luque.'],
        ['youth_5', 'Tobías Ezequiel', 'Amarilla Franco', '5789231', cde, 201, '0983 612 998', '2026-10-22', 'Jóvenes emprendedores Alto Paraná.'],
        ['youth_6', 'Valentina Jazmín', 'Ibarra Escobar', '5501874', encarnacion, 141, '0985 410 733', '2026-10-27', 'Promoción juvenil Encarnación.'],
        ['youth_7', 'Nicolás Andrés', 'Valdez Cardozo', '5290441', lambare, 236, '0971 504 218', '2026-11-02', 'Brigada de contacto vecinal Lambaré.'],
        ['youth_8', 'Andrea Celeste', 'Delvalle Torres', '5410982', capital, 21, '0982 904 115', '2026-11-05', 'Juventud profesional Villa Morra.'],
      ] as const;

      for (const [id, first_name, last_name, ci, locObj, secc, phone, registered_at, notes] of seedYouth) {
        wave3.push({
          path: 'youth_members',
          id,
          data: {
            first_name,
            last_name,
            ci,
            department_id: locObj.department_id,
            district_id: locObj.district_id,
            seccional_number: secc,
            phone,
            registered_at,
            notes,
            consent_accepted: true,
            custom_fields: {},
            ownerUid,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      const seedWomen = [
        ['women_1', 'María Teresa', 'Alvarenga de Ortiz', '2450198', capital, 14, '0981 554 209', '2026-10-03', 'Lideresa de comisiones de mujeres en Sajonia.'],
        ['women_2', 'Rossana Elizabeth', 'Gamarra Villalba', '3340912', capital, 30, '0982 310 884', '2026-10-07', 'Red de mujeres emprendedoras Zeballos Cué.'],
        ['women_3', 'Gladys Beatriz', 'Maidana Cuevas', '2890145', sanLorenzo, 221, '0971 440 912', '2026-10-13', 'Coordinación femenina San Lorenzo.'],
        ['women_4', 'Norma Alicia', 'Paredes Barrios', '3109845', luque, 226, '0984 712 330', '2026-10-16', 'Comisión solidaria de mujeres Luque.'],
        ['women_5', 'Zulma Raquel', 'Insaurralde Vega', '3782019', fdoMora, 231, '0983 220 419', '2026-10-21', 'Organización territorial Fernando de la Mora.'],
        ['women_6', 'Verónica Soledad', 'Báez Acosta', '4012983', cde, 201, '0985 901 664', '2026-10-25', 'Red de mujeres Alto Paraná.'],
        ['women_7', 'Mirta Graciela', 'Cantero Medina', '2678110', caacupe, 61, '0972 301 552', '2026-10-30', 'Referente distrital Caacupé.'],
        ['women_8', 'Lorena Patricia', 'Samaniego León', '3901284', encarnacion, 141, '0981 662 840', '2026-11-04', 'Mesa de trabajo de mujeres Itapúa.'],
      ] as const;

      for (const [id, first_name, last_name, ci, locObj, secc, phone, registered_at, notes] of seedWomen) {
        wave3.push({
          path: 'women_members',
          id,
          data: {
            first_name,
            last_name,
            ci,
            department_id: locObj.department_id,
            district_id: locObj.district_id,
            seccional_number: secc,
            phone,
            registered_at,
            notes,
            consent_accepted: true,
            custom_fields: {},
            ownerUid,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      const seedOnp = [
        ['onp_1', 'Alberto Ramón Benítez', '0981 312 450', 'Comisión Vecinal Sajonia Unida', '2026-10-08', 'Presidente de comisión vecinal de infraestructura barrial.'],
        ['onp_2', 'Beatriz Elena Villalba', '0982 645 190', 'Asociación de Feriantes del Mercado 4', '2026-10-12', 'Coordinación gremial de trabajadores independientes.'],
        ['onp_3', 'Carlos Alberto Giménez', '0971 520 884', 'Club Deportivo Juventud Obrera', '2026-10-15', 'Dirigente deportivo y promotor de actividades comunitarias.'],
        ['onp_4', 'Diana Paola Cáceres', '0984 219 770', 'Fundación Manos Solidarias Paraguay', '2026-10-19', 'Enlace social de asistencia educativa y jornadas médicas.'],
        ['onp_5', 'Eduardo José Franco', '0983 410 662', 'Junta de Saneamiento San Lorenzo Norte', '2026-10-24', 'Referente de gestión comunitaria de agua potable.'],
        ['onp_6', 'Fátima Concepción Núñez', '0985 773 108', 'Cooperativa Multiactiva La Paz Ltda.', '2026-10-29', 'Representante del consejo de educación cooperativa.'],
        ['onp_7', 'Gustavo Enrique Vera', '0972 904 335', 'Asociación de Comerciantes de Luque', '2026-11-03', 'Enlace con pymes y emprendedores locales.'],
        ['onp_8', 'Helena María Domínguez', '0981 882 514', 'Red de Voluntarios Ambientales Asunción', '2026-11-07', 'Coordinadora de jornadas de arborización y limpieza.'],
      ] as const;

      for (const [id, full_name, phone, organization, registered_at, notes] of seedOnp) {
        wave3.push({
          path: 'onp_members',
          id,
          data: {
            full_name,
            phone,
            organization,
            registered_at,
            notes,
            custom_fields: {},
            ownerUid,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      const seedEvents = [
        ['ev_1', 'Plenaria Territorial de Coordinadores Capital', 'Reuniones con coordinadores', '2026-11-17', '18:30', '20:30', capital, 14, 'Sede Central · Av. España 1240', 'Dani Centurión', 'Coordinadores de Seccionales 1 a 45', 'Revisión de metas territoriales, verificación de padrones de referentes y cronograma semanal.', 'Confirmar asistencia 24h antes.', 'programado'],
        ['ev_2', 'Audiencia con Comisiones Vecinales de San Lorenzo', 'Audiencias', '2026-11-18', '09:30', '11:30', sanLorenzo, 221, 'Local Seccional N° 221', 'Néstor Fabián González', 'Presidentes de comisiones vecinales y equipo distrital', 'Recepción de propuestas de infraestructura comunitaria y agenda social.', 'Llevar carpeta técnica.', 'programado'],
        ['ev_3', 'Mesa Legislativa y Agenda Parlamentaria', 'Actividades parlamentarias', '2026-11-19', '10:00', '12:00', capital, 7, 'Congreso Nacional · Sala Bicameral', 'Dani Centurión', 'Equipo parlamentario y asesores jurídicos', 'Análisis de proyectos prioritarios y agenda de comisiones.', 'Preparar resumen ejecutivo.', 'programado'],
        ['ev_4', 'Encuentro Departamental de Mujeres Líderes', 'Eventos especiales', '2026-11-21', '16:00', '18:30', luque, 226, 'Centro Cultural Luqueño', 'Norma Alicia Paredes', 'Estructura de Mujeres de Central y Capital', 'Jornada de capacitación en liderazgo territorial y organización de bases.', 'Confirmado audio y logística.', 'programado'],
        ['ev_5', 'Caminata y Visita Territorial Seccional N° 21', 'Actividades territoriales', '2026-11-23', '08:30', '12:00', capital, 21, 'Plaza Villa Morra · Punto de encuentro', 'Claudia Mabel Bogado', 'Jóvenes, mujeres y coordinadores de zona', 'Recorrido casa por casa y relevamiento de proyección territorial.', 'Distribuir materiales institucionales.', 'programado'],
        ['ev_6', 'Reunión Política Regional Alto Paraná', 'Reuniones políticas', '2026-11-25', '19:00', '21:00', cde, 201, 'Hotel Casino Acaray · Salón Paraná', 'Rodrigo Javier Mendoza', 'Coordinadores distritales de Alto Paraná', 'Evaluación de avance organizativo y consolidación de seccionales.', 'Transmisión interna para referentes.', 'programado'],
      ] as const;

      for (const [id, title, event_type, event_date, start_time, end_time, locObj, secc, location, responsible, participants, description, notes, status] of seedEvents) {
        wave3.push({
          path: 'agenda_events',
          id,
          data: {
            title,
            event_type,
            event_date,
            start_time,
            end_time,
            department_id: locObj.department_id,
            district_id: locObj.district_id,
            seccional_number: secc,
            location,
            responsible,
            participants,
            description,
            notes,
            reminder_minutes: 60,
            status,
            activity_summary: 'Actividad planificada en calendario oficial de campaña.',
            attendance_count: 0,
            activity_outcomes: 'Pendiente de ejecución.',
            custom_fields: {},
            ownerUid,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      wave4.push({
        path: 'audit_logs',
        id: 'audit_seed_1',
        data: {
          user_uid: ownerUid,
          username: user.username || 'admin',
          action: 'SEED_INICIAL',
          module: 'sistema',
          entity_id: '1',
          details: 'Inicialización en Firestore con 18 departamentos de Paraguay y datos base.',
          ownerUid,
          createdAt: now,
        },
      });
    }

    if (wave3.length > 0) await commitInWaves(wave3, 'seed_wave3', 6);
    if (wave4.length > 0) await commitInWaves(wave4, 'seed_wave4_projections', 5);
  })();

  try {
    await seedPromise;
  } finally {
    seedPromise = null;
  }
}
