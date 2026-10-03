// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Sourced construction-substance records for RealmForge stock products.
 *
 * These are material records, not stock geometry and not design certificates.
 * Product- or project-dependent properties stay explicitly missing. Viewport
 * colors are separately identified as authored appearance data and never act as
 * evidence for physical or structural readiness.
 */

import {
    COMPOSITE_MATERIAL_FACET_FIELDS_V1_1,
    COMPOSITE_MATERIAL_FACETS_V1_1,
    ENGINE_COMPOSITE_MATERIAL_SCHEMA,
    ENGINE_COMPOSITE_MATERIAL_VERSION_1_1,
    validateEngineCompositeMaterialResource,
} from './CompositeMaterialContracts.js';

const COPYRIGHT = 'Copyright (c) 2026 Jake Wehmeier (BTSpaniel)';
const LICENSE = 'LicenseRef-ParticleRealms-Alpha';

const APPEARANCE_SOURCE = Object.freeze({
    id: 'realmforge-construction-appearance',
    kind: 'authored',
    uri: 'realmforge://catalog/construction-appearance-v1',
    citation: 'RealmForge construction catalog viewport appearance profile',
    edition: '2026.08',
    note: 'Authored display values only. They are not measurements and cannot satisfy physical or structural readiness.',
});

const SOURCES = Object.freeze({
    bia: Object.freeze({
        id: 'bia-technical-notes',
        kind: 'primary',
        uri: 'https://www.gobrick.com/resources/technical-notes',
        citation: 'Brick Industry Association Technical Notes 3A, 8B, 9, and 10',
        edition: 'Technical Note 8B (March 2020); online index retrieved 2026-08-22',
        note: 'Fired-clay brick, brick masonry, mortar selection, and modular dimensioning authority.',
    }),
    woodHandbook: Object.freeze({
        id: 'usda-fpl-wood-handbook',
        kind: 'primary',
        uri: 'https://research.fs.usda.gov/fpl/wood-handbook',
        citation: 'USDA Forest Products Laboratory, Wood Handbook: Wood as an Engineering Material',
        edition: 'FPL-GTR-282 (2021)',
        note: 'Chapters 6 to 8 and 10 to 12 distinguish lumber, fastening, plywood, and OSB. Species, grade, moisture, layup, and panel rating remain project inputs.',
    }),
    easternSpruce: Object.freeze({
        id: 'usda-fpl-eastern-spruce',
        kind: 'primary',
        uri: 'https://www.fpl.fs.usda.gov/documnts/usda/amwood/263espru.pdf',
        citation: 'USDA Forest Service, Eastern Spruce, American Woods series',
        edition: 'FS-263 (revised 2003)',
        note: 'The publication reports 28 lb/ft3 for eastern spruce at 12 percent moisture; 448.5 kg/m3 is the rounded SI conversion used here.',
    }),
    metsaBirchPlywood: Object.freeze({
        id: 'metsa-wood-birch-plywood',
        kind: 'primary',
        uri: 'https://www.metsagroup.com/contentassets/8a5519dc6e534fcfa99c06759fbb8bad/metsa_wood_birch_plywood_product_datasheets_en.pdf',
        citation: 'Metsä Wood Birch Plywood Product Datasheets',
        edition: 'Product datasheets retrieved 2026-08-23',
        note: 'The manufacturer reports an average density of 680 kg/m3 at RH 65 percent. This record is product-specific, not a generic plywood default.',
    }),
    aci: Object.freeze({
        id: 'aci-concrete-terminology',
        kind: 'primary',
        uri: 'https://www.concrete.org/portals/0/files/pdf/aci_concrete_terminology.pdf',
        citation: 'American Concrete Institute Concrete Terminology',
        edition: 'ACI CT-25 (2025)',
        note: 'Normalweight concrete is approximately 2400 kg/m3. Mixture-specific strength is intentionally not generalized.',
    }),
    aiscShapes: Object.freeze({
        id: 'aisc-shapes-v16',
        kind: 'primary',
        uri: 'https://www.aisc.org/aisc/publications/steel-construction-manual/aisc-shapes-database-v160/',
        citation: 'AISC Shapes Database v16.0',
        edition: 'AISC Steel Construction Manual, 16th Edition (2023)',
        note: 'Metric profile identity and structural-shape context.',
    }),
    aiscA992: Object.freeze({
        id: 'aisc-a992-properties',
        kind: 'primary',
        uri: 'https://www.aisc.org/media/3lcc5hxg/updating-standard-shape-material-properties-database-for-design-and-reliability.pdf',
        citation: 'AISC, Updating Standard Shape Material Properties Database for Design and Reliability',
        edition: 'AISC research report (2010)',
        note: 'The record uses the published A992 minimum yield and minimum ultimate tensile requirements, not measured values for an unspecified heat.',
    }),
    aisc303: Object.freeze({
        id: 'aisc-303-22-steel-unit-weight',
        kind: 'primary',
        uri: 'https://www.aisc.org/globalassets/aisc/publications/standards/a303-22w.pdf',
        citation: 'ANSI/AISC 303-22, Code of Standard Practice for Steel Buildings and Bridges, section 9.2.1',
        edition: 'May 9, 2022',
        note: 'Section 9.2.1 specifies a steel unit mass density of 7 800 kg/m3 for weight calculations.',
    }),
    galvanizers: Object.freeze({
        id: 'aga-galvanized-welding',
        kind: 'primary',
        uri: 'https://galvanizeit.org/design-and-fabrication/fabrication-considerations/welding',
        citation: 'American Galvanizers Association welding guidance',
        edition: 'AGA online fabrication guidance retrieved 2026-08-22',
        note: 'Joining guidance only. Base-steel grade and coating mass remain stock-product inputs.',
    }),
    kaiser6061: Object.freeze({
        id: 'kaiser-6061-shapes',
        kind: 'primary',
        uri: 'https://online.kaiseraluminum.com/depot/PublicProductInformation/Document/1006/Kaiser_Aluminum_Shapes_Soft_Alloy.pdf',
        citation: 'Kaiser Aluminum, Extruded Standard Shapes Alloy 6061 Technical Data',
        edition: 'Kaiser 6061 technical data retrieved 2026-08-22',
        note: 'Typical 6061-T6 extruded-shape values; stock form and thickness still govern acceptance.',
    }),
    vitro: Object.freeze({
        id: 'vitro-float-glass',
        kind: 'primary',
        uri: 'https://www.vitroglazings.com/media/02ubg2vz/tech_doc_120.pdf',
        citation: 'Vitro Architectural Glass TD-120, Flat Glass Trade Thicknesses and Weights',
        edition: 'TD-120 retrieved 2026-08-22',
        note: 'The SI density is converted from the published 157 lb/ft3 soda-lime-silica float-glass density.',
    }),
    usg: Object.freeze({
        id: 'usg-sheetrock-panels',
        kind: 'primary',
        uri: 'https://assemblies-tools.usg.com/content/usgcom/en/products/walls/drywall/drywall-panels/regular-panels/sheetrock-gypsum-panels.141090.html',
        citation: 'USG Sheetrock Brand Gypsum Panels product data',
        edition: 'Product 141090 data retrieved 2026-08-22',
        note: 'Identity and score-and-snap fabrication context only. Panel density remains product- and thickness-specific.',
    }),
    usgJointFinish: Object.freeze({
        id: 'usg-sheetrock-joint-finishing',
        kind: 'primary',
        uri: 'https://www.usg.com/content/dam/USG_Marketing_Communications/united_states/product_promotional_materials/finished_assets/usg-sheetrock-taping-joint-compound-submittal-en-J60A.pdf',
        citation: 'USG Sheetrock Brand Taping Joint Compound Submittal Sheet J60A and Paper Joint Tape Submittal Sheet J1736',
        edition: 'J60A-USA-ENG/6-22 and J1736 retrieved 2026-08-24',
        note: 'Material identity and gypsum-panel joint-finishing use. Product coverage and roll mass remain selected stock-product evidence.',
    }),
    rockwool: Object.freeze({
        id: 'rockwool-comfortbatt',
        kind: 'primary',
        uri: 'https://brandcommunity.rockwool.com/readimage.aspx/asset.pdf?pubid=3tRbSeTWxl181X2p_jUH6w',
        citation: 'ROCKWOOL Comfortbatt Thermal Batt Insulation Technical Data Sheet',
        edition: 'Issued May 2025',
        note: 'Reference batt has density greater than 28.8 kg/m3 and product-specific thermal resistance. No exact bulk density is manufactured from the lower bound.',
    }),
    gaf: Object.freeze({
        id: 'gaf-asphalt-shingles',
        kind: 'primary',
        uri: 'https://www.gaf.com/en-us/roofing-materials/residential-roofing-materials/shingles',
        citation: 'GAF residential asphalt shingle product catalog',
        edition: 'Online product catalog retrieved 2026-08-22',
        note: 'Material identity and nailed roofing application only. Mass and performance are shingle-product-specific.',
    }),
    gafUnderlayment: Object.freeze({
        id: 'gaf-tiger-paw-roof-deck-protection',
        kind: 'primary',
        uri: 'https://www.gaf.com/en-us/document-library/documents/data-sheets/tiger-paw-premium-roof-deck-protection-resul179.pdf',
        citation: 'GAF Tiger Paw Premium Roof Deck Protection data sheet RESUL179',
        edition: 'Data sheet retrieved 2026-08-24',
        note: 'Selected polypropylene roof-deck underlayment identity, roll dimensions, and approximate roll mass. Installation performance remains assembly-specific.',
    }),
    authoredProductIdentity: Object.freeze({
        id: 'realmforge-authored-product-material-identity',
        kind: 'authored',
        uri: 'realmforge://catalog/product-material-identity-v1',
        citation: 'RealmForge modular-product material identity catalog',
        edition: '2026.08',
        note: 'Taxonomy and intended gameplay use only. Missing density, contact, strength, thermal, and joining values remain explicitly unavailable.',
    }),
    carpenterHpr11250pe: Object.freeze({
        id: 'carpenter-tranquility-hpr11250pe-2023',
        kind: 'primary',
        uri: 'https://carpenter.com/wp-content/uploads/2023/02/Carpenter_Foams_july2022.pdf',
        citation: 'Carpenter Co., Tranquility Active Response Foam, HPR11250PE column, page 3',
        edition: '1/2023; retrieved 2026-09-29',
        note: 'ASTM D3574 Test A density is 2.50 lb/ft3 nominal, converted with 0.45359237 kg/lb and 0.3048 m/ft. Manufacturer density tolerance is not published here. This selected grade supports nominal mass only, not measured batch mass, compression behavior or mattress certification.',
    }),
    camiraXtremeTsr14: Object.freeze({
        id: 'camira-xtreme-tsr14',
        kind: 'primary',
        uri: 'https://content.camirafabrics.com/media/d1vjuqyi/xtreme_ys.pdf',
        citation: 'Camira Fabrics, Xtreme Product Information, technical information, page 4',
        edition: 'YS (TSR14); retrieved 2026-09-29',
        note: 'The selected 100 percent post-consumer recycled polyester fabric has nominal areal mass 310 g/m2 +/-5 percent and minimum roll width 140 cm. No bulk density or actual fabric thickness is reported. Wider covers require joined panels. Fire and seam performance remain complete-product dependent.',
    }),
    enginePhysics: Object.freeze({
        id: 'engine-gameplay-physical-materials',
        kind: 'repository',
        uri: 'engine/sim/physics/PhysicalMaterialPresets.js',
        citation: 'Engine gameplay physical-material presets',
        edition: 'Repository revision 2026.08',
        note: 'Gameplay mass/contact evidence only. It is not an engineering measurement or certification.',
    }),
});

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function renderFacet(baseColorFactor, {
    metallicFactor = 0,
    roughnessFactor = 0.72,
    alphaMode = 'opaque',
    doubleSided = false,
} = {}) {
    return {
        workflow: 'metallicRoughness',
        baseColorFactor,
        metallicFactor,
        roughnessFactor,
        emissiveFactor: [0, 0, 0],
        alphaMode,
        alphaCutoff: 0.5,
        doubleSided,
    };
}

function constructionMaterial({
    id,
    logicalPath,
    name,
    category,
    kind,
    description,
    primarySources,
    facetSourceIds = {},
    fieldSourceIds = {},
    facets = {},
    notApplicableFacets = [],
}) {
    const completeFacets = {
        identity: { kind, phaseAt293K: 'solid', description },
        ...facets,
    };
    const sourceById = new Map([APPEARANCE_SOURCE, ...primarySources].map(source => [source.id, source]));
    const fieldSources = {};
    for (const [facet, fields] of Object.entries(completeFacets)) {
        for (const field of Object.keys(fields)) {
            const path = `${facet}.${field}`;
            const sourceIds = fieldSourceIds[path]
                ?? facetSourceIds[facet]
                ?? (facet === 'render' ? [APPEARANCE_SOURCE.id] : [primarySources[0].id]);
            if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
                throw new TypeError(`${id}: ${path} requires provenance`);
            }
            for (const sourceId of sourceIds) {
                if (!sourceById.has(sourceId)) throw new TypeError(`${id}: ${path} references unknown source '${sourceId}'`);
            }
            fieldSources[path] = [...sourceIds];
        }
    }
    const applicable = new Set(Object.keys(completeFacets));
    const notApplicable = new Set(notApplicableFacets);
    const missingFacets = COMPOSITE_MATERIAL_FACETS_V1_1
        .filter(facet => !applicable.has(facet) && !notApplicable.has(facet));
    const missingFields = Object.entries(completeFacets).flatMap(([facet, fields]) => (
        COMPOSITE_MATERIAL_FACET_FIELDS_V1_1[facet]
            .filter(field => !Object.hasOwn(fields, field))
            .map(field => `${facet}.${field}`)
    )).sort();
    const usedSourceIds = new Set(Object.values(fieldSources).flat());
    const resource = {
        schema: ENGINE_COMPOSITE_MATERIAL_SCHEMA,
        schemaVersion: ENGINE_COMPOSITE_MATERIAL_VERSION_1_1,
        copyright: COPYRIGHT,
        license: LICENSE,
        id,
        logicalPath,
        name,
        category,
        facets: completeFacets,
        missingFacets,
        notApplicableFacets: [...notApplicableFacets],
        missingFields,
        sources: [...sourceById.values()].filter(source => usedSourceIds.has(source.id)),
        fieldSources,
    };
    validateEngineCompositeMaterialResource(resource, `constructionMaterial(${id})`);
    return deepFreeze(resource);
}

const BRICK = constructionMaterial({
    id: 'builtin.material.ceramic.fired-clay-brick',
    logicalPath: 'material/ceramic/masonry/fired-clay-brick.json',
    name: 'Fired-Clay Brick',
    category: 'ceramic',
    kind: 'fired-clay-masonry-unit',
    description: 'A fired-clay brick substance. Unit dimensions, coring, absorption, strength, and grade belong to the selected stock product.',
    primarySources: [SOURCES.bia],
    facets: {
        render: renderFacet([0.55, 0.19, 0.10, 1], { roughnessFactor: 0.88 }),
        fabrication: {
            processes: ['forming', 'drying', 'firing'],
            notes: 'Cut policy and unit classification are stock-product properties.',
        },
        joining: {
            methods: ['mortar', 'mechanical-tie'],
            constraints: ['match mortar to exposure and masonry application', 'preserve drainage and movement details'],
            notes: 'Mortar and tie capacities require the selected products and project assembly.',
        },
    },
});

function mortar(type, id, path, color, guidance) {
    return constructionMaterial({
        id,
        logicalPath: path,
        name: `Type ${type} Mortar`,
        category: 'composite',
        kind: `type-${type.toLowerCase()}-masonry-mortar`,
        description: `Masonry mortar classified as Type ${type}. Mix proportions, constituent products, and test basis remain explicit project inputs.`,
        primarySources: [SOURCES.bia],
        facets: {
            render: renderFacet(color, { roughnessFactor: 0.92 }),
            fabrication: {
                processes: ['proportioning', 'batch-mixing', 'tooling', 'curing'],
                notes: 'A proportion specification and a property specification are distinct and must not be combined.',
            },
            joining: {
                methods: ['mortar'],
                constraints: [guidance, 'verify constituent compatibility and project quality assurance'],
                notes: 'No installed bond, compressive, tensile, or shear capacity is inferred without a cited project mix and test basis.',
            },
        },
    });
}

const TYPE_N_MORTAR = mortar(
    'N',
    'builtin.material.composite.type-n-mortar',
    'material/composite/masonry/type-n-mortar.json',
    [0.66, 0.63, 0.57, 1],
    'normal above-grade use including most veneer applications',
);

const TYPE_S_MORTAR = mortar(
    'S',
    'builtin.material.composite.type-s-mortar',
    'material/composite/masonry/type-s-mortar.json',
    [0.62, 0.60, 0.55, 1],
    'use where project requirements call for higher flexural strength than Type N',
);

const BRICK_MORTAR_MASONRY = constructionMaterial({
    id: 'builtin.material.composite.brick-mortar-masonry',
    logicalPath: 'material/composite/masonry/brick-mortar-masonry.json',
    name: 'Brick-and-Mortar Masonry',
    category: 'composite',
    kind: 'brick-mortar-assemblage',
    description: 'A semantic composite of fired-clay brick units and masonry mortar. Assemblage properties require the selected units, mortar, bond, workmanship, and test basis.',
    primarySources: [SOURCES.bia],
    facets: {
        render: renderFacet([0.50, 0.22, 0.14, 1], { roughnessFactor: 0.90 }),
        fabrication: {
            processes: ['laying', 'joint-tooling', 'curing'],
            notes: 'Bond pattern and openings are construction-pattern inputs rather than substance properties.',
        },
        joining: {
            methods: ['mortar', 'mechanical-tie'],
            compatibleMaterialIds: [
                'builtin.material.ceramic.fired-clay-brick',
                'builtin.material.composite.type-n-mortar',
                'builtin.material.composite.type-s-mortar',
            ],
            constraints: ['derive assemblage readiness from installed unit and joint identities', 'require project-specific masonry strength evidence'],
            notes: 'This catalog record does not collapse unit and joint identities.',
        },
    },
});

const SPF = constructionMaterial({
    id: 'builtin.material.organic.spruce-pine-fir',
    logicalPath: 'material/organic/wood/softwood/spruce-pine-fir.json',
    name: 'Spruce-Pine-Fir (SPF)',
    category: 'organic',
    kind: 'commercial-softwood-species-group',
    description: 'SPF commercial softwood grouping. Species, grade, moisture, treatment, and member orientation govern physical and mechanical properties.',
    primarySources: [SOURCES.woodHandbook],
    facets: {
        render: renderFacet([0.70, 0.55, 0.34, 1], { roughnessFactor: 0.78 }),
        fabrication: {
            processes: ['sawing', 'drilling', 'nailing', 'screwing', 'adhesive-bonding'],
            joiningConstraints: ['respect grain direction', 'respect moisture condition', 'use product-specific fastener schedule'],
            notes: 'No single density or design strength is valid for the entire SPF grouping.',
        },
        joining: {
            methods: ['nail', 'screw', 'bolt', 'adhesive'],
            constraints: ['species group, grade, moisture, edge distance, end distance, and fastener geometry are required'],
            notes: 'Fastening capability remains unavailable until the selected stock and fastener schedule supply the missing evidence.',
        },
    },
});

const OSB = constructionMaterial({
    id: 'builtin.material.composite.osb',
    logicalPath: 'material/composite/wood-panel/oriented-strand-board.json',
    name: 'Oriented Strand Board (OSB)',
    category: 'composite',
    kind: 'wood-strand-structural-panel',
    description: 'Adhesive-bonded oriented wood-strand panel. Rating, thickness, axis, exposure class, and manufacturer govern usable properties.',
    primarySources: [SOURCES.woodHandbook],
    facets: {
        render: renderFacet([0.60, 0.43, 0.24, 1], { roughnessFactor: 0.86 }),
        fabrication: {
            processes: ['panel-cutting', 'drilling', 'nailing', 'screwing', 'adhesive-bonding'],
            joiningConstraints: ['preserve strength axis', 'respect panel edge spacing and exposure rating'],
            notes: 'Published property ranges are not collapsed into an invented scalar for an unspecified panel.',
        },
        joining: {
            methods: ['nail', 'screw', 'adhesive'],
            constraints: ['panel rating, thickness, axis, edge distance, fastener, and support schedule are required'],
            notes: 'Mechanical fields remain explicitly missing for the generic catalog substance.',
        },
    },
});

const STRUCTURAL_PLYWOOD = constructionMaterial({
    id: 'builtin.material.composite.structural-plywood',
    logicalPath: 'material/composite/wood-panel/structural-plywood.json',
    name: 'Structural Plywood',
    category: 'composite',
    kind: 'cross-laminated-wood-veneer-panel',
    description: 'Adhesive-bonded wood veneer panel. Grade, layup, thickness, axis, exposure class, and manufacturer govern usable properties.',
    primarySources: [SOURCES.woodHandbook],
    facets: {
        render: renderFacet([0.68, 0.51, 0.30, 1], { roughnessFactor: 0.80 }),
        fabrication: {
            processes: ['panel-cutting', 'drilling', 'nailing', 'screwing', 'adhesive-bonding'],
            joiningConstraints: ['preserve face-grain axis', 'respect panel edge spacing and exposure rating'],
            notes: 'Plywood is not treated as an OSB property alias.',
        },
        joining: {
            methods: ['nail', 'screw', 'adhesive'],
            constraints: ['panel grade, layup, thickness, axis, edge distance, fastener, and support schedule are required'],
            notes: 'Mechanical fields remain explicitly missing for the generic catalog substance.',
        },
    },
});

const EASTERN_SPRUCE_12_PERCENT = constructionMaterial({
    id: 'builtin.material.organic.eastern-spruce-12pct',
    logicalPath: 'material/organic/wood/softwood/eastern-spruce-12pct.json',
    name: 'Eastern Spruce at 12% Moisture',
    category: 'organic',
    kind: 'eastern-spruce-selected-moisture-condition',
    description: 'Eastern spruce selected at the cited 12 percent moisture condition for furniture mass projection. Grade, member defects, and connection design remain stock and joint evidence.',
    primarySources: [SOURCES.easternSpruce, SOURCES.woodHandbook],
    fieldSourceIds: {
        'physical.densityKgPerM3': [SOURCES.easternSpruce.id],
    },
    facets: {
        render: renderFacet([0.70, 0.55, 0.34, 1], { roughnessFactor: 0.78 }),
        physical: { densityKgPerM3: 448.5 },
        fabrication: {
            processes: ['sawing', 'drilling', 'nailing', 'screwing', 'adhesive-bonding'],
            joiningConstraints: ['respect grain direction', 'retain the selected moisture condition', 'use a product-specific fastener schedule'],
            notes: 'The sourced density supports mass only and is not a structural design value.',
        },
        joining: {
            methods: ['nail', 'screw', 'bolt', 'adhesive', 'furniture-fastener'],
            constraints: ['grade, moisture, edge distance, end distance, fastener geometry, and load direction remain required'],
            notes: 'No nail, screw, or furniture-joint capacity is inferred from density.',
        },
    },
});

const METSA_BIRCH_PLYWOOD = constructionMaterial({
    id: 'builtin.material.composite.metsa-birch-plywood-rh65',
    logicalPath: 'material/composite/wood-panel/metsa-birch-plywood-rh65.json',
    name: 'Metsä Wood Birch Plywood at RH 65%',
    category: 'composite',
    kind: 'selected-birch-plywood-product',
    description: 'Selected Metsä Wood birch plywood at the cited RH 65 percent condition for furniture mass projection. Panel grade, thickness, layup, and fastening schedule remain product inputs.',
    primarySources: [SOURCES.metsaBirchPlywood],
    facets: {
        render: renderFacet([0.68, 0.51, 0.30, 1], { roughnessFactor: 0.80 }),
        physical: { densityKgPerM3: 680 },
        fabrication: {
            processes: ['panel-cutting', 'drilling', 'screwing', 'adhesive-bonding'],
            joiningConstraints: ['preserve face-grain axis', 'retain the selected humidity condition', 'respect product edge spacing'],
            notes: 'The manufacturer average supports mass projection, not a guaranteed piece measurement.',
        },
        joining: {
            methods: ['screw', 'bolt', 'adhesive', 'furniture-fastener'],
            constraints: ['panel thickness, edge distance, fastener identity, and support schedule remain required'],
            notes: 'No connection capacity is derived from the product density.',
        },
    },
});

const NORMAL_WEIGHT_CONCRETE = constructionMaterial({
    id: 'builtin.material.composite.normal-weight-concrete',
    logicalPath: 'material/composite/cementitious/normal-weight-concrete.json',
    name: 'Normal-Weight Concrete',
    category: 'composite',
    kind: 'normalweight-cementitious-composite',
    description: 'Normalweight concrete represented by placed pours or sections. Mixture design, curing, age, reinforcement, and specified strength remain project evidence.',
    primarySources: [SOURCES.aci],
    facets: {
        render: renderFacet([0.48, 0.49, 0.49, 1], { roughnessFactor: 0.94 }),
        physical: { densityKgPerM3: 2400 },
        fabrication: {
            processes: ['batching', 'placing', 'consolidating', 'curing'],
            joiningConstraints: ['construction joints and anchors require explicit project details'],
            notes: 'The density is an approximate normalweight classification value, not a mixture receipt.',
        },
        joining: {
            methods: ['cast-contact', 'anchor', 'bolt', 'adhesive'],
            constraints: ['require mixture, cure, reinforcement, embedment, and joint-specific evidence'],
            notes: 'No strength is inferred from the normalweight density classification.',
        },
    },
});

const A992_STEEL = constructionMaterial({
    id: 'builtin.material.alloy.structural-steel-a992',
    logicalPath: 'material/alloy/steel/structural-steel-a992.json',
    name: 'ASTM A992 Structural Steel',
    category: 'alloy',
    kind: 'a992-structural-steel',
    description: 'Structural steel grade used for rolled building framing shapes. Shape dimensions and properties remain stock-profile data.',
    primarySources: [SOURCES.aiscShapes, SOURCES.aiscA992, SOURCES.aisc303],
    facetSourceIds: {
        identity: [SOURCES.aiscShapes.id, SOURCES.aiscA992.id],
        mechanical: [SOURCES.aiscA992.id],
        fabrication: [SOURCES.aiscShapes.id],
        joining: [SOURCES.aiscShapes.id],
    },
    fieldSourceIds: {
        'physical.densityKgPerM3': [SOURCES.aisc303.id],
    },
    facets: {
        render: renderFacet([0.37, 0.39, 0.42, 1], { metallicFactor: 1, roughnessFactor: 0.42 }),
        physical: { densityKgPerM3: 7800 },
        mechanical: {
            yieldStrengthPa: 345000000,
            tensileStrengthPa: 448000000,
        },
        fabrication: {
            processes: ['rolling', 'cutting', 'drilling'],
            notes: 'Metric section dimensions come from the pinned AISC shape database; welding and bolting procedures remain joint resources.',
        },
        joining: {
            methods: ['weld', 'bolt'],
            constraints: ['require selected shape, connection geometry, bolt or weld specification, and project design basis'],
            notes: 'The authored mechanical values are published minimum grade requirements, not measured heat properties or connection capacities.',
        },
    },
});

const GALVANIZED_STEEL = constructionMaterial({
    id: 'builtin.material.alloy.galvanized-steel',
    logicalPath: 'material/alloy/steel/galvanized-steel.json',
    name: 'Hot-Dip Galvanized Steel',
    category: 'alloy',
    kind: 'zinc-coated-steel',
    description: 'A steel substrate with a hot-dip zinc coating. Substrate grade, product thickness, coating class, and coating mass remain stock-product data.',
    primarySources: [SOURCES.galvanizers, SOURCES.aisc303],
    fieldSourceIds: {
        'physical.densityKgPerM3': [SOURCES.aisc303.id],
    },
    facets: {
        render: renderFacet([0.57, 0.59, 0.60, 1], { metallicFactor: 1, roughnessFactor: 0.50 }),
        physical: { densityKgPerM3: 7800 },
        fabrication: {
            processes: ['hot-dip-galvanizing', 'cutting', 'welding'],
            joiningConstraints: ['control zinc at weld area', 'restore corrosion protection after welding'],
            notes: 'AISC steel unit mass supports deterministic gameplay mass. Coating mass and base-steel mechanical properties remain unspecified.',
        },
        joining: {
            methods: ['weld', 'bolt'],
            constraints: ['follow galvanized-steel ventilation, surface preparation, filler, and coating-repair guidance'],
            notes: 'Connection capacity requires the substrate grade and selected connection resource.',
        },
    },
});

const ALUMINUM_6061_T6 = constructionMaterial({
    id: 'builtin.material.alloy.aluminum-6061-t6',
    logicalPath: 'material/alloy/aluminum/aluminum-6061-t6.json',
    name: 'Aluminum 6061-T6',
    category: 'alloy',
    kind: 'heat-treated-aluminum-alloy',
    description: '6061 aluminum in T6 temper. Product form, thickness, orientation, and governing specification remain stock-product inputs.',
    primarySources: [SOURCES.kaiser6061],
    facets: {
        render: renderFacet([0.72, 0.74, 0.76, 1], { metallicFactor: 1, roughnessFactor: 0.32 }),
        physical: { densityKgPerM3: 2700 },
        mechanical: {
            youngsModulusPa: 68900000000,
            yieldStrengthPa: 276000000,
            tensileStrengthPa: 310000000,
            shearStrengthPa: 207000000,
        },
        fabrication: {
            processes: ['extruding', 'cutting', 'drilling', 'machining'],
            notes: 'Mechanical values are typical for the referenced extruded standard shape, not universal acceptance values.',
        },
        joining: {
            methods: ['bolt', 'weld'],
            constraints: ['account for product form, thickness, temper, heat-affected zone, and selected connection procedure'],
            notes: 'Connection capacity is not derived from base-material strength alone.',
        },
    },
});

const FLOAT_GLASS = constructionMaterial({
    id: 'builtin.material.ceramic.soda-lime-float-glass',
    logicalPath: 'material/ceramic/glass/soda-lime-float-glass.json',
    name: 'Soda-Lime-Silica Float Glass',
    category: 'ceramic',
    kind: 'soda-lime-silica-float-glass',
    description: 'Flat soda-lime-silica float glass. Thickness, heat treatment, edge condition, coatings, and glazing system remain stock and assembly inputs.',
    primarySources: [SOURCES.vitro],
    facets: {
        render: renderFacet([0.73, 0.88, 0.91, 0.32], {
            roughnessFactor: 0.08,
            alphaMode: 'blend',
            doubleSided: true,
        }),
        physical: { densityKgPerM3: 2515 },
        fabrication: {
            processes: ['float-forming', 'cutting'],
            notes: 'The rounded SI density is converted from 157 lb/ft3 in TD-120.',
        },
        joining: {
            methods: ['gasket', 'structural-sealant', 'mechanical-clamp'],
            constraints: ['require glass thickness, edge condition, support, sealant, and glazing-system evidence'],
            notes: 'Glass strength and breakage readiness remain unavailable for an unspecified product.',
        },
    },
});

const GYPSUM_BOARD = constructionMaterial({
    id: 'builtin.material.composite.gypsum-board',
    logicalPath: 'material/composite/interior/gypsum-board.json',
    name: 'Paper-Faced Gypsum Board',
    category: 'composite',
    kind: 'paper-faced-gypsum-panel',
    description: 'Interior gypsum wallboard. Thickness, core type, edge, fire classification, and product mass remain stock-product fields.',
    primarySources: [SOURCES.usg],
    facets: {
        render: renderFacet([0.82, 0.80, 0.72, 1], { roughnessFactor: 0.90 }),
        fabrication: {
            processes: ['score-and-snap', 'cutting', 'screw-fastening', 'joint-finishing'],
            notes: 'No generic density is calculated from one thickness-specific panel product.',
        },
        joining: {
            methods: ['screw', 'adhesive'],
            constraints: ['require panel type, framing, fastener length, spacing, edge distance, and assembly schedule'],
            notes: 'Fire and structural performance are assembly-specific.',
        },
    },
});

const PAPER_JOINT_TAPE = constructionMaterial({
    id: 'builtin.material.organic.cross-fibered-paper-joint-tape',
    logicalPath: 'material/organic/paper/cross-fibered-joint-tape.json',
    name: 'Cross-Fibered Paper Joint Tape',
    category: 'organic',
    kind: 'cross-fibered-paper-joint-tape',
    description: 'Centre-creased cross-fibered paper tape selected for reinforcing gypsum-panel flat joints and inside corners.',
    primarySources: [SOURCES.usgJointFinish],
    facets: {
        render: renderFacet([0.86, 0.84, 0.76, 1], { roughnessFactor: 0.96, doubleSided: true }),
        fabrication: {
            processes: ['roll-cutting', 'creasing', 'compound-embedding'],
            notes: 'Roll width, length, and mass remain selected stock-product evidence.',
        },
        joining: {
            methods: ['joint-compound-embedding'],
            constraints: ['embed continuously in compatible joint compound', 'finish flat joints and inside corners to the selected assembly schedule'],
            notes: 'No structural capacity is inferred from drywall finishing tape.',
        },
    },
});

const VINYL_JOINT_COMPOUND = constructionMaterial({
    id: 'builtin.material.composite.vinyl-drying-joint-compound',
    logicalPath: 'material/composite/interior/vinyl-drying-joint-compound.json',
    name: 'Vinyl-Based Drying Joint Compound',
    category: 'composite',
    kind: 'vinyl-based-ready-mix-joint-compound',
    description: 'Ready-mixed drying-type compound selected for embedding tape and finishing gypsum-panel joints, fasteners, bead, and trim.',
    primarySources: [SOURCES.usgJointFinish],
    facets: {
        render: renderFacet([0.91, 0.90, 0.85, 1], { roughnessFactor: 0.98 }),
        fabrication: {
            processes: ['mixing', 'tape-embedding', 'coating', 'drying', 'sanding'],
            notes: 'Coverage, coat count, drying condition, and installed mass remain selected product and assembly inputs.',
        },
        joining: {
            methods: ['compound-embed', 'skim-coat'],
            constraints: ['use compatible paper tape and gypsum-panel substrate', 'observe manufacturer drying and storage conditions'],
            notes: 'Finish adhesion and crack performance remain assembly-specific; no structural capacity is authored.',
        },
    },
});

const POLYPROPYLENE_ROOF_UNDERLAYMENT = constructionMaterial({
    id: 'builtin.material.polymer.polypropylene-roof-underlayment',
    logicalPath: 'material/polymer/roofing/polypropylene-underlayment.json',
    name: 'Polypropylene Roof-Deck Underlayment',
    category: 'polymer',
    kind: 'coated-nonwoven-polypropylene-underlayment',
    description: 'Selected synthetic roof-deck protection installed above sheathing and beneath asphalt shingles.',
    primarySources: [SOURCES.gafUnderlayment],
    facets: {
        render: renderFacet([0.48, 0.50, 0.50, 1], { roughnessFactor: 0.92, doubleSided: true }),
        fabrication: {
            processes: ['roll-cutting', 'lapping', 'cap-fastening'],
            notes: 'Roll coverage, laps, fasteners, and exposure limits remain selected product and roof-assembly inputs.',
        },
        joining: {
            methods: ['cap-nail', 'cap-staple'],
            constraints: ['install over supported roof deck', 'respect selected side and end laps', 'use compatible cap fasteners'],
            notes: 'Weather and wind readiness require the complete selected roof assembly.',
        },
    },
});

const MINERAL_WOOL = constructionMaterial({
    id: 'builtin.material.composite.mineral-wool',
    logicalPath: 'material/composite/insulation/mineral-wool.json',
    name: 'Mineral Wool Batt',
    category: 'composite',
    kind: 'stone-wool-batt-insulation',
    description: 'Semi-rigid mineral wool batt insulation. Product thickness, density, and thermal resistance remain selected stock-product properties.',
    primarySources: [SOURCES.rockwool],
    facets: {
        render: renderFacet([0.37, 0.34, 0.25, 1], { roughnessFactor: 0.98 }),
        fabrication: {
            processes: ['batt-cutting', 'friction-fitting'],
            notes: 'The cited density is a lower bound, so this generic material does not invent an exact mass density.',
        },
        joining: {
            methods: ['friction-fit', 'mechanical-anchor'],
            constraints: ['avoid gaps and compression outside product instructions', 'match batt dimensions to framing cavity'],
            notes: 'Thermal readiness requires the exact selected product and thickness.',
        },
    },
});

const ASPHALT_SHINGLES = constructionMaterial({
    id: 'builtin.material.composite.asphalt-shingles',
    logicalPath: 'material/composite/roofing/asphalt-shingles.json',
    name: 'Asphalt Roofing Shingles',
    category: 'composite',
    kind: 'asphalt-composition-roof-shingle',
    description: 'Factory-produced asphalt composition roofing shingle. Product line, exposure, mass, wind classification, and installation instructions remain stock-product evidence.',
    primarySources: [SOURCES.gaf],
    facets: {
        render: renderFacet([0.16, 0.17, 0.18, 1], { roughnessFactor: 0.96 }),
        fabrication: {
            processes: ['cutting', 'nailing', 'adhesive-tab-sealing'],
            notes: 'No product-specific performance is generalized from the catalog category.',
        },
        joining: {
            methods: ['nail', 'adhesive-tab'],
            constraints: ['require selected shingle, deck, underlayment, exposure, fastener, and manufacturer installation schedule'],
            notes: 'Wind and weather readiness are not material-only claims.',
        },
    },
});

function authoredProductMaterial({ id, path, name, category, kind, description, color, processes, joiningMethods }) {
    return constructionMaterial({
        id,
        logicalPath: path,
        name,
        category,
        kind,
        description,
        primarySources: [SOURCES.authoredProductIdentity],
        facets: {
            render: renderFacet(color, { roughnessFactor: category === 'polymer' ? 0.58 : 0.72 }),
            fabrication: {
                processes,
                notes: 'Process compatibility is authored product taxonomy; exact grade, formulation, machine settings, and acceptance evidence remain selected-product inputs.',
            },
            joining: {
                methods: joiningMethods,
                constraints: ['require exact grade, surface condition, geometry, and selected joining process'],
                notes: 'No connection or failure capacity is inferred from this identity record.',
            },
        },
    });
}

const AMERICAN_BEECH = authoredProductMaterial({
    id: 'builtin.material.organic.american-beech',
    path: 'material/organic/wood/hardwood/american-beech.json',
    name: 'American Beech',
    category: 'organic',
    kind: 'hardwood-species',
    description: 'American beech identity for furniture products. Grade, moisture condition, density, grain orientation, and strength remain selected-stock evidence.',
    color: [0.67, 0.48, 0.27, 1],
    processes: ['sawing', 'turning', 'drilling', 'sanding', 'finishing'],
    joiningMethods: ['dowel', 'screw', 'bolt', 'adhesive'],
});

const ABS = authoredProductMaterial({
    id: 'builtin.material.polymer.abs',
    path: 'material/polymer/thermoplastic/abs.json',
    name: 'ABS',
    category: 'polymer',
    kind: 'acrylonitrile-butadiene-styrene',
    description: 'ABS thermoplastic identity for shells and trim. Grade, additives, molding condition, density, and impact performance remain product evidence.',
    color: [0.12, 0.13, 0.15, 1],
    processes: ['injection-molding', 'thermoforming', 'machining'],
    joiningMethods: ['screw', 'snap-fit', 'adhesive', 'solvent-bond'],
});

const POLYPROPYLENE = authoredProductMaterial({
    id: 'builtin.material.polymer.polypropylene',
    path: 'material/polymer/thermoplastic/polypropylene.json',
    name: 'Polypropylene',
    category: 'polymer',
    kind: 'polypropylene-thermoplastic',
    description: 'Polypropylene identity for furniture shells and vehicle trim. Copolymer, filler, UV package, density, and mechanical properties remain product evidence.',
    color: [0.15, 0.16, 0.18, 1],
    processes: ['injection-molding', 'extrusion', 'thermoforming'],
    joiningMethods: ['screw', 'snap-fit', 'heat-stake', 'weld'],
});

const GLASS_FILLED_NYLON = authoredProductMaterial({
    id: 'builtin.material.polymer.glass-filled-nylon',
    path: 'material/polymer/composite/glass-filled-nylon.json',
    name: 'Glass-Filled Nylon',
    category: 'polymer',
    kind: 'glass-fibre-reinforced-polyamide',
    description: 'Glass-filled nylon identity for caster housings and structural polymer parts. Resin family, fibre fraction, conditioning, density, and strength remain product evidence.',
    color: [0.09, 0.10, 0.11, 1],
    processes: ['injection-molding', 'insert-molding', 'machining'],
    joiningMethods: ['press-fit', 'threaded-insert', 'screw', 'snap-fit'],
});

const POLYURETHANE = authoredProductMaterial({
    id: 'builtin.material.polymer.polyurethane',
    path: 'material/polymer/polyurethane/polyurethane.json',
    name: 'Polyurethane',
    category: 'polymer',
    kind: 'polyurethane-polymer',
    description: 'Polyurethane identity for molded components. Chemistry, hardness, density, cure, wear, and contact behavior remain formulation-specific evidence.',
    color: [0.18, 0.19, 0.20, 1],
    processes: ['reaction-molding', 'casting', 'coating'],
    joiningMethods: ['cast-bond', 'adhesive', 'mechanical-retention'],
});

const FLEXIBLE_POLYURETHANE_FOAM = authoredProductMaterial({
    id: 'builtin.material.composite.flexible-polyurethane-foam',
    path: 'material/composite/polymer/flexible-polyurethane-foam.json',
    name: 'Flexible Polyurethane Foam',
    category: 'composite',
    kind: 'flexible-cellular-polyurethane',
    description: 'Flexible polyurethane foam identity for cushions. Formulation, cell structure, density, indentation response, and durability remain selected-product evidence.',
    color: [0.70, 0.67, 0.48, 1],
    processes: ['foaming', 'molding', 'contour-cutting'],
    joiningMethods: ['adhesive', 'upholstery-wrap', 'mechanical-retention'],
});

const POLYESTER_UPHOLSTERY = authoredProductMaterial({
    id: 'builtin.material.polymer.polyester-upholstery',
    path: 'material/polymer/fiber/polyester-upholstery.json',
    name: 'Polyester Upholstery',
    category: 'polymer',
    kind: 'woven-polyester-upholstery',
    description: 'Woven polyester upholstery identity. Yarn, weave, backing, coating, areal mass, abrasion, and fire behavior remain selected-fabric evidence.',
    color: [0.17, 0.19, 0.22, 1],
    processes: ['weaving', 'cutting', 'sewing', 'stapling'],
    joiningMethods: ['seam', 'staple', 'adhesive', 'retainer'],
});

// Selected product grades are separate immutable identities. Generic upholstery
// records above intentionally retain their missing physical evidence.
const CARPENTER_TRANQUILITY_HPR11250PE = constructionMaterial({
    id: 'builtin.material.composite.carpenter-tranquility-hpr11250pe-2023',
    logicalPath: 'material/composite/polymer/carpenter-tranquility-hpr11250pe-2023.json',
    name: 'Carpenter Tranquility HPR11250PE (January 2023 nominal profile)',
    category: 'composite',
    kind: 'selected-flexible-cellular-polyurethane-grade',
    description: 'Selected HPR11250PE foam grade using the manufacturer nominal density. Cushion geometry is authored; deformation, batch mass and installed mattress performance remain unverified.',
    primarySources: [SOURCES.carpenterHpr11250pe],
    facets: {
        render: renderFacet([0.70, 0.67, 0.48, 1]),
        physical: { densityKgPerM3: 2.5 * 0.45359237 / (0.3048 ** 3) },
    },
});

const CAMIRA_XTREME_POLYESTER_TSR14 = constructionMaterial({
    id: 'builtin.material.polymer.camira-xtreme-polyester-tsr14',
    logicalPath: 'material/polymer/fiber/camira-xtreme-polyester-tsr14.json',
    name: 'Camira Xtreme Polyester (YS TSR14 nominal profile)',
    category: 'polymer',
    kind: 'selected-recycled-polyester-upholstery',
    description: 'Selected Camira Xtreme woven polyester fabric. The published areal mass belongs to selected cut-cover product evidence; fabric bulk density and thickness remain unavailable.',
    primarySources: [SOURCES.camiraXtremeTsr14],
    facets: {
        render: renderFacet([0.17, 0.19, 0.22, 1]),
    },
});

const SBR_TIRE_RUBBER = authoredProductMaterial({
    id: 'builtin.material.polymer.sbr-tire-rubber',
    path: 'material/polymer/elastomer/sbr-tire-rubber.json',
    name: 'Natural/SBR Tire Rubber',
    category: 'polymer',
    kind: 'natural-sbr-tire-compound',
    description: 'Natural/SBR tire-compound identity. Compound recipe, reinforcement, hardness, density, friction, rolling resistance, and wear remain tire-product evidence.',
    color: [0.025, 0.027, 0.030, 1],
    processes: ['mixing', 'calendering', 'molding', 'vulcanizing'],
    joiningMethods: ['vulcanized-bond', 'mechanical-bead'],
});

const NONMARKING_POLYURETHANE_TREAD = authoredProductMaterial({
    id: 'builtin.material.polymer.nonmarking-polyurethane-tread',
    path: 'material/polymer/polyurethane/nonmarking-caster-tread.json',
    name: 'Non-Marking Polyurethane Caster Tread',
    category: 'polymer',
    kind: 'nonmarking-polyurethane-wheel-tread',
    description: 'Non-marking polyurethane caster-tread identity. Hardness, density, rolling resistance, load rating, floor interaction, and bond remain selected-wheel evidence.',
    color: [0.40, 0.41, 0.42, 1],
    processes: ['casting', 'overmolding', 'curing'],
    joiningMethods: ['cast-bond', 'mechanical-interlock'],
});

const CAST_IRON_BRAKE = constructionMaterial({
    id: 'builtin.material.alloy.cast-iron-brake-gameplay',
    logicalPath: 'material/alloy/iron/cast-iron-brake-gameplay.json',
    name: 'Cast-Iron Brake Material (Gameplay Profile)',
    category: 'alloy',
    kind: 'generic-cast-iron-brake-material',
    description: 'Generic cast-iron brake-component material using the Engine gameplay density. Alloy grade, microstructure, thermal behavior, friction pair, and strength remain explicit product evidence.',
    primarySources: [SOURCES.enginePhysics],
    facets: {
        render: renderFacet([0.23, 0.24, 0.25, 1], { metallicFactor: 1, roughnessFactor: 0.62 }),
        physical: { densityKgPerM3: 7200 },
        fabrication: {
            processes: ['casting', 'machining'],
            notes: 'The density is an existing gameplay preset, not a measured brake-disc heat or grade.',
        },
        joining: {
            methods: ['bolt', 'bearing-fit'],
            constraints: ['require selected component geometry, grade, hub interface, fastener, and thermal/friction evidence'],
            notes: 'No braking or failure capacity is inferred from gameplay density.',
        },
    },
});

const PVC_PIPE = constructionMaterial({
    id: 'builtin.material.polymer.rigid-pvc-pipe', logicalPath: 'material/polymer/thermoplastic/rigid-pvc-pipe.json',
    name: 'Rigid PVC pipe compound', category: 'polymer', kind: 'rigid-polyvinyl-chloride',
    description: 'Rigid PVC pipe substance. Exact compound, pressure class, temperature limits and joints remain selected-product inputs.',
    primarySources: [{ id: 'westlake-pvc-engineering-2023', kind: 'primary',
        uri: 'https://www.westlakepipe.com/sites/default/files/PI-TB-010-US-EN-0223.1_PVC-Pipe-Eng-Props.pdf',
        citation: 'Westlake Pipe & Fittings, PVC & PVCO Pipe Engineering Properties', edition: 'PI-TB-010-US-EN-0223.1',
        note: 'Approximate 1400 kg/m3 from specific gravity 1.4; compound dependent. No pressure or heat rating is inferred.' }],
    facets: { render: renderFacet([0.89, 0.91, 0.9, 1], { roughnessFactor: 0.4 }), physical: { densityKgPerM3: 1400 } },
});

export const ENGINE_CONSTRUCTION_COMPOSITE_MATERIAL_RESOURCES = deepFreeze([
    BRICK,
    TYPE_N_MORTAR,
    TYPE_S_MORTAR,
    BRICK_MORTAR_MASONRY,
    SPF,
    OSB,
    STRUCTURAL_PLYWOOD,
    EASTERN_SPRUCE_12_PERCENT,
    METSA_BIRCH_PLYWOOD,
    NORMAL_WEIGHT_CONCRETE,
    A992_STEEL,
    GALVANIZED_STEEL,
    ALUMINUM_6061_T6,
    FLOAT_GLASS,
    GYPSUM_BOARD,
    PAPER_JOINT_TAPE,
    VINYL_JOINT_COMPOUND,
    POLYPROPYLENE_ROOF_UNDERLAYMENT,
    MINERAL_WOOL,
    ASPHALT_SHINGLES,
    AMERICAN_BEECH,
    ABS,
    POLYPROPYLENE,
    GLASS_FILLED_NYLON,
    POLYURETHANE,
    FLEXIBLE_POLYURETHANE_FOAM,
    POLYESTER_UPHOLSTERY,
    CARPENTER_TRANQUILITY_HPR11250PE,
    CAMIRA_XTREME_POLYESTER_TSR14,
    SBR_TIRE_RUBBER,
    NONMARKING_POLYURETHANE_TREAD,
    CAST_IRON_BRAKE,
    PVC_PIPE,
]);

/** Compatibility IDs are explicit and version-pinned; upgrades never rewrite documents. */
export const ENGINE_CONSTRUCTION_COMPOSITE_MATERIAL_ALIASES = deepFreeze({
    'builtin.material.composite.oriented-strand-board': 'builtin.material.composite.osb',
    'builtin.material.composite.structural-concrete': 'builtin.material.composite.normal-weight-concrete',
    'builtin.material.organic.softwood.spf': 'builtin.material.organic.spruce-pine-fir',
});

export function constructionCompositeMaterialResource(id) {
    const requested = String(id);
    const canonical = ENGINE_CONSTRUCTION_COMPOSITE_MATERIAL_ALIASES[requested] ?? requested;
    return ENGINE_CONSTRUCTION_COMPOSITE_MATERIAL_RESOURCES.find(resource => resource.id === canonical) ?? null;
}

export default ENGINE_CONSTRUCTION_COMPOSITE_MATERIAL_RESOURCES;
