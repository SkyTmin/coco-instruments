import { lazy, Suspense, useEffect } from 'react';
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { backButton, miniApp, swipeBehavior, useLaunchParams, useRawInitData, useSignal } from '@tma.js/sdk-react';

import { useFinanceStore } from '@/store';
import { setServerAuth } from '@/lib/storage';
import { syncReminders } from '@/lib/reminders';
import { tapLight } from '@/lib/haptics';

import { HomePage } from '@/pages/HomePage';
import { CropProvider } from '@/components/CropProvider';

// Per-section route chunks — keep the initial bundle small; pages load on demand.
const ClothingDashboardPage = lazy(() => import('@/pages/clothing/ClothingDashboardPage').then((m) => ({ default: m.ClothingDashboardPage })));
const ComposePage = lazy(() => import('@/pages/clothing/ComposePage').then((m) => ({ default: m.ComposePage })));
const ComparePage = lazy(() => import('@/pages/clothing/ComparePage').then((m) => ({ default: m.ComparePage })));
const WardrobePage = lazy(() => import('@/pages/clothing/WardrobePage').then((m) => ({ default: m.WardrobePage })));
const WardrobeItemFormPage = lazy(() => import('@/pages/clothing/WardrobeItemFormPage').then((m) => ({ default: m.WardrobeItemFormPage })));
const WardrobeItemDetailPage = lazy(() => import('@/pages/clothing/WardrobeItemDetailPage').then((m) => ({ default: m.WardrobeItemDetailPage })));
const OutfitsPage = lazy(() => import('@/pages/clothing/OutfitsPage').then((m) => ({ default: m.OutfitsPage })));
const OutfitFormPage = lazy(() => import('@/pages/clothing/OutfitFormPage').then((m) => ({ default: m.OutfitFormPage })));
const OutfitDetailPage = lazy(() => import('@/pages/clothing/OutfitDetailPage').then((m) => ({ default: m.OutfitDetailPage })));
const OutfitBuilderPage = lazy(() => import('@/pages/clothing/OutfitBuilderPage').then((m) => ({ default: m.OutfitBuilderPage })));
const CollectionsPage = lazy(() => import('@/pages/clothing/CollectionsPage').then((m) => ({ default: m.CollectionsPage })));
const CollectionFormPage = lazy(() => import('@/pages/clothing/CollectionFormPage').then((m) => ({ default: m.CollectionFormPage })));
const CollectionDetailPage = lazy(() => import('@/pages/clothing/CollectionDetailPage').then((m) => ({ default: m.CollectionDetailPage })));
const InspirationPage = lazy(() => import('@/pages/clothing/InspirationPage').then((m) => ({ default: m.InspirationPage })));
const SizesPage = lazy(() => import('@/pages/clothing/SizesPage').then((m) => ({ default: m.SizesPage })));
const WishlistPage = lazy(() => import('@/pages/clothing/WishlistPage').then((m) => ({ default: m.WishlistPage })));
const WishFormPage = lazy(() => import('@/pages/clothing/WishFormPage').then((m) => ({ default: m.WishFormPage })));
const CalculatorPage = lazy(() => import('@/pages/CalculatorPage').then((m) => ({ default: m.CalculatorPage })));
const FormulasPage = lazy(() => import('@/pages/FormulasPage').then((m) => ({ default: m.FormulasPage })));
const FormulaDetailPage = lazy(() => import('@/pages/FormulaDetailPage').then((m) => ({ default: m.FormulaDetailPage })));
const NoteEditorPage = lazy(() => import('@/pages/NoteEditorPage').then((m) => ({ default: m.NoteEditorPage })));
const NotesGraphPage = lazy(() => import('@/pages/NotesGraphPage').then((m) => ({ default: m.NotesGraphPage })));
const NotesPage = lazy(() => import('@/pages/NotesPage').then((m) => ({ default: m.NotesPage })));
const PeopleDashboardPage = lazy(() => import('@/pages/people/PeopleDashboardPage').then((m) => ({ default: m.PeopleDashboardPage })));
const PersonDetailPage = lazy(() => import('@/pages/people/PersonDetailPage').then((m) => ({ default: m.PersonDetailPage })));
const PersonFormPage = lazy(() => import('@/pages/people/PersonFormPage').then((m) => ({ default: m.PersonFormPage })));
const FinanceDashboardPage = lazy(() => import('@/pages/finance/FinanceDashboardPage').then((m) => ({ default: m.FinanceDashboardPage })));
const ExpensesListPage = lazy(() => import('@/pages/finance/ExpensesListPage').then((m) => ({ default: m.ExpensesListPage })));
const ExpenseFormPage = lazy(() => import('@/pages/finance/ExpenseFormPage').then((m) => ({ default: m.ExpenseFormPage })));
const ExpenseDetailPage = lazy(() => import('@/pages/finance/ExpenseDetailPage').then((m) => ({ default: m.ExpenseDetailPage })));
const SavingsListPage = lazy(() => import('@/pages/finance/SavingsListPage').then((m) => ({ default: m.SavingsListPage })));
const SavingsFormPage = lazy(() => import('@/pages/finance/SavingsFormPage').then((m) => ({ default: m.SavingsFormPage })));
const SavingsDetailPage = lazy(() => import('@/pages/finance/SavingsDetailPage').then((m) => ({ default: m.SavingsDetailPage })));
const RecurringFormPage = lazy(() => import('@/pages/finance/RecurringFormPage').then((m) => ({ default: m.RecurringFormPage })));
const RecurringDetailPage = lazy(() => import('@/pages/finance/RecurringDetailPage').then((m) => ({ default: m.RecurringDetailPage })));
const ListsPage = lazy(() => import('@/pages/finance/ListsPage').then((m) => ({ default: m.ListsPage })));
const ListFormPage = lazy(() => import('@/pages/finance/ListFormPage').then((m) => ({ default: m.ListFormPage })));
const ListDetailPage = lazy(() => import('@/pages/finance/ListDetailPage').then((m) => ({ default: m.ListDetailPage })));
const PaymentsCalendarPage = lazy(() => import('@/pages/finance/PaymentsCalendarPage').then((m) => ({ default: m.PaymentsCalendarPage })));
const NotificationSettingsPage = lazy(() => import('@/pages/finance/NotificationSettingsPage').then((m) => ({ default: m.NotificationSettingsPage })));

/** Drives the native Telegram BackButton from the router. */
function NavigationController() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      if (location.pathname === '/') backButton.hide();
      else backButton.show();
    } catch {
      /* back button not available (e.g. browser without mock) */
    }
  }, [location.pathname]);

  useEffect(() => {
    try {
      return backButton.onClick(() => {
        tapLight();
        navigate(-1);
      });
    } catch {
      return undefined;
    }
  }, [navigate]);

  return null;
}

export function App() {
  const lp = useLaunchParams();
  const isDark = useSignal(miniApp.isDark);
  const hydrate = useFinanceStore((s) => s.hydrate);
  const rawInitData = useRawInitData();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const expenses = useFinanceStore((s) => s.expenses);
  const recurring = useFinanceStore((s) => s.recurring);
  const reminderPrefs = useFinanceStore((s) => s.reminderPrefs);

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  }, [isDark]);

  // Stop Telegram minimizing the app when our horizontal swipes (calendar
  // paging, swipe-to-delete) carry a slight vertical component. Done in an
  // effect (after first paint) so it can never block rendering. Disables only
  // Telegram's native swipe-down gesture; in-app swipes + scroll are untouched.
  useEffect(() => {
    try {
      if (swipeBehavior.mount.isAvailable()) {
        swipeBehavior.mount();
        if (swipeBehavior.disableVertical.isAvailable()) swipeBehavior.disableVertical();
      }
    } catch {
      /* swipe behavior not supported on this client */
    }
  }, []);

  // Let app data persist on the server (must run before hydrate's first read).
  useEffect(() => {
    setServerAuth(rawInitData);
  }, [rawInitData]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Keep the server's reminder schedule in sync with the local data (debounced).
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      void syncReminders(rawInitData, reminderPrefs, expenses, recurring);
    }, 1200);
    return () => clearTimeout(t);
  }, [hydrated, rawInitData, reminderPrefs, expenses, recurring]);

  return (
    <AppRoot
      appearance={isDark ? 'dark' : 'light'}
      platform={['macos', 'ios'].includes(lp.tgWebAppPlatform) ? 'ios' : 'base'}
    >
      <HashRouter>
        <NavigationController />
        <CropProvider>
        <Suspense fallback={<div className="route-fallback" aria-hidden />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/finance" element={<FinanceDashboardPage />} />
          <Route path="/finance/calendar" element={<PaymentsCalendarPage />} />
          <Route path="/finance/settings" element={<NotificationSettingsPage />} />
          <Route path="/finance/expenses" element={<ExpensesListPage />} />
          <Route path="/finance/expenses/new" element={<ExpenseFormPage />} />
          <Route path="/finance/expenses/:id" element={<ExpenseDetailPage />} />
          <Route path="/finance/expenses/:id/edit" element={<ExpenseFormPage />} />
          <Route path="/finance/recurring/new" element={<RecurringFormPage />} />
          <Route path="/finance/recurring/:id" element={<RecurringDetailPage />} />
          <Route path="/finance/recurring/:id/edit" element={<RecurringFormPage />} />
          <Route path="/finance/lists" element={<ListsPage />} />
          <Route path="/finance/lists/new" element={<ListFormPage />} />
          <Route path="/finance/lists/:id" element={<ListDetailPage />} />
          <Route path="/finance/lists/:id/edit" element={<ListFormPage />} />
          <Route path="/finance/savings" element={<SavingsListPage />} />
          <Route path="/finance/savings/new" element={<SavingsFormPage />} />
          <Route path="/finance/savings/:id" element={<SavingsDetailPage />} />
          <Route path="/finance/savings/:id/edit" element={<SavingsFormPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/notes/new" element={<NoteEditorPage />} />
          <Route path="/notes/graph" element={<NotesGraphPage />} />
          <Route path="/notes/:id" element={<NoteEditorPage />} />
          <Route path="/people" element={<PeopleDashboardPage />} />
          <Route path="/people/new" element={<PersonFormPage />} />
          <Route path="/people/:id" element={<PersonDetailPage />} />
          <Route path="/people/:id/edit" element={<PersonFormPage />} />
          <Route path="/calculator" element={<CalculatorPage />} />
          <Route path="/calculator/formulas" element={<FormulasPage />} />
          <Route path="/calculator/formulas/:id" element={<FormulaDetailPage />} />
          <Route path="/clothing" element={<ClothingDashboardPage />} />
          <Route path="/clothing/compose" element={<ComposePage />} />
          <Route path="/clothing/compare" element={<ComparePage />} />
          <Route path="/clothing/wardrobe" element={<WardrobePage />} />
          <Route path="/clothing/wardrobe/new" element={<WardrobeItemFormPage />} />
          <Route path="/clothing/wardrobe/:id" element={<WardrobeItemDetailPage />} />
          <Route path="/clothing/wardrobe/:id/edit" element={<WardrobeItemFormPage />} />
          <Route path="/clothing/outfits" element={<OutfitsPage />} />
          <Route path="/clothing/outfits/new" element={<OutfitFormPage />} />
          <Route path="/clothing/outfits/:id" element={<OutfitDetailPage />} />
          <Route path="/clothing/outfits/:id/edit" element={<OutfitFormPage />} />
          <Route path="/clothing/outfits/:id/build" element={<OutfitBuilderPage />} />
          <Route path="/clothing/collections" element={<CollectionsPage />} />
          <Route path="/clothing/collections/new" element={<CollectionFormPage />} />
          <Route path="/clothing/collections/:id" element={<CollectionDetailPage />} />
          <Route path="/clothing/collections/:id/edit" element={<CollectionFormPage />} />
          <Route path="/clothing/inspiration" element={<InspirationPage />} />
          <Route path="/clothing/sizes" element={<SizesPage />} />
          <Route path="/clothing/wishlist" element={<WishlistPage />} />
          <Route path="/clothing/wishlist/new" element={<WishFormPage />} />
          <Route path="/clothing/wishlist/:id/edit" element={<WishFormPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </CropProvider>
      </HashRouter>
    </AppRoot>
  );
}
