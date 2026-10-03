// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveModule } from '../resolver.js';
const { Button } = await resolveModule('plauna/widgets/Primitive/Button.js', ['Button']);
const { DOMRenderer } = await resolveModule('plauna/core/DOMRenderer.js', ['DOMRenderer']);
let defaults = 0, clicks = 0, callbacks = [], activations = [], keys = [];
let cancellation = null;
class ObservedButton extends Button {
    handleClick() { defaults++; super.handleClick(); }
}
const button = new ObservedButton('button-under-test', {text: 'Activate'});
button.setContent('');
button.textContent = 'Activate';
button.onClick = event => {
    callbacks.push(event);
    if (cancellation === 'callback') event.preventDefault();
};
button.addEventListener('button-click', event => {
    activations.push(event);
    if (cancellation === 'retained') event.preventDefault();
});
button.addEventListener('click', () => clicks++);
document.addEventListener('keydown', event => keys.push({key:event.key, prevented:event.defaultPrevented}));
const renderer = new DOMRenderer({container:document.querySelector('#root'), usePretext:false});
renderer.render({root:button});
globalThis.fixture = {
    button, renderer,
    reset(nextCancellation = null) {
        defaults = 0; clicks = 0; callbacks = []; activations = []; keys = [];
        cancellation = nextCancellation;
    },
    snapshot() {
        return { defaults, clicks, keys, callbackCount:callbacks.length, activationCount:activations.length,
            callbacks:callbacks.map(event => ({type:event.type, correctTarget:event.target === button,
                nativeMouse:event.originalEvent instanceof MouseEvent,
                nativePrevented:Boolean(event.originalEvent?.defaultPrevented),
                prevented:Boolean(event.defaultPrevented),
                sameActivation:activations.includes(event)})),
            activations:activations.map(event => ({type:event.type, correctTarget:event.target === button,
                nativeMouse:event.originalEvent instanceof MouseEvent,
                nativePrevented:Boolean(event.originalEvent?.defaultPrevented), prevented:event.defaultPrevented})) };
    },
    cleanup() {
        renderer.destroy(); renderer.destroy(); button.destroy(); button.destroy();
        return {domNodes:document.querySelector('#root').childElementCount,
            mappings:renderer.nodeToDOM.size + renderer.domToNode.size + renderer.renderedNodes.size,
            handlers:button.eventHandlers.size, children:button.children.length};
    }
};
