// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Form Widgets Category
// Form elements and validation widgets

import { Checkbox } from './Checkbox.js';
import { Radio } from './Radio.js';
import { Switch } from './Switch.js';
import { Select } from './Select.js';
import { Textarea } from './Textarea.js';
import { Slider } from './Slider.js';
import { Rating } from './Rating.js';

export const formWidgets = [
    Checkbox, Radio, Switch, Select, Textarea, Slider, Rating
];

export const formWidgetRegistry = new Map();
for (const widget of formWidgets) {
    formWidgetRegistry.set(widget.id, widget);
}

export function getFormWidget(id) {
    return formWidgetRegistry.get(id);
}

export function getAllFormWidgets() {
    return formWidgets;
}

export default {
    widgets: formWidgets,
    registry: formWidgetRegistry,
    getWidget: getFormWidget,
    getAllWidgets: getAllFormWidgets
};
