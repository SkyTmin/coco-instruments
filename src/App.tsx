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
import { backButton, miniApp, useLaunchParams, useSignal } from '@tma.js/sdk-react';

import { useFinanceStore } from '@/store';
import { tapLight } from '@/lib/haptics';

import { HomePage } from '@/pages/HomePage';
import { ClothingPage } from '@/pages/ClothingPage';
import { FinanceDashboardPage } from '@/pages/finance/FinanceDashboardPage';
import { ExpensesListPage } from '@/pages/finance/ExpensesListPage';
import { ExpenseFormPage } from '@/pages/finance/ExpenseFormPage';
import { ExpenseDetailPage } from '@/pages/finance/ExpenseDetailPage';
import { SavingsListPage } from '@/pages/finance/SavingsListPage';
import { SavingsFormPage } from '@/pages/finance/SavingsFormPage';
import { SavingsDetailPage } from '@/pages/finance/SavingsDetailPage';
import { RecurringFormPage } from '@/pages/finance/RecurringFormPage';
import { RecurringDetailPage } from '@/pages/finance/RecurringDetailPage';

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

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  }, [isDark]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
          <Route path="/finance/expenses" element={<ExpensesListPage />} />
          <Route path="/finance/expenses/new" element={<ExpenseFormPage />} />
          <Route path="/finance/expenses/:id" element={<ExpenseDetailPage />} />
          <Route path="/finance/expenses/:id/edit" element={<ExpenseFormPage />} />
          <Route path="/finance/recurring/new" element={<RecurringFormPage />} />
          <Route path="/finance/recurring/:id" element={<RecurringDetailPage />} />
          <Route path="/finance/recurring/:id/edit" element={<RecurringFormPage />} />
          <Route path="/finance/savings" element={<SavingsListPage />} />
          <Route path="/finance/savings/new" element={<SavingsFormPage />} />
          <Route path="/finance/savings/:id" element={<SavingsDetailPage />} />
          <Route path="/finance/savings/:id/edit" element={<SavingsFormPage />} />
          <Route path="/clothing" element={<ClothingPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AppRoot>
  );
}
