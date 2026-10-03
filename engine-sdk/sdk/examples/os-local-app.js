// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** A local window app mounted by the normal OS app lifecycle. */
export default class SDKLocalApp {
    constructor({ root }) {
        this.root = root;
        this.count = 0;
        this.onIncrement = () => {
            this.count += 1;
            this.output.textContent = String(this.count);
        };
    }

    async mount() {
        this.root.dataset.sdkLocalApp = 'mounted';
        const heading = document.createElement('h2');
        heading.textContent = 'SDK local app';
        const description = document.createElement('p');
        description.textContent = 'This app requests no permissions. The OS owns its window and lifetime.';
        this.button = document.createElement('button');
        this.button.textContent = 'Increment local counter';
        this.button.dataset.sdkCounter = 'increment';
        this.output = document.createElement('output');
        this.output.textContent = '0';
        this.output.dataset.sdkCounterValue = '';
        this.button.addEventListener('click', this.onIncrement);
        this.root.append(heading, description, this.button, this.output);
    }

    async unmount() {
        this.button?.removeEventListener('click', this.onIncrement);
        this.root.replaceChildren();
        delete this.root.dataset.sdkLocalApp;
    }
}
