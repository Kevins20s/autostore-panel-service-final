'use strict';
const assert = require('node:assert/strict');
const { createTenantDbManager } = require('../src/shared-tenant-db');

function fakeMongoose() {
  const connections = [];
  return {
    connections,
    createConnection(uri, options) {
      const connection = {
        uri, options, models: Object.create(null), closed: false,
        asPromise: async () => connection,
        model(name, schema) { return this.models[name] ||= { name, schema, connection: this }; },
        async close() { this.closed = true; },
      };
      connections.push(connection);
      return connection;
    },
  };
}
const tenant = (licenseId, guildId, product = 'autostore', mongoUrl = `mongodb://localhost/${licenseId}`) => ({
  licenseId, guildId, product, config: { mongoUrl },
});
(async () => {
  const mongoose = fakeMongoose();
  const manager = createTenantDbManager(mongoose);
  const schema = () => ({ schema: true });
  const a = await manager.get(tenant('a', '123456789012345678'), { Order: schema });
  const aAgain = await manager.get(tenant('a', '123456789012345678'), { Order: schema });
  const b = await manager.get(tenant('b', '987654321098765432'), { Order: schema });
  const service = await manager.get(tenant('s', '111111111111111111', 'service'), { Order: schema });
  assert.equal(mongoose.connections.length, 3, 'satu koneksi per tenant, bukan per permintaan');
  assert.equal(a.connection, aAgain.connection, 'tenant yang sama memakai koneksi yang sama');
  assert.notEqual(a.connection, b.connection, 'dua license berbeda tidak berbagi koneksi');
  assert.notEqual(a.models.Order, b.models.Order, 'model tenant tidak boleh berbagi instance');
  assert.notEqual(a.connection, service.connection, 'Service terpisah dari AutoStore');
  assert.equal(manager.size(), 3);
  assert.equal(await manager.closeTenant(tenant('a', '123456789012345678')), true);
  assert.equal(a.connection.closed, true);
  assert.equal(manager.size(), 2);
  await manager.closeAll();
  assert.equal(manager.size(), 0);
  assert.equal(b.connection.closed, true);
  await assert.rejects(manager.get(tenant('x', 'bad-guild')), /Konteks tenant/);
  console.log('OK: tenant DB manager isolation checks');
})().catch((err) => { console.error(err); process.exitCode = 1; });
