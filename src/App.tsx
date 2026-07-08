import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { AppRoot } from '@telegram-apps/telegram-ui';
import {
  backButton,
  miniApp,
  swipeBehavior,
  useLaunchParams,
  useRawInitData,
  useSignal,
} from '@tma.js/sdk-react';

import { useFinanceStore } from '@/store';
import { setServerAuth, setWebAuth } from '@/lib/storage';
import { resolveDark, useThemePref } from '@/lib/theme';
import { syncReminders } from '@/lib/reminders';
import { closeTopOverlay } from '@/lib/escape-stack';
import { tapLight } from '@/lib/haptics';

import { HomePage } from '@/pages/HomePage';
import { CropProvider } from '@/components/CropProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SyncIndicator } from '@/components/SyncIndicator';
import { ToastHost } from '@/components/Toast';

// Per-section route chunks — keep the initial bundle small; pages load on demand.
const SearchPage = lazy(() =>
  import('@/pages/SearchPage').then((m) => ({ default: m.SearchPage })),
);
const ClothingDashboardPage = lazy(() =>
  import('@/pages/clothing/ClothingDashboardPage').then((m) => ({
    default: m.ClothingDashboardPage,
  })),
);
const ComposePage = lazy(() =>
  import('@/pages/clothing/ComposePage').then((m) => ({ default: m.ComposePage })),
);
const ComparePage = lazy(() =>
  import('@/pages/clothing/ComparePage').then((m) => ({ default: m.ComparePage })),
);
const WardrobePage = lazy(() =>
  import('@/pages/clothing/WardrobePage').then((m) => ({ default: m.WardrobePage })),
);
const WardrobeItemFormPage = lazy(() =>
  import('@/pages/clothing/WardrobeItemFormPage').then((m) => ({
    default: m.WardrobeItemFormPage,
  })),
);
const WardrobeItemDetailPage = lazy(() =>
  import('@/pages/clothing/WardrobeItemDetailPage').then((m) => ({
    default: m.WardrobeItemDetailPage,
  })),
);
const OutfitsPage = lazy(() =>
  import('@/pages/clothing/OutfitsPage').then((m) => ({ default: m.OutfitsPage })),
);
const LookbookPage = lazy(() =>
  import('@/pages/clothing/LookbookPage').then((m) => ({ default: m.LookbookPage })),
);
const OutfitFormPage = lazy(() =>
  import('@/pages/clothing/OutfitFormPage').then((m) => ({ default: m.OutfitFormPage })),
);
const OutfitDetailPage = lazy(() =>
  import('@/pages/clothing/OutfitDetailPage').then((m) => ({ default: m.OutfitDetailPage })),
);
const OutfitBuilderPage = lazy(() =>
  import('@/pages/clothing/OutfitBuilderPage').then((m) => ({ default: m.OutfitBuilderPage })),
);
const CollectionsPage = lazy(() =>
  import('@/pages/clothing/CollectionsPage').then((m) => ({ default: m.CollectionsPage })),
);
const CollectionFormPage = lazy(() =>
  import('@/pages/clothing/CollectionFormPage').then((m) => ({ default: m.CollectionFormPage })),
);
const CollectionDetailPage = lazy(() =>
  import('@/pages/clothing/CollectionDetailPage').then((m) => ({
    default: m.CollectionDetailPage,
  })),
);
const InspirationPage = lazy(() =>
  import('@/pages/clothing/InspirationPage').then((m) => ({ default: m.InspirationPage })),
);
const SizesPage = lazy(() =>
  import('@/pages/clothing/SizesPage').then((m) => ({ default: m.SizesPage })),
);
const WishlistPage = lazy(() =>
  import('@/pages/clothing/WishlistPage').then((m) => ({ default: m.WishlistPage })),
);
const WishFormPage = lazy(() =>
  import('@/pages/clothing/WishFormPage').then((m) => ({ default: m.WishFormPage })),
);
const CalculatorPage = lazy(() =>
  import('@/pages/CalculatorPage').then((m) => ({ default: m.CalculatorPage })),
);
const CameraPage = lazy(() =>
  import('@/pages/CameraPage').then((m) => ({ default: m.CameraPage })),
);
const FormulasPage = lazy(() =>
  import('@/pages/FormulasPage').then((m) => ({ default: m.FormulasPage })),
);
const FormulaDetailPage = lazy(() =>
  import('@/pages/FormulaDetailPage').then((m) => ({ default: m.FormulaDetailPage })),
);
const ChatNotePage = lazy(() =>
  import('@/pages/ChatNotePage').then((m) => ({ default: m.ChatNotePage })),
);
const NotesGraphPage = lazy(() =>
  import('@/pages/NotesGraphPage').then((m) => ({ default: m.NotesGraphPage })),
);
const NotesPage = lazy(() => import('@/pages/NotesPage').then((m) => ({ default: m.NotesPage })));
const NoteListsPage = lazy(() =>
  import('@/pages/NoteListsPage').then((m) => ({ default: m.NoteListsPage })),
);
const NoteListDetailPage = lazy(() =>
  import('@/pages/NoteListDetailPage').then((m) => ({ default: m.NoteListDetailPage })),
);
const ChatTagPage = lazy(() =>
  import('@/pages/ChatTagPage').then((m) => ({ default: m.ChatTagPage })),
);
const PeopleDashboardPage = lazy(() =>
  import('@/pages/people/PeopleDashboardPage').then((m) => ({ default: m.PeopleDashboardPage })),
);
const PersonDetailPage = lazy(() =>
  import('@/pages/people/PersonDetailPage').then((m) => ({ default: m.PersonDetailPage })),
);
const PersonFormPage = lazy(() =>
  import('@/pages/people/PersonFormPage').then((m) => ({ default: m.PersonFormPage })),
);
const FinanceDashboardPage = lazy(() =>
  import('@/pages/finance/FinanceDashboardPage').then((m) => ({ default: m.FinanceDashboardPage })),
);
const ExpensesListPage = lazy(() =>
  import('@/pages/finance/ExpensesListPage').then((m) => ({ default: m.ExpensesListPage })),
);
const ExpenseFormPage = lazy(() =>
  import('@/pages/finance/ExpenseFormPage').then((m) => ({ default: m.ExpenseFormPage })),
);
const ExpenseDetailPage = lazy(() =>
  import('@/pages/finance/ExpenseDetailPage').then((m) => ({ default: m.ExpenseDetailPage })),
);
const SavingsListPage = lazy(() =>
  import('@/pages/finance/SavingsListPage').then((m) => ({ default: m.SavingsListPage })),
);
const SavingsFormPage = lazy(() =>
  import('@/pages/finance/SavingsFormPage').then((m) => ({ default: m.SavingsFormPage })),
);
const SavingsDetailPage = lazy(() =>
  import('@/pages/finance/SavingsDetailPage').then((m) => ({ default: m.SavingsDetailPage })),
);
const RecurringFormPage = lazy(() =>
  import('@/pages/finance/RecurringFormPage').then((m) => ({ default: m.RecurringFormPage })),
);
const RecurringDetailPage = lazy(() =>
  import('@/pages/finance/RecurringDetailPage').then((m) => ({ default: m.RecurringDetailPage })),
);
const ListsPage = lazy(() =>
  import('@/pages/finance/ListsPage').then((m) => ({ default: m.ListsPage })),
);
const ListFormPage = lazy(() =>
  import('@/pages/finance/ListFormPage').then((m) => ({ default: m.ListFormPage })),
);
const ListDetailPage = lazy(() =>
  import('@/pages/finance/ListDetailPage').then((m) => ({ default: m.ListDetailPage })),
);
const TransactionsPage = lazy(() =>
  import('@/pages/finance/TransactionsPage').then((m) => ({ default: m.TransactionsPage })),
);
const TransactionFormPage = lazy(() =>
  import('@/pages/finance/TransactionFormPage').then((m) => ({ default: m.TransactionFormPage })),
);
const IncomeListPage = lazy(() =>
  import('@/pages/finance/IncomeListPage').then((m) => ({ default: m.IncomeListPage })),
);
const IncomeFormPage = lazy(() =>
  import('@/pages/finance/IncomeFormPage').then((m) => ({ default: m.IncomeFormPage })),
);
const IncomeDetailPage = lazy(() =>
  import('@/pages/finance/IncomeDetailPage').then((m) => ({ default: m.IncomeDetailPage })),
);
const WorkCalendarPage = lazy(() =>
  import('@/pages/finance/WorkCalendarPage').then((m) => ({ default: m.WorkCalendarPage })),
);
const PayslipPage = lazy(() =>
  import('@/pages/finance/PayslipPage').then((m) => ({ default: m.PayslipPage })),
);
const FinanceAnalyticsPage = lazy(() =>
  import('@/pages/finance/FinanceAnalyticsPage').then((m) => ({ default: m.FinanceAnalyticsPage })),
);
const PaymentsCalendarPage = lazy(() =>
  import('@/pages/finance/PaymentsCalendarPage').then((m) => ({ default: m.PaymentsCalendarPage })),
);
const NotificationSettingsPage = lazy(() =>
  import('@/pages/finance/NotificationSettingsPage').then((m) => ({
    default: m.NotificationSettingsPage,
  })),
);

// Warm the heaviest / most-visited section chunks during idle time, right after
// the home screen is interactive — so the first open of a section (e.g. the
// graph) is instant instead of waiting on a network fetch + parse. Same module
// specifiers as the lazy() defs above → the module/browser cache is shared, so
// this never double-downloads.
let sectionsPrefetched = false;
function prefetchSections() {
  if (sectionsPrefetched) return;
  sectionsPrefetched = true;
  const warm = (load: () => Promise<unknown>) => void load().catch(() => {});
  warm(() => import('@/pages/NotesPage'));
  warm(() => import('@/pages/ChatNotePage'));
  warm(() => import('@/pages/NotesGraphPage'));
  warm(() => import('@/pages/finance/FinanceDashboardPage'));
  warm(() => import('@/pages/people/PeopleDashboardPage'));
  warm(() => import('@/pages/clothing/ClothingDashboardPage'));
  warm(() => import('@/pages/CalculatorPage'));
}

/** App-wide keyboard support (desktop Telegram / browser):
 *  Esc — blur the focused field → close the topmost sheet → go back;
 *  Enter/Space — activate focused role="button" elements (so Tab works everywhere). */
function KeyboardController() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
          el.blur();
          return;
        }
        if (closeTopOverlay()) return;
        if (pathRef.current !== '/') {
          e.preventDefault();
          navigate(-1);
        }
        return;
      }
      // Make div-based "buttons" (cards, tiles) work from the keyboard.
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        const t = e.target as HTMLElement | null;
        if (
          t &&
          t.getAttribute?.('role') === 'button' &&
          !['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
        ) {
          e.preventDefault();
          t.click();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return null;
}

/**
 * Per-section error boundary: a crash in one section shows its fallback while
 * the Telegram BackButton (mounted outside) still navigates away; changing the
 * section remounts a clean boundary via the key.
 */
function SectionBoundary() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname.split('/')[1] || 'home'}>
      <Outlet />
    </ErrorBoundary>
  );
}

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
        // An open sheet/menu/lightbox closes first — only then navigate back.
        // Without this the back press pops history invisibly UNDER the overlay.
        if (closeTopOverlay()) return;
        navigate(-1);
      });
    } catch {
      return undefined;
    }
  }, [navigate]);

  return null;
}

/** Desktop: the mouse wheel scrolls horizontal rows (chips, carousels) the
 *  cursor is over — they have no other way to scroll without touch. */
function WheelScrollController() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0 || !e.deltaY) return; // trackpads scroll natively
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 2) {
          const style = getComputedStyle(el);
          if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
            const canScroll =
              e.deltaY > 0
                ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1
                : el.scrollLeft > 0;
            if (canScroll) {
              el.scrollLeft += e.deltaY;
              e.preventDefault();
            }
            return;
          }
        }
        el = el.parentElement;
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  return null;
}

/** iOS-style edge swipe (from the left edge to the right) navigates back. */
function SwipeBackController() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let active = false;
    let fired = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      // Only react to gestures that begin at the very left edge — everything
      // else belongs to in-app swipes (calendar, swipe-to-delete, graph pan).
      active = t.clientX <= 28 && pathRef.current !== '/';
      fired = false;
      startX = t.clientX;
      startY = t.clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (!active || fired) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx > 64 && dy < 50 && dx > dy * 1.6) {
        fired = true;
        active = false;
        tapLight();
        if (!closeTopOverlay()) navigate(-1);
      }
    };
    const onEnd = () => {
      active = false;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [navigate]);

  return null;
}

interface AppShellProps {
  platform: 'ios' | 'base';
  isDark: boolean;
  webMode: boolean;
  rawInitData?: string;
}

function AppShell({ platform, isDark, webMode, rawInitData }: AppShellProps) {
  const hydrate = useFinanceStore((s) => s.hydrate);
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

  // Prefetch section chunks once the browser is idle (after first paint), so the
  // first open of a section is snappy. Falls back to a timer on engines without
  // requestIdleCallback (older iOS WebKit).
  useEffect(() => {
    const ric = window.requestIdleCallback;
    if (ric) ric(prefetchSections, { timeout: 2500 });
    else window.setTimeout(prefetchSections, 1200);
  }, []);

  // Let app data persist on the server (must run before hydrate's first read).
  useEffect(() => {
    if (webMode) setWebAuth();
    else setServerAuth(rawInitData);
  }, [webMode, rawInitData]);

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
    <AppRoot appearance={isDark ? 'dark' : 'light'} platform={platform}>
      <HashRouter>
        <NavigationController />
        <SwipeBackController />
        <WheelScrollController />
        <KeyboardController />
        <CropProvider>
          <Suspense
            fallback={
              <div className="route-fallback" aria-hidden>
                <div className="route-spinner" />
              </div>
            }
          >
            <Routes>
              <Route element={<SectionBoundary />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/search" element={<SearchPage />} />
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
                <Route path="/finance/transactions" element={<TransactionsPage />} />
                <Route path="/finance/transactions/new" element={<TransactionFormPage />} />
                <Route path="/finance/transactions/:id/edit" element={<TransactionFormPage />} />
                <Route path="/finance/income" element={<IncomeListPage />} />
                <Route path="/finance/income/new" element={<IncomeFormPage />} />
                <Route path="/finance/income/:id" element={<IncomeDetailPage />} />
                <Route path="/finance/income/:id/edit" element={<IncomeFormPage />} />
                <Route path="/finance/income/:id/calendar" element={<WorkCalendarPage />} />
                <Route path="/finance/income/:id/payslip" element={<PayslipPage />} />
                <Route path="/finance/analytics" element={<FinanceAnalyticsPage />} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/notes/new" element={<ChatNotePage />} />
                <Route path="/notes/graph" element={<NotesGraphPage />} />
                <Route path="/notes/lists" element={<NoteListsPage />} />
                <Route path="/notes/lists/:listId" element={<NoteListDetailPage />} />
                <Route path="/notes/tag/:tag" element={<ChatTagPage />} />
                <Route path="/notes/:id" element={<ChatNotePage />} />
                <Route path="/people" element={<PeopleDashboardPage />} />
                <Route path="/people/new" element={<PersonFormPage />} />
                <Route path="/people/:id" element={<PersonDetailPage />} />
                <Route path="/people/:id/edit" element={<PersonFormPage />} />
                <Route path="/camera" element={<CameraPage />} />
                <Route path="/calculator" element={<CalculatorPage />} />
                <Route path="/calculator/formulas" element={<FormulasPage />} />
                <Route path="/calculator/formulas/:id" element={<FormulaDetailPage />} />
                <Route path="/clothing" element={<ClothingDashboardPage />} />
                <Route path="/clothing/lookbook" element={<LookbookPage />} />
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
              </Route>
            </Routes>
          </Suspense>
        </CropProvider>
        <ToastHost />
        <SyncIndicator />
      </HashRouter>
    </AppRoot>
  );
}

/** Telegram Mini App entry — identity & theme come from the Telegram SDK. */
export function App() {
  const lp = useLaunchParams();
  const systemDark = useSignal(miniApp.isDark);
  const pref = useThemePref();
  const rawInitData = useRawInitData();
  return (
    <AppShell
      platform={['macos', 'ios'].includes(lp.tgWebAppPlatform) ? 'ios' : 'base'}
      isDark={resolveDark(pref, systemDark)}
      webMode={false}
      rawInitData={rawInitData}
    />
  );
}

/** Website entry — opened in a normal browser after "Log in with Telegram".
 *  No Telegram SDK; identity rides on the session cookie, theme follows the OS. */
export function WebApp() {
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const pref = useThemePref();
  return <AppShell platform="base" isDark={resolveDark(pref, systemDark)} webMode />;
}
