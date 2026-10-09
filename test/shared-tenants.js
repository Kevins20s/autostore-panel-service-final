'use strict';
const assert = require('node:assert/strict');
const { buildTenantRegistry, tenantForGuild } = require('../src/shared-tenants');
const now = Date.now();
const g1 = '123456789012345678';
const g2 = '987654321098765432';
const licenses = [
  { id: 'a', type: 'autostore', runMode: 'central', expiresAt: now + 60000, config: { guildId: g1, mongoUrl: 'mongodb://tenant-a/db' } },
  { id: 'b', type: 'autostore', runMode: 'central', expiresAt: now + 60000, config: { guildId: g2, mongoUrl: 'mongodb+srv://tenant-b/db' } },
  { id: 's', type: 'service', runMode: 'central', expiresAt: now + 60000, config: { guildId: '111111111111111111', mongoUrl: 'mongodb://service/db' } },
  { id: 'old', type: 'autostore', expiresAt: now + 60000, config: { guildId: '222222222222222222', mongoUrl: 'mongodb://custom/db' } },
];
const registry = buildTenantRegistry(licenses, 'autostore', (config) => config);
assert.equal(registry.size, 2);
assert.equal(tenantForGuild(registry, g1).licenseId, 'a');
assert.equal(tenantForGuild(registry, g2).licenseId, 'b');
assert.equal(tenantForGuild(registry, '111111111111111111'), null, 'produk Service tidak boleh masuk registry AutoStore');
assert.equal(tenantForGuild(registry, '222222222222222222'), null, 'license Custom tidak boleh masuk registry shared');
assert.equal(tenantForGuild(registry, 'bad-id'), null);
assert.throws(() => buildTenantRegistry([
  licenses[0], { ...licenses[1], config: { ...licenses[1].config, guildId: g1 } }
], 'autostore', (config) => config), /terikat ke lebih dari satu license/);
assert.throws(() => buildTenantRegistry([
  { ...licenses[0], config: { guildId: '', mongoUrl: 'mongodb://tenant/db' } }
], 'autostore', (config) => config), /ID server Discord yang valid/);
assert.throws(() => buildTenantRegistry([
  { ...licenses[0], config: { guildId: g1, mongoUrl: 'not-a-mongo-url' } }
], 'autostore', (config) => config), /MongoDB URL yang valid/);
console.log('OK: shared tenant registry isolation checks');
