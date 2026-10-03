import { greet } from './greet.js';

const out = document.getElementById('out');
if (out) {
  out.textContent = greet('basic-app');
}
