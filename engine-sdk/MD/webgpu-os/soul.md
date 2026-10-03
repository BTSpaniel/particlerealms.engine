---
title: SOUL founder discovery and browser learning
description: Run a founder camp, inspect personal procedures and civilization state, review recorded lessons, and train a small WebGPU model.
updated: 2026-10-01
---

# SOUL founder discovery and browser learning

SOUL is a native WebGPU OS app with one world and synchronized map and perspective views. A fresh project starts paused with 100 founders, bedrolls and supplies, without permanent homes, assigned occupations or authored daily routines. Existing furnished village projects retain their original scenario and controller.

## Run a founder project

1. Open **Particle Realms SOUL**. Opening a camp does not allocate a neural model.
2. Press **Play society** to explore available actions using each person's observations and measured outcomes. **Decision cohort** controls decisions considered per tick; a saved cursor rotates through the population.
3. Use **Civilization** to search or sort people and inspect names, activity, accepted work, needs, resources, held tools, relationships and learned procedures. Operator inspection does not grant residents hidden knowledge.
4. For a smaller experiment, choose 2, 8 or 32 in **New founder population** and press **New founder project**. The app first saves and archives the existing complete project. Exports offers **Download previous project** for reopening that archive. A failed archive preserves the active world and fences uncertain writes. Save, restore, export and project replacement execute in a single queue.
5. Pause or save to retain pending work, personal learning, resource ledgers and model state. **Daily routine** and **View home interior** require the corresponding scenario or home.

The camp begins with two shared axes, two shared picks, one carried basket and one loose bedroll per individual, a workbench, and a shared depot containing two food units and two litres of water per person. Natural sites include berries, water, fallen branches, loose stone, reeds, trees, rock and ore. Their stock is finite. The current founder resource owner does not regrow it.

People can gather by hand, use and wear tools, mine, chop, craft replacement tools, repair them, store materials and make local requests or exchanges. Tool custody and ownership are separate. Borrowing requires the addressed person's authorization; theft can change custody and produce observed social consequences. Production requires reach, capacity, time and resources. A work admission is not a finished yield. Interrupted work and reserved inputs survive save/restore.

Founder shelter proposals choose bounded dimensions, one or two floors, sleeping-room count, capacity, orientation and site. A staged material ledger builds actual geometry with bedrooms and beds, shared cooking/preparation facilities and living space. Household invitations require acceptance. Bed assignments appear after completion. Learned architectural design, an unrestricted condominium program and a self-sustaining settlement remain unproven.

Sources: `agi/soul/SoulFounder.js`, `SoulEconomy.js`, `SoulShelter.js`, `SoulPlacement.js`; `webgpu-os/apps/soul/SoulApp.js`, `SoulDashboard.js`, `RealmForgeWorld.js`.

### Doors and other object interactions

SOUL residents currently cannot open or close doors. Furnished village doors are compiled into the house shell in a fixed open position. Founder shelters have open doorways without operable leaves. The current SOUL cottage asset does not request RealmForge's optional mechanism generation. Seeing a rendered object therefore does not establish that a resident can operate it.

Connected capabilities include walking, inspecting, gathering, tool work, crafting, repair, carrying, supported placement, reading, teaching, resting and sitting. Each has its own reach, custody, capacity or other owner checks. Appliances, taps, switches, drawers and arbitrary generated mechanisms need explicit connections to their existing RealmForge owners before they become resident actions.

Storylets should describe available evidence, the proposed interaction, prerequisites, expected effect and the actual later result. Keep expected and observed effects separate. A blocked, locked, occupied or interrupted attempt must remain that outcome. A dictionary supplies language, while personal experience must establish when an action works. Extra narrative text cannot replace missing physical actions.

Define reusable interactions by object family, such as hinged doors or supported seating. Generated instances can then expose the same validated capabilities with their own identity and observed state. Capture their individual experiences as learning records, and use short teaching examples to explain the relationship between action and consequence.

The next door connection needs a versioned mechanism-enabled template, stable leaf/handle/hinge identities, a reachable interaction anchor, an original actor task, the existing RealmForge mechanism request and measured outcome, synchronized collision/navigation and both views, and saved mechanism/task continuation. Door lessons can then compare successful opening with locked or obstructed attempts. Preserve private observation: an unseen door's changed state is unknown until observed or communicated.

RealmForge already has articulation opening, locking and persistence in `RealmForgeConstructionPresetPhysics`, plus approach/reservation/use in `RealmForgeActorUseRuntime`. Those bounded owners must be reused and measured at population scale. They are not currently bound to SOUL door proposals. This section records an implementation gap, not a delivered door feature.

Sources: `agi/soul/SoulFounderActions.js`, `SoulFounder.js`, `SoulShelter.js`; `webgpu-os/apps/soul/SoulAssets.js`, `SoulVillage.js`; `webgpu-os/apps/realmforge/construction/runtime/RealmForgeConstructionPresetPhysics.js`, `interactions/RealmForgeActorUseRuntime.js`, `interactions/RealmForgeObjectActionRuntime.js`.

## Select people and explore the world

Click a visible person in either viewport, choose a name in **Choose a Soul**, or select a person in the civilization roster. **Selected inhabitant** shows their current activity, accepted work, position in metres, needs, resources, held tools, carried objects, home, relationships and recent memories. These are operator inspection controls; they do not change what a resident knows.

1. Select a person and press **Follow selected**. The main camera follows their actual movement. Right-drag to look and scroll to zoom while following. Selecting another person changes the followed person; the map camera stays independent.
2. Press **Free roam** to stop following and focus the main viewport. Use **W A S D** to move, **Q** to descend, **E** to ascend, and **Shift** to move faster. Right-drag changes the view direction. Keyboard movement applies when the viewport has focus, not while editing a field.
3. Press **World overview** to frame the active world. **View home interior** opens the selected person's assigned home with its roof hidden. **Free roam** or **World overview** closes this deliberate cutaway and restores the nearby world.

The camera mode beside the view title identifies **Free roam**, **Following [name]**, or **Home interior**. Projects save both addressed camera positions and orientations. Following is a session choice: restoring a project retains its saved camera framing and starts without tracking a person. Camera movement does not move inhabitants or assign them work.

### Opening and restoring a realm

SOUL covers the viewports while it prepares the chosen world, saved cameras and scenery. It reveals them together after both views submit a frame of the completed presentation. Project replacement and GPU recovery use the same display barrier. A failed load keeps an error message visible; reopen SOUL to retry the saved project. Closing during preparation does not automatically save an unfinished opening.

SOUL explicitly uses RealmForge's original mesh renderer for both views. Its measured wall, furniture and person geometry stays visible after loading; the asynchronous SDF preview can omit thin construction details. This changes SOUL's display configuration without changing the shared renderer or world geometry.

A house under construction can still have an incomplete shell: its visible pieces follow the world's recorded construction stage. **View home interior** also intentionally hides a roof. These states are separate from loading a completed house.

Sources: `webgpu-os/apps/soul/SoulApp.js`, `SoulDashboard.js`, `RealmForgeWorld.js`, `SoulVillage.js`; `webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`.

Verification on 1 October 2026: 33 native WebGPU groups pass camera controls, canonical pointer selection, personal facts, saved camera restoration, covered activation/recovery, interrupted startup and storage refusal. Both native views retain all shell and roof groups for 100 completed homes. Late-frame screenshots confirm exterior and interior walls with the mesh configuration. Exact served source and before/after images are recorded under `tests/soul/viewport-camera-verification-20261001/verification.json`. Physical GPU removal was not induced; recovery recreated the original native GPU view owners.

### Live operation and animation checks

An actual source WebGPU OS session on the RTX 5070 Laptop GPU opened SOUL from the launcher, created an eight-person founder project, followed a moving person, ran society, paused, saved, closed and reopened the app. The reopened project retained world tick 88, eight individuals, selected person, tools and pending work. Kiro acquired tools, Eli began gathering berries, and residents issued social invitations. This short run demonstrated execution and restore, without establishing a self-sustaining settlement. Its screenshot and exact served code are under `tests/soul/live-learning-verification-20261001/visible-baseline-01/`.

Movement was visibly choppy in that baseline session. Separate native fixtures now exercise the imported skeletal walk, seated pose and original ground-rest action. The animation producer uses one presentation clock, stops while paused or hidden, and resumes without advancing through hidden time. Ground rest positions the rotated body above the terrain while preserving the canonical person's location. Current clips provide standing, walking, sitting and resting presentation; they do not yet provide action-specific tool strikes, hand-to-handle contact or a general manipulation animation system. The closer native screenshot also exposes a carried-basket gap: `SoulResourceView` retains its standing carry offset while the person rests, so the basket floats above the resting body. Tools need pose-aware attachments; physically setting one down must pass through the original object owner.

World transactions still commit and notify their original owners. Identical actor matrices retain their references, allowing the paired views to reuse an unchanged presentation. Changes to the compiled scene, source revision, transform, camera, region, or home cutaway force refresh; visibility resume also republishes pose geometry. This is a presentation optimization, with no skipped personal decisions, storage writes or collision checks.

`SoulPhysicalStorage.status().timings` supplies fixed aggregate counters for save, load, archive encoding/decoding, hashing, native reads/writes, reconstruction, currentness checks, geometry release/restore and head commit. Counts include failures and durations overlap when phases are nested. An initial native profile measured an eight-person society step at 2.19 seconds: 17 original transactions included about 872 ms presentation, 452 ms validation and 531 ms native journal writes. A fresh 100-person save/release took about 1.95 seconds, including about 1.02 seconds of currentness checks and 56 ms of native writes. These individual observations do not establish steady-state throughput or a whole-engine speedup. Currentness guards remain intact.

The repeat profile retained all 17 society transactions and measured about 49 ms in presentation within a 2.02-second step. Its fresh 100-person save/release took about 3.87 seconds, including 1.98 seconds of currentness checks. Validation and native writes were slower in this run, and shared dependencies changed between the two captures. Compare the individual spans and captured sources; these observations do not isolate an overall causal speedup. Both profiles passed the five native save, restore, refusal, execution and cleanup groups.

Sources: `webgpu-os/apps/soul/RealmForgeWorld.js`, `SoulVillage.js`, `SoulAnimation.js`, `SoulPhysicalStorage.js`; `tests/soul/animation-live.test.js`, `physical-save-profile.test.js`; `tests/soul/live-learning-verification-20261001/storage-profile-01/attribution-review.json`.

## Default books, reading and writing

**Library** shows 38 shared titles from the supplied *Particle Realms SOUL Master Plan C1*. The collection contains the plan’s 100 fictional example passages, short complete original first editions for the other titles, and 100 actual microstories in *100 Little Stories*. These are pocketbooks and example collections, not long finished volumes or records of events that occurred in this world. The collection’s source hash and each work’s origin remain saved with the text.

There are 42 finite physical copies: one of every title, plus extra copies of *The Book of Questions*, *Trials, Errors, and Discoveries*, *The Work of Our Hands* and *The Book of Souls*. A furnished village distributes them across eight selected household bookcases. A founder camp has two shared bookcases and retains its scenario without permanent houses. Placement uses RealmForge furniture generation and measured storage areas. Books use compact closed-book envelopes; this does not implement page mechanics or optical page reading.

People receive proposals to read personally visible copies, approach their shelves, or ask a nearby reader about an acquired passage. Actual execution checks custody, reach, visibility and the copy’s observed revision. Holding a book permits reading away from its original shelf. Existing object handling owns carrying, placement and displacement consequences; the library maintains no separate holder ledger.

Each individual retains up to 256 attributed passages. A firsthand record identifies the physical copy, edition, actual attempt receipt and tick. A delivered lesson retains that firsthand source and up to 16 teaching links. Nearby recipients can teach onward. Closed books do not supply their text to model evidence, and operator previews do not create personal readings. Only the selected individual’s acquired text enters the existing bounded memory feature encoder. This is exposure to attributed text, not demonstrated comprehension, a skill bonus or an immediate update to shared model weights.

To write an edition:

1. Choose a title in **Library**, then open **Write and publish this book**.
2. Edit its title, description and passages. **Add chapter** creates a passage that must contain text before saving.
3. Press **Save draft**. The durable manuscript remains unavailable to residents.
4. Press **Publish saved draft**. Existing copies receive the new edition and a new object revision. Previously acquired passages retain their original immutable edition and text.

World/project exports retain the catalogue, archived editions, drafts, physical copies and personal records. Old projects without a collection remain valid; opening one in the app installs the default collection through the original durable world transaction. Reading and teaching outcomes use the existing task and personal-experience workflow. Successful reading and teaching also retain the passage as Unicode-safe language chunks that fit the current 192-byte model context. The complete original text, edition, receipt and chunk order stay attached; all pieces of a work share a dataset source group. Sources still requires explicit review and compilation before WebGPU training; publishing never approves training.

Sources: `agi/soul/SoulDefaultBooks.js`, `SoulLibrary.js`, `SoulWorld.js`, `SoulFounder.js`, `SoulSociety.js`, `SoulWorldState.js`; `webgpu-os/apps/soul/SoulLibraryGeometry.js`, `SoulApp.js`. Browser verification: `tests/soul/library.test.js`.

## Personal discovery and neural learning

Founders begin without stored procedures. `SoulDiscovery` explores the actions currently offered by their real owners and tracks personally measured outcomes. Each individual retains at most 64 single-action procedures, 32 independent sequence variants and 128 recent episodes, with a separate saved random generator. Sequence variants retain their own steps, starting conditions, attempts, failures, observed returns and receipt evidence; a different recent prefix cannot overwrite an established variant's evidence.

The v2 contexts for supported physical actions include relevant needs, input quantities, capacity, target availability and usable tools. Unrelated possessions or need bands no longer split those procedures into separate contexts. Other action kinds retain conservative full contexts. A sequence also checks needs relevant to its later consumption or resting steps. Current targets are bound from permitted observations and checked again by their owners.

Sequences contain at most four steps. The learner works backward from a completed terminal effect through measured material inputs or actual use of an acquired, crafted or repaired tool. Production, delivery and shelter receipts preserve `consumedInputs`; resource links also require the corresponding inventory change, and tool links require actual wear. Sharing a standing commitment, passive energy recovery or chronological proximity alone does not establish a dependency. Execution requires at least two personally observed completions, a completion fraction of at least 60% and positive mean observed return. Failed or interrupted executions update that evidence.

Locally delivered teaching retains the teacher's provenance. Newly taught procedures and variants start with zero recipient trials, outcomes and receipt evidence. A person who already knows the terminal action can still receive a new sequence variant while keeping their own evidence. A bounded teacher prior can influence a single-action choice. An applicable taught sequence can enter voluntary practice at most twice, with an eight-personal-decision cooldown after each start. The first step must already be a currently available action. Every subsequent step uses the original owner and records its actual outcome. The inspector labels this as **taught sequence practice** and reports its starts, completions and failures separately. Ordinary learned execution still requires two verified personal traces, a completion fraction of at least 60% and positive mean return. Older sequence records remain historical; an active legacy sequence moves to recovery when the new semantic controller initializes its sequence bank.

Dependency extraction now uses the versioned `soul.personal-credit.v3` policy: at most 64 prior personal non-approach operations, within 600 simulation seconds from prerequisite completion to terminal completion. The existing 128-episode and four-step bounds remain. Other inhabitants' update ticks do not consume that personal window. Input spending, observed goods loss and tool custody breaks still prevent unsupported links. Untimed legacy episodes retain their historical meaning and cannot supply v3 credit.

This immediate episodic/statistical learning runs as ordinary world state in JavaScript. It does not update neural weights. Outcomes separately record need changes, acquired resources, accepted work completion, self/target harm and observed relationship consequences. Completion does not automatically endorse a theft, fight or other action for shared training.

Optional **Include serving model in decisions** adds WebGPU scores for the actual considered shortlist. New founder projects default to the explicit `pai-joint-v3` architecture: one shared core pass and a trainable candidate head. Existing v2 models retain likelihood scoring. Initialize or import a model first. Compact labels map back to the exact validated proposal, including routing and revision fields. The current 192-token context restricts the shortlist; it does not provide unrestricted language planning. Neural forward passes, training loss, backpropagation and AdamW updates remain WebGPU operations.

Personal travel uses actual navigation without an automatic authored greeting. Arrival receives an intermediate approach receipt; productive completion retains the original attempt identity. Conflicting manual attempts cannot overwrite a pending personal receipt. Rest and productive work cannot progress simultaneously. Restore checks active sequence references, step counts and the chronological personal receipts supporting completed steps. Shared lessons remain drafts until reviewed, compiled, trained and evaluated; candidate and serving checkpoints remain separate.

Sources: `agi/soul/SoulDiscovery.js`, `SoulFounder.js`, `SoulEconomy.js`, `SoulShelter.js`, `SoulLife.js`, `SoulWorldState.js`, `Curriculum.js`, `SoulRuntime.js`.

## Social capabilities and the existing village

Both scenarios retain world-owned combat, relationships, care and community actions. The furnished village uses the existing Engine utility controller. Founder proposals instead pass through personal discovery, with optional serving-model scores. The operator does not assign the normal society loop's goals. The following table describes the original village capabilities; founder resource and shelter owners extend these separately.

| Capability | World effect |
|---|---|
| Fighting and retreat | Reach-checked damage, stamina, injury, temporary incapacitation, recovery and physical retreat routes. Combat is currently nonlethal. |
| Theft | Transfers owned food, preserves resource totals, changes victim relationships, and creates memories only for local witnesses. |
| Affection and partnership | Familiarity and affection develop through interactions. Unrelated adults must separately propose and accept a partnership. Either can separate. |
| Families | Two partners separately agree to raising a child. A delayed arrival creates an individual with parents, age, inherited trait variation, personal memory and a rendered body. Adults care for children; children cannot perform adult romance actions. |
| Work and roles | Local requests can be voluntarily accepted. Gathering uses finite replenishing home food plots. Work completes only when owned food reaches the requester in person. A worker can navigate to the communicated meeting position; a departed requester is not silently tracked. |
| Communities | Trusted neighbours can found and independently join communities, elect coordinators and vote on delivered proposals for shared rules. Leadership requires an adult majority and does not itself impose a rule. |
| Teaching | A person with greater farming skill can teach a nearby individual. |
| Family housing | Parents can identify a child's shared-bed assignment, reserve stocked construction space, voluntarily join the work, and physically construct an additional furnished home. The child receives a distinct bed and walks to the new home. |

The legacy policy uses `AIUtility`; founder choices use personal discovery. World effects pass through `ActorTaskRuntime` and the canonical world transaction. Local social consequences reuse `SoulGraph`. These mechanisms do not establish trained neural social competence, emotions, consciousness or an already demonstrated self-sustaining civilization.

Society outcomes enter Sources as **drafts**. A successful theft or fight is an observed result, not an automatic training endorsement. Review, compilation, GPU training, evaluation and promotion retain the same approval boundaries as other experiences. The existing six-command learned model does not gain these new social commands merely because the simulator supports them.

### Friends, organizations and shared work

Founders can offer and independently accept friendships, and found groups, clans, guilds, companies, gangs or parties. Individuals can hold overlapping memberships. Delivered invitations, membership, coordinator election and acceptance of the role are distinct decisions. A kind or charter grants no additional custody rights, currency or automatic criminal behavior.

Shared plans support rally, travel, exploration, scouting, gathering, hauling, construction, watching, retreat, assistance and trade. Available proposals derive from the person's permitted ordinary actions and visible evidence. Seven formations are available: line, column, wedge, circle, square, staggered and skirmish. Roles describe voluntarily accepted plan responsibilities; they do not assign occupations or daily routines. Plan creation does not order another person to execute it.

Each participant receives a local plan disclosure and independently accepts. Changed assignments require current disclosure before physical action. Navigation and production use the existing owners. Arrival grants no materials; gathering, delivery and construction require actual productive receipts. All accepted participants must complete their responsibility. Scout/watch currently mean arrival and one inspection. Coordinated marching speed, continuous guarding, adaptive corridor formations, ranged combat and learned tactics are not implemented by this plan owner.

Busy participants can choose to continue, leave or cancel an accepted commitment. Withdrawal, membership changes and expiry retire matching pending work and release unused reservations. Completed goods remain. **Civilization → Organizations and parties** shows accepted members, coordinators, formation, plan revision, measured contributions and failure reasons. Selected-person relationships show friends and memberships. These operator panels do not disclose hidden facts to residents.

Group-containing native shortlists preserve personally delivered pre-action context and exact proposal references. They use personal outcome discovery. Current `pai-joint-v3` inputs do not encode group semantics; GPU group scoring and useful-choice group training stop explicitly. Observed receipts can become reviewed factual outcome text. Population measurements report excluded group choices separately and identify their personal-grounding scope. A new model version and held-out partner/communication evaluations are required before claiming learned strategy.

Organization histories have explicit budgets: 128 groups, 1,024 invitations, 256 ballots and 256 plans; each person has at most eight memberships and 32 friendships. Save/restore validates those records, mirrored invitations, private disclosures and plan receipts. Exhausted history budgets stop explicitly; exports do not currently compact institutional history.

Sources: `agi/soul/SoulOrganizations.js`, `SoulGroupPlans.js`, `SoulFounder.js`, `SoulSociety.js`, `SoulWorld.js`, `Curriculum.js`, `SoulRuntime.js`; `webgpu-os/apps/soul/SoulDashboard.js`, `SoulMeasurements.js`. Browser checks: `tests/soul/latest-organizations-result.json`, `latest-group-plans-result.json`, `latest-group-world-result.json`, `latest-group-protocol-result.json`, `latest-dashboard-result.json`.

### Legacy village family construction

In an existing furnished village, continue **Play society** with a family that needs more housing. A parent can choose `plan-home`; the owner reserves a clear expansion plot and its prefab stock. The planning parent accepts the work by initiating it. A nearby other parent receives an invitation and can independently choose `join-build`. `visit-build` schedules collision-checked travel; `build-home` requires the worker at the site with stamina and an elapsed work interval.

This legacy construction has 12 persistent stages. Each stage displays actual groups from the same RealmForge house used for the furnished village homes and consumes precisely those groups' product counts. Shell groups precede roof and furniture groups. The complete house contains 2,075 installed pieces in the current furnished template, with a bedroom, living room, kitchen and bathroom. The bed retains its measured resting anchor. These counts do not describe the founder shelter system, whose parts and work stages depend on its resident proposal.

The legacy village starts with finite prefab stock for 28 additional homes. These are prepared cut pieces matched to the generated bill of materials. Supply is staged at a reserved site; logging, mining, manufacturing and physical material haulage are not implemented by this legacy loop. Founders use their separate finite natural-resource owner and material-backed shelter construction. Work times in both scenarios are simulation parameters, not real-world labor estimates.

Unfinished footprints exclude people through world collision and owner validation. Their temporary site markers remain visible. A site cannot be assigned as a completed home. Completion assigns its owner and unique bed, makes furniture interactions available, and retires obsolete routines tied to the previous home. The child moves through the existing navigation system and can choose sleep on its new bed. Parents can visit a dependent's known home without receiving hidden live position updates.

Open **Civilization → Family construction** to inspect stages, builders and remaining stock allocations. Save/export retains reservations, installed pieces, progress and ownership. Restore validates conservation against the trusted template. Deleting the construction ledger cannot replenish stock while keeping the buildings. Construction receipts enter Sources as drafts for review.

Source: `webgpu-os/apps/soul/SoulHousing.js`, `SoulVillage.js`; `agi/soul/SoulSociety.js`, `SoulLife.js`, `SoulWorld.js`.

### Persistence and current bounds

The project retains the social clock, RNG, decision cursor, needs, relationships, offers, votes, family arrivals, lineage and routes. Definitively rejected task effects are retired through the task runtime before another choice. Invalid saved affiliations, inventories, ballots and family references are rejected before activation. Failed owner storage writes preserve the active state.

Defaults are 100 initial people, a population limit of 128, and a 270-day delay after a mutual family decision. New founder projects save a versioned policy of 600 simulation seconds per day, with daily hunger/thirst/energy/loneliness rates of 0.8/0.9/0.3/0.09. Existing projects without that policy preserve the previous 60-second day and previous need rates. Wall time depends on simulation throughput. Founder children can arrive without a permanent house; they receive fresh personal discovery state and resources through conserved family transfers. Their visual uses the existing humanoid mesh scaled by age, not a dedicated child model.

The legacy village retains home food plots and prefab construction stock. Founders have finite food, water, wood, stone, fibre and ore sites, bounded recipes and resident shelter proposals. Farming, regrowth, metal refining, currency and weather survival are not implemented by the founder resource owner. Community ballots still select among three authored norms; learned legislation and enforcement institutions remain future work. Multi-generation survival, durable division of labor and learned town planning require unforced long-duration studies.

Source: `agi/soul/SoulSociety.js`, `SoulWorld.js`, `SoulLife.js`; `webgpu-os/apps/soul/SoulApp.js`, `SoulVillage.js`, `RealmForgeWorld.js`.

## Inspiration from Sword Art Online: Alicization

Underworld is useful as a fictional design reference for persistent lives, relationships and a society developing through experience. It is not a technical specification for a browser model or evidence that a small neural network is conscious.

The official first episode describes Kirito and Eugeo growing up in Rulid, their assigned Calling, and the Taboo Index. The official thirteenth episode describes Cardinal as an autonomous system preserving order and discusses the origins of the Church and Taboo Index. Thus, the anime's society includes substantial imposed authority. SOUL follows the requested direction of voluntary work and residents' decisions about leadership and rules. Sources: [official episode 1](https://sao-alicization.com/story/01.html), [official episode 13](https://sao-alicization.com/1st/story/13.html).

The official War of Underworld introduction explicitly frames the project around bottom-up AI and conflict between societies. The licensed novel description emphasizes an inhabitant with emotional depth and childhood memories. These motivate separate personal histories, development and consequential interaction in SOUL. They do not supply an implementable learning algorithm. Sources: [official introduction](https://sao-alicization.com/intro/), [Yen Press: Alicization Beginning](https://yenpress.com/titles/9780316560993-sword-art-online-9-light-novel).

## Run a legacy village daily routine

1. Open or import an existing furnished village project. The world starts paused; founder projects do not offer authored daily routines.
2. Select an inhabitant and choose **Daily routine** for that person. **Play society** instead starts autonomous decisions across the population.
3. Use **Frame selected** to inspect walking and **View home interior** to inspect furniture and resting poses.
4. Pause or save at any point. The project retains the route, waypoint, routine stage, needs, personal memories, receipts and pending experience records.

The routine returns home, sleeps in the assigned bed, wakes, washes, prepares food, eats while seated, visits a neighbour, and returns to the living room. A greeting is delivered only if its recipient is within hearing distance. A visit without a recipient records that outcome. Blocked paths are reported instead of completing the task remotely.

Source: `agi/soul/SoulLife.js`, `webgpu-os/apps/soul/SoulApp.js`.

## World and presentation

Legacy village homes reuse RealmForge construction and room composition, with bedroom, living-room, kitchen and compact bathroom furniture. Founder shelters use their own bounded material-backed ForgeSource assembly, private sleeping rooms and shared cooking/living facilities. Fixtures do not imply simulated utilities or plumbing.

Movable bedrolls and supported household furniture retain stable object identity, collision and interaction anchors when placed or rotated. Moving a support is rejected while another object depends on it; remove the supported object first. Structural shelter pieces remain under the construction owner.

The Engine grid pathfinder plans routes. Every movement segment is checked by the shared RealmForge body collision resolver. People yield and replan around temporary obstructions. Seating and lying use the generated furniture's actual seat and resting anchors.

The existing humanoid skin is animated with sampled skeletal poses. Static buildings stay resident while actor matrices and shared pose vertices update. Animation is an OS-owned frame producer and stops when the app pauses or closes. The home cutaway changes the operator's view; personal observations still use world occlusion.

### RealmForge scale verification, 29 September 2026

Transform-only source revisions now preserve the published GPU layout after comparing mesh values, materials, bindings, batch order and picking identities. `ModelerViewport.setNodeMatrixUpdates` validates the whole sparse update before mutation and repacks only affected instance batches. Structural or presentation changes still republish. Repeated selection of the same person does not dirty the scene.

Real Blackwell WebGPU measurements:

| Scene / change | Full instance upload | Sparse instance upload |
|---|---|---|
| 16,384 static instances and one moving instance | 1,376,340 bytes, 65 uploads | 84 bytes, one upload |
| Eight founders, a held axe and 2,048 extra static pieces; each view over each of three movement ticks | 205,548 bytes, 84 uploads | 11,088 bytes, 26 uploads |

The moving-world case uses about 18.5 times fewer instance bytes. This is an upload comparison, not an isolated frame-rate result or a whole-engine speedup. Tests also render a 66-node home cutaway, move its occupant and restore the overview of a furnished 31,331-node village. The compact bathroom fallback now recognizes structured room-fit errors while retaining door, window and walking clearances.

Shared hierarchical coordinates no longer coerce sector identities into signed 32-bit integers. Standard sectors validate their declared range; BigInt sectors retain larger exact addresses. Normalization uses constant-work carries, and failed additions or copies preserve the original value. Tests cover positive/negative large sectors, nearby relative precision and conversion boundaries. Flattening enormous coordinates still loses precision. The addressed scenery implementation keeps exact sector/local identities separate from its local GPU matrices.

The active simulation remains resident with a 32,768-source-piece safeguard and bounded local movement coordinates anchored by an exact, immutable simulation frame. Separately streamed static scenery now has its own versioned region owner. This expands the persistent visual catalog while bounding the current working set; it does not permit autonomous cross-sector travel. The [next simulation integration](soul-civilization-roadmap.md#realmforge-and-streamed-worlds) records the remaining ownership and navigation changes.

Sources: `webgpu-os/apps/soul/RealmForgeWorld.js`, `webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`, `webgpu-os/apps/realmforge/construction/RealmForgeHousePlumbingFixtures.js`, `engine/world/HierarchicalCoords.js`. Reports: `tests/soul/latest-realmforge-scale-result.json`, `latest-realmforge-coordinates-result.json`, `latest-realmforge-plumbing-result.json`.

Source: `SoulVillage.js`, `SoulAnimation.js`, `RealmForgeWorld.js` under `webgpu-os/apps/soul/`; `agi/soul/SoulWorld.js`.

### Addressed physical camp and bounded navigation, 29 September 2026

**Project setup** now offers **Camp sector** and **Camp offset (m)** when creating a new founder project. The active camp address is displayed with navigation cache usage. The sector uses exact decimal strings; the offset and physical owners use local metre coordinates. Creating a camp still archives the previous complete project. Its address remains fixed for that world identity. **Follow**, home inspection, overview and **Return both views to camp** use the camp frame.

The `soul.world.v2` owner envelope includes `soul.simulation-frame.v1` with a world-bound ID, exact origin and metre units. Legacy `soul.world.v1` projects migrate to zero origin without rewriting their local positions, IDs, pending tasks, RNG, action signatures or sealed personal history. Existing historical records retain their implicit zero-frame meaning. New observations, grounding metadata, resource knowledge, discovered-object beliefs, episode receipts, experience outboxes and group destination/assignment/progress snapshots bind to the captured frame. Observer heading remains separate. Neural feature arrays and the saved model architecture remain unchanged.

World transactions cannot change the frame identity or origin. Restore rejects explicit bindings from another world or origin before replacing owners. A same-identity project import or newer world journal cannot re-anchor the active camp. `SoulWorld.address(id)` derives an exact address from its local position; `localPosition(address)` refuses distant addresses and positions outside active physical bounds. Cameras do not define physical ownership or personal evidence.

Navigation checks complete rectangles before the Engine allocates a grid or A* scratch. The current admission limits are 1,000,000 cells, 2,048 cells per axis, 4,096 saved route points, 100 cached grids and 8 MiB of cached walkable bytes. The cache figure excludes obstacle records, pathfinder scratch and total browser heap. Ground masks respect active physical bounds with the body's 0.23 m inset; absent regions are unavailable. Budget, unavailable-terrain and blocked-route failures remain explicit. Existing measured stairs and floor transitions remain the only vertical connections.

Eleven pure browser frame groups pass strict identity/canonical validation, huge-origin centimetre arithmetic, legacy task/history migration, frozen-graph binding certificates, foreign/missing evidence refusal, action identity and next-choice reproduction, resource observations and actual group snapshot bindings. Nine navigation groups verify refusal before allocation, active-bound terrain masks, actual movement and restore, blocked-state reasons, byte/entry cache eviction, geometry invalidation, obstacle detours and persistent route limits. The existing home, stair, group and grounding owner regressions pass. Saved-model compatibility retains its original 161,714 parameters, 47/48 held-out results, step 150 and cursor 900.

Seven native app groups pass actual GPU rendering and OPFS persistence at a `10^60` sector address: legacy migration, address validation before writes, old-project archive, independent cameras, pending travel export/import, wrong-frame rejection and recovery/closure. The strict-CAS app host is a fixture over actual OPFS; the separate storage suite verifies the OS StorageManager. Seven actual Blackwell renderer groups also retain 1 cm canonical separation at enormous sector addresses and cover the actual furnished village and home cutaway. No training ran in these checks. The first native founder regression exposed a seeded trial ID assigned after frame creation; its failure receipt is retained as `tests/soul/simulation-frame-founder-trial-identity-failure-20260929.json`. Trials now create the intended identity and frame together. The corrected native founder regression passes all twelve groups.

This is the physical address and navigation foundation. All canonical camp owners remain resident. It does not implement dormant region simulation, regional terrain loading, owner partitioning, NPC boundary handoff or cross-sector travel. The [streaming roadmap](soul-civilization-roadmap.md#realmforge-and-streamed-worlds) keeps those dependencies explicit.

Sources: `agi/soul/SoulSimulationFrame.js`, `SoulWorld.js`, `SoulNavigation.js`, `SoulLife.js`, `SoulDiscovery.js`, `SoulFounder.js`, `SoulEconomy.js`, `SoulGroupPlans.js`, `SoulOrganizations.js`; `webgpu-os/apps/soul/SoulApp.js`, `RealmForgeWorld.js`. Reports: `tests/soul/latest-simulation-frame-app-result.json`, `latest-simulation-frame-result.json`, `latest-navigation-budget-result.json`, `latest-presentation-region-views-result.json`.

### Cooperative scenery preparation, 29 September 2026

This completed milestone paced preparation **between whole region jobs**. It retained the Engine's four concurrent storage reads and serialized CPU preparation through one gate across generations. After 8 ms of accumulated synchronous work or four compiler invocations, the owner yielded through an abortable browser task or the native guarded `gpu.preparationCheckpoint`. The complete previous preview remained published until the demanded union passed every check. An older asynchronous compiler could not overlap its replacement.

The frozen browser protocol receipt passes 21 groups, including stale queued work, current checkpoint failure/retry, reentrant disposal and draining superseded asynchronous publications. Nine native hardware groups pass broker reuse, permission/cancellation/lease refusal, cleanup, cached preparation, portable preflight and closure. During seven new 256-part region preparations, seven completed OS checkpoints admitted twelve requested renderer callbacks/submissions while the prior one-region preview remained published. The eight-region union published after 424.7 ms elapsed. Cumulative preparation, including the baseline region, used 152.4 ms CPU; its longest indivisible job was 28.8 ms. Separate eight-source catalog prevalidation used 76.7 ms CPU and six yields.

Those measurements describe the completed between-job implementation. A whole job could exceed the 8 ms target before the next yield. The [incremental preparation workflow](#incremental-scenery-preparation-29-september-2026) now splits work inside a region. The historical receipts remain immutable under `tests/soul/preparation-verification-20260929/`: `presentation-regions-b9cca5c514ccddd6.json`, `preparation-app-ab9b4c1fd3563ed6.json` and `region-app-fc33925d1bc02420.json`. Their source hashes remain in `source-finalization-20260929T230037177582Z.json`. These CPU and wall-time observations are not isolated FPS or a general throughput comparison.

Historical sources: `agi/soul/SoulPresentationRegions.js`; `webgpu-os/apps/soul/SoulApp.js`; `webgpu-os/kernel/Syscalls.js`; `engine/core/gpu/GpuFrameBudgetBroker.js`.

### Derived physical geometry release, 30 September 2026

Open **World extent · terrain and streamed scenery**, then choose **Save & release unused geometry**. SOUL pauses society, drains accepted work and saves the complete canonical generation. It verifies every archive and publishes the exact guarded native head before releasing reconstructible compiled geometry. **Restore geometry** rebuilds the full scene. The status shows retained parts, released payloads, node count and release/reload counts separately from canonical cell membership.

The working set retains every actor body plus geometry needed by perception, cargo, supports, captured routes and commitments. Compiler groups stay together: prefab houses and their generated furniture, planted trunk/crown pairs, live economy trees, compound furniture and shelter/economy source members. Unknown structural links retain the full scene. Durable paused task journals can be saved; unresolved read envelopes block release.

The complete canonical source, every individual, shared ledger and measured collision-envelope directory remain loaded. The World drops derived scene references and clears exact collision detail and navigation caches. Both native views replace their node/picking/resource projections. Shared asset prototypes remain under their existing cache owners. Asynchronous SDF preparation can temporarily retain an older preview or candidate until its guarded preparation/retirement settles. Released-part counts describe compiler input identities; they are not browser heap or VRAM measurements.

Known synchronous World reads now acquire their original lease and resolve the required geometry owners before deciding to reload. `boundsFor`, `visible`, `observe`, `modelInput` and `obstacleBounds` reuse the released scene when every dependency is already resident. `collisionObjects` reads the complete measured envelope directory and canonical object records without requiring detailed geometry. `SoulLife.obstacles` uses the original obstacle read with its existing body padding and height filter. Known missing owners now reconstruct their complete compiler/support groups before dependent reads. Unknown scopes retain the original complete reload.

Visibility retains its 12 m limit from the eye position, 0.65 m above the body position. Observation admits an eye-centred 12 m region and potential visible targets, including their retained furniture/compiler groups. It still scans the complete canonical object catalogue and applies the same occlusion and custody checks. Personal memories, messages, captured destinations and delivered organization evidence retain their existing scope; camera or operator inspection does not provide hidden facts.

Arbitrary `withPhysicalQuery` callbacks and caller labels cannot authorize resident-only admission. Asynchronous or thenable callbacks, custom navigation inputs, arbitrary mutations and actual movement retain complete hydration. Known original look, inspection, reading and teaching tasks have bounded dependencies; other task semantics retain complete hydration. Resuming society therefore restores full geometry when its first mutation enters, while inspecting personal observations can preserve the smaller scene. Exact boxes for unadmitted geometry reject direct access. A failed reload retains the smaller scene and invokes no dependent mutation. A successful reload advances the residency epoch, expires old cuts and clears navigation before reads or movement. Cheap status and camera presentation changes do not automatically rebuild physics.

**World extent** also shows **Physical reads** from `SoulWorld.physicalReadStatus()`: reads that used loaded dependencies, requests for selective groups, reads requiring complete geometry and failures. The API includes total calls and per-kind counters. Resident hits count admitted reads while derived geometry is released; nested calls count separately, including visibility checks that need no detailed geometry. These counters do not measure browser heap, VRAM, saved bytes or frame rate. The preceding release measurements retain their original tested-source scope.

`SoulPhysicalStorage.saveAndReleaseGeometry(world, {publish})` reuses the original save cut and exact native compare-and-swap path. Copied metadata cannot replace that cut. Activity or closure after an accepted head write produces a historical save with `geometry: null`. Compiler/projector preparation and synchronous publication reject reentrant admission or disposal. The original canonical boundary is rechecked after preparation and publication. A failed second-view publication rebuilds both original scenes; lifecycle logging does not change a completed release outcome.

`SoulWorld.physicalGeometryStatus()`, `releasePhysicalGeometry(originalCut, {publish})` and `reloadPhysicalGeometry()` describe this derived-resource workflow. It preserves the original World and actor task owners. Existing Life movement still commits body, carried objects, held tools and the crossing receipt together. This does not implement selective canonical-cell archive loading, dormant inhabitants, regional runtime handoff or a larger physical admission profile. Selective derived reconstruction and the initial bounded task grammar are described in the selective loading section. Productive/movement task envelopes remain required before a canonical owner split or regional admission.

The fresh native 100-person fixture retained all 1,467 canonical source parts, released 181 derived inputs and reduced each view from 3,373 to 3,186 nodes. Reload returned both views to 3,373 nodes with the same world, model, curriculum and cameras. Ten focused browser groups pass verified storage, held dependencies, failed reloads, synchronous reentry refusal, second-view rollback, huge-sector carried-tool crossing and closure. Separate regressions pass six collision-cache, sixteen lease, thirteen physical-region and seventeen generation-loading groups. Fifteen actual WebGPU SDF groups also pass: intentional inactive zero-scale poses are excluded using current presentation state, while five invalid visible transforms retain strict rejection. Three affected packaging tests pass after their fixture descriptors were bound to the exact copied compute bytes; production checksum checks remain unchanged.

The immutable receipts, served JavaScript hashes, earlier diagnostic scopes and tested ownership bindings are indexed by `tests/soul/physical-residency-verification-20260930/verification.json`. The final native and SDF runs bind the RealmForge versions used during execution. Later shared viewport changes preserve the inactive-pose policy and its live callbacks in a source review; the hardware results remain bound to the tested viewport version. Older regression receipts retain their exact served-source scope. No neural training, browser heap, VRAM, frame rate or civilization throughput measurement ran in this slice.

The resident-read continuation passes nine focused browser groups and fifty existing regression groups. In the actual native 100-person app, both views stayed at 3,186 nodes after release through 24 observations, 24 model inputs and an inspector refresh. All 1,467 canonical parts remained saved; 181 derived inputs were released. The read counters recorded 15,777 nested resident hits, zero full fallbacks and zero errors during that check. A missing distant exact owner then produced one full fallback and restored both views to 3,373 nodes. World data, GPU model tensors, reviewed curriculum, media owners and both cameras stayed exact. The fixtures also check wall occlusion, personal isolation, long/rotated/source-only geometry, eye-height furniture, compiler failure/retry, arbitrary labels, async closure, Life obstacles/navigation and durable task blockers. Current evidence and actual served-source hashes are indexed by `tests/soul/physical-read-envelopes-verification-20261001/verification.json`; each regression retains its tested dependency versions. No neural training or throughput measurement ran.

Sources: `agi/soul/SoulPhysicalResidency.js`, `SoulCollisionIndex.js`, `SoulWorld.js`, `SoulLife.js`; `webgpu-os/apps/soul/SoulPhysicalStorage.js`, `SoulApp.js`, `RealmForgeWorld.js`. Focused browser fixtures: `tests/soul/physical-residency.html`, `physical-read-envelopes.html`.

### Fixed finite navigation reads, 1 October 2026

`SoulWorld.navigationFor`, `destinationFor`, `routeFor` and `surfaceRouteFor` now provide fixed synchronous navigation reads through the original World owner. `SoulLife` and `routeSoulSurfaces` delegate to those entry points. Each read acquires its original lease and selects dependencies from canonical actor/home/destination records and the complete measured collision envelopes. Missing canonical groups now load selectively before the reader enters; unknown scopes retain full reconstruction. Callers cannot supply a finite callback or name their own dependency scope.

Grid admission covers the complete original obstacle rectangle before cache lookup. Destination admission also retains the measured interaction owner when that branch uses it. Surface routes cover every candidate ground leg, selected stair waypoints and selected upper-floor polygons before the original candidate recovery loop. A compiler failure therefore remains a physical admission failure rather than being retried as an ordinary blocked destination. Original obstacle padding, height filters, floor/stair links, candidate ordering and allocation budgets remain in use. Ground coverage and shelter navigation metadata come from the complete canonical terrain/design ledger.

The navigation cache is private to the original Life owner. It retains numerical grid, obstacle and bounds data; public grids, arrays, maps and home/neighbour records are detached. Cache keys include the exact origin and destination, including height, terrain eligibility, rectangle and world bounds, source/terrain/residency revisions and `navigationRevision()`. Successful geometry publication, collision index replacement or object container changes advance that navigation epoch and clear the old cache. A failed publication does not advance it. Home/neighbour metadata is refreshed from the current canonical request rather than retained in the numerical cache.

Only original storylet stages captured as strict data and finite dense route vectors enter the reduced read path. Custom, malformed or accessor inputs use the original full-admission path. Arbitrary callbacks and asynchronous or thenable work retain full admission. Founder travel uses its saved personally observed target and does not fetch unused current interaction geometry to reveal a moved anchor. These navigation entry points do not change task journals or actual movement. Known original task protocols now use explicit obligations; arbitrary mutations and movement effects still hydrate completely. All canonical source, people and shared ledgers remain resident.

The selective loading continuation now adds compiler-group reconstruction and an initial bounded task grammar under the same World/storage authority. The following continuations add resource, movement, placement and crafting/repair envelopes. Broader task envelopes, canonical paging, dormant residents, a regional route planner and actor handoff remain future work. Historical release and resident-observation receipts retain their original served-source scope.

Ten focused browser groups and fifty-nine existing regression groups pass. The actual native 100-person app retains both 3,223-node views through 24 navigation, 24 destination and 24 route reads plus inspector refresh. The complete scene has 3,374 nodes per view and 1,468 canonical parts; 148 derived inputs are released. Counters record 342 nested resident hits, zero full fallbacks and zero errors during that check. One missing planner dependency then produces one full fallback and restores both complete views. Canonical world data, GPU tensors, approved curriculum, media owners and cameras remain exact. Conserved two-floor construction supplies five verified upstairs, downstairs, mid-stair and landing cases. Fixtures also verify exact bitmap/obstacle/route parity, changed endpoint elevation over a real ground gap, detached exported helpers, metadata invalidation, failed commits, compiler failure/retry, captured moved targets, legacy iterables and durable task blockers. Evidence and actual served-source hashes are indexed by `tests/soul/physical-navigation-reads-verification-20261001/verification.json`. No neural training or throughput measurement ran.

Sources: `agi/soul/SoulWorld.js`, `SoulLife.js`, `SoulNavigation.js`. Focused browser fixture: `tests/soul/physical-navigation-reads.html`.

### Selective geometry loading and task dependencies, 1 October 2026

After a verified save releases derived geometry, original bounded readers load missing canonical compiler groups instead of rebuilding every mesh. `prepareSoulPhysicalDependencySource` closes the union of resident and required source IDs over prefab contents, furniture, trees, economy/shelter groups and recursive supports. Every actor remains resident. Source order and canonical identities remain unchanged. The complete measured collision-envelope directory stays available; detailed boxes use the newly admitted scene. Unknown owners, arbitrary callbacks and unsupported compiler graphs retain full reconstruction.

`SoulPhysicalTaskDependencies` recognizes exact original `soul-look@1` and `soul-society@1` methods for `inspect`, `read-book`, `learn-book`, `rest-here`, `sit-here`, resource extraction, crafting, repair, resource-work, resource-cancel, delivery and tool exchange, store transfers, exploration and loose-object placement. The World first validates saved and live journals through the original `ActorTaskRuntime` restore grammar, including expanded steps and effect progress. Dependencies retain the actor, inventory, held tools, book copy and supports, teachers, eye-height observation regions and captured destinations. Book work/unit/edition IDs remain semantic metadata. Source references remain provenance. Original custody, visibility, revisions and delivered learning receipts still decide whether an action succeeds.

Settled paused known work can release unrelated geometry. Unknown proposal fields, other action semantics, care/suspended tasks and unresolved effects retain conservative fences. Known jobless book approach/ready work retains its copy and captured destination; an active route without a complete captured envelope still prevents release. Global productive ticks, crafting/repair escrow cancellation, construction, actual placement effects and actual movement retain their existing full paths. Crafting/repair admission and resumption use the bounded dependencies below.

Original checkpoint, archival, admission and bounded receipt updates can preserve the current partial scene. A read may load geometry while a native checkpoint write is awaiting storage. The journal commit then keeps that latest shared compiler generation rather than restoring the subset captured before its await. Source changes rebuild complete geometry. Synchronous preparation/publication guards reject reentry, and native presentation uses one publisher for both views on forward publication and rollback. Failed compilation or publication retains the previous scene, collision owner and navigation epoch before retry.

**World extent** reports selective load counts separately from full reloads. `physicalReadStatus().selectiveLoads` counts requests, including failed attempts; `physicalGeometryStatus().selectiveLoadCount` counts successful selective publications, and `selectivelyLoadedParts` counts admitted canonical derived inputs. These counters do not establish VRAM, heap or throughput improvements. The existing physical scene and owner budgets remain in force.

The dedicated actual-browser fixture verifies compiler closure, three sequential selective loads, original evidence/navigation parity, failure/retry, reentry, publisher rollback, paused task continuation, native checkpoint/read overlap, physical reading, local teaching and conservative unknown scopes. Its two-person scene retains 157 of 354 canonical derived inputs after release; loading one requested compound adds exactly three inputs (160 resident), while unrelated meshes stay released. All 354 canonical records stay saved. Three sequential loads add five inputs with zero full fallbacks in that case. Original lease, collision, physical-region, discovery and interrupted-work regressions are retained separately. Receipts and actual served-source hashes are indexed by `tests/soul/physical-selective-verification-20261001/verification.json`.

This slice's recorded logic checks use actual RealmForge compilation, original actor owners and native OPFS with GPU disabled. Native viewport gates are separate; earlier hardware evidence retains its tested-source scope. No neural training or performance measurement is attributed to these logic checks.

Sources: `agi/soul/SoulPhysicalResidency.js`, `SoulPhysicalTaskDependencies.js`, `SoulPhysicalRetention.js`, `SoulWorld.js`; `webgpu-os/apps/soul/SoulApp.js`. Focused logic fixture: `tests/soul/physical-selective.html`. Native selective publication and second-view rollback checks: `tests/soul/physical-read-envelopes.html`, `physical-navigation-reads.html`.

#### Resting and sitting dependencies

The original rest and sitting proposals retain the person, carried objects/tools, optional furniture and its support chain, personal observation region, and captured approach position. The observation region includes nearby furniture candidates for the owner's automatic local search. Dependency classification does not grant the furniture or report it as usable: the Founder owner checks personal visibility, distance, interaction type and occupancy. An occupied, hidden or unsuitable known target reaches that owner's ordinary rejection. Untargeted rest uses the ground when no personally visible, reachable resting furniture is available.

A jobless pending rest can release unrelated derived geometry only when it is the person's actual `founderPending`, has an actual `founderRest`, and retains the completed sleeping or sitting pose and matching explicit target. The retention report also preserves the occupied furniture, original return position and rendered pose position. Cancellation or inconsistent pending state keeps the full fence until the original owner settles its receipt. Paused rest/sitting actor tasks continue through the same validated checkpoint and admission paths as reading.

Unknown proposal fields, unclassified productive jobs, care interruptions and unresolved actor effects retain their existing full scopes. The ordinary society and Life update paths still hydrate complete geometry. This continuation improves task admission and save/release while resting; it does not introduce partial simulation ticks or canonical cell paging.

Discovery validation now accepts frozen generation captures containing learned atomic procedures and independent sequences without replacing their saved condition fields. Mutable legacy records keep their existing canonical JSON normalization. Validation still binds each context to its conditions, including memoized immutable leaves, and verifies the original sequence identity. This fixes save/release after an actual rest completion or cancellation.

Sources: `agi/soul/SoulPhysicalTaskDependencies.js`, `SoulPhysicalRetention.js`, `SoulFounder.js`, `SoulDiscovery.js`, `SoulWorld.js`. Continuation evidence: `tests/soul/physical-rest-verification-20261001/verification.json`.

#### Resource extraction task dependencies

Gathering, chopping and mining proposals retain the actor, carried objects/tools, canonical resource site, personal observation region and captured approach position. Original economy checks still decide visibility, reach, the supported extraction method, usable tool custody, stock reservations and carrying capacity. Dependency classification grants no goods or action permission. Admission creates a pending work record; only actual elapsed work produces conserved output and tool wear.

Resource-work and resource-cancel resolve the person's actual resource job. Its canonical site, tool and current holder, empty input bundle and captured work location form bounded dependencies. A pending productive receipt uses the same parser and must match the actual actor-owned resource job and supported original extraction proposal. Semantic job IDs are not mesh owner IDs. Unknown fields and unmatched jobs keep the complete fence. Crafting/repair escrow is covered by the following production continuation. A no-job cancellation follows the original bounded rejection, including the final task checkpoint after a successful cancellation removed its job.

Paused task and productive-job saves retain the complete canonical generation while releasing unrelated derived meshes. Restore validates the original runtime journal and the same pending work identity. Cancellation removes the actual job and settles its original personal outcome without granting output or wear credit. Completion retains exactly one productive receipt and unapproved curriculum draft. Ordinary global Founder, Society and Life ticks still hydrate the complete scene: a stock projection can remain unchanged between visual thresholds, so an unchanged source revision does not prove a bounded global update.

Eighteen focused actual-browser groups and 89 existing regression groups pass with GPU disabled; the physical workflow uses native OPFS. They cover genuine pre-effect task archive/restore, partial resource-job pause/restore/resumption, gathering, chopping, mining, stolen/broken tools, hidden sites, competing stock reservations, full bags, cancellation, and failed native effect commits. The controlled branch job preserves progress 2/5 seconds across restore and transfers exactly two wood from stock 160 to 158. Ten chopping seconds transfer five wood and fourteen mining seconds transfer two ore; both use exactly one durability point and settle one unapproved productive outcome. Admission and cancellation grant no output or final wear.

The pending native hardware gates now pass separately: nine physical-read groups, ten navigation-read groups and ten geometry-residency groups. The actual 100-person observation fixture keeps both views at 3,246 nodes from a complete 3,433-node scene; one missing known owner selectively raises each to 3,247 while unrelated geometry remains released. A controlled failure in the second viewport rolls both views back before retry. Repeated navigation keeps both 3,283-node views reduced, then a missing planner dependency selectively raises them to 3,299 within the complete 3,434-node scene. Actual GPU model tensors, approved curriculum, cameras and canonical data remain exact, and closure drains buffers and frame producers. These are correctness and lifecycle checks, with no neural training, whole-world memory or throughput claim.

Sources: `agi/soul/SoulPhysicalTaskDependencies.js`, `SoulPhysicalRetention.js`, `SoulWorld.js`, `SoulFounder.js`, `SoulEconomy.js`. Focused fixture: `tests/soul/physical-selective.html`. Continuation evidence: `tests/soul/physical-resource-verification-20261001/verification.json`.

#### Exploration and placement task dependencies

Exact original exploration proposals retain the actor, carried objects/tools, personal observation region and required captured destination. Execution of the admitted proposal schedules the original personal travel. It grants no movement, arrival or productive credit. Active travel with no planned route still prevents geometry release. Once the original Life owner records a route, retention preserves its remaining swept corridor and captured destination. Every actual Life update, cancellation and Founder outcome settlement still uses complete geometry. A later replan therefore cannot treat released detail as empty space.

Exact original `take-object`, `place-object`, `push-object` and `rotate-object` proposals retain their canonical object, compiler group, recursive current support/container, inventory and supplied destination. Captured travel coordinates remain separate from the requested final placement. Degree rotations use the existing 3,600-degree bound; world positions use the existing 1,000-metre bound. Stale revisions, hidden targets, other custody and occupancy reach the original placement owner for its ordinary refusal.

Placement obligations carry a detached `fullEffect: true` marker. The original private World effect path derives that marker only after checking the admitted task, registered step and exact resolved payload. It then admits complete geometry before calling the Founder and Placement owners. Their existing support scan, candidate compilation, swept collision checks and witness observations remain complete. A caller-supplied marker is an unknown proposal field and cannot authorize selective execution or geometry release.

Saving and restoring a paused intent retains the complete canonical archive and original runtime journal. Unknown fields, altered steps, care/suspended work and unsettled effects keep the existing full fences. This continuation bounds intent retention and checkpoint operations; it does not make physical movement or placement effects partial, or establish canonical paging.

Twenty-four focused browser groups and 98 existing regression groups pass with GPU disabled. The focused physical workflow uses the actual RealmForge compiler, original owners and native OPFS. A paused exploration keeps 61 derived nodes from a 398-node complete scene while saving all 354 canonical source records. Its restored owner plans and completes one actual arrival; a separately restored complete owner reproduces the next movement step. A genuinely moved bedroll retains its old captured approach, then fails the original current-use check. All four loose-object actions enter with complete geometry, including thin-wall and stale-revision refusals. Failed hydration and native custody commits publish no phantom movement, inventory or productive learning. These are correctness checks, without neural training, throughput or whole-world memory measurements.

A separate fresh hardware WebGPU suite passes nine groups. Its actual 100-person app preserves both 3,246-node views through paused placement and protocol resume, then hydrates both to 3,433 nodes before original owner execution. One stale-object rejection blocks the runtime with `effect-rejected`; it changes no source geometry, object custody, inventory, serving GPU tensors, approved curriculum or cameras. The suite also verifies selective publication rollback and resource cleanup. An earlier fixture incorrectly expected a terminal rejected task; its exact source and failed receipt are preserved, and the corrected rerun changes no production code.

Continuation evidence: `tests/soul/physical-movement-placement-verification-20261001/verification.json`. The earlier navigation and residency hardware suites retain their prior frozen-source scope.

Sources: `agi/soul/SoulPhysicalTaskDependencies.js`, `SoulPhysicalRetention.js`, `SoulWorld.js`, `SoulFounder.js`, `SoulLife.js`, `SoulPlacement.js`. Focused fixture: `tests/soul/physical-selective.html`. Native two-view admission fixture: `tests/soul/physical-read-envelopes.html`.

#### Crafting and repair task dependencies

Exact original `craft-make` and `tool-repair` proposals retain the actor, inventory, held tools, workbench, personal observation region and captured approach. Repair also retains its exact tool and current custodian. The existing economy owner decides visibility, reach, recipe inputs, custody, usable tools and carrying capacity. Starting a task reserves materials once; it grants no completed output or wear credit.

Pending production must match the person's original Founder work record and actual job. Crafting escrow must have exactly the declared recipe inputs, quantity one and original duration; repair reserves one wood and one stone for eight simulation seconds. The classifier checks station, captured work position, recipe or tool identity, phase, clock and exact input key set. Routing metadata may change on arrival while productive identity stays fixed. Broken repair tools and a required tool's changed custodian remain dependencies; the original owner decides whether work can resume. Resume retains the economy owner's existing reach and tool checks without adding a new station visibility requirement.

Paused admission and `resource-work` can keep unrelated derived geometry released. Resuming an archived task may selectively load missing required compiler groups before its effect; compiler identity can therefore change while the scene stays partial and canonical source remains unchanged. Actual elapsed production runs through the existing complete world update, including capacity checks, output creation, tool wear and personal outcome settlement. A full output bag leaves the completed-progress job and its reserved inputs intact until capacity is available.

Cancelling an existing crafting or repair job declares `fullEffect: true` through the same private validated task boundary as placement. Complete geometry is admitted before the original owner can return inputs to the nearby bag or create a physical material cache at the worksite. Cancellation grants no output and consumes none of the reserved inputs. After the job is removed, the original no-job cancellation refusal has bounded dependencies again. Failed native commits preserve the prior job, escrow and uncertainty fence.

The focused continuation earns its recipe materials through 21 simulation seconds of gathering. Its paused crafting task saves all 354 canonical records while retaining 155 of 398 derived nodes; resume selectively adds 14 source parts for the local bedroll and water-site groups, reaching 169 nodes with no full reload. Actual crafting preserves progress two of twelve seconds through native archive restore and produces one owned axe. A subsequent repair preserves two of eight seconds and restores the same tool from zero to 40 durability. Local and remote refunds, stolen required tools, completed work blocked by capacity, hidden stations, malformed escrow and failed native writes exercise the original conservation and recovery paths. Durability and capacity boundaries are explicitly declared fixture setup; crafting materials are actually gathered.

A fresh nine-group hardware WebGPU suite verifies the actual 100-person app. Crafting admission preserves both reduced 3,246-node views with zero job progress and exact reserved inputs. Remote cancellation restores both complete 3,433-node views before original owner entry, returns two wood, three stone and one fibre to one worksite cache, and publishes its geometry in both 3,447-node views. The subsequent no-job refusal remains within the reduced 3,260-node scene. Serving GPU tensors, approved curriculum, camera state and resource cleanup remain correct. This native fixture explicitly supplies ledger-balanced recipe materials; it verifies reservation and refund rather than natural acquisition. These are correctness checks, without neural training, throughput or whole-world memory measurements.

Thirty focused browser groups and 98 existing regression groups pass with GPU disabled, alongside the nine native hardware groups above. The original failed fixture and diagnostic subsets are retained separately; they are not added to this count. Continuation evidence: `tests/soul/physical-production-verification-20261001/verification.json`.

Sources: `agi/soul/SoulPhysicalTaskDependencies.js`, `SoulWorld.js`, `SoulFounder.js`, `SoulEconomy.js`. Focused fixture: `tests/soul/physical-selective.html`. Native two-view production fixture: `tests/soul/physical-read-envelopes.html`.

#### Delivery and tool-exchange task dependencies

Exact original resource requests, trade offers, borrowing, acceptance and refusal retain the sender, addressed person, relevant tool and captured meeting position. Delivered offers resolve through the original economy record with its exact delivery, trade or loan fields. A completed, declined or expired offer can still identify the dependencies for the owner's ordinary refusal; a missing or malformed record keeps the conservative fence. Offer IDs remain semantic records, not mesh identities.

Paused delivery, exchange, tool custody and store-transfer tasks can release unrelated derived geometry. Tool scopes retain the actual owner, current holder, and recorded lender/borrower as applicable. Returning a tool retains either its addressed recipient or the specified store. Held equipment and physical inventory use the existing recursive compiler/support dependencies. Captured approach positions do not overwrite the parties' current locations or reveal them as personal knowledge.

Requesting, offering, borrowing, accepting and declining use bounded effect dependencies. These actions deliver messages or commitments without granting goods or custody. Resource delivery and exchange, tool taking/authorization/theft/return, and store deposit/take declare full effect admission through the original private task boundary. Their original witness scans, relationships, capacity checks, job interruptions and render projection run with complete geometry. Inventory and tool ownership change only through those owners' committed receipts.

Known group-tagged actions now declare finite paused-intent dependencies through the group continuation below. Their effects still require complete geometry: the current group validator regenerates ordinary personal affordances and checks delivered plan revision, membership, consent, target binding and contribution receipts. Unknown fields, forged effect flags, foreign offers, unresolved journals and unsupported task methods keep conservative fences.

Verification on 1 October 2026 passes 36 focused browser groups, 105 existing owner regressions and nine native hardware WebGPU groups. The focused delivery case retains 61 of 398 derived nodes through request and acceptance, then restores all 398 before the original handover. Native archive continuation preserves one delivery receipt, exact bilateral stock, captured meeting points, private tool ownership and paused work. Hidden or departed recipients, insufficient stock, full bags, stale offers and failed commits grant no goods. A genuine group delivery stays fully fenced and credits only its two actually delivered units.

In the actual 100-person app, both views retain 3,260 of 3,447 nodes for paused exchanges and communication. Each transfer restores all 3,447 before the original owner executes. Delivery moves exactly two food units; lending and return preserve the same shared axe and unchanged tool count. Serving GPU tensors, approved lessons, cameras and buffer disposal pass their existing checks. These are correctness and geometry-count measurements; they do not establish throughput or whole-world memory savings. Evidence: `tests/soul/physical-exchange-verification-20261001/verification.json`.

Sources: `agi/soul/SoulPhysicalTaskDependencies.js`, `SoulWorld.js`, `SoulEconomy.js`, `SoulFounder.js`, `SoulGroupPlans.js`, `SoulOrganizations.js`. Focused fixture: `tests/soul/physical-selective.html`. Native two-view exchange fixture: `tests/soul/physical-read-envelopes.html`.

#### Group task dependencies and geometry costs

The original task classifier now recognizes eight group-tagged work kinds: `explore`, `inspect`, `resource-gather`, `resource-chop`, `resource-mine`, `resource-deliver`, `store-deposit` and `resource-exchange`. Each retains its exact `planId` and positive integer `planRevision`; the work kind must match the original plan kind. Build, shelter and other unclassified group work keep complete scopes.

Nine coordination kinds use the same classifier: `group-plan`, `group-plan-invite`, `group-plan-join`, `group-plan-decline`, `group-plan-leave`, `group-plan-cancel`, `group-plan-share`, `group-plan-continue` and `group-leave`. The classifier reuses the original organization, plan-specification and simulation-frame validators. It retains relevant people, real target objects, current formation slots and the acting person's disclosed target/assignment positions. Group, plan and invitation IDs remain ledger identities rather than physical mesh IDs.

Paused known group work can release unrelated derived geometry. Every group effect admits complete geometry before the original owner checks current consent, revision, visibility and ordinary affordances. A recognized old plan or withdrawn participant can therefore reach the owner's normal refusal. Dependency classification grants no membership, knowledge, permission or contribution credit. Malformed ledgers, future revisions, unsupported payloads and unresolved checkpoints keep conservative scopes.

Actual tagged extraction jobs preserve their plan identity through `resource-work`, cancellation and native save/restore. A plan revision can retire matching accepted work across its participants; unrelated personal work remains independent. Only the original execution receipts contribute measured goods or completed travel to the plan.

The native fixture also records elapsed time for retention, generation capture, catalogue creation, fresh reconstruction with validation, standalone world validation, native save/release, selective publication rollback, selective reconstruction, complete reconstruction and an original material-supply transaction. The fresh reconstruction input bypasses the module's certified-generation cache. Nested compiler, collision-catalogue and transaction phases overlap their enclosing samples. These are observations from one workflow, with no speedup or throughput acceptance claim.

The nine-group native hardware WebGPU run passes with 100 people, 1,527 canonical parts and six physical cells. Both views retain 3,260 of 3,447 nodes through paused group creation, invitation, consent, travel and withdrawal. Every original group effect sees both complete views. Withdrawal advances the plan from revision two to three and records one interruption; replaying revision two is rejected without movement or contribution. Serving GPU weights, approved lessons, cameras and cleanup remain correct.

| Observed operation | Elapsed time |
|---|---:|
| Retention audit | 102.3 ms |
| Generation capture | 45.8 ms |
| Catalogue build | 322.3 ms |
| Fresh reconstruction including validation | 214.2 ms |
| Separate detached-world validation | 55.9 ms |
| Complete native save and geometry release | 3,495.3 ms |
| Injected selective-publication refusal and rollback | 300.3 ms |
| Missing-owner selective reconstruction and read | 349.5 ms |
| Explicit complete reconstruction | 365.9 ms |
| Original material-supply transaction | 230.7 ms |

Save/release includes 98.3 ms of compiler work. Selective reconstruction adds one part but recompiles the 1,347 retained parts in 111.5 ms; complete reconstruction compiles 1,527 parts in 106.7 ms and rebuilds collision metadata in 3.7 ms. This single observation does not establish faster selective loading. The material transaction spends 114.3 ms in validation and 83.7 ms in commit. Original transaction phase timings are nested measurements rather than additional operations to sum with the table.

The largest observed boundary is save/release. A bounded next step is to measure archive preparation, encoding, hashing, reads/writes, validation, currentness assertions and head commit separately. Repeated allocation/serialized-size accounting through the existing shared JSON visitor is one concrete optimization candidate; current timings do not isolate its cost. Any optimization must retain strict validation and every live currentness check around storage awaits. Canonical owners remain resident; this continuation changes derived geometry retention rather than regional simulation ownership.

Verification passes 42 focused browser groups, 80 owner regression groups and nine native hardware groups: 131 groups in complete accepted runs. The focused travel case retains 91 of 429 derived nodes while paused, then completes two actual arrivals after native archive restore. Shared gathering preserves two seconds of partial work and produces exactly four natural wood units, two per person. Haul, store and trade each credit only their actual two-unit transfer. Withdrawal retains another person's unrelated job at its original progress; failed retirement writes preserve original consent, jobs, goods and recovery fences.

Two initial fixture errors and their diagnostic subset remain separate from acceptance: a declining bystander occupied a formation destination, and the stale-card assertion incorrectly forbade voluntary withdrawal. The corrected travel setup moves only that bystander through the original world owner. Current tagged work remains forbidden by stale disclosure, while leaving remains available. Complete receipts, exact served sources, timing scope and the preserved failed run are indexed by `tests/soul/physical-group-verification-20261001/verification.json`. These checks run no neural training and establish no new learned group policy.

Sources: `agi/soul/SoulPhysicalTaskDependencies.js`, `SoulGroupPlans.js`, `SoulOrganizations.js`; `tests/soul/physical-selective.test.js`, `physical-read-envelopes.test.js`.

### Guarded physical generation loading, 30 September 2026

Open **World extent · terrain and streamed scenery**, then choose **Load saved generation**. SOUL pauses society and drains accepted work. It reads every saved cell and the shared ledger, checks the original task grammar and clock binding, compiles the incoming world, and prepares both actual OS GPU views while the current world stays published. Successful loading keeps society paused.

Loading follows these rules:

| Saved state | Result |
|---|---|
| Same world/frame, newer world revision | Prepare, durably publish and activate the complete generation |
| Equal revision and identical complete canonical data | Verify without replacing owners or writing a journal |
| Older revision or equal revision with different data | Refuse; keep the current world and historical archives |
| Invalid files, task journal, geometry, allocation or stale preparation | Refuse before activation; retain the paused current world |

The serving and candidate models, optimizer state, curriculum, reviewed lessons and media retain their existing owners. Both addressed cameras remain unchanged. The selected individual remains selected when that ID exists in the incoming population; otherwise the first incoming individual is selected. A home cutaway closes if its home no longer exists. Incoming views use separate bounded surface slots; normal preparation holds four surfaces within the OS's eight-surface limit. Old view resources are released after activation.

`SoulPhysicalStorage.prepareGenerationLoad()` retains one immutable original ticket. Copies, foreign tickets, reused tickets, closure and fenced storage reject. Its final head reread checks the exact digest of the same returned Blob originally selected. Local save and verification operations refuse while a load ticket is preparing or retained. Cancellation releases the ticket. The head read proves the newest observed bytes; it is not a mutex against a writer in another worker.

The app separately captures the authoritative `world.json` expectation from its exact returned bytes. A newer authoritative journal or conflicting equal revision prevents loading. Before durable dispatch, the original World acquires a reversible replacement gate from its original completed-generation cut. New queries, actions, task creation and updates cannot enter while the gate is held. The storage dispatch guard rechecks the original state, geometry, journals, lease epoch, view/camera and scenery owners after hashing. Exact native compare-and-swap then protects the journal from a competing writer.

An accepted, verified journal receipt precedes the synchronous original-world retirement and incoming-world publication. Retirement performs no old task pause or checkpoint writes. Proven, already durable paused task journals also avoid redundant saves during ordinary pause/closure. A known refusal releases the gate without replacing the active world. Unknown native outcomes fence writes. If a verified journal commit is accepted but activation is interrupted, the app reports that committed state and requires reopening for recovery; it does not write the older active state over it.

Project imports validate saved task grammar before restoring scenery or model state. Mount and GPU recovery select the committed project plus a newer validated authoritative world journal. Recovery drains the old owner before observing that journal, then validates the selected world before retiring GPU/model owners. Physical heads do not independently select recovery state. The original checkpoint validator also rejects a saved checkpoint clock ahead of its canonical world clock without initializing the task or calling host ports.

Preparation retains the 128 MiB estimated JSON profile across the active cut, decoded target, incoming canonical clone and bounded journal parsing. A single journal is capped at 32 MiB and depth 48. Compiled geometry and GPU buffers remain under their existing owners and budgets. Staging can therefore refuse a generation that fits its serialized file limit but exceeds the combined preparation profile.

All physical cells of the loaded generation remain resident. Complete-generation restoration is now available; selective cell unloading, dormant simulation, dependency-aware release, regional routes and actor boundary handoff require their own owner contracts.

Sources: `agi/soul/SoulWorld.js`; `webgpu-os/apps/soul/SoulPhysicalStorage.js`, `SoulStorage.js`, `SoulApp.js`, `RealmForgeWorld.js`. Focused report: `tests/soul/latest-physical-generation-loading-result.json`.

### Physical generation saves, 30 September 2026

Open **World extent · terrain and streamed scenery**, then choose **Save physical generation**. The app pauses society and waits for original world and actor checkpoint owners. The save contains every admitted cell and one shared ledger. **Verify saved generation** reads every file, reconstructs the complete canonical world and stages its original RealmForge compiler and actor checkpoint validator. Verification preserves the active world. The panel reports generation, cell count, revision and whether the result matches current state.

`SoulPhysicalGeneration` partitions every source piece, individual and object into indexed primary-cell records. It preserves original array positions and world/source field order. The shared ledger retains economy, jobs, escrow, deliveries, relationships, organizations, routes, receipts, experience outboxes, personal RNG and other canonical fields exactly once. Logical compound IDs remain distinct from custody anchors: a carried axe retains its source members and property owner while its carrier supplies primary cell membership. Source-only and unpinned geometry is included. Primary membership is a save partition; it does not describe every cell touched by an object's geometry.

The restore validator derives complete coverage from the canonical physical directory. Missing, extra, duplicate, reordered, mismatched-frame and inconsistent compound/custody records fail before acceptance. Native verification also reuses `ActorTaskRuntime.validateCheckpoint(raw)` through `SoulWorld.validateSavedTaskCheckpoints()`. This synchronous path checks original registered methods, versions and task/effect frontiers without initializing tasks, advancing clocks, enrolling ownership or issuing effects. Valid paused work remains saved data.

`capturePhysicalGeneration()` issues an original immutable world cut at a completed boundary. It refuses pending physical operations, failed-commit fences and diverged live/saved journals. The cut binds state, geometry, update epoch, lease activity and journal signatures. Copies, foreign cuts, closure, later operations and in-place canonical changes expire it. Durable paused tasks can be saved while their physical dependencies still require retention.

`SoulPhysicalStorage` writes checksummed immutable JSON archives under a separate `physical-` namespace. It rereads and validates the complete candidate before publishing one `soul.physical-head.v1` head. Publication uses the exact expectation from the bytes of its observed head and a synchronous original-world guard after hashing, immediately before the OS atomic syscall. A known refusal before dispatch leaves storage usable. A malformed or lost native receipt fences further writes until reopening. Activity after accepted dispatch leaves a historical generation without release permission. Unreferenced candidate archives may remain after refused publication.

| Admission | Current bound |
|---|---|
| Complete generation archives | 32 MiB serialized JSON |
| Estimated preparation/restore allocation | 128 MiB, including conservative overlap admission |
| Canonical ledger / one cell | 16 MiB / 8 MiB serialized JSON |
| Head / JSON depth | 4 MiB / 48 levels |
| Source pieces / individuals / cells | 65,536 / 512 / 4,096 schema caps; active-world and byte limits may admit less |
| Retained save captures / queued storage operations | One / 16 |

Existing dataset, training checkpoint, runtime model and full-project exports retain their formats. Portable projects include the canonical world and do not depend on local physical archive paths. App recovery selects the committed project and newer authoritative world journal; it does not replace them with an older physical head.

The browser fixtures use actual OS `StorageManager`/`OPFSDriver`, original World/RealmForge/task owners and separate native OS GPU/strict-CAS OPFS app wiring. They verify paused-task continuation, complete coverage, adverse storage outcomes, closure and historical-state preservation. Delayed/corrupt/lost syscall wrappers retain their explicit fixture scope. These checks establish persistence correctness within the admitted profiles. They do not measure neural training or physical paging throughput.

All canonical physical owners remain resident. This milestone supplies durable regional records and complete generation verification. The [guarded loading workflow](#guarded-physical-generation-loading-30-september-2026) now activates complete generations. Dependency-aware save-before-release, regional routing and actor handoff remain the next owner contracts.

Sources: `agi/soul/SoulPhysicalGeneration.js`, `SoulWorld.js`; `engine/gameplay/ai/intelligence/ActorTaskRuntime.js`; `webgpu-os/apps/soul/SoulPhysicalStorage.js`, `SoulStorage.js`, `SoulApp.js`. Reports: `tests/soul/latest-physical-generation-result.json`, `physical-generation-actor-runtime-20260930.json`, `latest-region-storage-result.json`.

### Physical dispatch and query leases, 30 September 2026

**World extent** reports **Physical work**: active calls, the peak call count, persistent recovery fences and whether admission is open. Existing actions refresh it at entry and settlement; daily routines and society ticks refresh it after their update. This status reads the runtime counters without rebuilding the retention report or copying complete task journals on every render. All canonical objects, people, terrain and resources still remain resident.

`SoulPhysicalLeases` retains the complete resident catalogue for each accepted operation. It issues frozen original handles, rejects copied or foreign handles, and releases an original handle at most once. The default owner admits at most 4,096 simultaneous calls. World updates acquire before entering the transaction queue. Proposals, direct actor protocol calls and effects acquire before initialization, their private queues or the first await for an effect hash. A returned Promise retains its original hold until fulfillment or rejection. Failed commits leave a persistent recovery fence after active calls drain; a later successful update cannot clear that fence.

`SoulWorld.withPhysicalQuery(label, callback)` covers arbitrary dependent reads and retains complete hydration; a caller label grants no narrower scope. Known original synchronous bounds, visibility, observation, model-input, obstacle and collision-directory reads use the [resident-read admission path](#derived-physical-geometry-release-30-september-2026) under the same lease owner. The [fixed navigation reads](#fixed-finite-navigation-reads-1-october-2026) now admit complete planner dependencies before their original grid, destination and floor/stair algorithms. Unknown scopes and custom inputs retain complete hydration. Nested reads retain their outer scope. Synchronous callbacks preserve synchronous results and error identity; asynchronous callbacks retain their scope through settlement. Navigation grids use a separate physical residency epoch alongside source and terrain revisions. That epoch advances only when changed compiler geometry successfully publishes. Ordinary lease acquisition/release does not flush navigation caches, and a failed publication cannot advance it.

| Original owner API | Meaning |
|---|---|
| `capturePhysicalLeaseFence()` / `assertPhysicalLeaseFence(original)` | Authenticated evidence that dispatch work is idle, bound to this world, geometry, lease activity and complete saved/live actor journals. Active, suspended or unresolved actor work, recovery fences, copied evidence and later activity prevent reuse. |
| `capturePhysicalRetention()` / `assertPhysicalRetention(original)` | On-demand dependency report for bodies, routes, cargo, supports, reservations and other durable obligations. It remains a separate report with its own checks of the original owner. |

Idle evidence is one prerequisite for future paging. It does not authorize eviction: a completed actor dispatch can leave a personal route, productive job, escrow or accepted commitment requiring retention. The original `ActorTaskRuntime` and its effect ledger remain the single actor protocol. SOUL does not create a second dispatch journal.

Pausing or cancelling retires the host's private admission immediately, before the durable suspension write enters its queue. Explicit admission creates a fresh private generation and an ID derived from the upcoming committed world revision, such as `soul-admission-12`. A queued admission cannot revive a retired generation. Effects copy and freeze their proposal before hashing, then recheck the original admission and revision inside the transaction. Concurrent copies of one effect recheck the committed receipt there: identical payloads return the original receipt without a second world revision or physical mutation; a changed payload is rejected.

Closing the owner retires new public admission synchronously. Original accepted calls, actor cleanup, checkpoint writes and captured asynchronous reads drain before collision/navigation caches, ECS entities and lease ownership are released. A late definitive receipt may update the original task's progress without reviving a cancelled task. Restore/recovery constructs fresh transient ownership. Saved admissions start privately retired and require the task owner's explicit readmission; already committed receipts remain replayable. Saved or live uncertain effects remain visible to retention and idle checks.

The focused browser fixture passes sixteen groups covering original/copy authentication, bounded admission, queue/hash timing, complete nested and asynchronous query scopes, measured surface routing, mutable-input capture, concurrent replay, failed checkpoints/receipt commits, cancellation, re-admission, portable continuation and closing with the query capacity filled. These world checks use the real SOUL, RealmForge and shared actor owners with controlled commit gates; they do not claim filesystem crash recovery.

The continuation passes 65 report groups across seven browser suites. Eight native groups use actual hardware WebGPU and OS GPU/storage owners; a held mutation callback followed by actual OPFS publication verifies that the existing app action updates **Physical work** from busy to settled. Physical-region, collision, interruption, group and household regressions retain their own storage and execution scopes. The slice's immutable evidence is stored under `tests/soul/physical-lease-verification-20260930/`. Regional records, dirty-generation saves, guarded loads and actor handoff remain the next physical implementation gates. This slice performs no physical unloading or neural training.

Sources: `agi/soul/SoulPhysicalLeases.js`, `SoulWorld.js`, `SoulLife.js`, `SoulNavigation.js`; `engine/gameplay/ai/intelligence/ActorTaskRuntime.js`; `webgpu-os/apps/soul/SoulApp.js`.

### Physical retention inspection, 30 September 2026

Open **World extent → Inspect retention** to capture a read-only operator report. It shows retained and unleased resident cells, required owners, paging fences and CPU inspection time. The report includes complete measured compound footprints, current bodies, perception halos, remaining route corridors, carried objects and tools, support chains, resting/return positions, paused personal work, stationary escrow, accepted deliveries and unfinished group assignments. Source-only walls and floors use their measured geometry too. Captured destinations remain separate from an object's current position; inspection changes no personal observations, knowledge, RNG, task IDs or training records.

`SoulWorld.capturePhysicalRetention()` returns a recursively frozen `soul.physical-retention.v1` report. `assertPhysicalRetention(originalReport)` accepts only the original report from that world owner. Queuing a world update retires prior reports immediately. State/geometry replacement, full live task journal changes, restore, recovery and closure also retire them. Copies and reports from another owner are rejected. The report is derived on request and is not a second checkpoint or persisted world owner. The measured paused 100-person native camp used 159.7 ms CPU for its initial inspection and 152.1 ms after east terrain admission. The second report retained five of eight resident directory cells and marked three unleased. These are single-run inspection costs, not FPS or simulation-throughput measurements; inspection runs only when requested.

Cells use exact fixed-frame sector strings and 100 m local grid math. Closed measured footprints retain both sides of touching boundaries. Required cells outside the resident directory do not establish loaded terrain. Unleased counts describe resident cells without extracted obligations; they do not authorize unloading. Bounds, owners, cell membership references and inner traversal work have explicit budgets. Inspection rejects unresolved references, support cycles and budget overflow instead of returning a truncated report.

Full saved and live actor journals include current, suspended and historical tasks with unresolved effects. Pending world writes, failed commit outcomes, open proposal schemas, unresolved actor tasks, route replanning, legacy housing reads and pending birth admission conservatively retain the entire catalogue. A failed commit fence stays latched for that world owner, even after a successful retry; recovery constructs a fresh owner from validated durable state. This deliberately covers known failed writes as well as unknown outcomes.

All canonical owners remain resident. [Dispatch/query leases](#physical-dispatch-and-query-leases-30-september-2026) now retain accepted calls, and navigation caches include the catalogue publication epoch. Durable regional records, dirty-generation saves and guarded load/actor handoff remain the next implementation gates. This inspector supplies their durable dependency report. It does not implement physical paging or improve neural competence.

Browser verification covers exact huge/negative footprints, copied/foreign/stale reports, queued updates, hidden moved targets and final owner rejection, source-only long geometry, paused work/rest/return/settlement, accepted group slots, uncertain effects, installed household floors/stairs and complete carried tools. The native fixture uses actual hardware WebGPU and original OS GPU/storage owners; world protocol fixtures retain their documented storage scope. Evidence is frozen under `tests/soul/retention-verification-20260930/` and indexed separately from neural training and independent civilization trials.

Sources: `agi/soul/SoulPhysicalRetention.js`, `SoulPhysicalRegions.js`, `SoulCollisionIndex.js`, `SoulWorld.js`; `webgpu-os/apps/soul/SoulApp.js`.

### Bounded collision queries and detail cache, 30 September 2026

SOUL now reuses the Engine `AabbBvh` for local navigation, swept legacy movement and line-of-sight candidates. Its complete owner catalogue comes from measured collision overrides or transformed mesh bounds. It does not use an object's center or physical cell anchor as its collision extent. Long walls remain obstacles when their centers lie outside the old proximity cutoff. Tree trunk overrides retain their smaller physical shape, independent of the rendered canopy. Exact ray, body slide, floor, custody and placement checks remain with their existing owners.

The default detailed-box cache retains at most 256 owners and 1 MiB of coordinate values. These are six Float64 values per box; the count excludes JavaScript object overhead, compiler geometry and VRAM. Least recently used entries can leave this derived working set. A miss reconstructs every box from committed canonical geometry. An oversized owner returns its complete frozen result without caching it. An outstanding query retains its immutable array even if another query evicts that entry.

The complete BVH and canonical world remain resident. There is no resource, actor, task or house unloading in this slice. Discarding a derived cache entry requires no new world write because its authoritative input remains available. Physical paging still needs gameplay dependencies, durable regional records and guarded save-before-release.

`SoulWorld.transaction` prepares a changed index before dispatching the existing world write. A failure retains the old world, geometry and index. Successful publication releases the prior detail cache. Ordinary memory/message commits reuse the index; object catalogue identity, order and occluder changes invalidate it even without a source edit. Current custody is filtered on each query. Actor bodies still use current staged positions. Candidate placement and construction retain their separate measured validation paths. Committed static compiler geometry is an internal read-only input; cameras do not mutate it.

**World extent** shows collision cache owners, coordinate bytes and eviction counts. Project import and recovery rebuild this runtime cache from the validated world. Closing the app releases the cached detail arrays alongside navigation and GPU owners.

Six focused browser groups pass independent measured full-scan candidate parity, rotated/long geometry, actual axis-resolved movement and effect replay, entry/byte/zero-retention eviction, real oversized compounds, immutable results, catalogue/custody changes, pre-write geometry rejection, failed dispatch, portable restore and closure. The controlled 261-owner fixture returns 500 candidates over 500 local queries, compared with 130,500 owner tests in a full scan. This count is a broad-phase workload observation, not a frame-rate or neural throughput measurement. Hardware app and household regressions exercise the visible status, camera isolation, recovery, upstairs/downstairs traversal and swept furniture placement.

Sources: `agi/soul/SoulCollisionIndex.js`, `SoulWorld.js`, `SoulLife.js`; `engine/core/math/AabbBvh.js`; `webgpu-os/apps/soul/SoulApp.js`. Evidence: `tests/soul/latest-collision-cache-result.json`, `latest-physical-regions-app-result.json`, `latest-shelter-world-result.json`; immutable receipts are indexed separately in `latest-founder-verification.json`. See the [collision working-set roadmap](soul-civilization-roadmap.md#bounded-collision-working-set).

### Resident physical cells and terrain, 29 September 2026

New founder projects track canonical physical owners in exact 100 m cells. The immutable simulation frame supplies the cell addresses, including negative boundaries and enormous sector identities. Saved projects retain their recorded tracking mode. In a founder project, **World extent → Enable physical tracking** admits its actual ground before saving the directory.

**Add east terrain** adds a real flat RealmForge ground box covering local x=80–200 m and z=−80–80 m. It expands the founder camp through the existing world transaction. Residents can choose reachable destinations there through their existing capability and personal decision paths. This setup supplies terrain; it does not assign jobs, routines or homes. Camera scenery imports supply no physical terrain or resources.

The operator sees resident physical cell counts, terrain patch counts, distinct owner anchors, committed transfers and the selected person's current cell. Canonical source parts retain their identities. A carried loose root, its compound children and a held economy tool follow their carrier's cell; property ownership remains separate from custody. Furniture movement updates the existing shelter placement ledger before the renderer rebuilds the complete compound.

Ground navigation checks the full 0.23 m body footprint against the union of admitted boxes. Shared edges remain traversable. Movement checks the full swept footprint along the existing X then Z collision slide, so a missing-ground gap cannot be skipped. Ground placement and construction footprints also require admitted support. Installed upper floors, stair links and resting anchors retain their measured owners. Navigation allocation and route budgets remain bounded.

Every membership change is derived inside `SoulWorld.transaction`. A continuing anchor crossing cells appends one dedicated physical transfer receipt in the same snapshot as its movement. Creation, deletion and custody reassignment update membership without pretending to be travel. Transfer bookkeeping does not advance personal discovery RNG, consume task IDs, deliver knowledge or add training examples. Ordinary observed action consequences still use the existing experience workflow.

Physical state travels inside the existing world/project snapshots. Restore rejects contradictory directories, rebound frames, malformed transfer histories and transformed or generated terrain before replacing active owners. Terrain uses a closed standalone literal box profile, so raw admission geometry matches the canonical compiler. Native storage requires the verified write receipt's exact path, SHA-256 and byte length. A dispatched write with an unknown outcome preserves the prior token and fences continuation until recovery.

All physical, collision and task owners remain resident. Cell membership does not create separately loaded simulation runtimes, per-region eviction authority or a long-distance route planner. The current profile admits at most 32 terrain patches, 65,536 canonical source members, 4,096 cells and 4,096 retained crossing receipts, within ±500 m of the fixed simulation frame. The [physical paging roadmap](soul-civilization-roadmap.md#resident-physical-boundary-foundation) defines the next owner split.

Sources: `agi/soul/SoulPhysicalRegions.js`, `SoulWorld.js`, `SoulNavigation.js`, `SoulLife.js`, `SoulPlacement.js`, `SoulShelter.js`, `SoulFounder.js`; `webgpu-os/apps/soul/RealmForgeWorld.js`, `SoulApp.js`, `SoulStorage.js`.

The physical owner suite passes ten groups with the actual compiler and OS `StorageManager`/OPFS writes. It exercises huge and negative address crossings, real walking from x=79 m to x=101 m across the old camp boundary, shared terrain seams, missing-ground sweeps, carried bedroll/tool custody, failed-save rollback/retry, exact portable next-update continuation, actor-effect replay and reopening after an unknown committed outcome. Five native hardware groups pass visible controls, private-state/camera isolation, pre-write restore refusal, project recovery and GPU/cache cleanup. Eight household regression groups retain upper-floor movement, mid-stair restore, furniture placement and collision checks; the carried bench and all ten source parts of a held economic tool cross a 100 m boundary in one carrier receipt. Fifteen native storage groups verify exact receipt validation and fencing. Legacy navigation and immutable-frame regressions remain separate.

In the controlled two-person huge-origin fixture, one metre of walking plus the existing activity completion required eleven update calls and 568.9 ms elapsed. The last update used 44.0 ms total, including 19.0 ms validation and 22.7 ms durable commit. These samples include shared-world validation and storage; they are not frame rate, isolated GPU time or proof of 100-person throughput. Further physical partitioning must reduce active work before larger travel/population claims.

Reports: `tests/soul/latest-physical-regions-result.json`, `latest-physical-regions-app-result.json`, `latest-shelter-world-result.json`, `latest-region-storage-result.json`, `latest-navigation-budget-result.json`, `latest-simulation-frame-app-result.json`. The evidence index preserves development runner/fixture failures separately. Current test receipts record hashes of the JavaScript bytes actually served during each run. Scopes that predate that runner change retain their original provenance limits.

### Incremental scenery preparation, 29 September 2026

Native scenery imports, catalog recovery and saved-project preflight now cooperate **inside each region job**. Source validation, canonical RealmForge compilation, model primitives, SOUL instance grouping, compiled geometry checks and byte estimation expose bounded work steps. The synchronous and cooperative compiler entry points drain the same generator. The synchronous and cooperative geometry validators and byte estimators also share their checks. Active camp compilation remains its existing owner path.

A strict private snapshot is captured and recursively frozen before the first suspension. Cloning and freezing share one traversal, retaining strict JSON rejection of accessors, sparse/custom arrays, unsafe keys, nonfinite values and cycles. Only a privately certified, fully validated captured source can reuse its source preflight; freezing a caller object cannot bypass admission. Later caller mutation cannot change the source being compiled. Full-source duplicate IDs, closed literal materials, actual mesh topology, transformed bounds and the 128 m local extent remain checked. Typed geometry scans expose at most 4,096 elements per step. Shared backing buffers are counted once across the complete region, and retained rollback geometry still counts toward peak residency. Cooperative compiled checks require the preparation owner to retain its candidate arrays until completion. The validator does not freeze externally shared typed arrays.

The default preparation profile targets 8 ms of accumulated measured synchronous work, four compiler invocations and at most 256 work steps before a checkpoint. The existing preparation gate still serializes jobs across generations; storage reads retain their existing Engine scheduling. Camera changes, active-world changes, cancellation, owner loss and closure fence stale work. The complete previous camera union remains visible until every candidate region is ready and the existing renderer publishes the complete replacement. Current failures stay visible and retryable. This path uses the original OS GPU permission, mount, device lease and broker checkpoint. It creates no additional GPU owner or asynchronous transfer scope.

Use **World extent → Streamed scenery** to inspect the separate resident and catalog measurements. `maxJobCpuMs` is all measured CPU work for a region, accumulated across its steps. `maxSegmentCpuMs` measures the largest synchronous step; `maxSnapshotCpuMs` isolates the private snapshot; `maxSliceCpuMs` measures accumulated managed work between successful checkpoints. Checkpoint, gate and asynchronous fallback-compiler waits remain separate from CPU totals. Complete-publication elapsed time includes reading, waiting and publication. A long cumulative job does not imply an equally long uninterrupted browser task.

The target is cooperative, not a deadline. Strict snapshot capture, JSON encoding/full-source parsing, one primitive generation or model transform, and the final aggregate GPU upload remain indivisible. A step can cross the target before the next checkpoint, and its actual duration is reported. General worker isolation, incremental GPU publication, mesh detail refinement and physical region transfer are not established by these changes.

The focused browser suite passes 22 groups covering shared strict cloning/freezing, ten actual primitive types, synchronous/cooperative equivalence, shared geometry and byte accounting, duplicate identities, topology/bounds, failure/retry, disposal and cancellation in preparation phases. Fifteen existing RealmForge compiler/controlled viewport unit contracts pass separately; their GPU doubles are not hardware rendering evidence. Ten native hardware groups pass the genuine broker, within-job checkpoints, private capture, portable preflight, generation cancellation and closure. The existing residency protocol passes 21 groups. The native region app passes eleven groups plus its residency measurement. Seven actual hardware renderer groups retain the 31,331-node furnished overview and 66-node home cutaway. Two saved-model artifact groups preserve the original 161,714 parameters, 47/48 held-out choices, step 150 and cursor 900; no neural training ran.

In the fresh visible-browser fixture, seven new 256-part regions crossed 49 completed OS checkpoints while a redraw timer advanced 75 times. Twenty coordinated renderer callbacks/submissions completed. The prior one-region preview remained published until the complete eight-region union was ready, and the paused world hash remained unchanged. Cumulative CPU preparation, including the baseline region, was 90.4 ms. The largest whole-region job used 15.3 ms CPU across its steps; the largest measured segment and snapshot were 1.6 ms, and the largest managed slice was 6.9 ms. Complete publication took 518.8 ms elapsed. Separate eight-source catalog prevalidation used 72.8 ms CPU, a largest segment of 1.8 ms and 40 yields.

A native preflight with 512 parts and ten primitive kinds crossed fourteen checkpoints, retained its frozen private source after caller mutation, and wrote no storage or civilization state. Its total CPU work was 65.6 ms, its largest segment/snapshot was 3.7 ms, and its largest managed slice was 8.2 ms. That observed overrun illustrates the soft target. Unsupported material references failed before compiler work or writes. These are fresh controlled CPU, responsiveness and wall-time observations after the cost fixes, not an isolated FPS result or a like-for-like speed comparison with the historical milestone.

A preliminary 32-step profile produced 455 checkpoints and 3,510.1 ms publication elapsed in its recorded fixture. It is retained as tuning evidence in `tests/soul/incremental-preparation-pacing32-preliminary-20260929.json`, rather than final acceptance of the 256-step profile. The original preparation regression failure is separately retained as `tests/soul/incremental-preparation-regression-failure-20260929.json`.

Sources: `engine/core/schema/StrictJsonValue.js`; `webgpu-os/apps/realmforge/modeler/compile/AssemblyCompiler.js`; `webgpu-os/apps/soul/SoulVillage.js`, `SoulApp.js`; `agi/soul/SoulPresentationRegions.js`. Reports: `tests/soul/latest-incremental-preparation-result.json`, `latest-realmforge-compiler-result.json`, `latest-preparation-app-result.json`; immutable evidence is indexed by `tests/soul/latest-founder-verification.json`. The [streaming roadmap](soul-civilization-roadmap.md#incremental-scene-preparation) keeps the remaining preparation and physical-owner work explicit.

### Addressed scenery regions, 29 September 2026

The **World extent → Streamed scenery** controls import closed static ForgeSource regions and move either operator camera to an exact address. The map and 3D views request the union of their nearby regions. They retain independent render origins, so viewing distant places does not move the people or their physical camp. Imported scenery remains a visual preview: residents cannot observe, visit, gather from, construct on or manipulate those regions.

1. Enter the selected camera's **Exact sector, x y z** as three decimal integers. Enter **Local metres, x y z** within the sector. A sector spans 10,000 metres; import cells span 100 metres.
2. Choose **Import scenery region** and select a JSON file containing independent literal ForgeSource primitives. A plain ForgeSource uses the entered cell address; a versioned region payload supplies its own world identity, cell key and revision.
3. Choose **Go to address**. **Return both views to camp** restores the active simulation view.
4. Inspect catalog size, actual resident regions, source parts, estimated working bytes, queued loads and cache use. An unavailable or over-budget camera request keeps the prior complete preview and reports the reason. Active camp growth can withdraw scenery to preserve the active presentation budget; people and physical owners remain resident.

For example, this plain ForgeSource JSON describes one locally compiled scenery object:

```json
{
  "forge": 1,
  "name": "Scenery marker",
  "params": {},
  "connections": [],
  "parts": [{"id":"marker","primitive":"box","size":[2,3,2],"transform":{"pos":[20,1.5,20]},"material":{"color":[0.3,0.5,0.2]}}]
}
```

Imports accept the bounded primitive profile with literal local transforms and inline colours. Motion, parents, references, detached media, remote URLs and simulation-owner identities are rejected. Source JSON is limited to 4 MiB and 512 parts per region. Geometry compiles locally before Float32 conversion; an enormous global coordinate never becomes a Float32 translation.

| Budget | Current profile |
|---|---|
| Persistent catalog | 4,096 region descriptors |
| Resident scenery regions | 32 |
| Active simulation plus resident scenery | 32,768 source parts and 32,768 nodes |
| Estimated working data, including retained rollback geometry | 64 MiB |
| Decoded region cache | 8 MiB, at most 32 entries |
| Complete app catalog / portable region archive transfer | 128 MiB |
| Camera demand radius | At most 200 m per camera |

These are admitted engineering budgets, not measured total browser memory or device VRAM. Dense regions, the active camp, retained rollback geometry and archive transfer can exhaust a budget before its region count. Residency rejects the complete requested union instead of silently omitting required cells. GPU scenery meshes and instance buffers retire when their region leaves the presentation set. The active `SoulWorld.compiled` collision and interaction owners remain pinned independently of camera residency.

Immutable region archives carry SHA-256 checksums, exact decimal sector strings, local coordinates, world identity and revision. The native directory head uses the OS's compare-and-swap token. A conflicting or uncertain write fences that storage owner until reopening. Bounded blob reads check the native file's size before materializing its bytes. Complete project exports include the region directory, its archives and both addressed camera states; restore stages every archive and its geometry before replacing the active project. Region writes finish before imported serving weights replace the loaded model. Local recovery hydrates missing archives without rolling back a newer directory head, and validates that head before adoption. The app admits only catalogs that fit its complete 128 MiB archive-transfer profile.

Verification separates the native app, renderer, residency owner and real storage manager. The actual Blackwell WebGPU renderer passes opposite `10^40`-sector scenes, centimetre offsets, independent camera origins, save/restore, exact rebasing, publication recovery, eviction/reload, remote selection isolation and complete GPU allocation cleanup. Twelve actual `StorageManager`/OPFS checks pass native compare-and-swap, conflicting writers, lost write receipts, bounded reads, archive integrity and portable restore. Thirteen residency-owner groups pass exact identity, primitive/schema checks, capacity rejection, retained rollback budgeting, superseded loads, scheduler draining, active growth admission and disposal. Eleven native app groups pass a 36-region catalog with two resident regions, independent `10^60`-sector cameras, camera rollback, all-archive prevalidation, missing-file hydration, newer-head reconciliation, active-growth admission and failed-write closure. An injected directory-import failure preserves the loaded GPU serving/candidate weights and the active world. This app fixture uses actual OS GPU owners and native OPFS bytes through a strict CAS host; the separate storage suite tests the actual `StorageManager`. The existing twelve-group founder app regression and saved-model compatibility check also pass; no training ran in this region verification. The initial renderer prototype-sharing failure is retained as `tests/soul/presentation-region-views-failure-01.json`.

Sources: `agi/soul/SoulPresentationRegions.js`; `webgpu-os/apps/soul/SoulRegionStorage.js`, `SoulStorage.js`, `RealmForgeWorld.js`, `SoulApp.js`. Reports: `tests/soul/latest-presentation-region-views-result.json`, `latest-region-storage-result.json`, `latest-presentation-regions-result.json`, `latest-region-app-result.json`, `latest-founder-app-result.json`, `latest-grounded-artifact-result.json`.

## Review and train

1. Collect founder outcomes, run legacy routines, or import dictionary entries, text, images or OCR corrections in **Sources**.
2. Inspect and correct drafts. Native decision records require **Useful choice** or **Factual outcome** review. Only a completed productive receipt can support a useful-choice target; failures can become factual outcome text. **Draft a supervised alternative** creates a separate operator-labelled draft from the original pre-action evidence and never invents an executed result. Bulk approval skips unassessed choices. **Exclude from training** preserves original history. Earlier selected-first records remain excluded and require fresh collection. Older/Newer controls expose earlier records.
3. Choose **Compile approved dataset**. Source and episode groups stay together across training, validation and test splits.
4. In **Training**, choose **Grounded decisions and language · v3** for new founder learning, initialize, and train the candidate. Neural forward, backward and optimizer operations use WebGPU. Existing v2 imports retain their architecture; enlarging or changing the model is an explicit version choice.
5. Pause training and evaluate validation. **Promote candidate** requires complete, current passing language validation. Grounded v3 promotion also requires at least 100 validation decisions across 20 independent groups, two action kinds, 80% accuracy, no serving regression, evidence dependence, candidate-order invariance, and at least 20 opposed-evidence pairs with 80% accuracy. Language-only continuation cannot bypass the grounded gate. Legacy action datasets retain the separate six-home-command gate. Test evaluation cannot replace validation; serving weights change only after explicit promotion.
6. In a founder camp, **Generate one action** uses personal discovery; optional serving-model participation is selected in project setup. In a legacy village, select an **Action goal** and generate a supported GPU-scored command. All effects remain owner-validated. Scheduling does not establish that a person arrived, completed work or chose well.

Routine records include observed outcomes and action examples with provenance. They are drafts, not automatic endorsements. Definitions and lexicons supply reviewed source material; they do not by themselves make an untrained model understand or act correctly.

Action inputs capture permitted evidence before a stage begins. The completed receipt is retained as review evidence, outside the model input. Older daily action records that used post-action observations must be replaced by newly collected routines before compilation. Previously collected outcome records remain usable as outcome descriptions.

### Load a saved model or resume training

In **Exports**, choose **Import saved artifact** and select a runtime model to use its serving weights. Import a training checkpoint to restore candidate weights, optimizer moments, RNG, update count and dataset cursor. A fresh studio creates separate random serving weights when only a training checkpoint is imported; the imported candidate still needs evaluation and promotion. To restore both a trained serving model and its continuation state, import the runtime model first, then the training checkpoint. Choose **Save project** to retain the imported state with your world.

Source: `agi/soul/Curriculum.js`, `SoulRuntime.js`, `SoulWorld.js`.

## Measure population load

In Training, choose **Measure populations**. It replays cohorts of 2, 8, 32 and 100 in isolated copies, omitting sizes larger than the project's actual population. Founder replays preserve existing commitments, score bounded available proposals and execute through the owner; busy people are reported as unavailable. Village replays use authored routines. Both render through the shared views and bound inference requests to four. If an approved dataset is loaded, each cohort also performs one candidate update. It never promotes a checkpoint or approves sources. Cancel stops at an operation boundary.

Export the report for routine tick times, action selection latency, queue wait, throughput, rejected proposal counts, model GPU allocation and viewport telemetry. Bounded command validity does not establish that a chosen action is correct; held-out action correctness is reported separately. Model allocation is not total device VRAM usage. The replay uses an in-memory world commit; production project writes use OS storage and can be slower.

Source: `webgpu-os/apps/soul/SoulMeasurements.js`.

## Measure personal learning

Training offers **Measure independent behavior** and **Measure skill transfer**. Both use isolated worlds with the production owners and preserve the active project. The independent comparison declares seeds, starting supplies, decision cadence and horizon, then compares random choices, retained exact-context learning and semantic skills. The optional initialized v3 serving model adds a separately identified controller. The focused test uses actual owner practice and counterbalanced alternatives. It permits eight decisions and 180 simulation seconds per task, with no reset between attempts, and reports first-choice correctness separately from eventual completion. Its setup is reported separately from unforced society behavior.

New founder snapshots retain an operator-only measurement window: food/water access, need deprivation, production and consumption, unfinished work, and actual outcomes. Provisional roles require repeated completed work in a rolling 600-second window. A selected person's panel exposes objective, step, target, evidence, last result and recovery. These displays do not assign occupations or supply hidden observations to the controller.

The independent gate compares controller-neutral useful outcome sequences and summed deprivation using paired seed intervals. Learned-chain execution counts remain a separate diagnostic because only the semantic controller has that mechanism. Deprivation sums time in each need condition, including overlaps; it is not unique time with any unmet need. Intervention reports retain whether an intervention could actually be applied in each evolving world.

The current `soul.metrics.v3` ledger identifies strict useful chains as `soul.outcome-chain.v3` and records the exact personal credit policy. Every controller uses the same terminal material/tool dependency rule and positive summed observed return. Loading earlier windows preserves heuristic counts as `legacyHeuristicChains` and former strict counts as `legacyStrictChains`, then starts a new strict window. Historical sample labels and values retain their original version. Taught practice and demonstrated learned execution have separate counters. Results from different credit policies cannot be compared as though they used the same measure.

The current simulation can recover an incapacitated person; endpoint health is not a mortality rate. Report minimum health, ever-incapacitated state and unmet-need duration as well as averages. Finite stocks still prevent an indefinite sustainability claim.

The first v3 bounded comparison completed six eight-person worlds at 60 simulation seconds: two seeds and three controllers, with default books and actual broken-tool/depletion interventions. Exact-context and semantic controllers each completed two useful prerequisite chains in the first seed; none completed a chain in the second. No world completed learned execution, taught practice, reading, repair, delivery or a shelter stage. All retained healthy people during this short horizon. The competence gate remains false. See the [recorded results and limits](soul-civilization-roadmap.md#first-bounded-trials-with-personal-credit-v3) and `tests/soul/live-learning-verification-20261001/bounded-study-audit.json`. These isolated owner trials do not measure native OS throughput.

Cancel measurements at an operation boundary. **Export measurements** retains completed and partial results with their status. The latest report is included in project save/restore. Transaction profiling separates cloning, mutation, validation, compilation, storage callback and projection. Completed immutable personal histories can be shared across internal copies; restored or altered records still undergo full validation.

Sources: `agi/soul/SoulMetrics.js`, `SoulWorldState.js`; `webgpu-os/apps/soul/SoulTrials.js`, `SoulMeasurements.js`, `SoulDashboard.js`, `SoulApp.js`.

## Verification

### Founder workflow, 26 September 2026

Real Chrome on NVIDIA Blackwell passed personal outcome learning, founder world/placement, controlled family, interrupted-work and native app checks. The native 100-person scene rendered 3,371 pieces in 83 draws with no unbound materials. Tests verify actual OS GPU scoring with both views, archival before new-camp replacement, complete project restore, tampered inventory rejection, uncertain-write fencing and GPU/surface cleanup.

The latest personal outcome fixture preferred a repeatedly useful action in **184/200** choices. This measures bounded episodic learning, not a trained language policy. The generic decision dataset fixture contains 37 training, 5 validation and 3 test rows. After two WebGPU updates, validation accuracy was **20%**, and missing-evidence accuracy was also **20%**. Promotion correctly failed and serving weights remained unchanged.

Family and shelter fixtures explicitly set up capability conditions; they do not establish spontaneous multi-generation survival or independently learned building design. Current founder food and water are finite, with no regrowth/farming loop.

```powershell
python tests/soul/run_gpu.py --page discovery.html
python tests/soul/run_gpu.py --page discovery-learning.html
python tests/soul/run_gpu.py --page founder.html
python tests/soul/run_gpu.py --page founder-family.html
python tests/soul/run_gpu.py --page founder-interruption.html
python tests/soul/run_gpu.py --page economy.html
python tests/soul/run_gpu.py --page shelter-world.html
python tests/soul/run_founder_app.py
```

Sources: `tests/soul/latest-discovery-result.json`, `latest-discovery-learning-result.json`, `latest-founder-result.json`, `latest-founder-family-result.json`, `latest-founder-interruption-result.json`, `latest-founder-app-result.json`.

### Grounded v3 model, 26 September 2026

The exported model contains 161,714 parameters. Chrome on NVIDIA Blackwell trained it from browser random initialization for 150 updates in 88.2 seconds, using explicit supervised needs, resource-stock and tool-condition cases. The dataset has 240 training, 120 validation and 48 test decisions; opposing evidence pairs remain in the same split.

| Check | Measured result |
|---|---|
| Validation | 120/120 correct across 60 independent groups |
| Missing evidence | 50% accuracy |
| Opposed-evidence pairs | 60/60 correct |
| Candidate-order permutation | 100% invariant |
| Untouched test | 47/48 correct; 23/24 opposed pairs |
| Candidate-head CPU/GPU gradient | Maximum error 2.24e-7 |
| Enabled encoders | Nonzero gradients in all six |
| Checkpoint continuation fixture | Next update matched exactly |
| Legacy Pai numerics | All eight supplied Python reference fixtures passed |

This is a measured decision model for three controlled mechanisms. It does not demonstrate broad conversation, visual recognition from a live camera, house design or a self-sustaining civilization. Successful inference on those tasks remains an evaluation requirement.

Artifacts are saved under `artifacts/soul-grounded-learning-2026-09-26/`: `runtime-model.soul`, `training-checkpoint.soul`, `dataset.soul`, `verification.json`, `compatibility-verification.json` and `provenance.json`. In **Exports → Import saved artifact**, import the runtime model to use its serving weights. Import the training checkpoint afterward to continue the candidate from step 150 and dataset cursor 900. Save the project to retain both. The checkpoint contains the compiled dataset; the separate dataset export is also available for inspection/import.

Original training source hashes are retained. A fresh browser subsequently imported all three artifacts using the recorded runtime, reproduced 47/48 test accuracy, and checked expanded object/commitment bindings and both reference encodings. The latest compatibility check records the 22 fetched runtime module hashes. Earlier checks remain in `compatibility-history/` and `provenance.json`'s `runtimeValidationHistory`; compatibility verification does not retrain the model or rewrite its training provenance.

```powershell
python tests/soul/run_gpu.py --page grounded-policy.html
python tests/soul/run_gpu.py --page grounded-evaluation.html
python tests/soul/run_gpu.py --page grounded-artifact.html
python tests/soul/run_gpu.py --page grounding-world.html
python tests/soul/run_gpu.py --page founder-skills.html
python tests/soul/run_gpu.py --page founder-recovery.html
```

Sources: `tests/soul/latest-grounded-policy-result.json`, `latest-grounded-evaluation-result.json`, `latest-grounded-artifact-result.json`, `latest-gpu-result.json`; artifact verification and provenance files.

### Strict personal skills and recovery, 26 September 2026

The frozen strict-sequence version completed **100/100** focused tasks across 20 fresh seeds, with **85/100** correct first choices. Each task passed 20/20: food access, water access, tool use, replacement-tool crafting and material delivery to accepted construction. Every case entered learned sequence execution and verified the resulting effects through the production owners. Completion took an average of 2.40 choices and 12.05 simulation seconds, with observed maxima of five choices and 43 seconds, within the declared eight-choice/180-second budget.

These controlled cases supply prior owner-executed practice and bounded alternatives. They establish transfer and execution under those conditions; independent goal discovery is measured separately below. Each task's 20/20 result has a 95% Wilson interval of approximately 84%–100%. The five tasks within a seed are related; the report retains a seed-cluster estimate without treating its all-success interval as certainty about new settings.

All five controlled recovery cases also passed: depleted stock, a held broken tool, a moved bedroll, a blocked route and cancelled/restored work. Both reports validated the exact served sources against `founder-strict-confirmatory-source-20260926.zip`. Browser cleanup stalled after both complete reports were saved on this host; only those finished runners and their own descendants were stopped. This does not supply an isolated timing benchmark.

Sources: `tests/soul/founder-strict-focused-confirmatory.json`, `founder-strict-recovery-confirmatory.json`.

### Historical focused personal skills and recovery, 26 September 2026

Before the strict dependency rule and independent sequence bank were introduced, a 20-seed run completed **100/100** focused tasks: 20/20 each for food access, water access, tool acquisition, replacement-tool crafting and delivery to accepted construction. First choices were correct in **80/100** cases. Each task allowed at most eight choices and 180 simulation seconds, retaining real intermediate effects. This remains historical evidence of controlled owner task completion under that recorded implementation. It does not validate the revised sequence learner or establish that residents independently pursue those tasks in a free society.

Each task's 20/20 result has a 95% Wilson interval of approximately 84%–100%. The five tasks within one seed are related, so treating all 100 as independent trials would overstate confidence. The report also retains the descriptive seed-cluster estimate, whose normal interval collapses when all seeds succeed; that does not mean certain success in new settings.

The earlier first-choice study remains saved: 65/100, with exploratory inspection accounting for the misses. The bounded-completion protocol was made explicit after that diagnosis, then measured on fresh seeds without further policy tuning. The change in protocol must accompany comparisons between these reports.

The revised full study stopped after 18 of 60 worlds, with four complete matched seeds. A shelter at exactly the permitted clearance passed insertion but failed the subsequent reverse-order check because of floating-point rounding. The actor owner correctly retained an uncertain effect; the next task was refused. No aggregate acceptance gate was evaluated. The original failure, partial worlds and earlier historical reports remain preserved.

The shelter owner now compares symmetric signed axis gaps with its existing 0.000001 m tolerance. A four-group regression covers both insertion orders and genuine encroachment. Replaying the retained checkpoint from 240 to 300 simulation seconds with an immutable archive containing only that source fix completed the formerly failing plan and its subsequent construction action. This verifies the defect repair; it does not replace a complete independent comparison. Sources: `tests/soul/founder-strict-confirmatory-interrupted-summary.json`, `founder-shelter-clearance-fixed-replay.json`, `latest-shelter-result.json`.

Five controlled recovery cases passed through actual owners: depleted stock, a held broken tool, moved bedroll, blocked route and cancelled/restored work. They establish handling of these feasible cases, not spontaneous adaptation across every world intervention.

```powershell
python tests/soul/run_founder_study.py --kind focused --seeds 20 --seed-start 500000003 --seed-stride 104729 --name founder-focused-bounded-reproduction
python tests/soul/run_gpu.py --page founder-recovery.html
```

Sources: `tests/soul/founder-focused-bounded-confirmatory.json`, `founder-focused-confirmatory.json`, `founder-recovery-pinned.json`.

### Reproduce an independent comparison

The full protocol uses 20 seeds, eight people, 600 simulation seconds per world and three controllers: random choices, retained exact-context learning and semantic personal procedures. It evaluates the complete production owners without initializing presentation. Neural model participation is a separately declared optional app measurement; the Python study runner compares the three personal controllers.

The saved source archive pins the complete fetched JavaScript dependency graph, humanoid asset and Python harness sources. The initial `founder-confirmatory-pinned-20260926.zip` preserves an interrupted diagnostic study: its shared-commitment heuristic could link unrelated actions, so it cannot support a dependency-chain acceptance claim. Fifteen completed worlds and the invalidation reason remain in `founder-free-legacy-heuristic-summary.json`. The local study server rejects unrecorded JavaScript dependencies. Reports retain hashes of the exact served source and asset bytes; later changes in the working checkout are reported separately. This keeps concurrent development from silently changing an experiment.

The interrupted revised study froze `tests/soul/founder-strict-confirmatory-source-20260926.zip`, SHA-256 `07cc15c576aaa0890be97a8eb585a2178961e4d9769a8eed42af19d2df9d3c37`. Its 20 specified seeds were `1100000003 + i * 104729`, for `i = 0…19`. This archive preserves the failure for reproduction. A new acceptance attempt must pin the corrected implementation separately; it must not merge the original partial worlds with changed code.

```powershell
python tests/soul/run_founder_study.py --kind free --seeds 20 --seed-start 1100000003 --seed-stride 104729 --horizon 600 --source-snapshot tests/soul/founder-strict-confirmatory-source-20260926.zip --name founder-free-strict-reproduction
```

The runner saves durable progress, completed rows and periodic compressed world checkpoints. Four concurrent five-seed runs can be merged with `tests/soul/merge_founder_studies.py`; the merger requires the same source archive, settings, dependencies and harness hashes, rejects missing/duplicate seed-controller pairs, and recomputes the production comparison. Worker timing includes CPU contention and is not an isolated performance benchmark. A completed run means the protocol finished; inspect `gates.passed` for the competence result.

Sources: `tests/soul/run_founder_study.py`, `study_source.py`, `merge_founder_studies.py`; `webgpu-os/apps/soul/SoulTrials.js`.

### Legacy village and model regressions

Run from the repository root with Python and the existing Playwright/Chrome environment:

```powershell
python tests/soul/run_gpu.py --page cohorts.html
python tests/soul/run_gpu.py --page society.html
python tests/soul/run_gpu.py --page housing.html
python tests/soul/run_gpu.py --page app.html --housing --screenshot
python tests/soul/run_gpu.py --page actions.html
python tests/soul/run_gpu.py --page action-transfer.html
python tests/soul/run_gpu.py --page app.html --acceptance
python tests/soul/run_gpu.py --page app.html --screenshot --routine
```

The cohort run verifies completed stages, unique draft records and saved-routine continuation. It exports a reviewed test fixture for the acceptance run. Test-fixture review never approves the operator's project data. The society test checks controlled combat, theft, partnership, family and civic capabilities, physical delegated delivery, corruption rejection, continuation and a short unforced decision loop. A fixture advances the family calendar for the birth check; this is not a claim that an unforced multi-generation civilization has emerged. The app run checks default autonomous start and pause. The acceptance run exercises real permission enforcement, animation, GPU training, held-out evaluation, explicit promotion, population contention, project restore and resource cleanup.

The small measured model is a learning workflow demonstration. Authored routines do not establish learned conversational or social competence. Speech integration and broad paired-view learning evaluation remain separate milestones.

The action learning check trains from browser random initialization using reviewed routine evidence, selects checkpoints using validation, and evaluates the untouched test split and missing-evidence condition separately. It also checks the next training update after snapshot restoration. Success on six authored goal names does not establish understanding of unseen paraphrases or autonomous goal selection.

### Measured goal-command model, 26 September 2026

The browser run on NVIDIA Blackwell hardware reached 18/18 validation and 6/6 test choices after 240 updates. The exported runtime then selected 48/48 commands correctly across eight further episodes excluded from training and checkpoint selection. All use the six authored goal names. Validation target loss fell from 5.5384 to 0.0903, and the next update after restoration had zero measured weight difference.

The same model scored 2/6 on untrained natural-language paraphrases and 5/6 when supplied with observations from a different action. Missing observations still gave 6/6 correct fixed-goal choices; this result does not demonstrate visual understanding. These limitations remain visible in the test reports.

Source: `tests/soul/latest-actions-result.json`, `tests/soul/latest-action-transfer-result.json`; exported artifacts under `artifacts/soul-goal-learning-2026-09-26/`.

## Founder cohort verification

The native Chrome/WebGPU fixture `tests/soul/founder-scale.html` exercised decision cohorts of 2, 8, 32 and 100 inside a saved 100-person world, with both OS-owned views. Every proposal passed bounded protocol validation; the queue stayed at four or fewer requests. The current v3 run completed 100 decisions in 44.93 seconds (2.23 proposals/second), with the other development browser checks stopped. This measures the full replay, including world transactions and rendering; it does not establish action quality or real-time 100-person intelligence. The earlier v2 development run took 63.21 seconds with some contention, so those two figures are not a controlled architecture speed comparison.

Founder measurement rows report decision cohort and total simulated population separately. Existing background commitments continue in the copied world. Busy people are counted as unavailable rather than assigned invented work. The user's world, personal memories and serving weights remain unchanged; reviewed candidate training can run when a dataset is loaded.

Source: `webgpu-os/apps/soul/SoulMeasurements.js`, `tests/soul/latest-founder-scale-result.json`.

## See also

- [Civilization gaps, live dashboard and founder camp roadmap](soul-civilization-roadmap.md)
- [RealmForge](realmforge.md)
- [Compute Service](compute.md)
- [WebGPU OS overview](overview.md)
