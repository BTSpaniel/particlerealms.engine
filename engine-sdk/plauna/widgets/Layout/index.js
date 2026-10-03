// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Layout Widgets Category
// Layout and container widgets

import { Panel } from './Panel.js';
import { Grid } from './Grid.js';
import { Container } from './Container.js';
import { Divider } from './Divider.js';
import { Collapse } from './Collapse.js';
import { HeaderFooter } from './HeaderFooter.js';
import { Section } from './Section.js';
import { Spacer } from './Spacer.js';

export const layoutWidgets = [
    Panel, Grid, Container, Divider, Collapse, HeaderFooter, Section, Spacer
];

export const layoutWidgetRegistry = new Map();
for (const widget of layoutWidgets) {
    layoutWidgetRegistry.set(widget.id, widget);
}

export function getLayoutWidget(id) {
    return layoutWidgetRegistry.get(id);
}

export function getAllLayoutWidgets() {
    return layoutWidgets;
}

export default {
    widgets: layoutWidgets,
    registry: layoutWidgetRegistry,
    getWidget: getLayoutWidget,
    getAllWidgets: getAllLayoutWidgets
};
