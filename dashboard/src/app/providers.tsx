'use client';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { ThemeProvider } from '@/components/theme';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { AppStateProvider } from '@/lib/state';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AppStateProvider>
            <Shell>{children}</Shell>
          </AppStateProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
