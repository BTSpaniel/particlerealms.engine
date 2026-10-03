### App & widget lifecycle

Plauna apps and widgets follow a **mount → update → unmount** lifecycle; services (storage, command bus, theming) are *injected* rather than imported, so the same widget runs in the editor, the OS shell, and standalone.

**See also:** [Plauna Architecture](/plauna/architecture.md) · [Plauna Overview](/plauna/overview.md)
