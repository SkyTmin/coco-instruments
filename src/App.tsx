import { useEffect } from 'react';
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
import { syncReminders } from '@/lib/reminders';
import { tapLight } from '@/lib/haptics';

import { HomePage } from '@/pages/HomePage';
import { ClothingDashboardPage } from '@/pages/clothing/ClothingDashboardPage';
import { ShufflePage } from '@/pages/clothing/ShufflePage';
import { WardrobePage } from '@/pages/clothing/WardrobePage';
import { WardrobeItemFormPage } from '@/pages/clothing/WardrobeItemFormPage';
import { WardrobeItemDetailPage } from '@/pages/clothing/WardrobeItemDetailPage';
import { OutfitsPage } from '@/pages/clothing/OutfitsPage';
import { OutfitFormPage } from '@/pages/clothing/OutfitFormPage';
import { OutfitDetailPage } from '@/pages/clothing/OutfitDetailPage';
import { OutfitBuilderPage } from '@/pages/clothing/OutfitBuilderPage';
import { InsightsPage } from '@/pages/clothing/InsightsPage';
import { SizesPage } from '@/pages/clothing/SizesPage';
import { WishlistPage } from '@/pages/clothing/WishlistPage';
import { WishFormPage } from '@/pages/clothing/WishFormPage';
import { NoteEditorPage } from '@/pages/NoteEditorPage';
import { NotesGraphPage } from '@/pages/NotesGraphPage';
import { NotesPage } from '@/pages/NotesPage';
import { PeopleDashboardPage } from '@/pages/people/PeopleDashboardPage';
import { PersonDetailPage } from '@/pages/people/PersonDetailPage';
import { PersonFormPage } from '@/pages/people/PersonFormPage';
import { FinanceDashboardPage } from '@/pages/finance/FinanceDashboardPage';
import { ExpensesListPage } from '@/pages/finance/ExpensesListPage';
import { ExpenseFormPage } from '@/pages/finance/ExpenseFormPage';
import { ExpenseDetailPage } from '@/pages/finance/ExpenseDetailPage';
import { SavingsListPage } from '@/pages/finance/SavingsListPage';
import { SavingsFormPage } from '@/pages/finance/SavingsFormPage';
import { SavingsDetailPage } from '@/pages/finance/SavingsDetailPage';
import { RecurringFormPage } from '@/pages/finance/RecurringFormPage';
import { RecurringDetailPage } from '@/pages/finance/RecurringDetailPage';
import { ListsPage } from '@/pages/finance/ListsPage';
import { ListFormPage } from '@/pages/finance/ListFormPage';
import { ListDetailPage } from '@/pages/finance/ListDetailPage';
import { PaymentsCalendarPage } from '@/pages/finance/PaymentsCalendarPage';
import { NotificationSettingsPage } from '@/pages/finance/NotificationSettingsPage';

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
          <Route path="/clothing" element={<ClothingDashboardPage />} />
          <Route path="/clothing/shuffle" element={<ShufflePage />} />
          <Route path="/clothing/wardrobe" element={<WardrobePage />} />
          <Route path="/clothing/wardrobe/new" element={<WardrobeItemFormPage />} />
          <Route path="/clothing/wardrobe/:id" element={<WardrobeItemDetailPage />} />
          <Route path="/clothing/wardrobe/:id/edit" element={<WardrobeItemFormPage />} />
          <Route path="/clothing/outfits" element={<OutfitsPage />} />
          <Route path="/clothing/outfits/new" element={<OutfitFormPage />} />
          <Route path="/clothing/outfits/:id" element={<OutfitDetailPage />} />
          <Route path="/clothing/outfits/:id/edit" element={<OutfitFormPage />} />
          <Route path="/clothing/outfits/:id/build" element={<OutfitBuilderPage />} />
          <Route path="/clothing/insights" element={<InsightsPage />} />
          <Route path="/clothing/sizes" element={<SizesPage />} />
          <Route path="/clothing/wishlist" element={<WishlistPage />} />
          <Route path="/clothing/wishlist/new" element={<WishFormPage />} />
          <Route path="/clothing/wishlist/:id/edit" element={<WishFormPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AppRoot>
  );
}
