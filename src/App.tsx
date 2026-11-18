import { Clock, LogOut } from 'lucide-react';
import React, { useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { AppProvider, useApp } from './context/AppContext';
import { AdminPage } from './pages/AdminPage';
import { AgendaPage } from './pages/AgendaPage';
import { DashboardPage } from './pages/DashboardPage';
import { GuidePage } from './pages/GuidePage';
import { LoginPage } from './pages/LoginPage';
import { OnpPage } from './pages/OnpPage';
import { PeopleModulePage } from './pages/PeopleModulePage';
import { ProjectionsPage } from './pages/ProjectionsPage';
import { ReportsPage } from './pages/ReportsPage';
import { StatisticsPage } from './pages/StatisticsPage';
import { TerritorialPage } from './pages/TerritorialPage';
import { PageKey } from './types';

function MainRouter() {
  const { user, loadingAuth, hasPermission, logout, settings } = useApp();
  const [activePage, setActivePage] = useState<PageKey>('dashboard');

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Verificando sesión y conexión con Firestore...
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (!user.active) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
            <Clock className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Acceso Pendiente de Activación</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Su cuenta <strong className="text-slate-900">{user.email}</strong> fue registrada correctamente, pero aún debe
            ser habilitada por un Administrador del sistema ({settings.organization_name}).
          </p>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
            Solicite al administrador principal que active su usuario y le asigne su rol territorial en el Panel de Administración.
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardPage onNavigate={setActivePage} />;
      case 'coordinators':
        return (
          <PeopleModulePage
            moduleKey="coordinators"
            title="Coordinadores"
            singularLabel="Coordinador"
            description="Registro, control territorial, validación de C.I. y exportación de coordinadores de campaña"
          />
        );
      case 'youth':
        return (
          <PeopleModulePage
            moduleKey="youth"
            title="Estructura de Jóvenes"
            singularLabel="Integrante Juvenil"
            description="Administración independiente de la estructura territorial juvenil"
          />
        );
      case 'women':
        return (
          <PeopleModulePage
            moduleKey="women"
            title="Estructura de Mujeres"
            singularLabel="Integrante"
            description="Administración independiente de la estructura territorial de mujeres"
          />
        );
      case 'onp':
        return <OnpPage />;
      case 'projections':
        return <ProjectionsPage />;
      case 'agenda':
        return <AgendaPage />;
      case 'reports':
        return <ReportsPage />;
      case 'statistics':
        return <StatisticsPage />;
      case 'territorial':
        return <TerritorialPage />;
      case 'admin':
        return hasPermission('admin:manage') ? <AdminPage /> : <DashboardPage onNavigate={setActivePage} />;
      case 'guide':
        return <GuidePage />;
      default:
        return <DashboardPage onNavigate={setActivePage} />;
    }
  };

  return (
    <Layout activePage={activePage} onNavigate={setActivePage}>
      {renderPage()}
    </Layout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <MainRouter />
      </AppProvider>
    </ErrorBoundary>
  );
}
