import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { type PropsWithChildren, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { createBillyQueryClient } from '@/lib/query-client';

function QueryFocusManager() {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = AppState.addEventListener('change', (status) => {
      focusManager.setFocused(status === 'active');
    });
    return () => subscription.remove();
  }, []);

  return null;
}

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(createBillyQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <QueryFocusManager />
      {children}
    </QueryClientProvider>
  );
}
