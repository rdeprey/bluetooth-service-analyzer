export function browserSupport({ secure, bluetooth, policyAllowed = true, available, blocked = false }) {
  if (!secure) return { canChoose: false, warning: true, title: 'Bluetooth needs a secure page', message: 'Open this demo over HTTPS, or use localhost for development. You can still explore the sample device.' };
  if (!policyAllowed) return { canChoose: false, warning: true, title: 'Bluetooth is blocked on this page', message: 'Open the demo directly instead of inside an embedded preview. You can still explore the sample device.' };
  if (typeof bluetooth?.requestDevice !== 'function') return { canChoose: false, warning: true, title: 'Web Bluetooth is not supported or enabled here', message: 'This browser does not expose the Bluetooth API. Try Chrome or Edge on a supported system, or use the sample device.' };
  if (blocked) return { canChoose: false, warning: true, title: 'Web Bluetooth is disabled in your browser', message: 'Enable Bluetooth access in your browser and reload this page, or use the sample device.' };
  if (available === false) return { canChoose: true, warning: true, title: 'Bluetooth is currently unavailable', message: 'Your browser exposes the API, but reports Bluetooth as unavailable. Check your Bluetooth adapter, browser settings, and system permissions, or use the sample device.' };
  return { canChoose: true, warning: false, title: 'Web Bluetooth API detected', message: 'Device access still depends on your system and permissions. Advertisement listening is checked separately after selection.' };
}

export function canReadBattery(state, normalize) {
  return state.connection === 'Connected' && state.accessible.some(service =>
    service.uuid === normalize('180f') && service.characteristics.some(characteristic =>
      characteristic.uuid === normalize('2a19') && characteristic.operations.includes('read')));
}
