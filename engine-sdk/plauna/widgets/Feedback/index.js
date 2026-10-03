// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Feedback Widgets Category
// User feedback and notification widgets

import { Alert } from './Alert.js';
import { Toast } from './Toast.js';
import { Spinner } from './Spinner.js';
import { Status } from './Status.js';
import { EmptyState } from './EmptyState.js';

export const feedbackWidgets = [
    Alert, Toast, Spinner, Status, EmptyState
];

export const feedbackWidgetRegistry = new Map();
for (const widget of feedbackWidgets) {
    feedbackWidgetRegistry.set(widget.id, widget);
}

export function getFeedbackWidget(id) {
    return feedbackWidgetRegistry.get(id);
}

export function getAllFeedbackWidgets() {
    return feedbackWidgets;
}

export default {
    widgets: feedbackWidgets,
    registry: feedbackWidgetRegistry,
    getWidget: getFeedbackWidget,
    getAllWidgets: getAllFeedbackWidgets
};
