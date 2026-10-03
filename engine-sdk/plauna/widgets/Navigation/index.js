// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Navigation Widgets Category
// Navigation and menu widgets

import { Menu } from './Menu.js';
import { Breadcrumb } from './Breadcrumb.js';
import { Pagination } from './Pagination.js';
import { Tabs } from './Tabs.js';
import { Navbar } from './Navbar.js';
import { Sidebar } from './Sidebar.js';
import { Dropdown } from './Dropdown.js';
import { Stepper } from './Stepper.js';

export const navigationWidgets = [
    Menu, Breadcrumb, Pagination, Tabs, Navbar, Sidebar, Dropdown, Stepper
];

export const navigationWidgetRegistry = new Map();
for (const widget of navigationWidgets) {
    navigationWidgetRegistry.set(widget.id, widget);
}

export function getNavigationWidget(id) {
    return navigationWidgetRegistry.get(id);
}

export function getAllNavigationWidgets() {
    return navigationWidgets;
}

export default {
    widgets: navigationWidgets,
    registry: navigationWidgetRegistry,
    getWidget: getNavigationWidget,
    getAllWidgets: getAllNavigationWidgets
};
