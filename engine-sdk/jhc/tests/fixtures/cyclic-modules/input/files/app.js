import { a } from './a.js';
import { b } from './b.js';

const out = document.getElementById('out');
if (out) {
  out.textContent = `${a()}, ${b()}`;
}
