// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveModule, sourceUrl, finishSuite } from '../resolver.js';
    const {
      SOUND_PALETTE_SCHEMA,
      loadPalette,
      readSoundPaletteRecord,
      writeSoundPaletteRecord,
    } = await resolveModule("engine/audio/synth/VariationGenerator.js", ["SOUND_PALETTE_SCHEMA", "loadPalette", "readSoundPaletteRecord", "writeSoundPaletteRecord"]);
    const {
      GENERATED_SPELL_LIBRARY_SCHEMA,
      readGeneratedSpellLibraryRecord,
      writeGeneratedSpellLibraryRecord,
    } = await resolveModule("engine/gameplay/spells/SpellGeneratorIntegration.js", ["GENERATED_SPELL_LIBRARY_SCHEMA", "readGeneratedSpellLibraryRecord", "writeGeneratedSpellLibraryRecord"]);
    const {
      MATERIAL_LIBRARY_SCHEMA,
      readMaterialLibraryRecord,
      writeMaterialLibraryRecord,
    } = await resolveModule("engine/render/materials/MaterialLibrary.js", ["MATERIAL_LIBRARY_SCHEMA", "readMaterialLibraryRecord", "writeMaterialLibraryRecord"]);
    const {
      PARTICLE_TRUST_FLOOR_SCHEMA,
      readParticleTrustFloor,
      writeParticleTrustFloor,
    } = await resolveModule("engine/network/daemon/ParticleNetworkDaemon.js", ["PARTICLE_TRUST_FLOOR_SCHEMA", "readParticleTrustFloor", "writeParticleTrustFloor"]);
    const {
      REALM_BRANCH_STORAGE_SCHEMA,
      RealmBranchStorage,
    } = await resolveModule("engine/network/realm/branches/BranchStorage.js", ["REALM_BRANCH_STORAGE_SCHEMA", "RealmBranchStorage"]);
    const {
      COLLAB_IDENTITY_DB_NAME,
      COLLAB_IDENTITY_KEY_ID,
      COLLAB_IDENTITY_RECORD_SCHEMA,
      COLLAB_IDENTITY_RECORD_VERSION,
      COLLAB_IDENTITY_STORE_NAME,
      collabIdentityCurrentKey,
      createIdentity,
      prepareCollabIdentityRecord,
    } = await resolveModule("engine/collab/CollabIdentity.js", ["COLLAB_IDENTITY_DB_NAME", "COLLAB_IDENTITY_KEY_ID", "COLLAB_IDENTITY_RECORD_SCHEMA", "COLLAB_IDENTITY_RECORD_VERSION", "COLLAB_IDENTITY_STORE_NAME", "collabIdentityCurrentKey", "createIdentity", "prepareCollabIdentityRecord"]);
    const {
      PARTICLE_EFFECT_DB_NAME,
      PARTICLE_EFFECT_RECORD_SCHEMA,
      PARTICLE_EFFECT_RECORD_VERSION,
      PARTICLE_EFFECT_STORE_NAME,
      ParticleEffectRegistry,
      particleEffectCurrentId,
      prepareParticleEffectRecord,
    } = await resolveModule("engine/render/particles/ParticleEffectRegistry.js", ["PARTICLE_EFFECT_DB_NAME", "PARTICLE_EFFECT_RECORD_SCHEMA", "PARTICLE_EFFECT_RECORD_VERSION", "PARTICLE_EFFECT_STORE_NAME", "ParticleEffectRegistry", "particleEffectCurrentId", "prepareParticleEffectRecord"]);
    const {
      CHUNK_PERSISTENCE_DB_NAME,
      CHUNK_PERSISTENCE_RECORD_SCHEMA,
      CHUNK_PERSISTENCE_RECORD_VERSION,
      CHUNK_PERSISTENCE_STORE_NAME,
      ChunkPersistence,
      chunkPersistenceCurrentKey,
      prepareChunkPersistenceRecord,
    } = await resolveModule("engine/world/storage/ChunkPersistence.js", ["CHUNK_PERSISTENCE_DB_NAME", "CHUNK_PERSISTENCE_RECORD_SCHEMA", "CHUNK_PERSISTENCE_RECORD_VERSION", "CHUNK_PERSISTENCE_STORE_NAME", "ChunkPersistence", "chunkPersistenceCurrentKey", "prepareChunkPersistenceRecord"]);
    const {
      PARTICLE_MASTER_SERVERS_KEY,
      saveParticleMasterServers,
    } = await resolveModule("engine/network/routes/MasterServerList.js", ["PARTICLE_MASTER_SERVERS_KEY", "saveParticleMasterServers"]);

    class MemoryStorage {
      constructor(initial = {}) {
        this.values = new Map(Object.entries(initial));
        this.writeCount = 0;
      }
      getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
      setItem(key, value) { this.writeCount += 1; this.values.set(key, String(value)); }
      removeItem(key) { this.writeCount += 1; this.values.delete(key); }
      snapshot() { return JSON.stringify([...this.values.entries()].sort()); }
    }

    class MemoryBackend extends MemoryStorage {}

    const results = [];
    const assert = (value, message) => { if (!value) throw new Error(message); };
    function expectCode(action, code) {
      try { action(); } catch (error) {
        assert(error?.code === code, `expected ${code}, received ${error?.code || error?.message}`);
        return;
      }
      throw new Error(`expected ${code}`);
    }
    async function expectReject(action, pattern) {
      try { await action(); } catch (error) {
        assert(pattern.test(String(error?.message || error)), `unexpected rejection: ${error?.message || error}`);
        return;
      }
      throw new Error(`expected rejection matching ${pattern}`);
    }
    async function test(name, action) {
      try { await action(); results.push({ name, pass: true }); }
      catch (error) { results.push({ name, pass: false, error: error?.stack || String(error) }); }
    }

    function openDatabase(name, storeName, keyPath) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName, keyPath ? { keyPath } : undefined);
          }
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`${name} open blocked`));
      });
    }

    async function putRecord(name, storeName, value, { key, keyPath } = {}) {
      const db = await openDatabase(name, storeName, keyPath);
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          if (key === undefined) store.put(value);
          else store.put(value, key);
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error || new Error('put aborted'));
          tx.onerror = () => {};
        });
      } finally {
        db.close();
      }
    }

    async function readRecords(name, storeName, keys) {
      const db = await openDatabase(name, storeName);
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const values = new Array(keys.length);
          keys.forEach((key, index) => {
            const request = store.get(key);
            request.onsuccess = () => { values[index] = request.result; };
          });
          tx.oncomplete = () => resolve(values);
          tx.onabort = () => reject(tx.error || new Error('read aborted'));
          tx.onerror = () => {};
        });
      } finally {
        db.close();
      }
    }

    function deleteDatabase(name) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`${name} delete blocked`));
      });
    }

    await test('sound palette v1 read, v2 dual publication, and future zero-write', () => {
      const storage = new MemoryStorage({ engine_sound_palette: JSON.stringify({ entries: [{ id: 'old' }] }) });
      assert(readSoundPaletteRecord(storage).entries[0].id === 'old', 'v1 palette was not read');
      writeSoundPaletteRecord({ entries: [{ id: 'new' }] }, storage);
      const current = JSON.parse(storage.getItem('engine_sound_palette.v2'));
      assert(current.schema === SOUND_PALETTE_SCHEMA && current.schemaVersion === 2, 'palette v2 missing');
      assert(current.legacySnapshot === storage.getItem('engine_sound_palette'), 'palette mirror mismatch');
      storage.setItem('engine_sound_palette', JSON.stringify({ entries: [{ id: 'rollback' }] }));
      assert(loadPalette(storage).entries[0].id === 'rollback', 'older palette writer was shadowed');

      const future = new MemoryStorage({
        'engine_sound_palette.v2': JSON.stringify({
          schema: SOUND_PALETTE_SCHEMA, schemaVersion: 99, palette: { entries: [] }, legacySnapshot: '{"entries":[]}',
        }),
      });
      const before = future.snapshot();
      expectCode(() => writeSoundPaletteRecord({ entries: [] }, future), 'FUTURE_BROWSER_RECORD_VERSION');
      assert(future.snapshot() === before && future.writeCount === 0, 'future palette was overwritten');
    });

    await test('spell and material libraries use strict shared v2 records', () => {
      const spellStorage = new MemoryStorage();
      writeGeneratedSpellLibraryRecord({ ember: { id: 'ember', name: 'Ember' } }, spellStorage);
      assert(readGeneratedSpellLibraryRecord(spellStorage).ember.name === 'Ember', 'spell library missing');
      assert(JSON.parse(spellStorage.getItem('generated_spells.v2')).schema === GENERATED_SPELL_LIBRARY_SCHEMA,
        'spell schema missing');

      const materialStorage = new MemoryStorage();
      writeMaterialLibraryRecord([{ id: 'mat', name: 'Stone' }], materialStorage);
      assert(readMaterialLibraryRecord(materialStorage)[0].id === 'mat', 'material library missing');
      assert(JSON.parse(materialStorage.getItem('editor_material_library.v2')).schema === MATERIAL_LIBRARY_SCHEMA,
        'material schema missing');

      const future = new MemoryStorage({
        'editor_material_library.v2': JSON.stringify({
          schema: MATERIAL_LIBRARY_SCHEMA, schemaVersion: 7, materials: [], legacySnapshot: '[]',
        }),
      });
      const before = future.snapshot();
      expectCode(() => writeMaterialLibraryRecord([], future), 'FUTURE_BROWSER_RECORD_VERSION');
      assert(future.snapshot() === before && future.writeCount === 0, 'future material library changed');
    });

    await test('network trust floor dual publishes and blocks future generations', () => {
      const storage = new MemoryStorage();
      const floor = { rootVersion: 4, rollbackVersion: 1, issuedAt: 12 };
      writeParticleTrustFloor('root', 'node', floor, storage);
      assert(readParticleTrustFloor('root', 'node', storage).rootVersion === 4, 'trust floor missing');
      const current = JSON.parse(storage.getItem('particle.network.trust.v2:root:node'));
      assert(current.schema === PARTICLE_TRUST_FLOOR_SCHEMA, 'trust-floor schema missing');

      const future = new MemoryStorage({
        'particle.network.trust.v2:root:node': JSON.stringify({
          schema: PARTICLE_TRUST_FLOOR_SCHEMA, schemaVersion: 8, floor, legacySnapshot: JSON.stringify(floor),
        }),
      });
      const before = future.snapshot();
      expectCode(() => writeParticleTrustFloor('root', 'node', floor, future), 'FUTURE_BROWSER_RECORD_VERSION');
      assert(future.snapshot() === before && future.writeCount === 0, 'future trust floor changed');
    });

    await test('realm branch queues retain v1 rollback writers and future records', async () => {
      const realmId = `prid:v1:realm:${'a'.repeat(64)}`;
      const branchId = `prid:v1:branch:${'b'.repeat(64)}`;
      const backend = new MemoryBackend();
      const storage = new RealmBranchStorage({ backend });
      await storage.saveQueue(realmId, branchId, { pending: [1] });
      const encodedRealm = encodeURIComponent(realmId);
      const encodedBranch = encodeURIComponent(branchId);
      const legacyKey = `realm-network.branches.v1:queue:${encodedRealm}:${encodedBranch}`;
      const currentKey = `realm-network.branches.v2:queue:${encodedRealm}:${encodedBranch}`;
      const current = JSON.parse(backend.getItem(currentKey));
      assert(current.schema === REALM_BRANCH_STORAGE_SCHEMA && current.schemaVersion === 2, 'branch v2 missing');
      backend.setItem(legacyKey, JSON.stringify({ pending: [2] }));
      assert((await storage.loadQueue(realmId, branchId)).pending[0] === 2, 'rollback queue writer was shadowed');

      const future = JSON.stringify({
        schema: REALM_BRANCH_STORAGE_SCHEMA, schemaVersion: 99, value: {}, legacySnapshot: '{}',
      });
      backend.setItem(currentKey, future);
      const before = backend.snapshot();
      await expectReject(() => storage.saveQueue(realmId, branchId, { pending: [3] }), /newer than supported/);
      assert(backend.snapshot() === before, 'future branch queue changed');
    });

    await test('collaboration identity v2 commits atomically and future keys stay untouched', async () => {
      await deleteDatabase(COLLAB_IDENTITY_DB_NAME);
      const keyId = `${COLLAB_IDENTITY_KEY_ID}-focused`;
      const identity = await createIdentity(keyId);
      assert(identity._available && identity._persistent, 'identity was not persisted');
      const [legacy, current] = await readRecords(
        COLLAB_IDENTITY_DB_NAME, COLLAB_IDENTITY_STORE_NAME, [keyId, collabIdentityCurrentKey(keyId)],
      );
      assert(legacy?.privateKey, 'legacy identity mirror missing');
      const prepared = prepareCollabIdentityRecord(current);
      assert(prepared.version === COLLAB_IDENTITY_RECORD_VERSION, 'identity v2 envelope missing');

      const futureKey = `${COLLAB_IDENTITY_KEY_ID}-future`;
      const future = { schema: COLLAB_IDENTITY_RECORD_SCHEMA, schemaVersion: 99 };
      await putRecord(COLLAB_IDENTITY_DB_NAME, COLLAB_IDENTITY_STORE_NAME, future, {
        key: collabIdentityCurrentKey(futureKey),
      });
      const ephemeral = await createIdentity(futureKey);
      assert(ephemeral._available && !ephemeral._persistent, 'future identity was treated as writable');
      const [futureLegacy, futureCurrent] = await readRecords(
        COLLAB_IDENTITY_DB_NAME, COLLAB_IDENTITY_STORE_NAME,
        [futureKey, collabIdentityCurrentKey(futureKey)],
      );
      assert(futureLegacy === undefined, 'future identity created a legacy record');
      assert(futureCurrent.schemaVersion === 99, 'future identity record changed');
      await deleteDatabase(COLLAB_IDENTITY_DB_NAME);
    });

    await test('particle effects load v1, publish v2, and preflight future records', async () => {
      await deleteDatabase(PARTICLE_EFFECT_DB_NAME);
      const seed = new ParticleEffectRegistry();
      const legacyEffect = seed.create({ id: 'focused-effect', name: 'Focused Effect' });
      await putRecord(PARTICLE_EFFECT_DB_NAME, PARTICLE_EFFECT_STORE_NAME, legacyEffect, { keyPath: 'id' });

      const registry = new ParticleEffectRegistry();
      await registry.initialize();
      assert(registry.get('focused-effect')?.name === 'Focused Effect', 'legacy effect was not loaded');
      await registry.save(registry.get('focused-effect'));
      const [legacy, current] = await readRecords(
        PARTICLE_EFFECT_DB_NAME, PARTICLE_EFFECT_STORE_NAME,
        ['focused-effect', particleEffectCurrentId('focused-effect')],
      );
      assert(legacy.id === 'focused-effect', 'effect legacy mirror missing');
      assert(prepareParticleEffectRecord(current).version === PARTICLE_EFFECT_RECORD_VERSION, 'effect v2 missing');

      const futureEffect = registry.create({ id: 'future-effect', name: 'Future Effect' });
      const future = {
        id: particleEffectCurrentId(futureEffect.id),
        schema: PARTICLE_EFFECT_RECORD_SCHEMA,
        schemaVersion: 99,
      };
      await putRecord(PARTICLE_EFFECT_DB_NAME, PARTICLE_EFFECT_STORE_NAME, future, { keyPath: 'id' });
      await expectReject(() => registry.save(futureEffect), /FUTURE_PARTICLE_EFFECT_RECORD_VERSION/);
      const [futureLegacy, futureCurrent] = await readRecords(
        PARTICLE_EFFECT_DB_NAME, PARTICLE_EFFECT_STORE_NAME,
        [futureEffect.id, particleEffectCurrentId(futureEffect.id)],
      );
      assert(futureLegacy === undefined && futureCurrent.schemaVersion === 99, 'future effect changed');
      assert(!registry.has(futureEffect.id), 'future effect entered the cache');
      registry._db.close();
      registry._db = null;
      await deleteDatabase(PARTICLE_EFFECT_DB_NAME);
    });

    await test('chunk storage loads v1 and preserves future v2 records with zero writes', async () => {
      await deleteDatabase(CHUNK_PERSISTENCE_DB_NAME);
      const legacy = {
        key: 'world_legacy', chunkKey: 'legacy', timestamp: 10,
        data: { type: 'full', data: [[7, 2], [8, 1]] }, format: 'compressed',
      };
      await putRecord(CHUNK_PERSISTENCE_DB_NAME, CHUNK_PERSISTENCE_STORE_NAME, legacy, { keyPath: 'key' });
      const persistence = new ChunkPersistence();
      persistence.autosaveInterval = 0;
      await persistence.init();
      const loaded = await persistence.loadChunk('legacy');
      assert(loaded.data.voxels instanceof Uint8Array, 'legacy chunk was not decompressed');
      assert([...loaded.data.voxels].join(',') === '7,7,8', 'legacy chunk data changed');

      persistence.deltaSaves = false;
      await persistence.queueSave('current', { voxels: new Uint8Array([1, 1, 2]) }, true);
      const currentLegacyKey = 'world_current';
      const [currentLegacy, current] = await readRecords(
        CHUNK_PERSISTENCE_DB_NAME, CHUNK_PERSISTENCE_STORE_NAME,
        [currentLegacyKey, chunkPersistenceCurrentKey(currentLegacyKey)],
      );
      assert(currentLegacy.key === currentLegacyKey, 'chunk legacy mirror missing');
      assert(prepareChunkPersistenceRecord(current).version === CHUNK_PERSISTENCE_RECORD_VERSION, 'chunk v2 missing');

      const futureLegacyKey = 'world_future';
      const future = {
        key: chunkPersistenceCurrentKey(futureLegacyKey),
        schema: CHUNK_PERSISTENCE_RECORD_SCHEMA,
        schemaVersion: 99,
      };
      await putRecord(CHUNK_PERSISTENCE_DB_NAME, CHUNK_PERSISTENCE_STORE_NAME, future, { keyPath: 'key' });
      await expectReject(
        () => persistence.queueSave('future', { voxels: new Uint8Array([3]) }, true),
        /FUTURE_CHUNK_PERSISTENCE_RECORD_VERSION/,
      );
      const [futureLegacy, futureCurrent] = await readRecords(
        CHUNK_PERSISTENCE_DB_NAME, CHUNK_PERSISTENCE_STORE_NAME,
        [futureLegacyKey, chunkPersistenceCurrentKey(futureLegacyKey)],
      );
      assert(futureLegacy === undefined && futureCurrent.schemaVersion === 99, 'future chunk changed');
      persistence.destroy();
      await deleteDatabase(CHUNK_PERSISTENCE_DB_NAME);
    });

    await test('master-server future envelope remains unchanged', () => {
      const future = JSON.stringify({ format: 'particle-master-server-list-v99', schemaVersion: 99, servers: [] });
      const storage = new MemoryStorage({ [PARTICLE_MASTER_SERVERS_KEY]: future });
      const before = storage.snapshot();
      assert(!saveParticleMasterServers([], storage), 'future master-server save unexpectedly succeeded');
      assert(storage.snapshot() === before && storage.writeCount === 0, 'future master-server record changed');
    });


export const suiteResult = finishSuite('engine-persistence', results.map(row => ({name:row.name, passed:row.pass, error:row.error})));
