// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Data Views Widgets Category
// Data display and visualization widgets

import { Table } from './Table.js';
import { List } from './List.js';
import { Tree } from './Tree.js';
import { ListView } from './ListView.js';
import { Card } from './Card.js';

export const dataviewsWidgets = [
    Table, List, Tree, ListView, Card
];

export const dataviewsWidgetRegistry = new Map();
for (const widget of dataviewsWidgets) {
    dataviewsWidgetRegistry.set(widget.id, widget);
}

export function getDataviewsWidget(id) {
    return dataviewsWidgetRegistry.get(id);
}

export function getAllDataviewsWidgets() {
    return dataviewsWidgets;
}

export default {
    widgets: dataviewsWidgets,
    registry: dataviewsWidgetRegistry,
    getWidget: getDataviewsWidget,
    getAllWidgets: getAllDataviewsWidgets
};
