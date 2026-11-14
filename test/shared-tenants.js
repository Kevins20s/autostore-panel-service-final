'use strict';
const assert = require('node:assert/strict');
const { buildTenantRegistry, tenantForGuild, eligibleHostedLicense, eligibleHostedGuild, hostedTenant, hostedDbName } = require('../src/shared-tenants');
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

const publicEnv = {
  DISCORD_HOSTED_PUBLIC_ENABLED: '1',
  DISCORD_CATALOG_PILOT_MONGO_URL: 'mongodb://hosted/db',
  DISCORD_HOSTED_PILOT_LICENSE_ID: 'pilot',
  DISCORD_HOSTED_PILOT_GUILD_IDS: g1,
  DISCORD_HOSTED_PILOT_DB_NAMESPACE: 'existing',
};
const buyer = { id: 'paid-buyer', type: 'autostore', expiresAt: now + 60000,
  hostedBot: { enabled: true, guildId: g2 } };
assert.equal(eligibleHostedLicense(buyer, publicEnv), true);
assert.equal(eligibleHostedGuild(g2, buyer, publicEnv), true);
assert.equal(eligibleHostedGuild('bad-id', buyer, publicEnv), false);
for (const blocked of [
  { ...buyer, revoked: true },
  { ...buyer, expiresAt: now - 1 },
  { ...buyer, expiresAt: null, activationDays: 30 },
  { ...buyer, type: 'service' },
  { ...buyer, type: 'unknown' },
  { ...buyer, id: '' },
]) {
  assert.equal(eligibleHostedLicense(blocked, publicEnv), false);
  assert.equal(hostedTenant(blocked, [], publicEnv), null);
}
assert.equal(eligibleHostedLicense(buyer, { ...publicEnv, DISCORD_HOSTED_PUBLIC_ENABLED: '0' }), false);
assert.equal(eligibleHostedLicense(buyer, { ...publicEnv, DISCORD_CATALOG_PILOT_MONGO_URL: '' }), false);
const publicTenant = hostedTenant(buyer, [], publicEnv);
assert.equal(publicTenant.dbName, hostedDbName('autostore', buyer.id + ':' + g2));
assert.notEqual(publicTenant.dbName, hostedTenant({ ...buyer, id: 'another-buyer' }, [], publicEnv).dbName);
assert.equal(hostedTenant(buyer, [{ id: 'expired-shop', hostedBot: { guildId: g2, enabled: false } }], publicEnv), null);
const pilot = { ...buyer, id: 'pilot', hostedBot: { enabled: true, guildId: g1 } };
assert.equal(hostedTenant(pilot, [], publicEnv).dbName, hostedDbName('autostore', 'existing-0'));
assert.equal(hostedTenant({ ...pilot, hostedBot: { enabled: true, guildId: g2 } }, [], publicEnv), null);
console.log('OK: public buyers can host with isolated databases; inactive licenses and server conflicts stay blocked');
