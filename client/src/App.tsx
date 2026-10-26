import { lazy, Suspense } from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import { NetworkStatus } from './components/ui/NetworkStatus';
import { GuestLayout } from './layouts/GuestLayout';
import { PickupLayout } from './layouts/PickupLayout';
import { ReservationLayout } from './layouts/ReservationLayout';
import { StaffLayout } from './layouts/StaffLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { RequireAuth } from './features/auth/RequireAuth';
import { getPortalMode, portalHome } from './lib/portals';
import { useGuestTheme } from './features/guest/useGuestTheme';

const JoinPage = lazy(() =>
  import('./features/guest/JoinPage').then((module) => ({ default: module.JoinPage })),
);
const TableDisplayPage = lazy(() =>
  import('./features/guest/TableDisplayPage').then((module) => ({
    default: module.TableDisplayPage,
  })),
);
const MenuPage = lazy(() =>
  import('./features/guest/MenuPage').then((module) => ({ default: module.MenuPage })),
);
const MemberPage = lazy(() =>
  import('./features/guest/MemberPage').then((m) => ({ default: m.MemberPage })),
);
const PickupPage = lazy(() =>
  import('./features/pickup/PickupPage').then((m) => ({ default: m.PickupPage })),
);
const ReservationsPage = lazy(() =>
  import('./features/reservations/ReservationsPage').then((m) => ({ default: m.ReservationsPage })),
);
const AdminVouchers = lazy(() =>
  import('./features/admin/Vouchers').then((m) => ({ default: m.AdminVouchers })),
);
const AdminMembers = lazy(() =>
  import('./features/admin/Members').then((m) => ({ default: m.AdminMembers })),
);
const CartPage = lazy(() =>
  import('./features/guest/CartPage').then((module) => ({ default: module.CartPage })),
);
const GiftsPage = lazy(() =>
  import('./features/gifts/GiftsPage').then((m) => ({ default: m.GiftsPage })),
);
const GamePage = lazy(() =>
  import('./features/game/GamePage').then((m) => ({ default: m.GamePage })),
);
const FreestyleAdmin = lazy(() =>
  import('./features/freestyle/FreestyleAdmin').then((m) => ({ default: m.FreestyleAdmin })),
);
const SmartInsights = lazy(() =>
  import('./features/insights/SmartInsights').then((m) => ({ default: m.SmartInsights })),
);
const CupPrintPage = lazy(() =>
  import('./features/cupPhotos/CupPrintPage').then((m) => ({ default: m.CupPrintPage })),
);
const JukeboxPage = lazy(() =>
  import('./features/jukebox/JukeboxPage').then((m) => ({ default: m.JukeboxPage })),
);
const JukeboxPlayer = lazy(() =>
  import('./features/jukebox/JukeboxPlayer').then((m) => ({ default: m.JukeboxPlayer })),
);
const OrdersPage = lazy(() =>
  import('./features/guest/OrdersPage').then((module) => ({ default: module.OrdersPage })),
);
const ReceiptPage = lazy(() =>
  import('./features/guest/ReceiptPage').then((module) => ({ default: module.ReceiptPage })),
);
const AIPage = lazy(() =>
  import('./features/ai/AISheet').then((module) => ({ default: module.AIPage })),
);
const StaffKDS = lazy(() =>
  import('./features/staff/KDS').then((module) => ({ default: module.StaffKDS })),
);
const Workforce = lazy(() =>
  import('./features/staff/Workforce').then((m) => ({ default: m.Workforce })),
);
const StaffTables = lazy(() =>
  import('./features/staff/Tables').then((module) => ({ default: module.StaffTables })),
);
const StaffServiceRequests = lazy(() =>
  import('./features/staff/ServiceRequests').then((module) => ({
    default: module.StaffServiceRequests,
  })),
);
const StaffAvailability = lazy(() =>
  import('./features/staff/Availability').then((module) => ({ default: module.StaffAvailability })),
);
const StaffCashShift = lazy(() =>
  import('./features/staff/CashShift').then((module) => ({ default: module.StaffCashShift })),
);
const PaymentAccounting = lazy(() =>
  import('./features/staff/PaymentAccounting').then((module) => ({
    default: module.PaymentAccounting,
  })),
);
const AdminDashboard = lazy(() =>
  import('./features/admin/Dashboard').then((module) => ({ default: module.AdminDashboard })),
);
const AdminProducts = lazy(() =>
  import('./features/admin/Products').then((module) => ({ default: module.AdminProducts })),
);
const AdminInventory = lazy(() =>
  import('./features/admin/Inventory').then((module) => ({ default: module.AdminInventory })),
);
const AdminCategories = lazy(() =>
  import('./features/admin/Categories').then((module) => ({ default: module.AdminCategories })),
);
const AdminToppings = lazy(() =>
  import('./features/admin/Toppings').then((module) => ({ default: module.AdminToppings })),
);
const AdminTables = lazy(() =>
  import('./features/admin/Tables').then((module) => ({ default: module.AdminTables })),
);
const AdminUsers = lazy(() =>
  import('./features/admin/Users').then((module) => ({ default: module.AdminUsers })),
);
const AdminReviews = lazy(() =>
  import('./features/admin/Reviews').then((module) => ({ default: module.AdminReviews })),
);
const AdminOperations = lazy(() =>
  import('./features/admin/Operations').then((module) => ({ default: module.AdminOperations })),
);
const AdminBills = lazy(() =>
  import('./features/admin/Bills').then((module) => ({ default: module.AdminBills })),
);
const LoginPage = lazy(() =>
  import('./features/auth/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const AccountPage = lazy(() =>
  import('./features/auth/AccountPage').then((module) => ({ default: module.AccountPage })),
);

export function App(): JSX.Element {
  const portal = getPortalMode();
  const guestEnabled = portal === 'unified' || portal === 'guest';
  const staffEnabled = portal === 'unified' || portal === 'staff';
  const adminEnabled = portal === 'unified' || portal === 'admin';
  const { pathname } = useLocation();
  const internalPath = /^\/(staff|admin|auth)(\/|$)/.test(pathname);
  useGuestTheme(guestEnabled && !internalPath);

  return (
    <ToastProvider>
      <NetworkStatus />
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Navigate to={portalHome(portal)} replace />} />
          {guestEnabled ? (
            <>
              <Route path="/display" element={<TableDisplayPage />} />
              <Route path="/t" element={<JoinPage />} />
              <Route path="/t/:token" element={<JoinPage />} />
              <Route element={<GuestLayout />}>
                <Route path="/menu" element={<MenuPage />} />
                <Route path="/member" element={<MemberPage />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/gifts" element={<GiftsPage />} />
                <Route path="/game" element={<GamePage />} />
                <Route path="/jukebox" element={<JukeboxPage />} />
                <Route path="/receipt" element={<ReceiptPage />} />
                <Route path="/ai" element={<AIPage />} />
              </Route>
              <Route element={<PickupLayout />}>
                <Route path="/pickup" element={<PickupPage view="order" />} />
                <Route path="/pickup/orders" element={<PickupPage view="orders" />} />
                <Route path="/pickup/member" element={<MemberPage />} />
              </Route>
              <Route element={<ReservationLayout />}>
                <Route path="/reservations" element={<ReservationsPage />} />
                <Route path="/reservations/mine" element={<ReservationsPage mine />} />
                <Route path="/reservations/member" element={<MemberPage />} />
              </Route>
            </>
          ) : null}

          {staffEnabled || adminEnabled ? (
            <Route path="/auth/login" element={<LoginPage />} />
          ) : null}
          {staffEnabled ? (
            <Route element={<RequireAuth roles={['STAFF', 'ADMIN']} />}>
              <Route element={<StaffLayout />}>
                <Route path="/staff" element={<Navigate to="/staff/kds" replace />} />
                <Route path="/staff/kds" element={<StaffKDS />} />
                <Route path="/staff/cup-prints" element={<CupPrintPage />} />
                <Route path="/staff/jukebox" element={<JukeboxPlayer />} />
                <Route path="/staff/tables" element={<StaffTables />} />
                <Route path="/staff/service-requests" element={<StaffServiceRequests />} />
                <Route path="/staff/availability" element={<StaffAvailability />} />
                <Route path="/staff/cash-shift" element={<StaffCashShift />} />
                <Route path="/staff/payments" element={<PaymentAccounting />} />
                <Route path="/staff/account" element={<AccountPage />} />
                <Route path="/staff/workforce" element={<Workforce />} />
                <Route path="/staff/pickups" element={<PickupPage staff />} />
                <Route path="/staff/reservations" element={<ReservationsPage staff />} />
              </Route>
            </Route>
          ) : null}

          {adminEnabled ? (
            <Route element={<RequireAuth roles={['ADMIN']} />}>
              <Route element={<AdminLayout />}>
                <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                <Route path="/admin/freestyle" element={<FreestyleAdmin />} />
                <Route path="/admin/insights" element={<SmartInsights />} />
                <Route path="/admin/cup-prints" element={<CupPrintPage admin />} />
                <Route path="/admin/jukebox" element={<JukeboxPlayer admin />} />
                <Route path="/admin/operations" element={<AdminOperations />} />
                <Route path="/admin/bills" element={<AdminBills />} />
                <Route path="/admin/payments" element={<PaymentAccounting admin />} />
                <Route path="/admin/products" element={<AdminProducts />} />
                <Route path="/admin/inventory" element={<AdminInventory />} />
                <Route path="/admin/vouchers" element={<AdminVouchers />} />
                <Route path="/admin/members" element={<AdminMembers />} />
                <Route path="/admin/categories" element={<AdminCategories />} />
                <Route path="/admin/toppings" element={<AdminToppings />} />
                <Route path="/admin/tables" element={<AdminTables />} />
                <Route path="/admin/users" element={<AdminUsers />} />
                <Route path="/admin/workforce" element={<Workforce admin />} />
                <Route path="/admin/pickups" element={<PickupPage staff admin />} />
                <Route path="/admin/reservations" element={<ReservationsPage staff admin />} />
                <Route path="/admin/account" element={<AccountPage />} />
                <Route path="/admin/reviews" element={<AdminReviews />} />
              </Route>
            </Route>
          ) : null}

          <Route path="*" element={<Navigate to={portalHome(portal)} replace />} />
        </Routes>
      </Suspense>
    </ToastProvider>
  );
}

function PageLoading(): JSX.Element {
  return (
    <div
      className="min-h-screen grid place-items-center bg-background"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm text-muted-foreground">Đang tải trang…</p>
    </div>
  );
}
