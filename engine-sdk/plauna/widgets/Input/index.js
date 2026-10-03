// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Input Widgets Category
// User input and data entry widgets

import { Search } from './Search.js';
import { Input } from './Input.js';
import { Button } from './Button.js';
import { Color } from './Color.js';
import { Date } from './Date.js';
import { File } from './File.js';
import { Number } from './Number.js';
import { Range } from './Range.js';
import { Tag } from './Tag.js';
import { Time } from './Time.js';
import { Upload } from './Upload.js';

export const inputWidgets = [
    Search, Input, Button, Color, Date, File, Number, Range, Tag, Time, Upload
];

export const inputWidgetRegistry = new Map();
for (const widget of inputWidgets) {
    inputWidgetRegistry.set(widget.id, widget);
}

export function getInputWidget(id) {
    return inputWidgetRegistry.get(id);
}

export function getAllInputWidgets() {
    return inputWidgets;
}

export default {
    widgets: inputWidgets,
    registry: inputWidgetRegistry,
    getWidget: getInputWidget,
    getAllWidgets: getAllInputWidgets
};
