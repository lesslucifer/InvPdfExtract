import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { setQueryHookContext } from './lib/queryHook';
import { SearchOverlay } from './components/SearchOverlay';
import { useInitSubscriptions } from './stores';

setQueryHookContext({ queryClient });

export const App: React.FC = () => {
  useInitSubscriptions();
  return (
    <QueryClientProvider client={queryClient}>
      <SearchOverlay />
    </QueryClientProvider>
  );
};
