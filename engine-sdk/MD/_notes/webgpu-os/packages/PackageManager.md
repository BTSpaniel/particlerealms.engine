### Packaging & trust tiers

OS apps ship as signed `.prpkg` bundles (V2: signed + encrypted + merkle + cert). A developer (self-signed) key verifies as the **community / unofficial** tier; a root-issued cert promotes it to **trusted**, and capability grants scale with the tier.

**See also:** [Security & Trust Model](/concepts/security-model.md) · [WebGPU OS Architecture](/webgpu-os/architecture.md)
