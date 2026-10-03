function add(a, b) {
  return a + b;
}

const message = 'Token codec works';

export function init() {
  console.log(message, add(1, 2));
}
