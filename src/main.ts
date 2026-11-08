import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import './mc-controls.css';
import { initializeAnalytics } from './lib/analytics';

const target = document.getElementById('app')!;
// Replace the crawlable loading introduction once the interactive shell is available.
target.replaceChildren();
mount(App, { target });
initializeAnalytics();
