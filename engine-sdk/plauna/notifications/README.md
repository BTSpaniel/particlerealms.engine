# Plauna Notification System

A comprehensive notification system that separates user notifications from debug logging and provides a unified API for all Plauna components.

## Overview

The notification system consists of two main components:

1. **ToastManager** - Visual toast notifications for users
2. **NotificationSystem** - Centralized notification management with multiple output channels

## Features

### 🎯 Multiple Notification Types
- **Debug** - Development debugging information
- **Info** - General information messages  
- **Success** - Success confirmations
- **Warning** - Warning messages
- **Error** - Error notifications
- **Critical** - Critical system errors

### 📱 Multiple Output Channels
- **Toast Notifications** - Visual toasts for users
- **Console Logging** - Developer console output
- **Sound Effects** - Optional audio feedback
- **System Integration** - Framework event notifications

### 🎨 Customizable Options
- Positioning (top-left, top-right, bottom-left, bottom-right, center)
- Duration control
- Custom styling
- Sound effects
- Notification filtering

## Quick Start

### Basic Usage

```javascript
import { Notify } from 'plauna/notifications/NotificationSystem.js';

// Simple notifications
Notify.info('Application started');
Notify.success('File saved successfully');
Notify.warning('Low disk space');
Notify.error('Connection failed');

// With options
Notify.info('User logged in', {
    title: 'Authentication',
    duration: 5000,
    sound: true
});
```

### Specialized Notifications

```javascript
// System notifications
Notify.system('Hot reload enabled');

// User action feedback
Notify.action('Settings saved');

// Validation errors
Notify.validation('Email format is invalid');

// Performance monitoring
Notify.performance('Component rendered in 16ms');

// Security alerts
Notify.security('Invalid login attempt');

// Network status
Notify.network('Connected to server');
```

### Notification Groups

```javascript
// Create a notification group
const fileOperations = Notify.createGroup('File Operations');

// Add notifications to group
fileOperations.info('Reading file...');
fileOperations.success('File loaded successfully');
fileOperations.error('File not found');

// Get group statistics
const stats = fileOperations.getStats();
console.log('Group stats:', stats);
```

## Advanced Usage

### Configuration

```javascript
import { Notify } from 'plauna/notifications/NotificationSystem.js';

// Configure notification system
Notify.initialize({
    enableToasts: true,
    enableConsole: true,
    enableSounds: false,
    minLevel: 'info',
    prefix: '[MyApp]'
});

// Change settings at runtime
Notify.setMinLevel('warning'); // Only show warnings and above
Notify.setToasts(false); // Disable visual notifications
Notify.setSounds(true); // Enable sound effects
```

### Custom Toast Manager

```javascript
import { ToastManager } from 'plauna/ui/ToastManager.js';

// Create custom toast manager
const toastManager = new ToastManager({
    maxToasts: 3,
    position: 'top-center',
    defaultDuration: 5000
});

// Show custom toast
const toastId = toastManager.show('Custom message', 'success');

// Update existing toast
toastManager.update(toastId, 'Updated message', 'info');

// Dismiss toast
toastManager.dismiss(toastId);
```

## Integration with Plauna Components

### Widget Integration

```javascript
import { Button } from 'plauna/widgets/Primitive/Button.js';
import { Notify } from 'plauna/notifications/NotificationSystem.js';

const button = new Button('save-btn', 'Save Document');

// Button will automatically show notifications for user actions
button.addEventListener('button-click', () => {
    Notify.success('Document saved successfully');
});
```

### Hot Reload Integration

```javascript
import { HotReloadUtils } from 'plauna/editor/HotReload.js';

// Hot reload automatically uses notification system
const hotReload = HotReloadUtils.initializeRobust();

// Validation errors shown as notifications
// Success confirmations shown as notifications
// Progress updates shown as loading toasts
```

### Form Validation Integration

```javascript
import { Input } from 'plauna/widgets/Form/Input.js';

const emailInput = new Input('email-input', {
    type: 'email',
    validationRules: [
        {
            test: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
            message: 'Please enter a valid email address'
        }
    ],
    showValidationFeedback: true
});

// Validation errors automatically shown as notifications
emailInput.addEventListener('input-change', (event) => {
    if (!emailInput.isValid) {
        Notify.validation(emailInput.errorMessage);
    }
});
```

## Best Practices

### 1. Use Appropriate Notification Types

```javascript
// ✅ Good - Use specific types
Notify.success('Operation completed');
Notify.warning('Deprecated API used');
Notify.error('Failed to save data');

// ❌ Avoid - Always using generic info
Notify.info('Operation completed'); // Should be success
Notify.info('Deprecated API used'); // Should be warning
Notify.info('Failed to save data'); // Should be error
```

### 2. Provide Context with Titles

```javascript
// ✅ Good - Clear context
Notify.success('User created', { title: 'User Management' });

// ❌ Vague - No context
Notify.success('User created');
```

### 3. Group Related Notifications

```javascript
// ✅ Good - Grouped notifications
const uploadGroup = Notify.createGroup('File Upload');
uploadGroup.info('Uploading file...');
uploadGroup.success('File uploaded successfully');

// ❌ Scattered notifications
Notify.info('Uploading file...');
Notify.success('File uploaded successfully');
```

### 4. Use Appropriate Durations

```javascript
// ✅ Good - Contextual durations
Notify.info('Quick update', { duration: 2000 });
Notify.warning('Please review', { duration: 5000 });
Notify.error('Critical error', { duration: 10000 });

// ❌ One-size-fits-all
Notify.info('Quick update', { duration: 5000 });
Notify.warning('Please review', { duration: 5000 });
Notify.error('Critical error', { duration: 5000 });
```

### 5. Respect User Preferences

```javascript
// Check notification preferences
if (user.preferences.enableNotifications) {
    Notify.success('Operation completed');
}

// Respect notification level settings
if (Notify.getStats().minLevel <= 'success') {
    Notify.success('Operation completed');
}
```

## API Reference

### Notify Methods

| Method | Description | Example |
|--------|-------------|---------|
| `debug(message, options)` | Debug information | `Notify.debug('Variable value')` |
| `info(message, options)` | General information | `Notify.info('User logged in')` |
| `success(message, options)` | Success confirmation | `Notify.success('File saved')` |
| `warning(message, options)` | Warning message | `Notify.warning('Low memory')` |
| `error(message, options)` | Error notification | `Notify.error('Connection failed')` |
| `critical(message, options)` | Critical error | `Notify.critical('System crash')` |

### Specialized Methods

| Method | Description | Example |
|--------|-------------|---------|
| `system(message, options)` | System events | `Notify.system('Hot reload enabled')` |
| `action(message, options)` | User actions | `Notify.action('Settings saved')` |
| `validation(message, options)` | Validation errors | `Notify.validation('Invalid email')` |
| `performance(message, options)` | Performance data | `Notify.performance('Render: 16ms')` |
| `security(message, options)` | Security alerts | `Notify.security('Invalid login')` |
| `network(message, options)` | Network status | `Notify.network('Connected')` |

### Configuration Methods

| Method | Description | Example |
|--------|-------------|---------|
| `initialize(options)` | Configure system | `Notify.initialize({ minLevel: 'warning' })` |
| `setMinLevel(level)` | Set minimum level | `Notify.setMinLevel('error')` |
| `setToasts(enabled)` | Enable/disable toasts | `Notify.setToasts(false)` |
| `setConsole(enabled)` | Enable/disable console | `Notify.setConsole(true)` |
| `setSounds(enabled)` | Enable/disable sounds | `Notify.setSounds(true)` |
| `getStats()` | Get system statistics | `Notify.getStats()` |

### Options Object

```javascript
{
    title: 'Notification Title',      // Custom title
    duration: 5000,                  // Duration in ms
    toast: true,                      // Show toast
    console: true,                    // Log to console
    sound: false,                     // Play sound
    details: { extra: 'data' }        // Additional data
}
```

## Migration Guide

### From Direct DOM Notifications

```javascript
// ❌ Old way - Direct DOM manipulation
const notification = document.createElement('div');
notification.textContent = 'Message';
document.body.appendChild(notification);

// ✅ New way - Use notification system
Notify.info('Message');
```

### From Console Logging

```javascript
// ❌ Old way - Console only
console.log('User action completed');

// ✅ New way - Rich notifications
Notify.action('User action completed');
```

### From Alert Boxes

```javascript
// ❌ Old way - Blocking alerts
alert('Operation failed');

// ✅ New way - Non-blocking notifications
Notify.error('Operation failed');
```

## Troubleshooting

### Notifications Not Showing

1. Check if notification system is initialized
2. Verify minimum level settings
3. Ensure toast notifications are enabled
4. Check browser permissions for notifications

```javascript
// Debug notification system
console.log('Notification stats:', Notify.getStats());
```

### Performance Issues

1. Limit maximum concurrent toasts
2. Use appropriate notification levels
3. Group related notifications
4. Disable unnecessary channels

```javascript
// Optimize for performance
Notify.initialize({
    maxToasts: 3,
    minLevel: 'warning',
    enableSounds: false
});
```

### Sound Issues

1. Check if audio context is supported
2. Verify user interaction requirements
3. Test sound effect generation
4. Check browser audio permissions

## Examples

### Complete Application Setup

```javascript
import { Notify } from 'plauna/notifications/NotificationSystem.js';

// Initialize notification system
Notify.initialize({
    enableToasts: true,
    enableConsole: true,
    enableSounds: false,
    minLevel: 'info',
    prefix: '[MyApp]'
});

// Application lifecycle
Notify.system('Application starting');

// User interactions
function handleUserAction() {
    try {
        // Perform action
        Notify.action('User action completed successfully');
    } catch (error) {
        Notify.error('Action failed: ' + error.message);
    }
}

// Error handling
window.addEventListener('error', (event) => {
    Notify.critical('Unhandled error: ' + event.error.message);
});

// Performance monitoring
function measurePerformance() {
    const start = performance.now();
    // ... perform operation
    const duration = performance.now() - start;
    Notify.performance(`Operation completed in ${duration.toFixed(2)}ms`);
}
```

This comprehensive notification system provides a clean separation between user notifications and debug logging while offering extensive customization and integration options for all Plauna components.
