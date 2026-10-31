import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { initializeAnalytics } from './lib/analytics';

mount(App, { target: document.getElementById('app')! });
initializeAnalytics();
