import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './authcontext/AuthContext'
import AdminLoginPage from './pages/AdminLoginPage'
import AdminLayout from './components/AdminLayout'
import OverviewPage from './pages/OverviewPage'
import DriverVerificationPage from './pages/DriverVerificationPage'
import DriverVerificationDetailPage from './pages/DriverVerificationDetailPage'
import RideOperationsPage from './pages/RideOperationsPage'
import RideOperationDetailPage from './pages/RideOperationDetailPage'
import PanicAlertsPage from './pages/PanicAlertsPage'
import LostItemsPage from './pages/LostItemsPage'
import LiveMapPage from './pages/LiveMapRealtimePage'
import DriversPage from './pages/DriversPage'
import DriverDetailsPage from './pages/DriverDetailsPage'
import PassengersPage from './pages/PassengersPage'
import PassengerDetailsPage from './pages/PassengerDetailsPage'
import AdminUsersPage from './pages/AdminUsersPage'
import AgentsPage from './pages/AgentsPage'
import AgentDetailPage from './pages/AgentDetailPage'
import Can from './components/Can'
import PricingZonesPage from './pages/PricingZonesPage'
import ReportsPage from './pages/ReportsPage'
import VehicleTiersPage from './pages/VehicleTiersPage'
import VehicleCatalogPage from './pages/VehicleCatalogPage'
import AgentRewardsPage from './pages/AgentRewardsPage'
import SupportInboxPage from './pages/SupportInboxPage'
import SupportAgentPage from './pages/SupportAgentPage'
import DiscountCodesPage from './pages/DiscountCodesPage'
import DriverDiscountReimbursementsPage from './pages/DriverDiscountReimbursementsPage'

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

function PermissionRoute({ permission, children }) {
  const { loadingPermissions } = useAuth()
  if (loadingPermissions) {
    return <div className="rounded border border-slate-300 bg-white p-4 text-sm text-slate-600">Loading permissions...</div>
  }
  return (
    <Can permission={permission} fallback={<Navigate to="/dashboard/overview" replace />}>
      {children}
    </Can>
  )
}

function PublicOnlyRoute({ children }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Navigate to="/dashboard/overview" replace /> : children
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <AdminLoginPage />
          </PublicOnlyRoute>
        }
      />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route
          path="driver-verification"
          element={<PermissionRoute permission="verification.read"><DriverVerificationPage /></PermissionRoute>}
        />
        <Route
          path="driver-verification/:driverId"
          element={<PermissionRoute permission="verification.read"><DriverVerificationDetailPage /></PermissionRoute>}
        />
        <Route
          path="ride-operations"
          element={<PermissionRoute permission="ride_ops.read"><RideOperationsPage /></PermissionRoute>}
        />
        <Route
          path="ride-operations/:rideId"
          element={<PermissionRoute permission="ride_ops.read"><RideOperationDetailPage /></PermissionRoute>}
        />
        <Route
          path="panic-alerts"
          element={<PermissionRoute permission="ride_ops.read"><PanicAlertsPage /></PermissionRoute>}
        />
        <Route
          path="lost-items"
          element={<PermissionRoute permission="ride_ops.read"><LostItemsPage /></PermissionRoute>}
        />
        <Route
          path="live-map"
          element={<PermissionRoute permission="live_map.read"><LiveMapPage /></PermissionRoute>}
        />
        <Route
          path="drivers"
          element={<PermissionRoute permission="drivers.read"><DriversPage /></PermissionRoute>}
        />
        <Route
          path="drivers/:driverId"
          element={<PermissionRoute permission="drivers.read"><DriverDetailsPage /></PermissionRoute>}
        />
        <Route
          path="passengers"
          element={<PermissionRoute permission="passengers.read"><PassengersPage /></PermissionRoute>}
        />
        <Route
          path="agents"
          element={<PermissionRoute permission="agents.read"><AgentsPage /></PermissionRoute>}
        />
        <Route
          path="agents/:agentId"
          element={<PermissionRoute permission="agents.read"><AgentDetailPage /></PermissionRoute>}
        />
        <Route
          path="passengers/:passengerId"
          element={<PermissionRoute permission="passengers.read"><PassengerDetailsPage /></PermissionRoute>}
        />
        <Route
          path="admin-users"
          element={<PermissionRoute permission="admin.users.read"><AdminUsersPage /></PermissionRoute>}
        />
        <Route
          path="pricing-zones"
          element={<PermissionRoute permission="pricing.read"><PricingZonesPage /></PermissionRoute>}
        />
        <Route
          path="vehicle-catalog"
          element={<PermissionRoute permission="pricing.read"><VehicleCatalogPage /></PermissionRoute>}
        />
        <Route
          path="vehicle-tiers"
          element={<PermissionRoute permission="pricing.read"><VehicleTiersPage /></PermissionRoute>}
        />
        <Route
          path="agent-rewards"
          element={<PermissionRoute permission="payouts.read"><AgentRewardsPage /></PermissionRoute>}
        />
        <Route
          path="driver-payouts"
          element={<PermissionRoute permission="payouts.read"><DriverDiscountReimbursementsPage /></PermissionRoute>}
        />
        <Route
          path="promotions"
          element={<PermissionRoute permission="pricing.read"><DiscountCodesPage /></PermissionRoute>}
        />
        <Route
          path="reports"
          element={<PermissionRoute permission="reports.read"><ReportsPage /></PermissionRoute>}
        />
        <Route
          path="support"
          element={<PermissionRoute permission="support.read"><SupportInboxPage /></PermissionRoute>}
        />
        <Route
          path="support-agent"
          element={<PermissionRoute permission="support.read"><SupportAgentPage /></PermissionRoute>}
        />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
