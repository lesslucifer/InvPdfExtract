import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// Windowlized windows fill the entire viewport — remove body padding
if (window.location.search.includes('windowlized=true')) {
  document.body.style.padding = '0';
}

const root = createRoot(document.getElementById('root')!);
root.render(createElement(App));
