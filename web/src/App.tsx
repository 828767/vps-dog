import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Layout } from './components/Layout';
import Dashboard from './pages/Dashboard';
import NodeDetail from './pages/NodeDetail';
import UptimeDetail from './pages/UptimeDetail';
import NotFound from './pages/NotFound';
import AdminLayout from './pages/admin/AdminLayout';
import AdminLogin from './pages/admin/AdminLogin';
import AdminNodes from './pages/admin/AdminNodes';
import AdminPings from './pages/admin/AdminPings';
import AdminUptime from './pages/admin/AdminUptime';
import AdminSettings from './pages/admin/AdminSettings';
import AdminUsers from './pages/admin/AdminUsers';
import AdminAudit from './pages/admin/AdminAudit';
import AdminOverview from './pages/admin/AdminOverview';

export default function App(): ReactNode {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/node/:id" element={<NodeDetail />} />
        <Route path="/uptime/:id" element={<UptimeDetail />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* `/admin` is the login screen when unauthenticated; the guard inside
          AdminLayout redirects here on 401. */}
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route path="overview" element={<AdminOverview />} />
        <Route path="nodes" element={<AdminNodes />} />
        <Route path="pings" element={<AdminPings />} />
        <Route path="uptime" element={<AdminUptime />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="*" element={<Navigate to="/admin/overview" replace />} />
      </Route>
    </Routes>
  );
}
