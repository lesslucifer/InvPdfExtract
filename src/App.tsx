import React from 'react';
import { SearchOverlay } from './components/SearchOverlay';
import { useInitSubscriptions } from './stores';

export const App: React.FC = () => {
  useInitSubscriptions();
  return <SearchOverlay />;
};
