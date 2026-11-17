import { uuid } from './bluetooth.mjs';

// Deliberately deterministic. All sample values are labeled in the interface.
export function sampleBluetooth() {
  return {
    async requestDevice(options) {
      const device = new EventTarget();
      device.name = 'Bench sensor · sample';
      const permissions = new Set(options.optionalServices);
      const definitions = [
        ['180f', [['2a19', { read: true, notify: true }]]],
        ['180a', [['2a29', { read: true }]]]
      ];
      const services = definitions.map(([id, characteristics]) => ({
        uuid: uuid(id),
        async getCharacteristics() {
          return characteristics.map(([id, properties]) => ({
            uuid: uuid(id), properties,
            async readValue() { return new DataView(Uint8Array.of(76).buffer); }
          }));
        },
        async getCharacteristic(id) {
          const result = (await this.getCharacteristics()).find(c => c.uuid === id);
          if (!result) throw new DOMException('Characteristic not found', 'NotFoundError');
          return result;
        }
      })).filter(service => permissions.has(service.uuid));
      device.gatt = {
        connected: false,
        async connect() { this.connected = true; return this; },
        disconnect() {
          if (!this.connected) return;
          this.connected = false;
          device.dispatchEvent(new Event('gattserverdisconnected'));
        },
        async getPrimaryServices() { return services; },
        async getPrimaryService(id) {
          const result = services.find(s => s.uuid === id);
          if (!result) throw new DOMException('Service not found', 'NotFoundError');
          return result;
        }
      };
      device.watchAdvertisements = async ({ signal }) => {
        const send = () => {
          if (signal.aborted) return;
          const event = new Event('advertisementreceived');
          Object.assign(event, { uuids: permissions.has(uuid('180f')) ? [uuid('180f')] : [], rssi: -57 });
          device.dispatchEvent(event);
        };
        send();
        const timer = setInterval(send, 2000);
        signal.addEventListener('abort', () => clearInterval(timer), { once: true });
      };
      return device;
    }
  };
}
